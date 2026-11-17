# Ultra Harddisk Defrag 1.0 — User Guide

Everything this program does is done by Windows' own storage optimizer, `defrag.exe`.
Ultra Harddisk Defrag is the cockpit: it enumerates your disks, explains which operation
fits each media type, shows the exact command line before it runs, streams the progress,
parses the fragmentation report, and remembers what happened.

Nothing else is installed. No driver, no service, no background agent, no bundled
third-party engine. If you delete the folder, the program is gone.

---

## 1. Installation

Three packages are produced by the build, all from the same sources:

| Package | Size | What it does |
| --- | --- | --- |
| `release/UltraHarddiskDefrag-1.0.0-x64.exe` | 78 MB | **Installer** (NSIS, per-user). Shortcuts, uninstall entry, no Administrator needed to install. |
| `release/UltraHarddiskDefrag-1.0.0-win-x64.zip` | 107 MB | Portable folder. Unzip anywhere, run `Ultra Harddisk Defrag.exe`. |
| `release/win-unpacked/` | — | The same build, already unpacked (this is what the test suite drives). |

### Installing with the installer

1. Double-click `UltraHarddiskDefrag-1.0.0-x64.exe`.
2. SmartScreen warns because the binary is unsigned — *More info → Run anyway*.
3. The assisted wizard offers the per-user target directory (default
   `%LOCALAPPDATA%\Programs\ultra-harddisk-defrag`), then creates a Start-menu shortcut,
   an optional desktop shortcut and an entry under *Apps & features*.
4. No Administrator prompt: the install is per-user by design (`perMachine: false`).

Silent install (unattended, no wizard):

```bat
UltraHarddiskDefrag-1.0.0-x64.exe /S
UltraHarddiskDefrag-1.0.0-x64.exe /S /D=C:\Tools\UltraHarddiskDefrag
```

`/D=` must be the **last** argument, unquoted, with real backslashes.

### Uninstalling

*Apps & features → Ultra Harddisk Defrag 1.0 → Uninstall*, or run
`"<install dir>\Uninstall Ultra Harddisk Defrag.exe"` (add `/S` for silent). Settings and
history in `%APPDATA%\Ultra Harddisk Defrag` are kept; delete that folder too for a full
removal.

The portable zip remains the way to try the app without touching the system at all.

