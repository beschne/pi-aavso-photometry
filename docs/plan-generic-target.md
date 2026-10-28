# Plan: generic target, automatic comparison stars

Branch: `generic-target` (from `main` at v1.4.0). `main` stays the T CrB release.
Status: **steps 1–9 done; `2.0.0-rc.1`.** Tested in PixInsight on a T CrB master
(identical result to v1.4.0; manual coordinates, unknown name and unsaved stack
also pass) and on SS Cyg (second target; found and fixed the duplicate-label
bug). Security audit done (no open findings). The real report for the rc step
is the SS Cyg submission of 2026-10-28 (made with 2.0.0-dev, same code as rc.1).
Next: merge to `main` as `2.0.0`.
Last updated 2026-10-28.

## Goal

The script's only inputs are the **object name** and the **plate-solved master
file**. The script fetches the AAVSO comparison-star sequence and finder chart
itself. The user no longer downloads charts or comparison-star CSVs, and the
CSV file picker is removed.

## Verified facts (2026-10-28, probed with curl)

| Fact | Evidence |
|------|----------|
| Old JSON endpoint `apps.aavso.org/vsp/api/photometry/` still dead (302 → v2 → 404) | `tools/README.md`, re-checked |
| `https://apps.aavso.org/vsp/api/chart/?star=<name>&fov=<arcmin>&maglimit=<mag>&format=xml` works (200, XML) | T CrB, RS Oph, SS Cyg |
| Same endpoint accepts `ra=<deg>&dec=<deg>` (decimal degrees) instead of `star` | `ra=239.8757&dec=25.9202` → 12 comps |
| Response: `chartid`, `image_uri` (PNG), `star`, `fov`, `maglimit`, and `photometry` list with `auid`, `ra`, `dec`, `label`, `bands` (V, B, Rc, Ic, J, H, K — each `mag` + `error`), `comments` | `chart60.xml` |
| **The target's own `auid`/`ra`/`dec` are direct children of `<root>`**, after the `photometry` list (corrected — an earlier draft said it was a label-less list entry) | T CrB → `000-BBW-825 15:59:30.16 25:55:12.6` (matches the hardcoded position); RS Oph, SS Cyg likewise; also with `maglimit=5` |
| Query by `ra`/`dec` returns **no** target entry | as expected |
| Unknown name → HTTP 400 with `<errors><list-item>Star … does not exist in VSX</list-item>…` | `NoSuchStar XYZ` |
| `chartid` depends on the request: identical parameters return the same ID within a day (`X43358AIB` twice for T CrB 60′); it differs from July (`X42615NN`) | — |
| Comparison V magnitudes for T CrB 60′ are identical to the July CSV `X42615NN` (12/12 stars) | offline test |
| **Finder-chart PNG endpoint is failing:** `vsp/chart/<id>.png` and the VSP chart page both return HTTP 500 after ~90 s | tested twice, fresh and old chart IDs |
| Coverage is the **full square chart**, not half its radius: `fov=60` returned stars up to 39.4′ from the target (≈ 30′·√2) | separation check on `chart60.xml` |
| B is delivered directly — no need to derive B = V + (B−V) | — |
| **VSP limits wide charts:** fov > 180′ requires maglimit ≤ 12 (HTTP 400 otherwise). The script caps the chart at 180′ when the comp mag limit is fainter than 12 and warns that corner stars are missing | found in the first PixInsight run (Seestar field needs 198′); 180′/14.5 ✓, 181′/14.5 ✗, 330′/12 ✓ |
| VSX API (`www.aavso.org/vsx/…`) is behind a Cloudflare challenge; CDS (SIMBAD/Sesame) timed out from the sandbox | — |

## Changes since the first draft of this plan

1. **No external name resolver.** The target's coordinates come from the
   root-level `ra`/`dec` in the VSP response, i.e. VSX's own name resolution. Sesame is
   dropped: one network dependency instead of two, and the target name in the
   report is guaranteed to match what AAVSO knows.
2. **Manual fallback queries VSP by RA/Dec.** If the name is unknown to VSX, the
   user enters RA/Dec and the chart is requested by position.
3. **FOV is computed from the target, not the image centre.** The VSP chart is
   centred on the target, so the required size depends on where the target sits
   in the frame. The old "half radius" assumption in `tools/README.md` is wrong.
4. **`TARGET.magQuiescence` needs a replacement** (see step 6) — it was hidden
   T CrB knowledge in the comp-selection logic.

## Implementation steps

### 1. Dialog inputs (Setup step)

- **Object name** (Edit, persisted as `BeSchne/Photometry/objectName`).
- **Comparison-star magnitude limit** (default 14.5, persisted).
- **Manual RA/Dec** (disabled by default; enabled automatically when the name
  lookup fails, or by a checkbox). Parsed with the existing `parseCoord()` /
  `sexagesimalToDeg()`; accept sexagesimal or decimal degrees.
- **Remove** the CSV picker (`csvEdit`, browse button, `csvRow`,
  `aavso-photometry.js:1116–1138`), `SETTINGS_CSV` (line 88) and the
  `_csvPath` checks (line ~2078).
