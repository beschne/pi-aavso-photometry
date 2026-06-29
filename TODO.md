# aavso-photometry.js — Build Checklist

## 1. Script skeleton
- [x] Feature header (`#feature-id BeSchne > Photometry`, `#feature-info`, optional `#feature-icon`)
- [x] Top constants block: T CrB position, observer site, default comp/check labels, `SATURATION_FRACTION`, AAVSO metadata (`OBSCODE`, `CHART`, …)
- [x] `main()` entry point with top-level error handling
- [x] Console banner (script name + version)

## 2. CSV parser
- [x] Read comparison-star CSV from persisted path (`BeSchne/Photometry/comparisonCsvPath`)
- [x] Re-prompt via `OpenFileDialog` if path missing or file not found; persist new choice
- [x] RFC 4180-compliant parser (handles quoted fields with embedded `""`)
- [x] Validate column header; fail loudly on mismatch
- [x] Filter rows to `Band == "V"`
- [x] Parse sexagesimal RA / Dec (Dec has no leading `+` for positive values)
- [x] Flag blend-warned stars from `Comments` field; exclude from PSF candidates

## 3. Coordinate projection
- [x] Validate active window: must be open, RGB (3 channels), and carry a plate-solve solution
- [x] Load astrometric solution via WCS/`AstrometricMetadata` library (verify `#include` path)
- [x] Project T CrB J2000 position → pixel coordinates
- [x] Project each in-frame comparison star → pixel coordinates
- [x] Discard stars that project outside the image bounds

## 4. PSF measurement
- [x] Build DynamicPSF star input list (target + comp + check)
- [x] Run `executeGlobal()`
- [x] Read back amplitude, background, sigma/FWHM, flux, MAD/residual per star
- [x] Quality filter — too faint: no detection or amplitude below noise floor
- [x] Quality filter — saturated/clipped: peak > `SATURATION_FRACTION` × robust image max **and** high MAD residual
- [x] Quality filter — centroid drift: fitted centre too far from projected position
- [x] Abort with clear message if target or comp PSF fails quality checks

## 5. Photometry math
- [x] Instrumental magnitude = −2.5 · log10(flux) for target, comp, check
- [x] T CrB magnitude = comp_catalogue_V + (instrumental_target − instrumental_comp)
- [x] `MERR`: scatter from comp/check difference as a first approximation (replace with Poisson later — see Roadmap)
- [x] Airmass (Kasten & Young 1989) from mid-exposure JD, observer site, T CrB J2000 RA/Dec; error if altitude ≤ 0°

## 6. Acquisition-time dialog
- [x] Modal `Dialog` with Start / End fields (UTC ISO-8601) and JD readouts
- [x] "Reference file" button → `OpenFileDialog` → `FileFormat`/`FileFormatInstance` read
- [x] Populate Start from `DATE-OBS`; End from `DATE-OBS + EXPTIME`; show `EXPTIME`
- [x] Mid-time selector: three modes — `= Start` / `= (Start+End)/2` (default) / Manual
- [x] Display final mid-time JD prominently
- [x] Sanity guards: `EXPTIME > 0`, End strictly after Start (cross-frame span is not an error)
- [x] OK / Cancel; abort script on Cancel

## 7. AAVSO report writer
- [x] `SaveFileDialog` on every run; enforce `.txt` / `.csv` / `.tsv` extension
- [x] Write file header: `#TYPE`, `#OBSCODE`, `#SOFTWARE`, `#DELIM`, `#DATE`, `#OBSTYPE`
- [x] Write observation line with all 15 fields (see `docs/aavso-extended-format.md`)
- [x] `CMAG` / `KMAG` = instrumental magnitudes (not catalogue); `MTYPE=STD`; `TRANS=NO`
- [x] Echo full output to Process Console

---

## Roadmap items in scope for v1

- [x] Selectable comp/check stars in the dialog at runtime (Comp/Check label edit fields, persisted)
- [x] **Forbidden-process detection — robustness** (current check only covers saved FITS `HISTORY` keywords; in-memory stacks after `ImageIntegration` are a blind spot):
  - [x] Warn if `view.historyIndex > 0` when no forbidden HISTORY keyword found ("image modified this session — verify linearity")
  - [x] Supplement with green-channel median heuristic: linear master typically < 0.05; stretched image typically > 0.15
  - [x] Nudge user to save master stack before running (so HISTORY keywords are present) — static precondition line in the dialog
