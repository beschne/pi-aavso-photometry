# tools/fetch-vsp.py

Downloads an AAVSO VSP comparison-star table and finder chart for a variable
star and saves them as:

- `charts/<chartID>.csv` — comparison stars in the format the photometry script expects
- `charts/<chartID>.png` — finder chart image

The chart ID printed to stdout is the same value that goes in the AAVSO `CHART`
report field.

## Usage

```bash
python3 tools/fetch-vsp.py [options]
```

| Option | Default | Description |
|---|---|---|
| `--star` | `T CrB` | Variable star name |
| `--fov` | `450` | Field of view in arcminutes (450 = 7.5°) |
| `--maglimit` | `14.5` | Faint magnitude limit |
| `--outdir` | `charts` | Output directory |

No external dependencies — stdlib only (Python 3.6+).

## Chart ID naming: finder chart vs. photometry sequence

The VSP issues two different IDs for the same observation field:

| ID example | Suffix | Use |
|---|---|---|
| `X42615BSV` | V = visual finder chart | Print and use at the eyepiece |
| `X42615BSX` | X = extended photometry sequence | Put in the AAVSO `CHART` report field |

CCD/OSC observers must cite the **chart ID from the photometry sequence** (X suffix)
in the `CHART` report field, not the finder chart ID. The VSP photometry table page
states it explicitly: *"Report this sequence as X42597QE in the chart field."*
That value is used as both the CSV filename (e.g. `charts/X42597QE.csv`) and the
AAVSO `CHART` field. The sequence covers stars within half the plotted FoV radius —
a 7.5° chart gives a 3.75° sequence.

## CSV format

`AUID,RA,Dec,Label,Band,Mag,Error,Comments` — one row per star per band.

- V comes directly from the VSP photometry table.
- B is derived as V + (B-V); B error is propagated as √(errV² + errBV²), which
  is slightly more conservative than a directly measured B-band error. Magnitudes
  are exact.
- RA as `HH:MM:SS.ss`, Dec as `DD:MM:SS.s` (no leading `+` for positive values).

## VSP REST API — broken since AAVSO v2 migration (verified 2026-07-03)

The tool scrapes the HTML photometry table endpoint, which still works. The JSON
REST API is broken — every path redirects into a dead v2 endpoint:

```
apps.aavso.org/vsp/api/photometry/?<params>
  → 302 → apps.aavso.org/v2/vsp/api/photometry?<params>   [404 SPA]
```

When the API is restored, the intended URL is:
```
https://apps.aavso.org/vsp/api/photometry/?star=T+CrB&fov=450&maglimit=14.5
```
The response would include `chartid` and a `photometry` array — removing the need
for HTML scraping. The PixInsight `NetworkTransfer` class (no `#include` needed) is
confirmed available in PJSR scripts for when that migration is complete.