- The master file is the active image window, as now.

### 2. FOV from the plate solution

- Load the WCS via `loadAstrometry()` (unchanged).
- Coordinates of the target: from the VSP response (or manual RA/Dec). Project
  it to pixels; abort if outside the frame.
- Convert the four image corners to RA/Dec (pixel → celestial via the same
  `AstrometricMetadata` instance; verify the method name in the bundled
  library). Required half-size *r* = max angular distance from the target to any
  corner.
- Request `fov = ceil(2 · r · 1.1)` arcmin (10 % margin). The circle bound is
  conservative for the square chart.
- **Chicken-and-egg:** the target position is needed to compute the FOV, but it
  comes from the VSP response. Resolve by a two-pass request: first a small
  request (`fov=30`, `maglimit=5`) only to get the target's coordinates, then the
  real request with the computed FOV. Both are cheap (≈ 5 KB for the first).
- Show the computed image FOV and requested chart FOV in the Setup step.
- Check the maximum `fov` VSP accepts and clamp to it; log a warning if clamped.

### 3. Fetch

- HTTP GET via PJSR `NetworkTransfer` (confirmed to exist; usage not yet
  tested). HTTPS only; URL-encode the name; set a User-Agent; timeout.
- On HTTP 400: parse `<errors>` and show the message ("does not exist in VSX")
  in the dialog; enable the manual RA/Dec field.
- On network failure: clear error, no silent fallback.

### 4. Parse

- PJSR has `XMLDocument.parse()` with `XMLElement.childElementsByName()` and
  `.text` (documented in the PI 1.9.4 PJSR reference) — used directly; nested
  `<list-item>` inside `<bands>` is handled because the lookup is
  non-recursive.
- Root-level `ra`/`dec` → target. If absent (RA/Dec query), use the manual
  coordinates.
- Produce exactly the star objects `loadComparisonStars()` returns today (with
  `magV`/`errorV`, `magB`/`errorB`, blend flag from `comments`), so PSF,
  ensemble, check-star and report code stay unchanged.
- Validate: `chartid` matches `^X[0-9A-Z]+$` before it is used as a filename
  (path-traversal guard); reject response if it does not.

### 5. Saved artifacts

- **Changed after the first PixInsight runs:** the files are written **on
  export, into the report's folder**, not next to the master at discovery. A
  checkbox next to Export, "Also save comparison stars and finder chart" (on by
  default, persisted as `BeSchne/Photometry/saveSequenceWithReport`), controls
  it. Reason: the CSV is the evidence for the report's `CHART` line and AAVSO
  revises sequences over time; runs that are never exported leave no files;
  no special case for unsaved stacks.
- Files: `<chartid>.csv` (`AUID,RA,Dec,Label,Band,Mag,Error,Comments`, V and
  B rows) and `<chartid>.png` (if it could be downloaded). Existing files in
  the export folder are kept, so several reports share one copy.
- **Changed after the SS Cyg test:** the PNG is no longer fetched during
  discovery (it cost 20 s per new chart and always failed). A second checkbox,
  "Download finder chart" (off by default, `BeSchne/Photometry/saveChartWithReport`),
  downloads it at export; the first checkbox is now "Save comparison stars"
  (CSV only). Comp Stars has three stages instead of four.
- These files are records of a run, not inputs. The CSV parser
  (`loadComparisonStars`, `parseCSVRow`, `readTextFile`) is removed.
- The PNG download is limited to 20 s and only warns on failure; the console
  then prints the chart URL. Rechecked 2026-10-28: HTTP 500 after ~90 s for every
  chart, even a fresh 30′ chart with 6 stars, with or without a browser user agent;
  the chart page redirects to `/v2/vsp/chart/<id>`, which returns 404. The data
  endpoints answer in < 1 s, so the fault is AAVSO's image renderer.
- The sequence is cached for the dialog session (same image, name,
  coordinates, mag limit), so revisiting the Comp Stars step does not
  re-download.

### 6. Target-specific constants

- `TARGET` (line 31): `name`, `ra`, `dec` filled at run time.
- `CHART` (line 45): from `chartid`.
- `TARGET.magQuiescence` (used for default comp/check selection, line ~2151):
  replace with an **estimate of the target's magnitude from this image** —
  compute a preliminary ZP from all good-PSF comps, derive the target's TG mag,
  then pick comps by Δmag from that estimate. No catalogue magnitude needed.
- Report `NAME`: the name as VSX returns it in `<star>` (e.g. `RS OPH`) —
  confirm AAVSO WebObs accepts that form; otherwise use the name as typed.
- Remove remaining T CrB wording from labels and tooltips.

### 7. Cleanup — done 2026-10-28 (confirmed by the user)

- `charts/` (pre-fetched T CrB CSV/PNG + `charts/README.md`)
- `sample_comparison_stars.csv`
- `tools/fetch-vsp.py`, `tools/README.md`

### 8. Docs and version — done 2026-10-28

