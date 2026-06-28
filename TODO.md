# beschne-photometry.js — Build Checklist

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

## Roadmap items (not in scope for v1)

- [ ] Selectable comp/check stars in the dialog at runtime (Priority 1 — needed for outburst)
- [ ] **Forbidden-process detection — robustness** (current check only covers saved FITS `HISTORY` keywords; in-memory stacks after `ImageIntegration` are a blind spot):
  - [ ] Warn if `view.historyIndex > 0` when no forbidden HISTORY keyword found ("image modified this session — verify linearity")
  - [ ] Supplement with green-channel median heuristic: linear master typically < 0.05; stretched image typically > 0.15
  - [ ] Nudge user to save master stack before running (so HISTORY keywords are present)
- [ ] Annotated verification image (thumbnail with target + comp/check marked)
- [ ] Check-star gate: warn if (K−C) deviation exceeds threshold before writing
- [ ] Real `MERR`: Poisson + sky-background noise
- [ ] Ensemble photometry (`CNAME=ENSEMBLE`)
- [ ] User-specifiable target star
- [ ] TG→V transformation (`TRANS=YES`)
- [ ] Multiband TB/TG (blue channel)
- [ ] README.md
