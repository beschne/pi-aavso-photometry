# Domain Knowledge Reference

## Target: T Coronae Borealis ("Blaze Star")

**Catalog position (J2000, hardcoded constant):**
- RA = 239.8757° (15h 59m 30.2s)
- Dec = +25.9202° (+25° 55′ 13″)

Keep in the top constants block, factored for extensibility to other targets.

## Observer site

**Pfaffenwiesbach / Bad Homburg:**
- Latitude: +50.302°
- Longitude: +8.553° (East positive)
- Elevation: ~320 m (not needed for geometric airmass)

FITS override: if `SITELAT`/`SITELONG` keywords are present and reliable, they may be used; otherwise use the above constants.

## TG band and OSC convention

- The green channel of an OSC sensor is reported to AAVSO as **TG** (tri-color green), not Johnson V.
- TG runs **systematically brighter than V** for red stars (~0.1–0.3 mag) — significant because T CrB has an M3 III companion.
- **Never relabel TG as V.**
- I/R/B bands track the persistent M-giant companion, not white-dwarf activity. This script reports TG only by design.

## Comparison-star CSV (AAVSO VSP export)

**Files:**
- `docs/X42597QE_photometry.csv` — reference copy of the AAVSO VSP export for chart X42597QE
- `sample_comparison_stars.csv` — format sample (root of repo)

**Columns:** `AUID,RA,Dec,Label,Band,Mag,Error,Comments`

| Column | Format | Notes |
|--------|--------|-------|
| `AUID` | string | Preferred identifier for AAVSO report |
| `RA` | `HH:MM:SS.ss` | Sexagesimal |
| `Dec` | `DD:MM:SS.s` | Sexagesimal — **no leading `+`** for positive declinations |
| `Label` | string | V mag × 10 (e.g., `98` = 9.8 mag) |
| `Band` | string | V, B, Rc, Ic, J, H, K, SG, SR, SI, … |
| `Mag` | float | Catalogue magnitude in this band |
| `Error` | float | Magnitude uncertainty |
| `Comments` | string | Blend warnings, notes; may be RFC 4180 quoted with escaped `""` |

**Critical:** one row per star **per band** → filter to `Band == "V"` before use (V magnitudes are the reference for TG differential photometry).

**CSV quoting:** the `Comments` field may be RFC 4180 quoted, with embedded double-quotes escaped as `""`. Example from label 102: `"Combined magnitude of a 10.21 and 13.75 Vmag. pair 8"" apart. ..."`. Use a proper CSV parser, not a naive `split(",")`.

**Blend warning:** label `102` (AUID `000-BBW-779`) on chart X42597QE is a blended pair: combined V = 10.167; individual stars 10.21 + 13.75 mag, 8″ apart. Unsuitable for PSF fitting. Parse `Comments` for blend flags and exclude flagged stars.

**Column mismatch:** fail loudly — do not silently skip rows.

## DATE-OBS caveat

PixInsight's `ImageIntegration` writes `DATE-OBS` as the midpoint between the *first* and *last* subframe **start** times, ignoring exposure duration. This is not true mid-exposure time and is unreliable for Seestar stacks. The acquisition-time dialog (see `time-handling.md`) fixes this by reading start/end from referenced subframes and computing the true mid-time. The stack's own `DATE-OBS` is never trusted blindly.

## Saturation / clipping detection

The master is a normalised float in [0,1] — an absolute pixel threshold is meaningless.

**Flag a star as saturated when both conditions hold:**
1. Measured peak (DynamicPSF amplitude + background) > `SATURATION_FRACTION` × image robust maximum
   - Robust maximum: use 99.99th percentile or max with single-pixel outliers excluded — **not** raw `max` (a hot pixel would skew the scale)
   - Default `SATURATION_FRACTION` ≈ 0.90; calibrate once against a known clipped star
2. DynamicPSF fit quality is anomalous (high MAD/residual — a clipped core fits a Gaussian poorly)

- High peak + clean fit = merely a bright star → keep
- High peak + poor fit = clipped/saturated → reject

Caveat: true saturation is a subframe property; on the master this is only a heuristic — keep it conservative.

## Outburst observation strategy

T CrB is expected to brighten by ~8 magnitudes from quiescence (~10 V) to nova peak (~2 V). The script handles this in two stages:

### Stage 1 — Early brightening (~7–9 mag): change comp/check labels in the dialog

The current chart **X42597QE** already contains brighter comp stars:

| Label | AUID | V mag | Use when T CrB is |
|-------|------|-------|-------------------|
| `98`  | `000-BBW-796` | 9.809 | Quiescence (~10 V) — default |
| `106` | `000-BJS-901` | 10.554 | Quiescence — default check |
| `84`  | `000-BBW-888` | 8.361 | Brightening, ~7–9 mag |
| `79`  | `000-BBW-881` | 7.886 | Brightening, ~7–9 mag |

