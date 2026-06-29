# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project does

A **native PixInsight PJSR script** that performs differential photometry of the
recurrent nova T Coronae Borealis ("Blaze Star") directly inside PixInsight, on an
open plate-solved OSC stack, and writes an **AAVSO Extended File Format** report.

The script performs the same science inside PixInsight directly, reusing its own
facilities (astrometric solution, FITS keywords, DynamicPSF) rather than re-implementing
them externally.

## Language and runtime — read first

- **This is PJSR (PixInsight JavaScript Runtime), not Python.** Do not write Python,
  do not add `import`/`pip`/`npm`, do not assume Node.js. Only the PJSR core and
  PixInsight's bundled `#include <pjsr/...>` libraries are available.
- Target: **PixInsight 1.9.4 "Lockhart" on macOS (Apple Silicon).**
- **JS engine: Google V8** (changed from SpiderMonkey 24 in 1.9.4). Modern ES6+
  features are available; do not assume SpiderMonkey 24 limitations or quirks.
- No external dependencies of any kind. If a capability seems to need one, it almost
  certainly already exists as a native PixInsight process or bundled JS library —
  use that.

## Naming conventions

- **GitHub repository:** `pi-photometry`. Future PixInsight scripts get their own `pi-…` repos.
- **PixInsight menu category:** `BeSchne` (for Benno Schneider). Feature header: `#feature-id BeSchne > Photometry`.
- **File name:** `aavso-photometry.js` — lower-case, hyphenated, not target-specific.
- **Settings namespace:** `BeSchne/<Script>/<key>`, e.g. `BeSchne/Photometry/comparisonCsvPath`.
- **Human-facing strings** (TITLE/VERSION constants, dialog title): "AAVSO Photometry".

## Scripts

| File | Purpose |
| ---- | ------- |
| `aavso-photometry.js` | The script. Runs on the active image window; locates T CrB via the plate solve; measures it against CSV comparison stars; writes an AAVSO Extended report. |
| `sample_comparison_stars.csv` | Format sample for the comparison-star CSV (two stars, multiple bands). |
| `docs/X42597QE_photometry.csv` | Reference copy of the AAVSO VSP export for chart X42597QE. |
| `docs/X42597QE.png` | AAVSO finder chart for T CrB, chart X42597QE. |

## Running and development

**Development loop (no install, no restart):**
Edit `aavso-photometry.js` in a normal editor, save, then in PixInsight:
`Script > Execute Script File…` → select the file. It is re-read from disk on every
run. Debug output goes to the Process Console (`console.writeln()`); errors print
there with line numbers.

**Optional menu registration:** `Script > Feature Scripts… > Add` the script's
directory once; PixInsight reads the `#feature-id` header and lists it in the Script
menu. Edits to the code body are picked up on the next run; only changes to the
`#feature-id` registration itself need a rescan/relaunch.

**Do NOT** use the Update Repository → Exit → Install → Restart cycle during
development. That mechanism is only for distributing the finished script to other machines.

## Input image preconditions

These are enforced by the dialog's notice text and must be respected in all code and documentation:

| Condition | Status | Reason |
|-----------|--------|--------|
| Linear (unstretched) stack | **Required** | PSF flux is non-linear on a stretched image — photometry is meaningless |
| Plate-solved (ImageSolver) | **Required** | Coordinate projection depends on the WCS solution |
| Any stretch applied | **Incompatible** | Breaks PSF linearity |
| Deconvolution applied | **Incompatible** | Alters PSF shape; Gaussian fit assumption breaks |
| BlurXTerminator applied | **Incompatible** | Same as deconvolution — non-linear PSF modification |
| Background extraction (ABE / DBE / GradientCorrection) | **Safe** | Subtracts a smooth background surface; PSF local background parameter `B` absorbs any residual; cancels in differential math |
| SpectrophotometricColorCalibration (SPCC) | **Safe** | Applies a uniform per-channel multiplier; cancels exactly in `instMag_T − instMag_C` |

## Observer site coordinates

**No hardcoded fallback.** `const SITE` has been removed entirely. Coordinates are sourced in this order:

1. `readSiteCoords(win.keywords)` tries these FITS keywords (first match wins):
   - Latitude: `SITELAT`, `OBSLAT`, `LAT-OBS`, `LATITUDE`
   - Longitude: `SITELONG`, `OBSLONG`, `LONG-OBS`, `LONGITUDE` — degrees **East positive**
   - Elevation: `SITEELEV`, `OBSELEV`, `ELEVATIO`, `ALTITUDE` — rarely present in Seestar files
2. Values found are written into editable **Lat / Lon / Elev** fields in the dialog (timing section).
3. The user can correct any value before writing the report.
4. Elevation defaults to `0` m if absent from FITS and the field is blank.
5. If Lat or Lon remain blank → `AMASS=na` in the report (no error).

**Do not re-introduce a hardcoded site fallback.** A silent wrong location is worse than an explicit `na`.

