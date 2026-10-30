# AAVSO Photometry

![PixInsight](https://img.shields.io/badge/PixInsight-1.9.4%2B-blue)
![AAVSO](https://img.shields.io/badge/AAVSO-Extended_Format-green)
![platform](https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux-lightgrey)
![vibe coded](https://img.shields.io/badge/vibe_coded-Claude_Sonnet-blueviolet)

*[Deutsche Version](README.de.md)*

A native **PixInsight PJSR script** that performs differential photometry of variable
stars directly inside PixInsight and writes an **AAVSO Extended File Format** report.

[PixInsight](https://pixinsight.com) is a professional astronomical image processing
platform widely used in the astrophotography community; PJSR is its built-in JavaScript
scripting environment.

It works for **any variable star with an AAVSO comparison sequence**: enter the star's
AAVSO name, and the script downloads the comparison stars from the AAVSO Variable Star
Plotter (VSP) itself — no manual chart or CSV download. It was developed for
**T Coronae Borealis** ("Blaze Star"), a recurrent nova expected to brighten by
~8 magnitudes from quiescence (~10 mag) to outburst (~2 mag).

The script measures in **two photometric bands per run** — TG (green channel, V-calibrated)
and TB (blue channel, B-calibrated) — and writes one AAVSO observation line per band.

The script reuses PixInsight's own facilities — the astrometric WCS solution,
FITS keywords, and DynamicPSF — rather than reimplementing them externally.

The dialog is a six-step wizard — Setup → Comp Stars → Photometry → Mid-time → Verification → Report.

![Setup step](screenshots/screenshot%2C%20v2.0.0%2C%20%281%29%20setup.png)
![Comp Stars step](screenshots/screenshot%2C%20v2.0.0%2C%20%282%29%20comp%20stars.png)

---

## Requirements

- **PixInsight 1.9.4 "Lockhart"** or later (V8 JS engine required); tested with PixInsight 1.9.5 build 1706 and 1.9.6 build 1713 on macOS (arm64)
- An open, plate-solved OSC (one-shot colour) RGB master light stack, debayered in PixInsight
- The target's AAVSO (VSX) name, e.g. `T CrB` — or its J2000 coordinates
- An internet connection (the comparison stars are downloaded from [AAVSO VSP](https://www.aavso.org/vsp))

## Input image preconditions

| Condition | Status |
|-----------|--------|
| Debayered OSC (one-shot colour) RGB stack | **Required** — TG and TB are extracted from separate colour channels; a monochrome image is rejected at startup |
| Linear (unstretched) stack | **Required** — PSF flux is non-linear on a stretched image |
| Plate-solved (ImageSolver) | **Required** — coordinate projection depends on the WCS solution |
| Any stretch applied | **Incompatible** — breaks PSF linearity |
| Deconvolution / BlurXTerminator | **Incompatible** — alters PSF shape |
| Background extraction (ABE / DBE / GradientCorrection) | Safe |
| SpectrophotometricColorCalibration (SPCC) | Safe |

---

## Getting started

### 1. Download the script

Clone or download this repository and place it in a convenient folder on your machine.
No installation or PixInsight restart is required.

### 2. Prepare your image in PixInsight

Open your **linear, plate-solved OSC RGB master stack** as the active window.
If the stack is not yet plate-solved, run `Script > Astronomy > ImageSolver` first.

> The script reads the process history from FITS keywords when the stack is saved to
> disk. If incompatible processes (stretch, deconvolution, BlurXTerminator) are
> detected, a red warning appears on the Photometry step.

### 3. Run the script

- **Quick run (no menu entry):** `Script > Execute Script File…` → select `aavso-photometry.js`
- **With menu entry:** `Script > Feature Scripts… > Add` the script directory once.
  PixInsight registers it under `Script > BeSchne > AAVSO Photometry` and picks up code
  changes on every subsequent run without rescanning.

### 4. Work through the six wizard steps

**Step 1 — Setup**

| Field | What to do |
|-------|------------|
| **Active image** | Confirm it shows your stack |
| **Image field** | Read-only: the image's field of view from the plate solution |
| **Object** | The target's AAVSO (VSX) name, e.g. `T CrB` or `RS Oph` (remembered) |
| **Comp mag limit** | Faintest comparison stars to download (default 14.5, remembered). Lower it for a bright target |
| **Coordinates** | Only if AAVSO does not know the name: tick it and enter RA (`HH:MM:SS` or degrees) and Dec. It is ticked automatically when the name lookup fails |
| **Observer code** | Enter your AAVSO observer code |

**Step 2 — Comp Stars**

Entering this step downloads the comparison stars and measures them. The status line
shows each stage:

1. Looking up the object at AAVSO — gets the target's coordinates
2. Downloading the comparison stars — the chart is sized from the plate solution to
   cover the whole image around the target
3. Fitting PSFs of the target and all in-frame comparison stars

The candidates appear in a table with V mag, Δmag from the target, and PSF quality
notes. Δmag is measured from a preliminary estimate of the target's brightness in
this image, so no catalogue magnitude of the target is needed. Stars that pass quality
checks and are within 2 magnitudes of the target are pre-ticked as the ensemble.
Click any row to toggle it. Select the **Check star** from the dropdown at the bottom.
Wide charts can give two stars of similar magnitude the same label; they appear as
separate rows, and the report names them by AUID.

The download is reused while the image, object, coordinates and mag limit stay the
same, so going back and forth between steps does not repeat it.

**Step 3 — Photometry**

Photometry runs automatically when you click this step. The panel shows:
- **TG** magnitude and **MERR** — green channel, calibrated against V-band comp star magnitudes
- **TB** magnitude and **MERR** — blue channel, calibrated against B-band comp star magnitudes (shows — only if the blue PSF failed; all stars in a standard AAVSO VSP export include B magnitudes)
- **TG PSF flux** — the instrumental magnitudes for target, comp ensemble, and check star (green channel)
- A red warning if incompatible processes are detected in the image history
- An orange warning if the check-star deviation from catalogue V exceeds 3×MERR

**Step 4 — Mid-time**

Use the **folder buttons** next to Start and End to reference your first and last
surviving subframe. The script reads `DATE-OBS` and `EXPTIME` from the FITS header
and computes the mid-exposure time automatically as `(Start + End) / 2`.

Verify the **Mid JD**, **airmass**, and **moon** readouts look reasonable.

**Step 5 — Verification**

Inspect the annotated thumbnail: target (red circle), comp stars (green), check (cyan).
Confirm the circles land on the intended stars. Use the stretch buttons to bring out
faint stars if needed.

![Verification step](screenshots/screenshot%2C%20v2.0.0%2C%20%285%29%20verification.png)

**Step 6 — Report**

A human-readable report is generated automatically when you enter this step.
Switch to **AAVSO Extended Format** for submission, then click **Export…** and save
with a `.txt` extension.

Two checkboxes next to Export (both remembered) add files to the report's folder;
files that already exist there are kept:

- **Save comparison stars** (default on) writes `<chart ID>.csv` — the comparison
  stars used. AAVSO revises sequences over time, so this preserves exactly what the
  report's `CHART` field refers to.
- **Download finder chart** (default off) downloads the AAVSO chart image as
  `<chart ID>.png` (gives up after 20 s). When off, the console prints the chart's URL.
  The chart is not needed for the photometry; the verification image already marks the
  comparison and check stars in your own frame.

### 5. Submit to AAVSO

1. Go to the [AAVSO Submit Photometric Observations](https://apps.aavso.org/v2/data/submit/photometry/) form and log in
2. In the first field, select **File upload** (not Manual)
3. Upload the exported `.txt` file
4. Review the preview — your observation is plotted against historical data
5. Click **Submit** to confirm

---

## Outburst strategy

T CrB is expected to brighten by ~8 magnitudes from quiescence (~10 V) to nova peak (~2 V).

For detailed equipment guidance — which comp stars fit in which frame at which
brightness, and which Comp mag limit to use at each phase — see
[docs/outburst-strategy.md](docs/outburst-strategy.md).

### Why TB matters most for outburst detection

T CrB is a symbiotic system: a cool M3 III red giant transfers mass to a white dwarf
via an accretion disk. At quiescence the M giant dominates the combined light. As
accretion increases before and during the outburst, the hot WD and disk brighten —
and this hot emission peaks in the UV/blue rather than the red.

| Band | Channel | Calibrated against | Quiescent M-giant contribution | Sensitivity to WD/disk brightening |
|------|---------|--------------------|-------------------------------|-------------------------------------|
| **TB** | Blue | B-band comp mags | Low (M3 III has B−V ≈ +1.6) | **Highest** |
| **TG** | Green | V-band comp mags | Moderate | Medium |
| TR | Red | Rc-band comp mags | Dominant | Lowest |

The **TB−TG colour index** approximates B−V. At quiescence TB is significantly
fainter than TG because the M giant emits little blue light. As the hot component
brightens, this gap narrows — TB brightens faster than TG. A sustained blueward
shift in TB−TG (index decreasing toward zero) can be an early warning of
increased accretion or nova onset, potentially visible before TG shows a
significant magnitude change.

This is why TR is not measured: at quiescence the red channel is overwhelmingly
M-giant photospheric emission; the WD/disk contribution is a small fraction of the
total Rc flux, making TR the least sensitive band for detecting nova precursors.

### Stage 1 — Early brightening (~7–9 mag): nothing to change

The comp ensemble is pre-selected relative to the target's brightness *measured in the
image*, so brighter comp stars (e.g. labels `84` at 8.4 V and `79` at 7.9 V near T CrB)
are picked automatically as T CrB brightens. Check the selection in the Comp Stars step
and adjust the ticks if needed.

### Stage 2 — Nova peak (~2–6 mag): lower the Comp mag limit

At peak brightness T CrB will saturate any normal exposure. You will need very short
sub-second frames, and faint comp stars may be undetectable.

1. Set **Comp mag limit** in the Setup step to about 2–3 magnitudes fainter than the
   expected target brightness (e.g. `8` for a 5-mag target)
2. With a limit of **12 or brighter**, AAVSO VSP allows charts wider than 180′ (up to
   1200′ in the script), so wide-field instruments get comp stars across the whole frame
3. The chart ID of the new sequence goes into the report automatically

AAVSO will issue Alert Notices with specific chart and exposure guidance when the
outburst begins — monitor [aavso.org/news](https://www.aavso.org/news).

---

## PixInsight 1.9.6 compatibility

> **Status: tested.** PixInsight 1.9.6 "Lockhart" (build 1713) was released in October 2026. The script has been reviewed against the [1.9.6 release notes](https://pixinsight.net/dev/index.php?articles/pixinsight-1-9-6-lockhart-released.28/) and tested under 1.9.6 on macOS (arm64). It runs without modifications.

A code review against the 1.9.6 breaking changes found no required modifications:

- **Template literals:** `//` or `/*` inside a template literal is now a compile error. The script contains no such literals.
- **Network access:** The `FileDownload`/`FileUpload` semantics have changed. They do not apply here, because the script uses `NetworkTransfer` over HTTPS with its own error handling.
- **Moon phase:** 1.9.6 fixes a PJSR bug that reported the Moon's phase angle as always about zero. The script does not depend on it, because it computes the lunar illumination itself.
- **Minimum version:** The script still requires 1.9.4 or later. It does not use any 1.9.6-only API.

Test results:

- **Contained windowing mode** (now the default): in a hosted dialog, Return triggers the default button. Return in the Object, Start, End and Mid-time fields does not advance or close the wizard, with contained windowing mode both enabled and disabled.
- **DynamicPSF:** PSF fitting was reworked. Fits now start from the measured peak and width of each star, and a bug that let fits of bright stars converge to the wings has been fixed. An SS Cyg stack (2026-10-28, Seestar S30 Pro) gave identical results under 1.9.5 and 1.9.6: TG 11.636 ± 0.032, TB 12.374 ± 0.055, same comp stars and check star values. Bright, near-saturated stars, where the fix matters most, have not been compared yet.
- **FITS WCS** (not tested): 1.9.6 fixes WCS keywords that were read as mirrored solutions for half of all rotation angles. This only affects stacks that were plate-solved by other software and loaded from FITS. They should now project correctly. Check the Verification step if you use such stacks.

Relevant 1.9.6 improvements for this workflow:

- Crop, Resample and Rotation now preserve a linear astrometric solution, so cropped stacks no longer need to be re-solved.
- ImageSolver 6.6 can solve images blindly using a local Gaia DR3 index. The index file must be downloaded separately.
- The new PhotometricAnalysis script, used together with AperturePhotometry 2.2, also writes AAVSO Extended Format reports. It selects its comparison stars automatically, with catalog photometry from Gaia DR3. This script instead uses the official AAVSO VSP sequence and its chart ID, which keeps measurements consistent with other observers in AAVSO campaigns.

---

## Known limitations

**TG and TB ≠ Johnson V and B.** The script reports in the **TG** (tri-colour green)
and **TB** (tri-colour blue) bands, not Johnson V or B. OSC passbands differ from
standard filter bandpasses; TG runs ~0.1–0.3 mag brighter than V for red stars because
the OSC green filter has a different effective wavelength than the standard V bandpass.
The equivalent offset applies in TB vs B. The AAVSO reports correctly record `FILT=TG`
and `FILT=TB` with `TRANS=NO`. Never relabel TG or TB measurements as V or B.

**TB−TG is not a calibrated B−V index.** The colour difference approximates B−V
qualitatively but carries the combined uncalibrated offsets of both passbands.
It is best used as a relative indicator of colour change over time, not as an
absolute colour index.

**Seestar FOV constraint at nova peak.** The Seestar S30 Pro has a ~4.3° × 2.4° FOV.
At nova peak (~2 mag) the nearest suitable comparison stars (1–4 mag) may lie outside
this window. In that case consider a wider-field instrument, visual observation, or
ensemble photometry of fainter in-frame stars.

**AAVSO VSP chart size vs. mag limit.** VSP allows charts wider than 180′ only with a
mag limit of 12 or brighter. With a fainter limit (default 14.5) the script requests a
180′ chart and warns in the console that comparison stars near the image corners are
missing — for a wide field such as the Seestar's 4.3° × 2.4°, set the limit to 12 to
cover the whole frame.

**Internet connection required.** The comparison stars are downloaded at run time;
there is no offline mode. The finder chart image is optional and off by default (in
October 2026 the VSP image server returned HTTP 500 for every chart).

**DATE-OBS unreliable for stacked masters.** PixInsight's `ImageIntegration` writes
`DATE-OBS` as the midpoint of sub *start* times, ignoring exposure duration. Always
use the **reference-file buttons** in the Timing section to set Start and End from
actual subframes rather than trusting the stack's `DATE-OBS`.

---

## Troubleshooting

| Error / symptom | Cause | Fix |
|-----------------|-------|-----|
| *No active image window* | No stack is open, or it is not the active window | Open the master stack and click its title bar |
| *Not a plate-solved image* | No WCS solution found | Run `Script > Astronomy > ImageSolver` on the stack first |
| *Expected a debayered OSC … RGB image* | Image is monochrome, a single-channel extract, or an undebayered Bayer raw | Run the Debayer process in PixInsight first, then use the full debayered RGB master |
| *AAVSO VSP: Star … does not exist in VSX* | AAVSO does not know the object name | Check the spelling (e.g. `T CrB`), or enter the coordinates (the **Coordinates** box is ticked automatically) |
| *AAVSO VSP request failed* | No internet connection, or AAVSO is down | Check the connection and retry; the console shows the request URL |
| *Comp mag limit must be a V magnitude* | Empty or invalid mag limit | Enter a number, e.g. `14.5` |
| *… is outside the image frame* | The target is not in this image | Check the object name / coordinates and the plate solution |
| *No comparison star with a usable PSF* | All in-frame comp stars failed the PSF checks | Adjust the Comp mag limit; check focus, saturation and plate solution |
| *PSF rejected — too faint* | Star too dim for a reliable Gaussian fit | Choose a brighter comp/check label |
| *PSF rejected — saturated* | Star clipped in the master | Choose a fainter comp/check label or reduce exposure |
| Red warning: *forbidden process detected* | Stack was stretched or deconvolved | Re-stack from calibrated subs without applying any stretch or sharpening |
| Orange warning: *check-star deviation > 3×MERR* | Possible systematic error | Check the Verification thumbnail for wrong-star or blending issues; inspect atmospheric conditions |

---

## Output

**Human-readable report** (default): a formatted text summary suitable for personal
records and quick review.

**AAVSO Extended Format** (on demand): comma-delimited CSV for direct submission via
the [AAVSO Submit Photometric Observations](https://apps.aavso.org/v2/data/submit/photometry/) form (select **File upload**). The report contains one observation line per measured band (`FILT=TG` and `FILT=TB`), sharing the same DATE, AMASS, and CHART. Key choices: `TRANS=NO`, `MTYPE=STD`, `OBSTYPE=CCD`; `NAME` is the star name as AAVSO returns it (e.g. `T CrB`) and `CHART` is the chart ID of the downloaded sequence (e.g. `X43358CRK`).

---

## PixInsight in-app documentation

The script ships with a native PixInsight HTML help page that opens via the `?` button
in the dialog (or `Script > Feature Scripts > ?`).

To install it:

1. Create the folder `<PI install>/doc/scripts/Photometry/`
2. Copy `docs/Photometry.html` into that folder
3. Inside it, create an `images/` subfolder and copy the screenshots from `screenshots/`
   with the following names:

| Source file (`screenshots/`) | Install as (`images/`) |
|------------------------------|------------------------|
| `screenshot, v2.0.0, (1) setup.png` | `setup.png` |
| `screenshot, v2.0.0, (2) comp stars.png` | `comp-stars.png` |
| `screenshot, v2.0.0, (3) photometry.png` | `photometry.png` |
| `screenshot, v2.0.0, (4) mid-time.png` | `mid-time.png` |
| `screenshot, v2.0.0, (5) verification.png` | `verification.png` |
| `screenshot, v2.0.0, (6) report human readable.png` | `report-human.png` |
| `screenshot, v2.0.0, (6) report aavso.png` | `report-aavso.png` |

---

## Repository layout

```
aavso-photometry.js          Main script
docs/
  Photometry.html            Native PixInsight help page (install into PI doc tree)
  aavso-extended-format.md   AAVSO Extended File Format field spec
  domain-knowledge.md        Photometry constants and science notes
  outburst-strategy.md       T CrB outburst equipment guidance (also .de.md)
  time-handling.md           Mid-exposure time specification
  pjsr-api-notes.md          Verified PJSR API patterns and pitfalls
  plan-generic-target.md     v2.0 plan: any target, automatic comparison stars
screenshots/                 Dialog screenshots (all versions)
CLAUDE.md                    AI coding-assistant guidance
TODO.md                      Build checklist and roadmap
```

---

## Roadmap

- ~~Ensemble photometry~~ — done (v1.2.0)
- ~~Multiband TG + TB~~ — done (v1.3.0)
- ~~User-specifiable target star, automatic comparison stars from AAVSO VSP~~ — done (v2.0.0)
- TG→V, TB→B colour transformation (`TRANS=YES`)

---

## Author

Benno Schneider · AAVSO observer code **BSLA**

<br/>

<img src="docs/astrophotography%20and%20photometry%20meme.png" width="800"/>

---

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
