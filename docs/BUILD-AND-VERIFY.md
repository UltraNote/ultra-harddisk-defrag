# Build & Verify

Every command below was run on this machine (Windows 11 26200, node v26.11.1, npm 11.20.0).

## 1. Setup

```bash
npm install
# If `electron --version` fails with "Electron failed to install correctly", the postinstall
# was skipped. Fix without reinstalling:
#   unzip %LOCALAPPDATA%\electron\Cache\electron-v33.4.11-win32-x64.zip into node_modules/electron/dist
#   printf 'electron.exe' > node_modules/electron/path.txt
npm run icon      # build/icon.png + build/icon.ico
```

## 2. Gates

| Gate | Command | Expected |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | no output |
| Engine self-test | `npm run selftest` | `30 passed, 0 failed, 0 skipped` |
| Build | `npm run build` | `out/main`, `out/preload`, `out/renderer` |
| IPC / E2E | see below | `53 passed, 0 failed, 2 skipped` |
| Window + autostart | see below | `7 passed, 0 failed` |

The self-test needs no elevation and writes only to a temp folder that it deletes.

## 3. Running the E2E suites

The app must be running with a DevTools port. Only one instance can run at a time (single
instance lock), so stop any previous instance first.

```bash
# dev build
./node_modules/.bin/electron out/main/index.js --remote-debugging-port=9333 &
node scripts/ipc-test.mjs 9333
node scripts/window-test.mjs 9333

# packaged build (the important one — it is what users get)
"release/win-unpacked/Ultra Harddisk Defrag.exe" --remote-debugging-port=9334 &
node scripts/ipc-test.mjs 9334
node scripts/window-test.mjs 9334

# screenshots of all nine pages (temp dir, nothing lands in the repo)
node scripts/tour.mjs 9334
```

To stop a stray instance without killing unrelated Electron apps:

```bash
PID=$(netstat -ano | grep ':9333 ' | awk '{print $NF}' | head -1)
powershell -NoProfile -Command "Stop-Process -Id $PID -Force"
```

## 4. Packaging

```bash
npm run pack       # electron-vite build + electron-builder --dir + icon/version patching
npm run dist:zip   # pack + 7z zip of release/win-unpacked
```

Output: `release/UltraHarddiskDefrag-1.0.0-win-x64.zip` (≈107 MB).

`npm run dist` (NSIS installer) needs an **elevated** terminal on this machine:
electron-builder extracts `winCodeSign` with symlinks and a standard token cannot create
them (`Cannot create symbolic link : A required privilege is not held by the client`).
`signAndEditExecutable: false` plus `scripts/patch-exe.mjs` (rcedit) applies the icon and
version metadata without that toolchain.

## 5. What each suite actually asserts

* **selftest** — command construction for all nine actions, volume normalisation (including
  bare letters), invalid-volume and empty-file-list rejection, stats parsing, progress
  parsing, elevation text detection, live volume/disk/TRIM enumeration, `defrag.exe`
  callability, large-file scan on a fixture, dry-run and elevation-gate semantics, history
  emission for every terminal state, settings persistence across instances, log/history/stats
  bookkeeping, per-volume memory.
* **ipc-test** — the preload bridge (32 methods), status/volumes/health/libraries/logs via
  IPC, all eight command previews, dry run, elevation gate, progress events, history,
  disk sorting/media types, action center, fix-all, log clear, settings save/read/reset,
  rendered shell and navigation. Two checks are knowingly skipped: `relaunchElevated`
  (would raise a UAC prompt) and `pickFiles` (native dialog).
* **window-test** — maximize fills the work area and restores, the title bar carries the
  product name, and the autostart toggle really writes and removes the HKCU Run value
  (`work.selman.ultra-harddisk-defrag`).

## 6. Machine notes

* This host's display is 1280×720 (work area 672 px tall) at 300 % scaling, so the window
  clamps to the work area on creation — verify layouts at that size, not only at 1440×900.
* `taskkill //IM electron.exe //F` from Git Bash is unreliable; resolve the PID from
  `netstat -ano` and use `Stop-Process -Id`.
* Registry check used by the window test:
  `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v work.selman.ultra-harddisk-defrag`
