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
npm run dist       # electron-vite build + electron-builder --win --x64  (builds the NSIS installer)
```

Outputs:

| File | Size | Notes |
| --- | --- | --- |
| `release/UltraHarddiskDefrag-1.0.0-x64.exe` | 78 MB | per-user NSIS installer + `.blockmap` |
| `release/UltraHarddiskDefrag-1.0.0-win-x64.zip` | 107 MB | portable folder |
| `release/win-unpacked/` | 269 MB | unpacked build, used by the E2E suites |

### Icon pipeline

```bash
npm run icon     # make-icon.mjs (7 native sizes + preview sheet) -> make-ico.mjs (multi-entry ico)
```

`electron-builder.yml` runs `afterPack: scripts/after-pack.cjs`, which calls `scripts/patch-exe.mjs`
(rcedit from the electron-builder cache) *inside* the packaging step. That ordering matters: patching
`release/win-unpacked` after the fact is lost the moment the NSIS installer re-packages the app, which
is exactly how the exe ended up with Electron's atom icon in the first packaging attempt. Verify with:

```bash
powershell -NoProfile -Command 'Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Icon]::ExtractAssociatedIcon("release\win-unpacked\Ultra Harddisk Defrag.exe"); $i.ToBitmap().Save("$env:TEMP\exe-icon.png")'
```

and look at the PNG, or compare `release\win-unpacked\resources\icon.png` with `build/icon.png`.

### Installer build note

An earlier attempt failed while electron-builder extracted the `winCodeSign` archive
(`Cannot create symbolic link : A required privilege is not held by the client` — that
archive contains macOS symlinks). It succeeds in a **standard** shell once the cache holds an
extracted copy and `signAndEditExecutable: false` keeps the toolchain out of the rcedit path.
If the error ever returns:

```bash
7za x "$LOCALAPPDATA/electron-builder/Cache/winCodeSign/<n>.7z" -o"$LOCALAPPDATA/electron-builder/Cache/winCodeSign/<n>" -snld -x'!darwin*'
```

### Installer verification (run for 1.0)

```bash
# silent install into a throwaway directory, then run the installed copy
powershell -NoProfile -Command "Start-Process -FilePath 'release\UltraHarddiskDefrag-1.0.0-x64.exe' \
  -ArgumentList '/S','/D=C:\Users\<user>\AppData\Local\Temp\udefrag-install' -PassThru -Wait"
node scripts/ipc-test.mjs 9338        # 53 passed, 0 failed, 2 skipped
# silent uninstall, then confirm the tree, shortcuts and Uninstall key are gone
```

Git Bash mangles `/S` and `/D=...` (backslashes are eaten: `/D=C:\Users\x` becomes
`C:Usersx`). Either use PowerShell `Start-Process -ArgumentList` as above, or
`MSYS2_ARG_CONV_EXCL='*'` plus a single-quoted `/D='C:\path'`.

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
