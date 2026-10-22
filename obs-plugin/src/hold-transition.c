/*
EMEET-OBS Bridge Transition: fade to a picture, hold, fade to the next scene.

Adapted from OBS Studio's own "Fade to Color" transition (plugins/obs-transitions), GPL v2 or later.

Timeline (t runs 0..1 over the transition duration, which the Bridge sets to 2*fade + hold):
  0 .. p1   scene A fades into the picture
  p1 .. p2  the picture is shown on its own (the camera moves while it is covered)
  p2 .. 1   the picture fades into scene B

Safety rules (a bug here can take OBS down during a live meeting):
  - no threads, no network, no allocation in the render loop;
  - every pointer is checked; a missing or unreadable picture simply renders as plain black;
  - the picture and the timing values are only touched while the graphics context is held, so the
    render thread and the thread that calls update() can never use them at the same time.
*/

#include <obs-module.h>
#include <graphics/image-file.h>
#include <plugin-support.h>

#define S_IMAGE "image_path"
#define S_FADE_MS "fade_ms"
#define S_HOLD_MS "hold_ms"
#define S_PLUGIN_VERSION "plugin_version"

#define DEFAULT_FADE_MS 500
#define DEFAULT_HOLD_MS 3500
#define MAX_FADE_MS 10000
#define MAX_HOLD_MS 60000

struct hold_transition {
	obs_source_t *source;

	gs_effect_t *effect;
	gs_eparam_t *ep_tex;
	gs_eparam_t *ep_img;
	gs_eparam_t *ep_swp;
	gs_eparam_t *ep_img_size;
	gs_eparam_t *ep_has_img;

	/* Touched only while the graphics context is held. */
	gs_image_file4_t *image;
	float p1;
	float p2;

	/* Touched only by update(). */
	char *image_path;
};

static inline float clampf(float x, float lo, float hi)
{
	if (x < lo)
		return lo;
	if (x > hi)
		return hi;
	return x;
}

static inline float smoothstepf(float lo, float hi, float x)
{
	if (hi <= lo)
		return x >= hi ? 1.0f : 0.0f;
	x = clampf((x - lo) / (hi - lo), 0.0f, 1.0f);
	return x * x * (3.0f - 2.0f * x);
}

static const char *hold_get_name(void *type_data)
{
	UNUSED_PARAMETER(type_data);
	return obs_module_text("EmeetBridgeHoldTransition");
}

/* Call with the graphics context held. */
static void hold_free_image(struct hold_transition *s)
{
	if (s->image) {
		gs_image_file4_free(s->image);
		bfree(s->image);
		s->image = NULL;
	}
}

static void hold_update(void *data, obs_data_t *settings)
{
	struct hold_transition *s = data;
	if (!s || !settings)
		return;

	long long fade = obs_data_get_int(settings, S_FADE_MS);
	long long hold = obs_data_get_int(settings, S_HOLD_MS);
	if (fade < 0)
		fade = 0;
	if (fade > MAX_FADE_MS)
		fade = MAX_FADE_MS;
	if (hold < 0)
		hold = 0;
	if (hold > MAX_HOLD_MS)
		hold = MAX_HOLD_MS;

	const float total = (float)(2 * fade + hold);
	float p1 = 0.0f;
	float p2 = 0.0f;
	if (total > 0.0f) {
		p1 = (float)fade / total;
		p2 = (float)(fade + hold) / total;
	}

	const char *path = obs_data_get_string(settings, S_IMAGE);
	const char *new_path = (path && *path) ? path : NULL;
	const char *cur_path = s->image_path;
	const bool reload = ((new_path == NULL) != (cur_path == NULL)) || (new_path && cur_path && strcmp(new_path, cur_path) != 0);

	/* Decode the file outside the graphics lock (slow part); create the texture inside it. */
	gs_image_file4_t *img = NULL;
	if (reload && new_path) {
		img = bzalloc(sizeof(gs_image_file4_t));
		gs_image_file4_init(img, new_path, GS_IMAGE_ALPHA_PREMULTIPLY);
	}

	obs_enter_graphics();
	s->p1 = p1;
	s->p2 = p2;
	if (reload) {
		hold_free_image(s);
		if (img) {
			gs_image_file4_init_texture(img);
			if (img->image3.image2.image.loaded && img->image3.image2.image.texture) {
				s->image = img;
				img = NULL;
			}
		}
	}
	obs_leave_graphics();

	if (img) {
		/* The picture could not be used: free it (needs the graphics context) and render plain black. */
		blog(LOG_WARNING, "[%s] could not load picture '%s' - using plain black", PLUGIN_NAME, new_path ? new_path : "");
		obs_enter_graphics();
		gs_image_file4_free(img);
		obs_leave_graphics();
		bfree(img);
	}

	if (reload) {
		bfree(s->image_path);
		s->image_path = new_path ? bstrdup(new_path) : NULL;
	}
}

