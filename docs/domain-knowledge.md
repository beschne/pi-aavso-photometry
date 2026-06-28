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

## Airmass computation (Kasten & Young 1989)

Pure JavaScript, no external dependency. Input: mid-exposure JD (UTC), observer site lat/long, target J2000 RA/Dec.

**Steps:**

1. **JD → GMST** (Meeus, *Astronomical Algorithms*, ch. 12)
2. **LST** = GMST + longitude_east (both in degrees)
   **Hour angle** H = LST − RA (degrees)
3. **True altitude h:**
   ```
   sin h = sin φ · sin δ + cos φ · cos δ · cos H
   ```
4. **Airmass:**
   ```
   X = 1 / ( sin(h) + 0.50572 · (h_deg + 6.07995)^(−1.6364) )
   ```
   where `h_deg` is altitude in degrees. Valid down to the horizon.
   Do **not** use plain `sec z = 1 / sin h` — it diverges near the horizon.

- Use J2000 RA/Dec — precession/refraction are negligible at the reported precision.
- If computed altitude ≤ 0°, the star is not observable → emit an error, not a nonsensical airmass value.