- [x] Annotated verification image (thumbnail with target + comp/check marked)
- [ ] Check-star gate: warn if (K−C) deviation exceeds threshold before writing
- [x] Real `MERR`: Poisson + sky-background noise (PSF MAD residuals propagated via matched-filter formula)

### Security audit (needed before 1.0.0)
- [ ] **Input validation** — validate all user-editable fields (lat/lon/elev, time fields, manual mid-time) before use; reject or clamp out-of-range values
- [ ] **CSV content sanitisation** — star labels, AUIDs, and comments read from the CSV are written verbatim into the AAVSO report; verify no field can inject extra delimiters or newlines that corrupt the output format
- [ ] **FITS keyword sanitisation** — values from `HISTORY`, `DATE-OBS`, site keywords are displayed in the dialog and/or written to the report; confirm they cannot inject HTML into `useRichText` labels or corrupt the report file
- [ ] **File path handling** — stored CSV path and export path come from user input / Settings; confirm no path traversal or unintended overwrite is possible via `SaveFileDialog`
- [ ] **No unintended network access** — confirm the script makes no outbound connections (PJSR can call `NetworkTransfer`; verify it is not used)
- [ ] **Settings namespace isolation** — confirm `BeSchne/Photometry/…` keys cannot read or overwrite keys from other PixInsight scripts

### PixInsight script documentation (needed before 1.0.0)
- [ ] **`#feature-info` text** — the one-paragraph description shown in `Script > Feature Scripts` should be complete and accurate (currently minimal)
- [ ] **In-dialog tooltips** — add `toolTip` text to every control (CSV path, Comp/Check combos, time fields, lat/lon/elev, mid-time radio buttons, report format radio buttons) so hovering explains each field
- [ ] **Process Console banner** — verify the startup banner (script name, version, brief purpose) is clear enough for a new user reading the console

### Documentation (needed before 1.0.0)
- [ ] **README: screenshot** of the dialog (use `docs/screenshot, 28Jun26, initial version.png` or a fresher one)
- [ ] **README: getting-started guide** — end-to-end from download to first submitted report (assumes no prior PixInsight scripting knowledge)
- [ ] **README: how to get the comparison-star CSV** from AAVSO VSP (URL, field-of-view setting, magnitude limit, download as CSV)
- [ ] **README: how to submit to AAVSO WebObs** — link and brief steps after exporting the AAVSO Extended report
- [ ] **README: troubleshooting** — common errors and fixes (no active window, plate solve missing, star outside frame, PSF rejected)
- [ ] **README: outburst strategy summary** — when to switch comp/check labels and where to get a new chart (condense from `docs/domain-knowledge.md`)
- [ ] **README: known limitations** — TG ≠ V (systematic offset for red stars), Seestar FOV constraint at nova peak

## Roadmap items not in scope for v1

- [ ] **UI redesign — tabbed / step-oriented layout.** The current single long dialog is hard to navigate and hides the verification image behind a modal window. Ideas to explore:
  - Tab strip across the top (or step list on the left): **Setup** → **Run** → **Timing** → **Report**
  - Remaining panel space used for the verification thumbnail (currently a separate window) and the report preview side-by-side
  - Eliminates the modal-blocks-image-window problem: verification thumbnail lives inside the dialog
  - Consider whether non-modal (`show()` + explicit "Close" state machine) is worth the added complexity vs. a well-structured modal with embedded panels
- [ ] **Verification image stretch controls.** Currently the stretch is fixed at run time and cannot be changed without interacting with a separate image window (blocked by modal dialog). Add on-demand stretch options, e.g. radio buttons or a button group: **Auto** (current formula, `mtf(0.25, median)`) / **Boosted** (more aggressive: lower target background, e.g. `mtf(0.1, median)`) / **Linear** (no stretch, raw pixel values). If the thumbnail is embedded in the dialog (see UI redesign above), these controls sit alongside it; otherwise they re-render the separate verification window.
- [ ] Ensemble photometry (`CNAME=ENSEMBLE`)
- [ ] User-specifiable target star
- [ ] TG→V transformation (`TRANS=YES`)
- [ ] Multiband TB/TG (blue channel)
