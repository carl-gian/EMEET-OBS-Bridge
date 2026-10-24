// The EMEET click coordinates are physical screen pixels laid out for a 1920x1080 primary display. Any other
// resolution would click the wrong spots, so the app refuses to run. Windows scaling (125%, 150% ...) is fine as
// long as the PHYSICAL resolution is 1920x1080, so we multiply Electron's scaled (DIP) size by the scale factor.

export const REQUIRED_WIDTH = 1920
export const REQUIRED_HEIGHT = 1080

export interface DisplayCheck {
  ok: boolean
  width: number // physical pixels
  height: number
}

export function checkPrimaryDisplay(size: { width: number; height: number }, scaleFactor: number): DisplayCheck {
  const width = Math.round(size.width * scaleFactor)
  const height = Math.round(size.height * scaleFactor)
  return { ok: width === REQUIRED_WIDTH && height === REQUIRED_HEIGHT, width, height }
}

export function displayErrorText(c: DisplayCheck): { title: string; message: string; detail: string } {
  return {
    title: 'EMEET–OBS Bridge has stopped working',
    message: 'EMEET–OBS Bridge has stopped working.',
    detail:
      `Your main display is ${c.width} x ${c.height}. This program only works when the main display is exactly ${REQUIRED_WIDTH} x ${REQUIRED_HEIGHT} (1080p), ` +
      `because the camera buttons are clicked at fixed screen positions.\n\n` +
      `To fix it: set your main display to 1920 x 1080 in Windows (Settings > System > Display > Display resolution), then start the program again. ` +
      `Only the main display is checked; a second display does not matter.`
  }
}
