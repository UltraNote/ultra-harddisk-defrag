# Build and verify

Use Windows 10 or 11, Node.js 22.12 or newer, and a standard user session for automated desktop verification.

## Install dependencies and build

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

If an npm install-script policy prevented Electron's installer from running, run
`node node_modules/electron/install.js` before starting Electron. The icon assets are checked in.
Run `npm run icon` to regenerate them after changing the artwork.

## Test the desktop app

```powershell
npm run test:desktop
npm run dist
npm run test:desktop -- 'release/win-unpacked/Ultra Harddisk Defrag.exe'
```

The desktop harness launches each copy with a temporary profile and a loopback DevTools port.
It checks the preload bridge, media-aware previews, the Administrator gate, dry runs, ordered batches,
health, large-file scans, manual libraries, all nine pages, and window controls. The window suite
tests the real HKCU Run value, including reset, and restores its prior value afterward.
Run desktop suites sequentially because they share that registry value.

The engine self-test probes Windows read-only and uses temporary fixture files for scans and persistence.
The automated desktop suite skips the UAC prompt and native file picker. Actual disk optimization,
scheduler execution, and system power transitions require a dedicated test machine or VM.

For manual screenshots, launch an isolated development or packaged copy with
`--remote-debugging-port=9333` and run `node scripts/tour.mjs 9333` while the window is open.

## Installer and portable ZIP

| Command | Output |
| --- | --- |
| `npm run dist` | Per-user NSIS installer and unpacked app |
| `npm run pack` | Unpacked app under `release/win-unpacked` |
| `npm run dist:zip` | Portable ZIP containing the unpacked app |

Electron Builder applies the executable icon and version metadata during packaging. Windows tar
creates the portable ZIP. The packaged app includes the tray icon under `resources/icon.png`.

On a Windows account without an existing installation, verify the installer in a temporary directory.

```powershell
$testInstall = Join-Path $env:TEMP ('udefrag-install-' + [guid]::NewGuid())
$setup = Start-Process -FilePath (Resolve-Path 'release/UltraHarddiskDefrag-1.0.0-x64.exe') `
  -ArgumentList @('/S', ('/D=' + $testInstall)) -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw 'Installation failed' }
try {
  node scripts/desktop-test.mjs (Join-Path $testInstall 'Ultra Harddisk Defrag.exe')
  if ($LASTEXITCODE -ne 0) { throw 'Installed desktop checks failed' }
} finally {
  $uninstaller = Join-Path $testInstall 'Uninstall Ultra Harddisk Defrag.exe'
  Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
}
```

Verify the application executable, shortcuts, and the uninstall entry are gone. To check the ZIP,
run `tar -tf release/UltraHarddiskDefrag-1.0.0-win-x64.zip` and test the extracted executable
with the same desktop harness.
