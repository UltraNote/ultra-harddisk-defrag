# Reverse-Engineering Notes — Smart Defrag 12 → Ultra Harddisk Defrag 1.0

What was inspected, what was learned, what was deliberately not copied, and how the rebuild
proves it is clean.

---

## 1. Subject

| Fact | Value |
| --- | --- |
| Shortcut | `C:\Users\Public\Desktop\Smart Defrag 12.lnk` |
| Install root | `C:\Program Files (x86)\IObit\Smart Defrag` |
| Main executable | `SmartDefrag.exe` |
| FileVersion | `12.1.0.619` |
| ProductVersion | `12.1.0` |
| ProductName | `smart defrag` |
| Company | IObit |
| Authenticode | Valid (signed by IObit) |

The shortcut was resolved with `WScript.Shell.CreateShortcut` (target, arguments, working
directory), and the target's `VersionInfo` was read through the same shell object. No
executable was run as part of the investigation beyond `SmartDefrag.exe`'s own version
metadata being read — the installer was never launched, and no component of it is used at
runtime by this project.

---

## 2. What was examined

### 2.1 Install tree

```
Action Center/  Database/  DB/  drivers/  Extension/  Language/  LatestNews/
pub/  SDReport/  skin/
ActionCenterDownloader.exe  AUpdate.exe  AutoAnalyze.exe  AutoDefrag.exe
AutoUpdate.exe  CareScan.exe  dataexchange.dll  diskinfo.dll  DiskInfo.exe …
UserGame.ini  SDLog.txt  "Update History.txt"
```

Findings that shaped the rebuild:

* **`drivers/`** — per-OS kernel driver folders (`win10_x64`, `win10_x86`, `win7_x64`,
  `win7_x86`, `win8_x64`, `win8_x86`, `wlh_*`, `wnet_*`). This is how the commercial product
  performs boot-time, MFT and file-type defrag. **Decision: not reproduced.** Shipping a
  kernel driver without a signing story and without the ability to audit it is not
  acceptable for this project, and Windows' own `/B` covers the user-visible case.
* **`Language\English.lng`** — UTF-16LE string table, 1399 lines after decoding with
  `iconv -f UTF-16LE`. This is the authoritative menu/dialog inventory: it is where the
  feature surface below came from.
* **`UserGame.ini`** — the game-optimization list file. Informed the "Game & App Boost"
  page, which instead reads Steam/Epic's own manifests (no vendor list is copied).
* **`Update History.txt`, `SDLog.txt`** — update cadence and log format hints.
* **`AutoAnalyze.exe`, `AutoDefrag.exe`** — separate helper binaries for idle analysis and
  idle defrag. Informed the idle gate design (analyze → decide → optimize), implemented
  in-process instead of via helper executables.

### 2.2 Feature surface extracted from the string table

* Per-volume actions: **analyze, defrag/optimize, fast (quick) defrag, large-file defrag,
  boot-time defrag, TRIM/SSD optimize, check** — 7 actions.
* Main tabs: **Optimize/Defrag, Scheduled, Game/Performance, Settings**, plus a SMART/health
  window and an Action Center.
* Settings tree: silent-mode program list, battery/AC policy, exclude list, boot-time file
  types (pagefile, MFT, system files, registry), scheduled cadence + "shut down after",
  notifications, log retention, language/skin.

### 2.3 Runtime probing of the *platform*, not the product

The rebuild drives documented Windows interfaces, verified on this machine before writing
code:

| Probe | Result used |
| --- | --- |
| `defrag /?` | The complete documented switch set (`/A /O /D /X /L /K /B /File /U /V /H`) — the app only emits switches from this list. |
| `defrag C: /A` | Report layout for the statistics parser; also proves analysis needs elevation. |
| `Get-Volume`, `Get-Partition`, `Get-PhysicalDisk` | Volume ↔ disk ↔ media-type mapping. |
| `fsutil behavior query DisableDeleteNotify` | TRIM state without elevation. |
| `Get-CimInstance -Namespace root\WMI MSStorageDriver_ATAPISmartData` | SMART availability (Administrator-only, frequently absent for NVMe). |
| Steam `libraryfolders.vdf` | Library discovery format. |

---

## 3. What was NOT reused

A hard rule for this project: **no vendor artefacts**. Specifically:

* No IObit executable, DLL, driver, `.sys`, `.lng`, `.ini`, skin, icon, image, database or
  news feed file is present in this repository or in the built package. The REA pass only
  *read* these files to learn behaviour.
* No IObit string is shipped. UI copy was written from scratch; where terminology matches
  (e.g. "Boot Time Defrag", "Trim"), it matches because it is the technical term for the
  Windows operation, not because text was copied.
* No third-party defrag engine, no `dfrgui.exe` replacement, no scheduled-task hijack of
  Microsoft's own maintenance task without the user's explicit toggle.
* The application ID (`work.selman.ultra-harddisk-defrag`), icons (`scripts/make-icon.mjs`,
  generated procedurally), and theme are original.

Verification that the package is clean:

```bash
# no vendor binaries in the tree
git ls-files | grep -iE 'iobit|smartdefrag|\.sys$|\.lng$' || echo "clean"

# the shipped package only contains our own files plus Electron/Node runtime
npx asar list "release/win-unpacked/resources/app.asar"
```

---

## 4. Mapping: commercial feature → our implementation

| Smart Defrag 12 | Ultra Harddisk Defrag 1.0 | How |
| --- | --- | --- |
| Volume grid with fragmentation % | Dashboard volume cards | `defrag /A` parsed into `FragmentationStats` |
| Analyze / Defrag / Fast Defrag | Tiles → `/A`, `/O`, `/O` without `/V` | Same documented switches |
| Large-file defrag | Large Files page + `/File` | Our own bounded scanner chooses targets |
| Boot-time defrag | Boot optimization card + `/B` | Windows performs boot-file optimization when requested |
| SSD TRIM optimize | Trim & Intelligent Optimize → `/L` | Media type comes from `Get-PhysicalDisk` |
| SMART / health window | Disk Health page | TRIM via `fsutil`, disks via CIM, SMART only when exposed |
| Auto defrag while idle | Auto Defrag (idle gate) | `powerMonitor` idle time + threshold |
| Scheduled defrag + shutdown after | Schedule page | In-process scheduler, countdown + cancel |
| Silent mode / game list | Silent mode (process names) | Process-name matching, 20 s cache |
| Game optimization | Game & App Boost | Steam/Epic manifests, no vendor list |
| Action Center | Action Center + Fix All | Issues recomputed from live state |
| Driver-based boot/MFT defrag | **Not implemented** | Deliberate: no unsigned kernel driver |
| Update/news/subscription modules | **Not implemented** | Deliberate: no accounts, no nagging |

---

## 5. Behavioural lessons that changed the design

1. **Analysis needs elevation** on a stock Windows install (`0x89000024`). Instead of hiding
   that, the app surfaces it as a first-class job state (`needs-elevation`) with a relaunch
   button — a refusal is recorded in history like any other outcome.
2. **SSDs must never be defragmented.** The commercial product solves this with a driver;
   we solve it by refusing the combination in the UI and by defaulting every SSD to `/L`.
3. **`defrag.exe` output is not machine-stable.** It is localized and can buffer. The parser
   is tolerant (regex over the English labels), keeps the raw tail, and the UI shows the log
   stream so the user can always see the truth even when parsing fails.
4. **Separate helper executables are unnecessary.** Idle analysis/defrag run in-process with
   `powerMonitor` gating; fewer moving parts, no extra processes to audit.
