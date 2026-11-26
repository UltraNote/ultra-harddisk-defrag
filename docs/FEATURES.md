# Ultra Harddisk Defrag 1.0 — Feature Inventory

Complete list of what exists in 1.0, how each feature is implemented, and where the data
comes from. Anything not in this file does not exist yet — `docs/ROADMAP.md` holds the
planned work and is explicit about what is *not* implemented.

---

## 1. Functional areas

| # | Area | Page | Status |
| --- | --- | --- | --- |
| 1 | Volume discovery and classification | Dashboard | complete |
| 2 | Fragmentation analysis | Defrag | complete |
| 3 | Eight defrag/optimize operations | Defrag | complete |
| 4 | Targeted file defrag (`/File`) | Large Files | complete |
| 5 | Large-file discovery | Large Files | complete |
| 6 | Disk health & TRIM state | Disk Health | complete |
| 7 | Idle auto-defrag | Schedule | complete |
| 8 | Scheduled defrag | Schedule | complete |
| 9 | Boot-time optimization (`/B`) | Schedule | complete |
| 10 | Silent mode (process watch) | Schedule | complete |
| 11 | After-task power actions | Schedule | complete |
| 12 | Game/app library boost | Game & App Boost | complete |
| 13 | Action Center with Fix All | Action Center | complete |
| 14 | Operation log | Logs | complete |
| 15 | Settings & persistence | Settings | complete |
| 16 | Tray icon, notifications, single instance | shell | complete |
| 17 | Elevation hand-off (UAC relaunch) | shell | complete |
| 18 | Dry run / command preview | Defrag | complete |
| 19 | Job cancellation | Defrag | complete |

---

## 2. Operations and their exact command lines

Every command is produced by `src/main/engine/defrag.ts → buildCommand()` and displayed in
the UI before execution. No undocumented flags are invented.

| Action | Command | Notes |
| --- | --- | --- |
| `analyze` | `defrag.exe <vol> /A /V` | Read-only report. |
| `optimize` | `defrag.exe <vol> /O /U /V` | Preferred operation for media type. |
| `traditional` | `defrag.exe <vol> /D /U /V` | Full defrag, HDD. |
| `quick` | `defrag.exe <vol> /O /U` | No verbose report. |
| `freeSpace` | `defrag.exe <vol> /X /U /V` | Free-space consolidation. |
| `retrim` | `defrag.exe <vol> /L /U` | TRIM/retrim, SSD. |
| `slab` | `defrag.exe <vol> /K /U` | Slab consolidation. |
| `bootOptimize` | `defrag.exe <vol> /B` | Run Windows boot-file optimization on a detected HDD. |
| `files` | `defrag.exe <vol> /D /U /File <path…>` | Targeted defrag, volume-checked. |

