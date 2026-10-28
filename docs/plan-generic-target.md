# Plan: generic target, automatic comparison stars

Branch: `generic-target` (from `main` at v1.4.0). `main` stays the T CrB release.
Status: **plan only — nothing implemented.** Last reviewed 2026-10-28.

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
| **The target itself is in the `photometry` list** as an entry with `auid`/`ra`/`dec` but **no `label` and no `bands`** | T CrB → `000-BBW-825 15:59:30.16 25:55:12.6` (matches the hardcoded position); RS Oph, SS Cyg likewise; also with `maglimit=5` |
| Query by `ra`/`dec` returns **no** target entry | as expected |
| Unknown name → HTTP 400 with `<errors><list-item>Star … does not exist in VSX</list-item>…` | `NoSuchStar XYZ` |
| `chartid` is **new on every request** (T CrB 60′: `X42615NN` in July, `X43358AIB` today) | — |
| Coverage is the **full square chart**, not half its radius: `fov=60` returned stars up to 39.4′ from the target (≈ 30′·√2) | separation check on `chart60.xml` |
| B is delivered directly — no need to derive B = V + (B−V) | — |
| VSX API (`www.aavso.org/vsx/…`) is behind a Cloudflare challenge; CDS (SIMBAD/Sesame) timed out from the sandbox | — |

## Changes since the first draft of this plan

1. **No external name resolver.** The target's coordinates come from the
   label-less entry in the VSP response, i.e. VSX's own name resolution. Sesame is
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

- Check whether PJSR has an XML parser (`XMLDocument` or similar, as used by
  `ImageSolver`/XISF code). Otherwise a targeted parser for this fixed
  structure: split `<photometry>` into top-level `<list-item>` blocks, then
  read fields per block. Nested `<list-item>` inside `<bands>` must be handled.
- Decode XML entities in `comments`.
- Entry without `label` and without `bands` → target. If more than one, take
  the one closest to the chart centre; if none (RA/Dec query), use manual
  coordinates.
- Produce exactly the star objects `loadComparisonStars()` returns today (with
  `magV`/`errorV`, `magB`/`errorB`, blend flag from `comments`), so PSF,
  ensemble, check-star and report code stay unchanged.
- Validate: `chartid` matches `^X[0-9A-Z]+$` before it is used as a filename
  (path-traversal guard); reject response if it does not.

### 5. Saved artifacts

- Write `<chartid>.csv` (current CSV format:
  `AUID,RA,Dec,Label,Band,Mag,Error,Comments`, V and B rows) and
  `<chartid>.png` (downloaded from `image_uri`) **next to the master file**.
- If the image window has no file path (unsaved stack), fall back to the last
  export directory (`SETTINGS_LAST_DIR`), and say where it was written.
- These files are records of a run, not inputs. The CSV parser
  (`loadComparisonStars`) is replaced by the XML path; keep `parseCSVRow` only if
  still needed for writing/escaping — otherwise remove.

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

### 7. Cleanup (confirm before deleting)

- `charts/` (pre-fetched T CrB CSV/PNG + `charts/README.md`)
- `sample_comparison_stars.csv`
- `tools/fetch-vsp.py`, `tools/README.md`

### 8. Docs and version

- README (EN + DE): replace "Get the comparison-star CSV", troubleshooting rows
  about CSVs, outburst instructions that call `fetch-vsp.py`, file list.
- `docs/Photometry.html` and screenshots of the Setup step.
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
  - `main` stays at 1.4.0; urgent T CrB fixes ship from `main` as 1.4.x.
- Repeat the security audit (`SECURITY_AUDIT.md`) — new network input and new
  file writes.

### 9. Testing

- Offline (here): XML → star list → CSV transform and FOV arithmetic in Node
  against saved responses (T CrB 60′/900′ maglimit 5, RS Oph, SS Cyg, unknown
  name). Same JS function as in the script.
- In PixInsight (user): T CrB master — compare result against a v1.4.0 run on
  the same file; then a second target; then the unknown-name / manual RA/Dec path;
  then an unsaved in-memory stack.

## Open points

- `NetworkTransfer` usage in PJSR 1.9.4 is untested.
- Maximum `fov` accepted by VSP is unknown.
- Whether WebObs prefers `RS OPH` or `RS Oph` in `NAME`.
- Offline use: without network the script cannot run. A "reuse saved
  `<chartid>.csv`" option would bring back a file picker, so it is out of scope
  unless wanted.
