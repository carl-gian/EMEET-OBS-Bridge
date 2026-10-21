# How to get the Windows installer (.exe)

You do this once to set up, then every new version is just a few clicks.
GitHub's free Windows computers build the installer for you.

## One-time setup

1. Make a free account at https://github.com (skip if you have one).
2. Install **GitHub Desktop** from https://desktop.github.com and sign in.
3. In GitHub Desktop: **File > Add local repository...** and choose this project folder
   ("Project New Emeet Partner Program").
   - It will say "this directory does not appear to be a Git repository" - click **create a repository**.
   - Name: `EMEET-OBS-Bridge`. Leave the rest. Click **Create repository**.
4. Click **Publish repository**. **Tick "Keep this code private"**. Click Publish.
   - The folders `Legacy`, `meeting-media-manager-master` and `obs-transition-table-master` are
     NOT uploaded on purpose (your old config holds your OBS password).

## Every time you want a new installer

1. In GitHub Desktop: type a short note in the box bottom-left, click **Commit to main**, then **Push origin**.
2. Open your repository page on github.com, click the **Actions** tab.
3. Click **Build Windows installer** (left), then **Run workflow** > **Run workflow** (green).
   (It also starts by itself after every push.)
4. Wait about 3-5 minutes until the circle turns into a green tick. Click the run.
5. At the bottom, under **Artifacts**, click **EMEET-OBS-Bridge-Setup** to download a zip.
6. Unzip it and double-click `EMEET-OBS-Bridge-Setup-x.y.z.exe`.
   - Windows shows "Windows protected your PC": click **More info**, then **Run anyway** (the app isn't code-signed).
7. Finish the installer. The app opens; its icon sits in the tray (bottom-right, maybe under the ^ arrow).

If the run shows a red cross, click it, copy the red error text and send it to me.

## First run on the Windows PC

1. **OBS**: Tools > WebSocket Server Settings > tick *Enable WebSocket server*, note port + password. Turn on **Studio Mode**.
2. In the app: **Settings > OBS** - type the port/password. **Settings > General** - Browse to the EMEET Studio exe (and OBS exe).
3. Open EMEET Studio. In **Settings > Camera** press **Test click** on a preset - the camera should move without EMEET coming to the front.
4. Closing (X) or minimizing the window hides it to the tray. To really quit: right-click the tray icon > **Quit ...** and confirm.

## Sending me logs

In the app: **Export diagnostics** (top bar, or tray icon > Export diagnostics). It saves a zip on your Desktop.
It contains the logs, your settings **without the password**, and version info. Send me that zip.
(**Open logs** opens the folder: `%APPDATA%\OBS Master Controller\logs` - `app.log` has everything, `ptz.log` only the camera clicks.)