static void *hold_create(obs_data_t *settings, obs_source_t *source)
{
	char *file = obs_module_file("emeet_bridge_hold.effect");
	if (!file) {
		blog(LOG_ERROR, "[%s] could not find emeet_bridge_hold.effect", PLUGIN_NAME);
		return NULL;
	}

	obs_enter_graphics();
	gs_effect_t *effect = gs_effect_create_from_file(file, NULL);
	obs_leave_graphics();
	bfree(file);

	if (!effect) {
		blog(LOG_ERROR, "[%s] could not compile emeet_bridge_hold.effect", PLUGIN_NAME);
		return NULL;
	}

	struct hold_transition *s = bzalloc(sizeof(struct hold_transition));
	s->source = source;
	s->effect = effect;
	s->ep_tex = gs_effect_get_param_by_name(effect, "tex");
	s->ep_img = gs_effect_get_param_by_name(effect, "img");
	s->ep_swp = gs_effect_get_param_by_name(effect, "swp");
	s->ep_img_size = gs_effect_get_param_by_name(effect, "img_size");
	s->ep_has_img = gs_effect_get_param_by_name(effect, "has_img");

	obs_source_update(source, settings);
	return s;
}

static void hold_destroy(void *data)
{
	struct hold_transition *s = data;
	if (!s)
		return;

	obs_enter_graphics();
	hold_free_image(s);
	if (s->effect)
		gs_effect_destroy(s->effect);
	obs_leave_graphics();

	bfree(s->image_path);
	bfree(s);
}

static void hold_callback(void *data, gs_texture_t *a, gs_texture_t *b, float t, uint32_t cx, uint32_t cy)
{
	struct hold_transition *s = data;
	if (!s || !a || !b)
		return;

	/* swp = how much picture to mix over the scene; base = which scene is underneath. */
	gs_texture_t *base;
	float swp;
	if (t < s->p1) {
		base = a;
		swp = smoothstepf(0.0f, s->p1, t);
	} else if (t < s->p2) {
		base = a;
		swp = 1.0f;
	} else {
		base = b;
		swp = 1.0f - smoothstepf(s->p2, 1.0f, t);
	}

	gs_texture_t *img_tex = NULL;
	struct vec2 size;
	vec2_set(&size, 1.0f, 1.0f);
	if (s->image) {
		img_tex = s->image->image3.image2.image.texture;
		const float iw = (float)s->image->image3.image2.image.cx;
		const float ih = (float)s->image->image3.image2.image.cy;
		if (img_tex && iw > 0.0f && ih > 0.0f && cx > 0 && cy > 0) {
			const float ia = iw / ih;
			const float ca = (float)cx / (float)cy;
			if (ia > ca)
				vec2_set(&size, 1.0f, ca / ia);
			else
				vec2_set(&size, ia / ca, 1.0f);
		}
	}

	const bool nonlinear = gs_get_color_space() == GS_CS_SRGB;
	const bool previous = gs_framebuffer_srgb_enabled();
	gs_enable_framebuffer_srgb(!nonlinear);

	gs_texture_t *img_or_base = img_tex ? img_tex : base;
	if (nonlinear) {
		gs_effect_set_texture(s->ep_tex, base);
		gs_effect_set_texture(s->ep_img, img_or_base);
	} else {
		gs_effect_set_texture_srgb(s->ep_tex, base);
		gs_effect_set_texture_srgb(s->ep_img, img_or_base);
	}
	gs_effect_set_float(s->ep_swp, swp);
	gs_effect_set_vec2(s->ep_img_size, &size);
	gs_effect_set_float(s->ep_has_img, img_tex ? 1.0f : 0.0f);

	while (gs_effect_loop(s->effect, "HoldImage"))
		gs_draw_sprite(NULL, 0, cx, cy);

	gs_enable_framebuffer_srgb(previous);
}

