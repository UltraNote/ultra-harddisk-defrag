# Ultra Harddisk Defrag 1.0

A Windows disk optimization suite built as a clean-room rebuild of the workflow found in
IObit Smart Defrag 12 — implemented entirely on top of Microsoft's own storage optimizer.

Electron + React + TypeScript. No kernel driver, no background service, no bundled
third-party engine, no vendor assets.

```
Analyze → Optimize → Trim (SSD) → Boot optimize → Schedule → Health → Report
```

## Why it exists

Smart Defrag does a lot of things right (per-volume analysis, media-aware operations,
idle automation, game-library awareness) and a few things this project refuses to copy
(unsigned kernel drivers, subscription nagging, bundled engines). Ultra Harddisk Defrag 1.0
rebuilds the useful half from documented Windows interfaces:

* every operation maps to a **documented `defrag.exe` switch**, shown in the UI before it runs
* every number comes from **`Get-Volume` / `Get-PhysicalDisk` / `defrag /A` / `fsutil`** —
  nothing is estimated, and unavailable values say so
* SSDs are **trimmed, never defragmented**, driven by the media type Windows reports

## Documentation

Read in this order:

1. [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) — install, elevation, every page, recipes,
   troubleshooting, safety statement, uninstall.
2. [`docs/FEATURES.md`](docs/FEATURES.md) — complete feature inventory, the exact command
   line for each operation, data sources per fact, and what is deliberately missing.
3. [`docs/ROADMAP.md`](docs/ROADMAP.md) — improvement and update plan: 1.1, 1.2, 1.3, 2.0,
   release gates, maintenance rhythm, known issues.
4. [`docs/REVERSE-ENGINEERING.md`](docs/REVERSE-ENGINEERING.md) — what was inspected in the
   commercial product, what was learned, what was deliberately not reused, and how the
   package is verified clean.
5. [`docs/BUILD-AND-VERIFY.md`](docs/BUILD-AND-VERIFY.md) — build, gates, E2E runs, packaging
   and machine quirks.
6. [`CHANGELOG.md`](CHANGELOG.md) — 1.0.0 with the verification results quoted.

## Features at a glance

| Area | What you get |
| --- | --- |
| Dashboard | Volume cards with real fragmentation and usage bars, Optimize all, automation summary, recent runs |
| Defrag | 8 operations (`/A /O /D /X /L /K /B`, quick mode), command preview, dry run, live progress, stats, history |
| Large Files | Bounded scan (25 s budget), threshold picker, pagefile-sized file defrag via `/File` |
| Disk Health | TRIM state, media/bus/health from CIM, SMART only when the provider exposes it |
| Schedule | Idle Auto Defrag (threshold + cool-down), daily/weekly/monthly schedule, boot optimization, silent mode, after-task power actions |
| Game & App Boost | Steam and Epic library detection, per-library retrim/optimize |
| Action Center | Severity-ranked issues computed from live state, Fix All |
| Logs | Five channels, filtering, capped retention |
| Settings | Tray, autostart (HKCU Run), battery guard, exclusions, notifications, log size, reset |

## Elevation

Windows refuses storage-optimizer writes to a standard user token (`0x89000024`). The app
never works around that: it shows the elevation state in the title bar, allows dry runs and
health reads unelevated, and offers a one-click UAC relaunch when a real job is requested.

## Build

```bash
npm install
npm run icon
npm run typecheck && npm run selftest
npm run pack && npm run dist:zip
```

Result: `release/UltraHarddiskDefrag-1.0.0-win-x64.zip` — unzip anywhere and run
`Ultra Harddisk Defrag.exe`. Full details in
[`docs/BUILD-AND-VERIFY.md`](docs/BUILD-AND-VERIFY.md).

## Verification

| Suite | Result |
| --- | --- |
| `npm run typecheck` | clean (node + web) |
| `npm run selftest` | 30 passed, 0 failed |
| `npm run test:ipc` (dev and packaged) | 53 passed, 0 failed, 2 skipped |
| `npm run test:window` | 7 passed, 0 failed |

## Safety

No malware, virus or trojan is bundled, installed or executed — by the app or by its tests.
No IObit binary, driver, string table or asset is reused; the REA pass only read files to
learn behaviour. All disk writes are performed by Microsoft's signed `defrag.exe`. The app's
own write surface is its `%APPDATA%` state folder and, only if you enable it, one HKCU Run
value.

## License

MIT — see [LICENSE](LICENSE).