First start creates `%APPDATA%\Ultra Harddisk Defrag\`:

```
settings.json          your preferences
history.json           last 100 runs (action, volume, duration, state, fragmentation before/after)
state/logs.json        operation log, capped by the log setting
state/stats.json       counters
state/volumes.json     last action per volume
state/libraries.json   folders you added on the Game & App Boost page
```

Delete that folder to return to factory defaults.

---

## 2. Elevation: the one rule you cannot skip

Windows refuses every storage-optimizer write operation to a standard user token and
returns **`0x89000024`** ("insufficient privileges"). Ultra Harddisk Defrag does not try
to work around that, because the workaround would be a kernel driver.

* The title bar always shows either **Administrator** (green dot) or **Standard user** (red dot).
* With a standard token you can still browse volumes, read health, generate command previews,
  run **dry runs** (validation without execution) and configure settings.
* Any real analyze/optimize/retrim attempt stops at the elevation gate and offers a
  **Relaunch as Administrator** button (UAC prompt, then the app restarts elevated).

> Analysis also needs elevation on a stock Windows installation: `defrag /A` opens the
> volume for writes. If your build lets analysis through, you will see real numbers
> immediately; if not, the gate explains itself instead of pretending.

---

## 3. The pages

### 3.1 Dashboard

* **Stat cards** — volumes, average fragmentation (only over analyzed volumes), last
  optimization, disk health.
* **Volume cards** — one row per volume: letter badge, label, file system, size/free,
  media type (SSD/HDD/Unspecified from `Get-PhysicalDisk`), fragmentation bar, usage bar,
  last action, and buttons:
  * **Analyze** — `defrag.exe X: /A /V`
  * **Optimize / Trim** — `defrag.exe X: /O /U /V` on HDD, `defrag.exe X: /L /U` on SSD
  * **→** — opens the full toolbox for that volume
* **Optimize all** — walks every fixed volume and runs the media-appropriate action in
  sequence. One job at a time, always.
* **Automation summary** — Auto Defrag, schedule, boot optimization state.
* **Recent runs** — the last job of this session plus the most recent history record with
  before → after fragmentation.

A fragmentation bar that reads *not analyzed* is exactly that: unknown. The app never
estimates a percentage.

### 3.2 Defrag

The workbench. Pick a volume chip (C: SSD, D: HDD, …), then an operation:

| Tile | Command | What it does |
| --- | --- | --- |
| Analyze | `defrag C: /A /V` | Reads fragmentation statistics. Changes nothing. |
| Defrag & Optimize | `defrag C: /O /U /V` | Preferred operation for the media type: defrag on HDD, retrim/slab on SSD. |
| Fast Defrag | `defrag C: /O /U` | Same choice, no verbose report. Fastest. |
| Traditional Defrag | `defrag C: /D /U /V` | Classic defrag pass. HDD only, slowest, most thorough. |
| Free Space Defrag | `defrag C: /X /U /V` | Consolidates free space for contiguous writes. |
| Trim & Intelligent Optimize | `defrag C: /L /U` | Sends TRIM / releases free blocks on an SSD. |
| Slab Consolidation | `defrag C: /K /U` | Slab consolidation for thinly provisioned volumes. |
| Boot Time Defrag | `defrag C: /B` | Schedules boot-file optimization for the next restart. |

Under the tiles:

* **Next command** — the literal command line, generated by the same code that executes it.
* **Dry run** — validates the request and shows the command without running it.
* **Run panel** — phase, percentage bar, and the tail of `defrag.exe`'s own output.
* **Fragmentation statistics** — every field the report contained: total fragmented space,
  average fragments per file, fragmented files, excess fragments, folders, average
  fragments per folder, scattered files, volume size, cluster size, percent free. Missing
  fields say *unavailable*.
* **History** — last 100 runs with state (`completed`, `failed`, `cancelled`,
  `needs-elevation`), duration, fragmentation before → after and the exit code.

Cancel stops the child process tree (`taskkill /T /F`) and records the run as `cancelled`.

### 3.3 Large Files

Finds the biggest files on a volume (or a folder you pick) and defragments just those:

1. Pick a scope (volume chip) or **Pick a folder**.
2. Choose a threshold: 100 MB, 500 MB, 1 GB or 5 GB.
3. **Scan** — the walk is bounded by a 25-second budget, so an 8 TB disk never freezes the
   window. When the budget cuts the walk short, the log entry says so.
4. Select files (or **Select all**) → **Defrag selected** → `defrag.exe X: /D /U /File <paths>`.

Files must live on the selected volume; the engine filters cross-volume selections out.

### 3.4 Disk Health

| Panel | Source | Reliability |
| --- | --- | --- |
| TRIM / UNMAP state | `fsutil behavior query DisableDeleteNotify` | reliable, unelevated |
| Media type, bus type, size | `Get-PhysicalDisk` | reliable |
| Volume health, file system | `Get-Volume` | reliable |
| Temperature, wear, power-on hours, error counters | storage reliability counters | only when the provider returns them |
| ATA SMART attribute table | `root\WMI MSStorageDriver_ATAPISmartData` | Administrator-only, usually absent on NVMe |

Values that do not exist are printed as `—`, never as `0 °C` or `100 %`. The page ends with
an explicit "what this app can and cannot see" list so nobody has to guess which number to
trust.

**Retrim C** runs `defrag C: /L /U` for every SSD volume.

### 3.5 Schedule & automation

**Auto Defrag** (idle)

* Enabled by default. Requires an elevated session.
* Waits for `idleMinutes` of no input (`powerMonitor.getSystemIdleTime()`).
* Analyzes each eligible volume, then optimizes only those at or above the threshold
  (default 5 %).
* Never runs twice within 6 hours of the previous automatic pass.

**Scheduled defrag**

* Daily / weekly (pick a weekday) / monthly (pick a day), at a chosen hour and minute.
* Checked once per minute while the app runs; one run per calendar day.
* `shutdownAfter` shuts the PC down **only** if every volume finished successfully, after a
  60-second countdown that can be cancelled.

**Boot time optimization**

* Toggles for pagefile, Master File Table, system files and registry hives, plus cadence.
* **Ask Windows to optimize at next restart** runs `defrag C: /B` immediately — the actual
  work happens during the next boot, not now.

**Silent mode**

* While any listed process runs, automatic and scheduled passes are skipped
  (case-insensitive process-name match, refreshed every 20 s).

**After a finished run**

* none / sleep / hibernate / shut down / restart, with a configurable delay (minimum 10 s)
  and a cancel route through the notification.

Eligible volumes are fixed NTFS volumes that are not in the exclusion list. Battery guard
skips automatic work on battery power.

### 3.6 Game & App Boost

Reads the game libraries that already exist:

* **Steam** — `HKCU\Software\Valve\Steam\SteamPath` plus every `"path"` entry in
  `steamapps\libraryfolders.vdf` and `config\libraryfolders.vdf`.
* **Epic** — `%PROGRAMDATA%\Epic\EpicGamesLauncher\Data\Manifests\*.item` (`InstallLocation`).
* **Manual** — folders you add, stored in `state/libraries.json`.

Each library is measured (bounded), tagged with its media type, and gets a single action:
**Retrim volume** on an SSD, **Optimize volume** on an HDD.

### 3.7 Action Center

Issues are recomputed on every refresh, so an issue disappears the moment the condition
does:

| Issue | Severity | Fix |
| --- | --- | --- |
| Standard user session | high | Relaunch elevated |
| `defrag.exe` unavailable | high | none (report only) |
| No volume analyzed yet (elevated) | medium | Analyze every fixed volume |
| Volume at/above 10 % fragmented | medium (high ≥ 20 %) | Optimize that volume |
| SSD not retrimmed in 30 days | low | Retrim that volume |
| Nothing automated at all | low | Enable Auto Defrag + schedule |
| Disk not healthy / wear ≥ 90 % | high | none (back up, replace) |

**Fix all** applies everything that can be applied without asking: it enables automation and
runs the volume-specific operations in sequence. Anything needing elevation or a human
decision stays listed, and the log records `N of M issues addressed`.

### 3.8 Logs

Five channels — `optimize`, `analyze`, `health`, `schedule`, `app` — with level
(info/warn/error), timestamp, message and detail. Auto-refresh every 5 s. **Clear** empties
the store. Size is capped by *Settings → Log & storage*.

### 3.9 Settings

* **General** — minimize to tray, start with Windows (HKCU Run, no service),
  tray notifications, hide removable volumes, language.
* **Defrag behaviour** — battery guard, skip files over 1 GB, VSS preference (recorded
  only — the app never stops Volume Shadow Copy), "become the default defrag tool" shell
  verb (off by default, never replaces `dfrgui.exe`).
* **Excluded volumes** — letters skipped by automatic and scheduled passes; manual runs
  still work.
* **Notifications** — toast duration, completion notifications, health warnings.
* **Log & storage** — max entries, clear, restore defaults.
* **About** — version, engine, host, elevation, the no-driver statement.

---

## 4. Day-to-day recipes

**Monthly maintenance (HDD)**
1. Run as Administrator.
2. Dashboard → **Optimize all**.
3. Review DeFrag → History: fragmentation before → after should go down.

**SSD owner**
1. Leave Auto Defrag enabled; it will only ever run `/L` (retrim) on an SSD.
2. Do not use Traditional Defrag or Free Space Defrag on an SSD — the page warns you.
3. Disk Health shows whether TRIM is enabled system-wide.

**One huge file keeps fragmenting (a VM disk, a game archive)**
1. Large Files → pick the volume → 5 GB threshold → Scan.
2. Tick the file → **Defrag selected** (`/File`).

**Overnight run then shut down**
1. Schedule → enabled → weekly → Sunday → 03:00 → Defrag & Optimize.
2. Turn on *Shut down the PC afterwards*.

---

## 5. Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| Bar reads *not analyzed* | Analysis never ran or was refused | Relaunch elevated, then Analyze |
| Job state `needs-elevation` | Standard user token, `0x89000024` | Relaunch as Administrator |
| Job state `failed` with an exit code | The optimizer refused the volume (dirty bit, BitLocker, in use) | Run `chkdsk` on that volume, or check BitLocker state |
| Progress stays at 0 % | `defrag.exe` buffers its report on some builds | Watch the log box; percentage often appears later |
| TRIM says disabled | `DisableDeleteNotify = 1` | `fsutil behavior set DisableDeleteNotify 0` (elevated) |
| SMART columns show `—` | Provider does not expose the counters (typical for NVMe in user space) | Nothing to fix; the gap is documented on the page |
| No game libraries | Steam/Epic not installed, or no manifests | Add the folder manually |
| Scheduled run did not happen | Machine was off, on battery with the guard on, or a silent-mode program was running | Check Logs → `schedule` |
| Nothing happens when closing | Minimize-to-tray is on | Use the tray menu → Exit |

---

## 6. Safety statement

* No malware, virus, trojan or any other payload is installed, bundled or executed by this
  program — including by the test suite, which uses only text fixtures and temp folders.
* No IObit binary, driver, DLL, string table or skin is copied into this project. The
  implementation was written from observed behaviour, file names and its own UI vocabulary;
  see `docs/REVERSE-ENGINEERING.md` for exactly what was inspected.
* All disk writes are performed by Microsoft's signed `defrag.exe`. The app's own write
  surface is limited to its `%APPDATA%` state folder and the HKCU Run value you explicitly
  enable.
* The app is unsigned, so Windows SmartScreen will warn on first run — that is normal for a
  locally built executable and has nothing to do with the contents.

## 7. Uninstall

1. Settings → General → turn *Start with Windows* off.
2. Tray → Exit.
3. Delete the unzipped folder.
4. Delete `%APPDATA%\Ultra Harddisk Defrag` if you also want the history gone.
