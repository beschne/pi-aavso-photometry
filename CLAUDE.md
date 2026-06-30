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
| `docs/Photometry.html` | Native PixInsight help page — see **PixInsight documentation** below for install instructions. |
| `docs/X42597QE_photometry.csv` | Reference copy of the AAVSO VSP export for chart X42597QE. |
| `docs/X42597QE.png` | AAVSO finder chart for T CrB, chart X42597QE. |
| `screenshots/` | Dialog screenshots for all versions, used in the READMEs and PI docs. |

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

## PixInsight documentation

`docs/Photometry.html` is the native PixInsight help page, opened by `Dialog.browseScriptDocumentation("Photometry")` (the `?` button). It must be installed manually into the PI doc tree; there is no Update Repository mechanism for GitHub-distributed scripts.

**Install path:** `<PI install>/doc/scripts/Photometry/Photometry.html`

**Images** go in `<PI install>/doc/scripts/Photometry/images/`, renamed as follows:

| Source (`screenshots/`) | Install as (`images/`) |
|-------------------------|------------------------|
| `screenshot, v1.2.0, (1) setup.png` | `setup.png` |
| `screenshot, v1.2.0, (2) comp stars.png` | `comp-stars.png` |
| `screenshot, v1.2.0, (3) photometry.png` | `photometry.png` |
| `screenshot, v1.2.0, (4) mid-time.png` | `mid-time.png` |
| `screenshot, v1.2.0, (5) verification.png` | `verification.png` |
| `screenshot, v1.2.0, (6) report, human readable.png` | `report-human.png` |
| `screenshot, v1.2.0, (6) report, aavso.png` | `report-aavso.png` |

**pidoc path depth:** the HTML references `../../pidoc/` for CSS/JS (two levels up from `Photometry/` to `doc/`). Do not change this when editing the file.

**Testing without installing:** symlink the file into the PI doc tree so edits are picked up live:
```bash
mkdir -p /Applications/PixInsight/doc/scripts/Photometry
ln -s "$(pwd)/docs/Photometry.html" /Applications/PixInsight/doc/scripts/Photometry/Photometry.html
```
Copy or symlink the `images/` folder alongside it (see table above for filenames). Then `Dialog.browseScriptDocumentation("Photometry")` opens the live file. Delete the symlink when done.

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

**Supplementary heuristics (run on "Run Photometry", shown in `linearityLbl`):**
- **Green-channel median:** `img.selectedChannel = 1; img.median()` — linear master typically < 0.05; ambiguous 0.05–0.15 (yellow warning); likely stretched > 0.15 (orange warning). Supplementary signal only — never blocks.
- **`historyIndex` check:** if `win.mainView.historyIndex > 0` and no forbidden HISTORY keywords found, warn that the image has unsaved edits this session whose process names are unknown. Encourages saving the stack so HISTORY keywords are present.

`linearityLbl` (yellow/orange) is distinct from `warningLbl` (red) which shows confirmed HISTORY keyword hits. Both may be visible simultaneously.

## Architecture

1. **Input:** `ImageWindow.activeWindow` — plate-solved, debayered OSC RGB master light. Abort clearly if unsuitable.
2. **Channel:** green only (PixInsight R,G,B → index 1). Reported as AAVSO **TG** band.
3. **Astrometry:** PixInsight's own WCS/astrometric-metadata library (`ImageSolver` / `AnnotateImage`). Do **not** hand-roll gnomonic projection.
4. **Target location:** T CrB catalog position hardcoded → project to pixels via the plate solve.
5. **Comparison stars:** read from a user-chosen CSV (path persisted via `Settings`); project each in-frame star to pixels.
6. **Measurement:** PSF fit via native **DynamicPSF**; read amplitude / background / sigma / flux. Apply quality filters (too faint, saturated/clipped, centroid drift) — see `docs/domain-knowledge.md`.
7. **Photometry (current scope):** ensemble comp stars (N selectable in Comp Stars step) + single check star. Zero-point ZP = mean(magV_i − instMag_i); mag(T) = ZP + instMag_T. `MERR` = √(σ_ZP² + σ_T²) where σ_ZP = std(ZP_i)/√N for N≥2 (see `docs/domain-knowledge.md`). The check star is a separate quality gate — its derived magnitude is compared to catalogue V; a >3×MERR deviation triggers a warning.
8. **Time confirmation (UI):** time fields (Start / End / Mid) are in the Mid-time step of `PhotometryDialog` — see `docs/time-handling.md` and **Dialog layout** below. Confirmed mid-time JD drives the AAVSO `DATE` field and airmass.
9. **Output:** navigating to the Report step auto-generates the report (human-readable by default; AAVSO Extended CSV on demand); "Export…" opens a `SaveFileDialog` and writes the file immediately — see `docs/aavso-extended-format.md`.

