# Domain Knowledge Reference

## Target

Since v2.0.0 the target is entered by name; its J2000 position comes from the AAVSO
VSP response (VSX name resolution), or from manual RA/Dec in Setup. Nothing is
hardcoded.

**T Coronae Borealis ("Blaze Star")**, the target the script was developed for:
- RA = 239.8757° (15h 59m 30.2s), Dec = +25.9202° (+25° 55′ 13″) — matches VSP
  (`000-BBW-825`, `15:59:30.16 25:55:12.6`)

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

## AAVSO VSP chart ID naming convention

The VSP issues two different IDs for the same observation field:

| ID example | Suffix | Use |
|---|---|---|
| `X42615BSV` | V = visual finder chart | Print and use at the eyepiece |
| `X42615BSX` | X = extended photometry sequence | Put in the AAVSO `CHART` report field |

CCD/OSC observers must cite the **chart ID** from the photometry sequence in the `CHART` report field, not the finder chart ID. The VSP photometry table page states it explicitly: *"Report this sequence as X42597QE in the chart field."* The chart API returns this ID as `<chartid>`; the script writes it into `CHART` and names the saved `<chartId>.csv` after it. Identical requests (target, fov, maglimit) return the same ID.

**Coverage:** the sequence covers the whole square chart of side `fov`, centred on the target (a 60′ request returned stars up to 39.4′ from T CrB ≈ 30′·√2). An earlier note here said "half the plotted FoV radius" — that was wrong.

**Size limit:** charts larger than 180′ are only allowed with `maglimit` ≤ 12.

## Comparison stars (AAVSO VSP chart API)

Downloaded at run time: `https://apps.aavso.org/vsp/api/chart/?star=<name>&fov=<arcmin>&maglimit=<mag>&format=xml`
(or `ra=`/`dec=` in decimal degrees instead of `star=`). Details: `plan-generic-target.md`.
The response lists each star once with all bands (`V`, `B`, `Rc`, `Ic`, `J`, `H`, `K`).

**Saved CSV** (`<chartId>.csv`, written next to the exported report) — same layout as
the former VSP photometry-table export:

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

One row per star **per band**; the script writes V and B rows (V is the reference for TG, B for TB). The `Comments` field is RFC 4180 quoted when needed, with embedded double-quotes escaped as `""` — e.g. label 102: `"Combined magnitude of a 10.21 and 13.75 Vmag. pair 8"" apart. ..."`.

**Blend warning:** label `102` (AUID `000-BBW-779`) near T CrB is a blended pair: combined V = 10.167; individual stars 10.21 + 13.75 mag, 8″ apart. Unsuitable for PSF fitting. The script excludes stars whose comments match blend/pair/combined.

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

### Stage 1 — Early brightening (~7–9 mag): automatic

The comp ensemble is pre-selected within 2 mag of the target's brightness *estimated in the image* (median zero-point of all good comps), so brighter comps near T CrB are picked up as it brightens:

| Label | AUID | V mag | Suits T CrB at |
|-------|------|-------|----------------|
| `98`  | `000-BBW-796` | 9.809 | Quiescence (~10 V) |
| `106` | `000-BJS-901` | 10.554 | Quiescence |
| `84`  | `000-BBW-888` | 8.361 | Brightening, ~7–9 mag |
| `79`  | `000-BBW-881` | 7.886 | Brightening, ~7–9 mag |

Check the selection in the Comp Stars step; ticks can be changed per run.

### Stage 2 — Nova peak (~2–6 mag): lower the Comp mag limit

T CrB will saturate at any normal exposure; you will be shooting very short sub-second exposures, and comp stars fainter than ~5 mag may be undetectable in those frames.

**What to do:** set **Comp mag limit** in Setup to ~2–3 mag fainter than the target (e.g. 8). With a limit ≤ 12 VSP allows charts wider than 180′, so the script requests a chart covering the whole frame (up to 1200′). The new chart ID goes into the report automatically.

**The Seestar FOV constraint:** the Seestar S30 Pro has a ~4.3° × 2.4° FOV. At 2 mag, suitable comp stars (1–4 mag) may not exist within that window — the nearest bright Corona Borealis star, Alphecca (α CrB, 2.22 V), is ~4° away. If no adequate comp falls in frame, consider:
- Using a wider-field setup for the nova peak
- Visual observation — AAVSO actively solicits visual reports for bright novae
- Ensemble photometry of several fainter in-frame stars with `CNAME=ENSEMBLE` (implemented in v1.2.0)

**AAVSO alert notices:** when T CrB enters outburst AAVSO will issue Alert Notices with specific chart recommendations and exposure guidance. Monitor `aavso.org/news` and the T CrB campaign page.

## MERR — photometric magnitude error

`MERR` is computed from the DynamicPSF fit residuals, capturing Poisson photon noise + sky background noise + read noise without needing separate gain or read-noise FITS keywords.

**Per-star formula** (`psfMagError()` in the script):

`psf.mad` is the mean absolute deviation of the Gaussian fit residuals across the pixels in the fitting box (returned by DynamicPSF). $A$, $\sigma_x$, $\sigma_y$ are the fitted amplitude and Gaussian widths.

**The formula is valid only for a Gaussian PSF model.** This is why `autoPSF = false` and `gaussianPSF = true` in the script — see `docs/pjsr-api-notes.md` § *PSF model choice for photometry*.

$$\sigma_\text{pix} = \frac{\text{MAD}}{0.6745}$$

For Gaussian noise, $\text{MAD} = 0.6745\,\sigma$, so this recovers the per-pixel noise standard deviation.

$$\sigma_A = \sigma_\text{pix} \sqrt{\frac{2}{\pi \, \sigma_x \sigma_y}}$$

Noise in the fitted amplitude from an optimal matched filter applied to a 2D Gaussian PSF.

$$\text{SNR} = \frac{A}{\sigma_A}, \qquad \sigma_\text{mag} = \frac{2.5}{\ln 10} \cdot \frac{1}{\text{SNR}} \approx \frac{1.08574}{\text{SNR}}$$

**Combined MERR** — target and comp errors added in quadrature:

$$\text{MERR} = \sqrt{\sigma_T^2 + \sigma_C^2}$$

**Check-star quality gate (separate from MERR):** the check star's derived magnitude is standardised from the comp ensemble ZP and compared to its catalogue V value. If the (signed) deviation exceeds $3 \times \text{MERR}$ in absolute value, a warning is shown in the Photometry step and printed to the console. This catches systematic errors (wrong star, blending, atmospheric gradient) that the noise model cannot detect — it is a sanity check against a star whose true magnitude is already known, since T CrB's is not.

The warning reports the signed deviation (`predicted − catalogue`) and a direction-based hint: a check star that measures **fainter** than catalogue often points to a gradient, thin cloud, over-subtracted background, or a mismatched star; one that measures **brighter** often points to PSF blending with a neighbour. It also lists up to 5 other in-frame candidates not currently used as comp or check, each with its own predicted-vs-catalogue deviation (computed for free from the cached discovery-pass instrumental magnitudes — no extra PSF fitting needed), sorted by `|deviation|`, so a candidate that would pass the gate is visible at a glance. The script does **not** auto-switch the check star — if the underlying cause is systemic (bad ensemble ZP, atmospheric gradient, plate-solve offset), most candidates would deviate similarly, and silently picking whichever agrees best would mask the problem instead of catching it. The operator decides.

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