Volume identifiers accept `C`, `C:`, `C:\` and `\\?\Volume{guid}\`; anything else is
rejected before a process is spawned.

---

## 3. Data sources (all first-party Windows)

| Fact | Source | Elevation needed |
| --- | --- | --- |
| Volume list, label, FS, size, free, health | PowerShell `Get-Volume` | no |
| Partition → disk mapping | `Get-Partition` | no |
| Physical disk, media type, bus | `Get-PhysicalDisk` | no |
| Reliability counters (temp/wear/hours/errors) | storage reliability counters via the volume script | partial |
| TRIM state | `fsutil behavior query DisableDeleteNotify` | no |
| Fragmentation statistics | `defrag.exe /A /V` output | yes |
| ATA SMART attribute table | `root\WMI MSStorageDriver_ATAPISmartData` | yes, often absent on NVMe |
| Steam libraries | registry `HKCU\Software\Valve\Steam` + `libraryfolders.vdf` | no |
| Epic libraries | `%PROGRAMDATA%\Epic\…\Manifests\*.item` | no |
| Battery state | Electron `powerMonitor.isOnBatteryPower()` | no |
| Idle time | Electron `powerMonitor.getSystemIdleTime()` | no |

Nothing is estimated. A value that the source does not return is `null` in the model and
`—` / *unavailable* in the UI.

---

## 4. Feature detail

### 4.1 Volume discovery
* System volume flagged (`isSystem`) and accented in the UI.
* Media type drives every default: SSD → retrim, HDD → defrag.
* Non-fixed volumes (removable, network, optical) are labelled and excluded from automation.
* Refresh on demand, every 60 s in the background, and cached for 15 s to avoid hammering
  PowerShell.

### 4.2 Fragmentation analysis
`parseDefragOutput()` extracts, when present:

* total fragmented space %, average fragments per file, fragmented files, excess fragments
* folders, average fragments per folder, scattered files
* volume size, cluster size, percent free space
* progress percentages (highest value seen wins) and completion markers

The raw report tail (20 kB) is kept on the stats object for troubleshooting.

### 4.3 Job engine
* One job at a time; a second request while running returns the running job.
* Live progress throttled to ~6 updates/second.
* Cancellation kills the process tree and records `cancelled`.
* Terminal states: `completed`, `failed`, `cancelled`, `needs-elevation`.
  Every terminal state produces a history entry (including refusals).
* Exit codes and the last output lines are captured for failures.

### 4.4 Targeted file defrag
* Volume must match the file's drive letter; mismatches are rejected.
* Empty selections are refused with an explicit error.

### 4.5 Large-file scan
* Bounded depth-first walk, skipping Windows/system/recycle/driver trees.
* 25 s budget, 4000-entry working set, top-`limit` returned sorted by size.
* Truncation is reported in the log (`time budget reached`).

### 4.6 Health
* TRIM state mapped to enabled/disabled/unknown.
* Disks sorted numerically by device id.
* SMART availability stated as a source string, not faked.

### 4.7 Automation
* Auto Defrag: idle gate → analyze → optimize only above threshold → 6 h cool-down.
* Scheduled: daily/weekly/monthly, one run per day, battery guard, silent-mode gate,
  optional shutdown with countdown and cancel. The app remembers the latest run across restarts.
* Boot optimization: settings toggles + on-demand `/B` execution.
* Exclusion list honoured by both automatic paths; manual runs unaffected.

### 4.8 Elevation hand-off
`relaunchElevated()` re-launches `process.execPath` (plus the app path in dev) through
`Start-Process -Verb RunAs`, then quits the current instance so the single-instance lock
passes to the new process.

### 4.9 Persistence
`settings.json` (deep-merged with defaults so upgrades never lose new keys), `history.json`
(100 entries), `state/{logs,stats,volumes,libraries}.json`. Writes are best-effort: a failed
write logs and never crashes the app.

### 4.10 Icon and branding

`scripts/make-icon.mjs` draws the application icon analytically (no image library): a round platter
with three fragmented teal arcs on the left and one consolidated amber arc on the right, around an
amber spindle, on a graphite tile with a rim light so it stays visible on a dark taskbar.

* Rendered at 16, 24, 32, 48, 64, 128 and 256 px — each size drawn natively with 4x supersampling,
  never downscaled, so the 32 px taskbar icon keeps its arc separation.
* `scripts/make-ico.mjs` packs all sizes into a multi-entry `build/icon.ico`.
* `build/icon-preview.png` shows every size side by side for review.
* Deliberately unlike **Ultra Malware Fighter's** blue shield — the two apps must never be confused in
  the taskbar, tray or installer list.
- Electron Builder applies the executable icon. The window and tray use `build/icon.png`, which
  `electron-builder.yml` copies to `resources/icon.png`
  (`nativeIcon()` reads `process.resourcesPath` when packaged).

### 4.11 UI surface
Nine pages, custom frameless title bar with live elevation/engine chips, amber/graphite
theme, no external font or asset dependency, CSP locked to `self`.

---

## 5. Test coverage (what actually runs)

| Suite | Command | Assertions |
| --- | --- | --- |
| Engine self-test (no Electron, no elevation) | `npm run selftest` | 30 |
| IPC/E2E over CDP against the real main process | `npm run test:ipc` | 53 (+2 skipped) |
| Window, maximize and autostart round-trip | `npm run test:window` | 7 |
| Typecheck | `npm run typecheck` | node + web projects |

Engine assertions cover: all nine command lines, bare-letter volume normalisation, invalid
volume rejection, empty file-list rejection, statistics parsing, progress parsing, elevation
text detection, live volume enumeration, system-volume detection, TRIM read, physical-disk
enumeration, `defrag.exe` callability, large-file scan on a fixture, dry-run semantics,
the elevation gate, history emission for every job, preview output, settings persistence
across instances, log recording, history/stats counters and per-volume memory.

---

## 6. Deliberate non-features (1.0)

These exist in the commercial product this app was modelled on, and are **not** in 1.0:

* Kernel-mode defrag driver, boot-time file-type defrag execution (only the `/B` request).
* Registry/file-type boot optimization performed by the app itself.
* "RAM disk"/prefetch caching, temperature-driven fan control.
* Cloud/subscription accounts, news feed, update nagging.
* Any bundled third-party engine.

Each one is tracked in `docs/ROADMAP.md` with the reason it is or is not worth building.