Switch comp and check labels in the **Comp label / Check label** dialog fields before clicking Run Photometry. The selection persists between sessions via Settings.

### Stage 2 — Nova peak (~2–6 mag): download a new VSP chart

At peak brightness the faint comp stars in X42597QE are still measurable — the problem is T CrB itself will saturate at any normal exposure. You will be shooting very short sub-second exposures, and comp stars fainter than ~5 mag may be undetectable in those frames.

**What to do:**
1. Go to the **AAVSO Variable Star Plotter** (VSP) at `aavso.org/vsp`.
2. Enter `T CrB`, set field of view to 180′ or wider, and set magnitude limit to ~5 or 6.
3. Download the **Photometry Table** as CSV — it is the same column format the script already reads.
4. Load the new CSV in the script via the Browse button; enter suitable comp/check labels from the new chart.
5. Update the `CHART` constant in the script to match the new chart ID shown in the VSP output.

**The Seestar FOV constraint:** the Seestar S50 has a ~1.4° × 1.0° FOV. At 2 mag, suitable comp stars (1–4 mag) may not exist within that window — the nearest bright Corona Borealis star, Alphecca (α CrB, 2.22 V), is ~4° away. If no adequate comp falls in frame, consider:
- Using a wider-field setup for the nova peak
- Visual observation — AAVSO actively solicits visual reports for bright novae
- Ensemble photometry of several fainter in-frame stars with `CNAME=ENSEMBLE` (future feature)

**AAVSO alert notices:** when T CrB enters outburst AAVSO will issue Alert Notices with specific chart recommendations and exposure guidance. Monitor `aavso.org/news` and the T CrB campaign page.

## MERR — photometric magnitude error

`MERR` is computed from the DynamicPSF fit residuals, capturing Poisson photon noise + sky background noise + read noise without needing separate gain or read-noise FITS keywords.

**Per-star formula** (`psfMagError()` in the script):

`psf.mad` is the mean absolute deviation of the Gaussian fit residuals across the pixels in the fitting box (returned by DynamicPSF). $A$, $\sigma_x$, $\sigma_y$ are the fitted amplitude and Gaussian widths.

$$\sigma_\text{pix} = \frac{\text{MAD}}{0.6745}$$

For Gaussian noise, $\text{MAD} = 0.6745\,\sigma$, so this recovers the per-pixel noise standard deviation.

$$\sigma_A = \sigma_\text{pix} \sqrt{\frac{2}{\pi \, \sigma_x \sigma_y}}$$

Noise in the fitted amplitude from an optimal matched filter applied to a 2D Gaussian PSF.

$$\text{SNR} = \frac{A}{\sigma_A}, \qquad \sigma_\text{mag} = \frac{2.5}{\ln 10} \cdot \frac{1}{\text{SNR}} \approx \frac{1.08574}{\text{SNR}}$$

**Combined MERR** — target and comp errors added in quadrature:

$$\text{MERR} = \sqrt{\sigma_T^2 + \sigma_C^2}$$

**Check-star quality gate (separate from MERR):** the check star's derived magnitude is standardised from the comp and compared to its catalogue V value. If the deviation exceeds $3 \times \text{MERR}$, a warning is printed to the console. This catches systematic errors (wrong star, blending, atmospheric gradient) that the noise model cannot detect.

**Typical values:** for a 20–25 frame × 30 s Seestar stack of a ~10 mag target, MERR is typically 0.003–0.010 mag.

## Airmass computation (Kasten & Young 1989)

Pure JavaScript, no external dependency. Input: mid-exposure JD (UTC), observer site lat/long, target J2000 RA/Dec.

**Steps:**

1. **JD → GMST** (Meeus, *Astronomical Algorithms*, ch. 12)
2. **LST** = GMST + longitude_east (both in degrees)
   **Hour angle** H = LST − RA (degrees)
3. **True altitude** $h$:

$$\sin h = \sin\varphi\,\sin\delta + \cos\varphi\,\cos\delta\,\cos H$$

4. **Airmass** (Kasten & Young 1989):

$$X = \frac{1}{\sin h + 0.50572\,(h_\text{deg} + 6.07995)^{-1.6364}}$$

   where $h_\text{deg}$ is altitude in degrees. Valid down to the horizon.
   Do **not** use plain $X = 1/\sin h$ — it diverges near the horizon.

- Use J2000 RA/Dec — precession/refraction are negligible at the reported precision.
- If computed altitude ≤ 0°, the star is not observable → emit an error, not a nonsensical airmass value.
