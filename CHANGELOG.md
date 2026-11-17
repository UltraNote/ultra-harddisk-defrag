# Changelog

All notable changes to Ultra Harddisk Defrag. Format follows Keep a Changelog; versions are
earned by passing the gates in `docs/ROADMAP.md`.

## [1.0.0] — 2026-11-17

First working release. Built as a clean-room rebuild of the Smart Defrag 12 workflow on top
of Microsoft's documented storage optimizer.

### Added

**Engine** (`src/main/engine`, Electron-free, runnable under `tsx`)

* `defrag.ts` — command builder for nine actions (`analyze`, `optimize`, `traditional`,
  `quick`, `freeSpace`, `retrim`, `slab`, `bootOptimize`, `files`), output parser
  (statistics + progress + completion), elevation-error detection, and a job runner with
  live progress throttling, process-tree cancellation and a single terminal-state exit that
  always emits history.
* `volumes.ts` — volume enumeration via `Get-Volume`/`Get-Partition`/`Get-PhysicalDisk`,
  TRIM state via `fsutil`, physical-disk health with honest SMART availability reporting;
  disks sorted numerically by device id.
* `libraries.ts` — Steam (`libraryfolders.vdf`) and Epic (`.item` manifests) discovery,
  bounded size measurement, bounded large-file scan with truncation reporting.
* `store.ts` — deep-merged settings that survive upgrades, 100-entry history, five-channel
  capped log, stats, per-volume memory, manual library list; best-effort persistence.
* `shell.ts`, `runtime.ts` — command execution with generous buffers, JSON coercion, paths.

**Application**

* Frameless window with a custom title bar showing live elevation and engine state, clamped
  to the work area on creation.
* Nine pages: Dashboard, Defrag, Large Files, Disk Health, Schedule, Game & App Boost,
  Action Center, Logs, Settings.
* Job runner UI: command preview, dry run, phase/percent progress, live `defrag.exe` output,
  fragmentation statistics, history table.
* Automation: idle Auto Defrag (analyze → threshold → optimize, 6 h cool-down), daily/weekly/
  monthly schedule, boot-time optimization request (`/B`), silent mode by process name,
  after-task sleep/hibernate/shutdown/restart with a cancellable countdown.
* Action Center with severity-ranked issues recomputed from live state and a Fix All that
  reports `N of M`.
* Tray icon and menu, single-instance lock, UAC relaunch hand-off, HKCU autostart toggle.
* Amber/graphite theme, CSP locked to `self`, no external assets.

**Tooling**

* `npm run selftest` — 30 engine assertions, no Electron, no elevation.
* `scripts/ipc-test.mjs` — CDP-driven suite against the real main process: 53 assertions.
* `scripts/window-test.mjs` — maximize/work-area, title bar, and a real HKCU Run round-trip.
* `scripts/tour.mjs` — screenshots every page into a temp dir.
* Packaging: procedural icon (`make-icon.mjs` → `make-ico.mjs`), per-user **NSIS installer**
  (`npm run dist`), portable `dist:zip`, `patch-exe.mjs` applying icon and version metadata
  without the winCodeSign toolchain.

**Docs** — `docs/USER-GUIDE.md`, `docs/FEATURES.md`, `docs/ROADMAP.md`,
`docs/REVERSE-ENGINEERING.md`, `docs/BUILD-AND-VERIFY.md`.

### Verified

```
npm run typecheck           clean
npm run selftest            30 passed, 0 failed, 0 skipped
npm run test:ipc  (dev)     53 passed, 0 failed, 2 skipped
npm run test:ipc  (packaged)53 passed, 0 failed, 2 skipped
npm run test:window         7 passed, 0 failed
installer cycle             /S install (75 files + shortcuts + Uninstall key),
                            installed copy passes all 53 IPC assertions, /S uninstall clean
```

Artifacts: `release/UltraHarddiskDefrag-1.0.0-x64.exe` (installer, 78 MB) and
`release/UltraHarddiskDefrag-1.0.0-win-x64.zip` (portable, 107 MB).

### Known limitations

* Analysis and every write operation require Administrator; unelevated requests end in the
  `needs-elevation` state (never a silent failure).
* Scheduled work only runs while the app is running (1.2 addresses this with Task Scheduler).
* Localized (non-English) Windows may return a stats block the parser misses; the raw report
  stays visible in the log box.
* SMART temperature/wear/hours are frequently unavailable for NVMe in user space.
* The installer and binaries are unsigned: Windows SmartScreen warns on first launch.
* Unsigned binary — Windows SmartScreen warns on first run.