## File organisation — when to split

The script is intentionally a **single file** (`aavso-photometry.js`). Do not split it
until there is a concrete reason (a second script that reuses a module, or the file
growing past ~2 500 lines where navigation becomes painful).

PJSR supports `#include "subfile.js"` (preprocessed before V8 sees the code), so
splitting is technically straightforward and is how PixInsight's own bundled scripts
work. If splitting is ever warranted, the natural seams are:

| Candidate file | Contents |
|----------------|----------|
| `lib/csv-parser.js` | RFC 4180 parser + `loadComparisonStars()` |
| `lib/astrometry.js` | WCS projection, `projectToPixel()` |
| `lib/psf.js` | `fitPSF()`, `psfInstrumentalMag()`, `psfMagError()`, `checkPSFQuality()` |
| `lib/photometry.js` | Airmass, time/JD math, `readSiteCoords()` |
| `lib/report.js` | `generateReport()` — human-readable + AAVSO Extended formats |
| `aavso-photometry.js` | Dialog + `main()` only |

The `lib/` files would be reusable across future `pi-…` scripts. That is the trigger
worth waiting for: when a second script needs the CSV parser or astrometry helper,
split then. Until that point the single-file approach costs nothing and avoids
multi-file download friction for users.

## Domain knowledge — key constants

Full details: `docs/domain-knowledge.md`.

- **T CrB position (hardcoded):** RA = 239.8757°, Dec = +25.9202° (15h59m30.2s, +25°55′13″)
- **Observer site:** read from FITS keywords at run time (see below); **no hardcoded fallback**. `const SITE` has been removed.
- **TG band:** green OSC channel; runs ~0.1–0.3 mag brighter than V for red stars. **Never relabel TG as V.**
- **Comparison CSV:** filter `Band == "V"`; prefer AUID over label in output; exclude blended stars (label 102 on chart X42597QE). CSV uses RFC 4180 quoting — use a proper parser, not `split(",")`. Fail loudly on column mismatch.
- **DATE-OBS caveat:** ImageIntegration writes the midpoint of sub *start* times, ignoring exposure duration — unreliable. The acquisition-time dialog (see `docs/time-handling.md`) is the fix.
- **Airmass:** Kasten & Young (1989) formula in pure JS — see `docs/domain-knowledge.md`. If lat or lon is absent, `AMASS=na` is written; this is valid per the AAVSO Extended File Format spec and is not treated as an error.
- **Default comp/check:** the two stars whose V magnitude is closest to `TARGET.magQuiescence` (10.0 V for T CrB). Proximity minimises differential extinction and PSF fitting error contribution. Display order in the combos is brightest→faintest for easy browsing. Not persisted between sessions.
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

Default comp/check: the two stars closest in V magnitude to `TARGET.magQuiescence` (10.0 V). For chart X42597QE at quiescence this yields label `98` (9.809 V, Δ=0.19) and `106` (10.554 V, Δ=0.55).

## Time handling

Full specification: `docs/time-handling.md`.

- Start/end fields shown as UTC ISO-8601, both editable by the user.
- "Reference file" button reads `DATE-OBS` and `EXPTIME` from a FITS/XISF subframe. `DATE-END` is deliberately ignored.
- Session span: reference first surviving sub for Start, last surviving sub for End. End = last sub `DATE-OBS + EXPTIME`.
- Mid-time modes: `= Start` / **`= (Start+End)/2` (default, recommended)** / Manual. The JD flows into AAVSO `DATE` and airmass.

## Dialog layout

Everything runs inside a single `PhotometryDialog` (class extending `Dialog`). The layout is a **six-step wizard**: a narrow left pane of step-navigator `Control` items, a vertical separator, and a right pane that shows one panel at a time.

**Left pane** — step navigator
- Six custom `Control` items (not `PushButton`). Each draws its label left-aligned in `onPaint` (bold = current step; grey = disabled). `onMousePress` calls `activateStep(idx)`.
- A flat `ToolButton` (help icon) sits at the bottom. No Close button — use the window's own.
- `setMinSize(110, 18)`, sizer spacing = 0, to match normal text line rhythm.

**Step enablement** (`isStepEnabled`):
- Steps 0 (Setup) and 1 (Comp Stars) always enabled.
- Step 2 (Photometry): requires `_discoveryDone && _ensembleEntries.length > 0`.
- Steps 3 (Mid-time) and 4 (Verification): require `_photDone`.
- Step 5 (Report): requires `_photDone && !isNaN(self.midJD)`.