## Forbidden-process detection — implementation and known limits

`detectForbiddenHistory(win)` scans `win.keywords` for FITS `HISTORY` keywords whose value contains a forbidden process name. Matched names are shown as a red warning label in the dialog after "Run Photometry" is clicked.

**Current detection list:** `HistogramTransformation`, `GHSStretch`, `MaskedStretch`, `CurveTransformation`, `Deconvolution`, `BlurXTerminator`, `LocalHistogramEqualization`, `ExponentialTransformation`, `HDRMultiscaleTransform`.

**Known blind spot — unsaved in-memory stacks:** PixInsight only writes `HISTORY` FITS keywords when a file is saved to disk (and only if the "Add FITS keywords" option is enabled in preferences). A stretch or deconvolution applied to an in-memory `ImageIntegration` result in the current session, without an intermediate save, will **not** appear in `win.keywords` and will **not** be detected.

**Improving robustness:** There is no public PJSR API to enumerate in-session undo history entries by name (`View.historyIndex` tells you *how many* steps exist but not *which processes* they are). Options to improve coverage in future:
- Prompt the user to confirm linearity if `view.historyIndex > 0` (something was done this session, identity unknown).
- Check image statistics as a heuristic: a linear master stack has a very low green-channel median (typically < 0.05 in [0,1]); a stretched image is usually > 0.15. Implement as a supplementary signal, not a hard gate.
- Encourage saving the master stack before running photometry, so `HISTORY` keywords are present.

## Architecture

1. **Input:** `ImageWindow.activeWindow` — plate-solved, debayered OSC RGB master light. Abort clearly if unsuitable.
2. **Channel:** green only (PixInsight R,G,B → index 1). Reported as AAVSO **TG** band.
3. **Astrometry:** PixInsight's own WCS/astrometric-metadata library (`ImageSolver` / `AnnotateImage`). Do **not** hand-roll gnomonic projection.
4. **Target location:** T CrB catalog position hardcoded → project to pixels via the plate solve.
5. **Comparison stars:** read from a user-chosen CSV (path persisted via `Settings`); project each in-frame star to pixels.
6. **Measurement:** PSF fit via native **DynamicPSF**; read amplitude / background / sigma / flux. Apply quality filters (too faint, saturated/clipped, centroid drift) — see `docs/domain-knowledge.md`.
7. **Photometry (current scope):** single comp star + single check star. Derive T CrB magnitude from comp's known V mag and the instrumental difference. `MERR` is computed from PSF fit residuals (see `docs/domain-knowledge.md`). The check star is a separate quality gate — its derived magnitude is compared to catalogue V; a >3×MERR deviation triggers a console warning.
8. **Time confirmation (UI):** time fields (Start / End / Mid) are embedded in the unified `PhotometryDialog` — see `docs/time-handling.md` and **Dialog layout** below. Confirmed mid-time JD drives the AAVSO `DATE` field and airmass.
9. **Output:** user clicks "Create Report" to generate text (human-readable by default; AAVSO Extended CSV on demand); "Export…" opens a `SaveFileDialog` and writes the file immediately — see `docs/aavso-extended-format.md`.

## Domain knowledge — key constants

Full details: `docs/domain-knowledge.md`.

- **T CrB position (hardcoded):** RA = 239.8757°, Dec = +25.9202° (15h59m30.2s, +25°55′13″)
- **Observer site:** read from FITS keywords at run time (see below); **no hardcoded fallback**. `const SITE` has been removed.
- **TG band:** green OSC channel; runs ~0.1–0.3 mag brighter than V for red stars. **Never relabel TG as V.**
- **Comparison CSV:** filter `Band == "V"`; prefer AUID over label in output; exclude blended stars (label 102 on chart X42597QE). CSV uses RFC 4180 quoting — use a proper parser, not `split(",")`. Fail loudly on column mismatch.
- **DATE-OBS caveat:** ImageIntegration writes the midpoint of sub *start* times, ignoring exposure duration — unreliable. The acquisition-time dialog (see `docs/time-handling.md`) is the fix.
- **Airmass:** Kasten & Young (1989) formula in pure JS — see `docs/domain-knowledge.md`. If lat or lon is absent, `AMASS=na` is written; this is valid per the AAVSO Extended File Format spec and is not treated as an error.
- **Settings key:** `"BeSchne/Photometry/comparisonCsvPath"` — re-prompt if stored path no longer exists.

## AAVSO Extended File Format

Full field spec and comp/check star table: `docs/aavso-extended-format.md`.

**File header:**
```
#TYPE=EXTENDED
#OBSCODE=BSLA
#SOFTWARE=<script name + version>
#DELIM=,
#DATE=JD
#OBSTYPE=CCD
```

**Per-observation fields:**
`NAME,DATE,MAG,MERR,FILT,TRANS,MTYPE,CNAME,CMAG,KNAME,KMAG,AMASS,GROUP,CHART,NOTES`