- README (EN + DE): replace "Get the comparison-star CSV", troubleshooting rows
  about CSVs, outburst instructions that call `fetch-vsp.py`, file list.
- `docs/Photometry.html` and screenshots — all seven steps re-captured as
  `screenshot, v2.0.0-dev, …` (2026-10-28); READMEs and CLAUDE.md point to them. Also new in
  `docs/pjsr-api-notes.md`: NetworkTransfer, XMLDocument, and the regex-`//`
  preprocessor pitfall.
- `CLAUDE.md`: architecture items 4–5, comparison-CSV bullet, default comp/check
  bullet, settings key, file table.
- `TODO.md`: close "user-specifiable target star" and "FOV-aware comparison star
  CSV".
- `docs/domain-knowledge.md`, `docs/outburst-strategy*.md`: chart workflow.
- Versioning (2.0.0: workflow change, settings key removed). `VERSION` appears in
  the console banner and in the `#SOFTWARE` header of every AAVSO report, so the
  branch must never report itself as 1.4.0 or as a finished 2.0.0:
  1. First code commit on `generic-target`: `VERSION = "2.0.0-dev"`.
  2. When the PixInsight test sequence (step 9) passes: `2.0.0-rc.1`; submit
     one real T CrB report and compare with a v1.4.0 run on the same master.
     Increment `rc.N` for fixes.
  3. After merging to `main`: `VERSION = "2.0.0"`, tag `v2.0.0`, GitHub Release
     (see `PRIVATE_NOTES.md`).
  - At each step, also update the help-page footer in `docs/Photometry.html`
    (currently `2.0.0-rc.1`).
  - `main` stays at 1.4.0; urgent T CrB fixes ship from `main` as 1.4.x.
- Repeat the security audit (`SECURITY_AUDIT.md`) — new network input and new
  file writes.

### 9. Testing

- Offline (done 2026-10-28, 31/31 checks pass; the harness was in the session
  scratchpad and is gone — the duplicate-label fix was only syntax-checked offline): the script's own functions,
  loaded in Node with PJSR mocks, against saved responses (T CrB 60′ and
  900′/maglimit 5, RS Oph, SS Cyg, RA/Dec query, unknown name): XML parse,
  target coordinates, CSV writer, URL builder, manual RA/Dec parsing, FOV
  sizing (centred, corner, clamped), target-magnitude estimate. The harness is
  not in the repo (the project rule is PJSR only).
- In PixInsight (user), 2026-10-28 on a T CrB master:
  - ✓ compared with a v1.4.0 run on the same file — identical magnitudes, MERR and comps
  - ✓ manual RA/Dec — request by `ra=239.87567&dec=25.92017&fov=180&maglimit=14.5`
  - ✓ unknown name (`T CrX`) — VSX error shown, **Coordinates** ticked automatically
  - ✓ unsaved in-memory stack — discovery and export work
  - ✓ busy guard — closing and step clicks blocked during discovery
- In PixInsight (user), 2026-10-28 on an SS Cyg master (Seestar S30P, 40 × 10 s):
  - ✓ second target — 180′ chart X43358HAP, 96 stars, 70 in frame (field needs
    290′, so the cap at 180′ for mag limit 14.5 and its warning were exercised)
  - ✗→✓ **duplicate chart labels:** wide VSP charts reuse labels for stars of
    equal magnitude (here two 114, two 116, two 118, four 134, …). PSF fits were
    keyed by label, so same-label stars shared one fit and most were rejected
    ("centroid ~1000 px from projected position"). Fixed: fits keyed per star,
    comp/check selection matched by star, not label. Stars marked OK were never
    affected (the 5 px position check held), so the first result was valid.
  - ✓ report notes name stars with a duplicated label by AUID, e.g.
    `comp 000-BCP-196+000-BKL-344+117+000-BLR-636+000-BCP-241+000-BCP-232; check 119`
  - Result after the fix: SS Cyg 11.636 ± 0.032 TG, 12.374 ± 0.055 TB, 6 comps,
    check 119 −0.023 mag (before: 11.602 ± 0.029, check 121 −0.049); submitted to AAVSO
  - ✓ finder chart moved to export: Comp Stars shows Steps 1/3–3/3; chart
    checkbox off → URL printed, on → 20 s attempt and warning; both checkboxes
    remembered across restarts

## Open points

- `NetworkTransfer` usage follows the PJSR reference but is untested in
  PixInsight — in particular whether `download()` returns the body of an
  HTTP 400 (needed for the "does not exist in VSX" message) and whether the
  progress handler fires often enough for the time limit.
- `fov=1200` was accepted; the real maximum is unknown, so 1200′ is the clamp.
- Finder-chart PNG endpoint returns HTTP 500 — recheck later; nothing to change
  in the script when it recovers.
- Whether WebObs prefers `RS OPH` or `RS Oph` in `NAME`.
- Offline use: without network the script cannot run. A "reuse saved
  `<chartid>.csv`" option would bring back a file picker, so it is out of scope
  unless wanted.