**Auto-triggers in `activateStep`:**
- Entering step 1 → runs `runDiscovery()` (single DynamicPSF pass for all candidates).
- Entering step 2 → runs `runPhotometry()` (uses cached PSF from discovery).
- Entering step 5 → runs `generateReport()`.

| Step | Panel | Contents |
|------|-------|----------|
| **0 — Setup** | `setupPanel` | Title + version credit (bold); precondition labels (✓/✗/ℹ); active image name (read-only); CSV path + Browse; **Observer code** EditBox (default `BSLA`; persisted in Settings; written into `#OBSCODE` report header) |
| **1 — Comp Stars** | `compStarsPanel` | TreeBox (5 cols: ✓, Label, AUID, V mag, Δmag, Quality) listing all in-frame V-band candidates; **Check** ComboBox at bottom; `updateCompCount()` label |
| **2 — Photometry** | `runPanel` | Magnitude + Filter TG + Error (MERR); Raw PSF flux row (T/ensemble/check instrumental mags); `warningLbl` (red, forbidden processes); `linearityLbl` (yellow/orange, stretch heuristics); `checkGateLbl` (check-star deviation) |
| **3 — Mid-time** | `midtimePanel` | First/last sub reference buttons; Start/End ISO + JD readouts; EXPTIME; mid-time RadioButtons (`= (S+E)/2` default, `= Start`, Manual + edit); mid-time JD + ISO readouts; Lat/Lon/Elev editable fields (pre-filled from FITS); airmass + moon readouts |
| **4 — Verification** | `verifyPanel` | Annotated thumbnail (target = red circle, comp stars = green, check = cyan); No / Auto / Boosted stretch RadioButtons; re-renders on stretch change via `reRenderVerify()` |
| **5 — Report** | `reportPanel` | Format RadioButtons (Human readable default, AAVSO Extended); scrollable read-only `TextBox` preview; Export button (opens `SaveFileDialog`, writes immediately) |

**RadioButton grouping:** three independent exclusive groups, each with a different parent to avoid Qt's per-parent exclusion colliding across groups:
- Mid-time group (`rbMidpoint`, `rbStart`, `rbManual`) — parented to `midtimePanel`.
- Format group (`rbHuman`, `rbAavso`) — parented to intermediate `Control` (`fmtGrp`).
- Stretch group (`rbNoStretch`, `rbAutoStretch`, `rbBoosted`) — parented to intermediate `Control` (`stretchGrp`) inside `verifyPanel`.

## PJSR API reference

Notes on verified patterns and stumbling blocks: `docs/pjsr-api-notes.md`.

**Rule:** do not fabricate API signatures. When unsure of a method name, class, or `#include` path, say so and verify against PixInsight 1.9.x's PJSR reference and the bundled scripts (`ImageSolver`, `AnnotateImage`).

## Roadmap (planned, not yet implemented)

Keep code structured so these are additions, not rewrites. In priority order:

- ~~**(Priority 1) Selectable comp/check stars at runtime.**~~ Done: Comp/Check ComboBoxes in Setup; default = brightest/second-brightest in CSV; persisted in Settings.
- ~~**Five-step wizard UI.**~~ Done: Setup → Photometry → Mid-time → Verification → Report. Photometry and report auto-trigger on step entry.
- ~~**Annotated verification image.**~~ Done: embedded thumbnail in step 4 with No/Auto/Boosted stretch controls.
- ~~**Check-star gate.**~~ Done: deviation > 3×MERR triggers orange warning in Photometry step and console.
- ~~**Real `MERR`.**~~ Done: PSF MAD residuals propagated via matched-filter formula; target + comp combined in quadrature.
- ~~**Ensemble photometry.**~~ Done (v1.2.0): six-step wizard (Setup → Comp Stars → Photometry → Mid-time → Verification → Report). Comp Stars TreeBox; single DynamicPSF discovery pass; ZP = mean(magV_i − instMag_i); `CNAME=ENSEMBLE`, `CMAG=na`; comp labels in NOTES. End-to-end tested with T CrB submission to AAVSO.

- **Multiband TB/TG** from the OSC master (blue channel). Red channel is M-giant-dominated — needs care.
- **User-specifiable target star.** Currently T CrB is hardcoded; isolate the target definition for easy extension.

- **(Low priority — scientific extensions)**
  - **TG→V transformation** (`TRANS=YES`) with once-derived coefficients.

## Coding conventions

- Clearly-labelled block of **tunable constants at the very top** of the file.
- **English** comments throughout.
- Factor the target-star definition so the script can later cover more than T CrB.
- PJSR/PixInsight APIs only — no external libraries.

## Git

Crediting Claude as co-author is fine for this repository. Commits may include:
`Co-Authored-By: Claude <noreply@anthropic.com>`