static void hold_video_render(void *data, gs_effect_t *effect)
{
	UNUSED_PARAMETER(effect);
	struct hold_transition *s = data;
	if (!s)
		return;

	const bool previous = gs_set_linear_srgb(true);
	obs_transition_video_render(s->source, hold_callback);
	gs_set_linear_srgb(previous);
}

/* Audio: scene A fades out during the first fade, stays silent during the hold, scene B fades in during the last fade. */
static float hold_mix_a(void *data, float t)
{
	struct hold_transition *s = data;
	if (!s || t >= s->p1)
		return 0.0f;
	return 1.0f - smoothstepf(0.0f, s->p1, t);
}

static float hold_mix_b(void *data, float t)
{
	struct hold_transition *s = data;
	if (!s || t < s->p2)
		return 0.0f;
	return smoothstepf(s->p2, 1.0f, t);
}

static bool hold_audio_render(void *data, uint64_t *ts_out, struct obs_source_audio_mix *audio, uint32_t mixers,
			      size_t channels, size_t sample_rate)
{
	struct hold_transition *s = data;
	if (!s)
		return false;
	return obs_transition_audio_render(s->source, ts_out, audio, mixers, channels, sample_rate, hold_mix_a,
					   hold_mix_b);
}

static obs_properties_t *hold_properties(void *data)
{
	UNUSED_PARAMETER(data);
	obs_properties_t *props = obs_properties_create();

	obs_properties_add_path(props, S_IMAGE, obs_module_text("Picture"), OBS_PATH_FILE,
				"Pictures (*.png *.jpg *.jpeg *.bmp);;All files (*.*)", NULL);
	obs_property_t *p = obs_properties_add_int(props, S_FADE_MS, obs_module_text("FadeMs"), 0, MAX_FADE_MS, 10);
	obs_property_int_set_suffix(p, " ms");
	p = obs_properties_add_int(props, S_HOLD_MS, obs_module_text("HoldMs"), 0, MAX_HOLD_MS, 100);
	obs_property_int_set_suffix(p, " ms");
	return props;
}

static void hold_defaults(obs_data_t *settings)
{
	obs_data_set_default_string(settings, S_IMAGE, "");
	obs_data_set_default_int(settings, S_FADE_MS, DEFAULT_FADE_MS);
	obs_data_set_default_int(settings, S_HOLD_MS, DEFAULT_HOLD_MS);
	obs_data_set_default_string(settings, S_PLUGIN_VERSION, PLUGIN_VERSION);
}

static enum gs_color_space hold_video_get_color_space(void *data, size_t count,
						      const enum gs_color_space *preferred_spaces)
{
	struct hold_transition *s = data;
	const enum gs_color_space transition_space = obs_transition_video_get_color_space(s->source);

	enum gs_color_space space = transition_space;
	for (size_t i = 0; i < count; ++i) {
		space = preferred_spaces[i];
		if (space == transition_space)
			break;
	}
	return space;
}

struct obs_source_info emeet_bridge_hold_transition = {
	.id = "emeet_bridge_hold_transition",
	.type = OBS_SOURCE_TYPE_TRANSITION,
	.get_name = hold_get_name,
	.create = hold_create,
	.destroy = hold_destroy,
	.update = hold_update,
	.video_render = hold_video_render,
	.audio_render = hold_audio_render,
	.get_properties = hold_properties,
	.get_defaults = hold_defaults,
	.video_get_color_space = hold_video_get_color_space,
};