Key choices: `FILT=TG`, `TRANS=NO`, `MTYPE=STD` (not `DIF`), `OBSTYPE=CCD` (Seestar is a dedicated astronomy camera, not a consumer DSLR), `CHART=X42597QE`, `GROUP=na`.
`CMAG`/`KMAG` are **instrumental** magnitudes (can be negative). Output via `SaveFileDialog` on every run (not persisted).

Default comp/check at quiescence: label `98` (9.809 V, AUID `000-BBW-796`) and `106` (10.554 V, AUID `000-BJS-901`).

## Time handling

Full specification: `docs/time-handling.md`.

- Start/end fields shown as UTC ISO-8601, both editable by the user.
- "Reference file" button reads `DATE-OBS` and `EXPTIME` from a FITS/XISF subframe. `DATE-END` is deliberately ignored.
- Session span: reference first surviving sub for Start, last surviving sub for End. End = last sub `DATE-OBS + EXPTIME`.
- Mid-time modes: `= Start` / **`= (Start+End)/2` (default, recommended)** / Manual. The JD flows into AAVSO `DATE` and airmass.

## Dialog layout

Everything runs inside a single `PhotometryDialog` (class extending `Dialog`). Sections are separated by `<hr/>` horizontal rules (`Label.useRichText = true`). Top-to-bottom layout:

| Section | Contents |
|---------|----------|
| **Header** | Title label; "Benno Schneider © 2026" credit |
| **Preconditions** | Three `Label` controls with ✓/✗ icon prefixes (Required / Incompatible / Safe); `warningLbl` (hidden until Run is clicked) shows detected forbidden processes in red bold HTML |
| **Input** | Active image name (read-only); comparison CSV path + Browse button |
| **Run** | "Run Photometry" button |
| **Results** | Derived T CrB magnitude + uncertainty; instrumental mags for target / comp / check |
| **Timing** | First/last sub reference buttons; Start / End ISO fields + JD readouts; EXPTIME; mid-time RadioButtons (`= (S+E)/2` default, `= Start`, Manual + edit); mid-time JD + ISO readouts; Lat / Lon / Elev editable fields (pre-filled from FITS); airmass readout |
| **Output** | Format RadioButtons (Human readable default, AAVSO Extended); "Create Report" button; scrollable read-only `TextBox` preview; "Export…" button (opens `SaveFileDialog`, writes immediately) |
| **Buttons** | "Close" button (`self.cancel()`) |

**RadioButton grouping:** the mid-time group (`rbMidpoint`, `rbStart`, `rbManual`) and the format group (`rbHuman`, `rbAavso`) must have **different parent widgets** to avoid Qt's per-parent exclusive grouping silently unchecking `rbMidpoint` when `rbHuman.checked = true` is set. The format pair is parented to an intermediate `Control` (`fmtGrp`); the mid-time pair is parented directly to the dialog.

## PJSR API reference

Notes on verified patterns and stumbling blocks: `docs/pjsr-api-notes.md`.

**Rule:** do not fabricate API signatures. When unsure of a method name, class, or `#include` path, say so and verify against PixInsight 1.9.x's PJSR reference and the bundled scripts (`ImageSolver`, `AnnotateImage`).

## Roadmap (planned, not yet implemented)

Keep code structured so these are additions, not rewrites. In priority order:

- **(Priority 1) Selectable comp/check stars at runtime.** Labels `98`/`106` work at quiescence but are unusable when T CrB brightens by ~8 mag. The user must be able to switch to brighter comps (`84`, `79`, …) from the dialog without editing code.

- **(High priority — QA, low effort)**
  - **Annotated verification image.** Thumbnail showing target + comp/check stars before the report is written. Catches the most common failure (wrong star) at a glance.
  - **Check-star gate.** Standardise the check star's magnitude from the comp; if (K−C) deviation exceeds a tunable threshold, warn before writing.
  - ~~**Real `MERR`.**~~ Done: PSF MAD residuals propagated via matched-filter formula; target + comp combined in quadrature. Check-star deviation is now a separate quality gate logged to the console.

- **Ensemble photometry.** Multiple comp stars → `CNAME=ENSEMBLE`, `CMAG=na`; list used stars in `NOTES`.
- **User-specifiable target star.** Currently T CrB is hardcoded; isolate the target definition for easy extension.

- **(Low priority — scientific extensions)**
  - **TG→V transformation** (`TRANS=YES`) with once-derived coefficients.
  - **Multiband TB/TG** from the OSC master (blue channel). Red channel is M-giant-dominated — needs care.

## Coding conventions

- Clearly-labelled block of **tunable constants at the very top** of the file.
- **English** comments throughout.
- Factor the target-star definition so the script can later cover more than T CrB.
- PJSR/PixInsight APIs only — no external libraries.

## Git

Crediting Claude as co-author is fine for this repository. Commits may include:
`Co-Authored-By: Claude <noreply@anthropic.com>`
