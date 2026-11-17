# Ultra Harddisk Defrag — Improvement & Update Plan

Cadence, gates and the actual backlog. Versions are earned by passing gates, not by dates.

---

## 1. Release gates

A release ships only when all of these pass on the release machine:

| Gate | Command | Requirement |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | zero errors in both projects |
| Engine behaviour | `npm run selftest` | 0 failed |
| Real IPC surface | `npm run test:ipc` | 0 failed against the packaged build |
| Window/autostart | `npm run test:window` | 0 failed |
| Documentation | manual | USER-GUIDE, FEATURES, ROADMAP, CHANGELOG updated in the same commit |
| Portable build | `npm run pack && npm run dist:zip` | zip produced, exe version metadata correct |

Regression rule: a bug fixed in the engine gets an assertion in `selftest.ts` before the fix
is considered done, and a bug in the IPC surface gets an assertion in `scripts/ipc-test.mjs`.

---

## 2. 1.1 — correctness and comfort (next)

**P0**
* Detect the volume dirty bit / BitLocker state before running, and explain the refusal
  instead of surfacing a raw exit code.
* Parse `defrag /A` output when the report is localized (German/French Windows) by matching
  field *positions* when the English labels are absent.
* Persist the analysis timestamp per volume so the dashboard can say "analyzed 3 h ago"
  after a restart.

**P1**
* Per-volume operation overrides (e.g. `D:` always `/D`, `E:` never touched).
* Export history as CSV.
* Richer tray menu: per-volume analyze, pause automation for 1 h.

**P2**
* Mini overlay window during a run (always-on-top progress).
* Keyboard shortcuts for the action grid.

## 3. 1.2 — scheduling that survives a closed window

Today the scheduler lives inside the app process: closing the app stops scheduled work.

**P0**
* Optional Windows Task Scheduler integration: register a task that starts the app headless
  (`--run-schedule`) at the chosen time, so schedules fire with the window closed. Uses
  `schtasks` via the same elevation hand-off; never a service.
* `--run-schedule` mode: no window, runs the configured job, writes history, exits.

**P1**
* Missed-run recovery: if the machine was off at the scheduled time, run on next start
  within a configurable window (default 6 h).
* Wake-from-sleep option (`WakeToRun` on the task).

**P2**
* Multiple schedules (weekday/weekend profiles).

## 4. 1.3 — better measurement

**P0**
* Fragmentation *trend* per volume from history, with a small sparkline.
* Per-volume "last fragmented %" persisted and shown on the dashboard without re-analysis.

**P1**
* Sector-level free-space map using `FSCTL_GET_VOLUME_BITMAP` through a tiny helper invoked
  by PowerShell (`fsutil volume allocationReport`), rendered as a real block map — only if it
  proves cheaper than one `defrag /A`.
* Queue estimate: measured throughput per media type from history, shown as ETA.

**P2**
* Compare against Windows' own `Optimize-Volume` to validate the numbers.

## 5. 2.0 — capabilities that need more than defrag.exe

Each item here is scoped, reasoned about, and gated behind "does Windows already do this
properly?" The answer for all of them in 1.0 was "yes, so we only drive it".

* **Boot-time file-type defrag** — requires either a driver or Task Scheduler with
  `defrag /B` semantics; first step is documenting exactly what `/B` already covers
  (`bootmgr`, pagefile, hibernation file, MFT) so we do not duplicate it.
* **Volume move/merge** (as Smart Defrag's "Disk Defrag" extras) — needs partition APIs;
  high risk, low value for an app that promises not to touch the partition table.
* **Game-library relocation advisor** — read-only: recommend moving an HDD library to an
  SSD based on measured load times, no file moves performed.
* **Signed build** — an Authenticode certificate would remove the SmartScreen warning; it is
  a funding decision, not an engineering one.

Explicit non-goals, permanently: subscription accounts, ad panels, bundled "PC cleaner"
modules, kernel drivers shipped without a signing story, telemetry.

---

## 6. Maintenance rhythm

* **Weekly** — run the four gates against the current HEAD; fix drift.
* **Monthly** — review the Action Center issue list for false positives on real machines
  (this is the cheapest source of correctness bugs).
* **Per Windows feature update** — re-verify `defrag.exe` switches (`defrag /?`) and
  `Get-PhysicalDisk` schema; both have changed across Windows versions before.
* **Per release** — CHANGELOG entry with the gate results quoted verbatim, plus an updated
  `docs/BUILD-AND-VERIFY.md` if any command changed.

## 7. Known issues carried into 1.1

1. A localized Windows install may return a stats block the English regexes miss → analysis
   succeeds but the statistics panel stays empty. Mitigation shipped: the raw report tail is
   always visible in the log box.
2. Scheduled work requires the app to be running (see 1.2 P0).
3. The installer is unsigned, so SmartScreen warns once on first launch. A code-signing
   certificate is a funding decision (see 2.0), not an engineering one.
4. SMART values are frequently unavailable for NVMe in user space; the UI states this rather
   than guessing.
