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

Currently configured for **T Coronae Borealis** ("Blaze Star"), a recurrent nova
expected to brighten by ~8 magnitudes from quiescence (~10 mag) to outburst (~2 mag).

The script measures in **two photometric bands per run** — TG (green channel, V-calibrated)
and TB (blue channel, B-calibrated) — and writes one AAVSO observation line per band.

The script reuses PixInsight's own facilities — the astrometric WCS solution,
FITS keywords, and DynamicPSF — rather than reimplementing them externally.

The dialog is a six-step wizard — Setup → Comp Stars → Photometry → Mid-time → Verification → Report.

![Setup step](screenshots/screenshot%2C%20v1.3.0%2C%20%281%29%20setup.png)
![Comp Stars step](screenshots/screenshot%2C%20v1.2.0%2C%20%282%29%20comp%20stars.png)

---

## Requirements

- **PixInsight 1.9.4 "Lockhart"** or later (V8 JS engine required)
- An open, plate-solved OSC (one-shot colour) RGB master light stack, debayered in PixInsight
- A comparison-star CSV exported from [AAVSO VSP](https://www.aavso.org/vsp)

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

### 2. Get the comparison-star CSV from AAVSO VSP

The script needs a photometry table that lists the comparison stars and their catalogue magnitudes.

1. Go to the **AAVSO Variable Star Plotter**: [aavso.org/vsp](https://www.aavso.org/vsp)
2. Enter target name: **T CrB**
3. Set **Field of view** to **60′** (matches a typical Seestar/small-scope FOV)
4. Set **Limiting magnitude** to **12.0** (captures comp stars down to ~11 mag)
5. Click **Plot Chart** — note the **Chart ID** (e.g. `X42597QE`)
6. Click **Photometry table** → **Download** → save as **CSV**

The downloaded file is the comparison-star CSV.
A reference copy for chart X42597QE is included at `docs/X42597QE_photometry.csv`.

### 3. Prepare your image in PixInsight

Open your **linear, plate-solved OSC RGB master stack** as the active window.
If the stack is not yet plate-solved, run `Script > Astronomy > ImageSolver` first.

> The script reads the process history from FITS keywords when the stack is saved to
> disk. If incompatible processes (stretch, deconvolution, BlurXTerminator) are
> detected, a red warning appears on the Photometry step.

### 4. Run the script

- **Quick run (no menu entry):** `Script > Execute Script File…` → select `aavso-photometry.js`
- **With menu entry:** `Script > Feature Scripts… > Add` the script directory once.
  PixInsight registers it under `Script > BeSchne > Photometry` and picks up code
  changes on every subsequent run without rescanning.

### 5. Work through the six wizard steps

**Step 1 — Setup**

| Field | What to do |
|-------|------------|
| **Active image** | Confirm it shows your stack |
| **Comparison CSV** | Browse to the CSV you downloaded in step 2 |
| **Observer code** | Enter your AAVSO observer code |

**Step 2 — Comp Stars**

The script runs a PSF discovery pass on all in-frame V-band candidates and presents
them in a table with V mag, Δmag from target, and PSF quality notes. Stars that pass
quality checks and are within 2 magnitudes of the target are pre-ticked as the ensemble.
Click any row to toggle it. Select the **Check star** from the dropdown at the bottom.

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

![Verification step](screenshots/screenshot%2C%20v1.2.0%2C%20%285%29%20verification.png)

**Step 6 — Report**

A human-readable report is generated automatically when you enter this step.
Switch to **AAVSO Extended Format** for submission, then click **Export…** and save
with a `.txt` extension.

### 8. Submit to AAVSO

1. Go to the [AAVSO Submit Photometric Observations](https://apps.aavso.org/v2/data/submit/photometry/) form and log in
2. In the first field, select **File upload** (not Manual)
3. Upload the exported `.txt` file
4. Review the preview — your observation is plotted against historical data
5. Click **Submit** to confirm

---

## Outburst strategy

T CrB is expected to brighten by ~8 magnitudes from quiescence (~10 V) to nova peak (~2 V).

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

### Stage 1 — Early brightening (~7–9 mag): change comp/check labels

Chart **X42597QE** contains brighter comp stars for this stage:

| Label | AUID | V mag | Use when T CrB is |
|-------|------|-------|-------------------|
| `98`  | `000-BBW-796` | 9.809 | Quiescence (~10 V) |
| `106` | `000-BJS-901` | 10.554 | Quiescence (check star) |
| `84`  | `000-BBW-888` | 8.361 | Brightening, ~7–9 mag |
| `79`  | `000-BBW-881` | 7.886 | Brightening, ~7–9 mag |

Change the **Comp** and **Check** dropdowns in the Setup step before running.
The dropdowns always reset to the brightest available stars when the script starts.

### Stage 2 — Nova peak (~2–6 mag): get a new VSP chart

At peak brightness T CrB will saturate any normal exposure. You will need very short
sub-second frames, and the faint comp stars in X42597QE may be undetectable.

1. Return to [AAVSO VSP](https://www.aavso.org/vsp), set FOV to **180′** and limiting
   magnitude to **5–6**
2. Download the new photometry table as CSV
3. Load it via the **Browse** button and enter suitable comp/check labels
4. Update the `CHART` constant in the script (line ~40) to the new chart ID

AAVSO will issue Alert Notices with specific chart and exposure guidance when the
outburst begins — monitor [aavso.org/news](https://www.aavso.org/news).

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

**Seestar FOV constraint at nova peak.** The Seestar S50 has a ~1.4° × 1.0° FOV.
At nova peak (~2 mag) the nearest suitable comparison stars (1–4 mag) may lie outside
this window. In that case consider a wider-field instrument, visual observation, or
ensemble photometry of fainter in-frame stars.

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
| *Star outside the image frame* | Comp or check star label not in the FOV | Choose a different label from the dropdown |
| *PSF rejected — too faint* | Star too dim for a reliable Gaussian fit | Choose a brighter comp/check label |
| *PSF rejected — saturated* | Star clipped in the master | Choose a fainter comp/check label or reduce exposure |
| *No usable V-band rows found* | Wrong CSV file or column mismatch | Re-export from AAVSO VSP and check the CSV has the expected columns |
| Red warning: *forbidden process detected* | Stack was stretched or deconvolved | Re-stack from calibrated subs without applying any stretch or sharpening |
| Orange warning: *check-star deviation > 3×MERR* | Possible systematic error | Check the Verification thumbnail for wrong-star or blending issues; inspect atmospheric conditions |

---

## Output

**Human-readable report** (default): a formatted text summary suitable for personal
records and quick review.

**AAVSO Extended Format** (on demand): comma-delimited CSV for direct submission via
the [AAVSO Submit Photometric Observations](https://apps.aavso.org/v2/data/submit/photometry/) form (select **File upload**). The report contains one observation line per measured band (`FILT=TG` and `FILT=TB`), sharing the same DATE, AMASS, and CHART. Key choices: `TRANS=NO`, `MTYPE=STD`, `OBSTYPE=CCD`, `CHART=X42597QE`.

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
| `screenshot, v1.3.0, (1) setup.png` | `setup.png` |
| `screenshot, v1.2.0, (2) comp stars.png` | `comp-stars.png` |
| `screenshot, v1.3.0, (3) photometry.png` | `photometry.png` |
| `screenshot, v1.2.0, (4) mid-time.png` | `mid-time.png` |
| `screenshot, v1.2.0, (5) verification.png` | `verification.png` |
| `screenshot, v1.3.0, (6) report, human readable.png` | `report-human.png` |
| `screenshot, v1.3.0, (6) report, aavso.png` | `report-aavso.png` |

---

## Repository layout

```
aavso-photometry.js          Main script
sample_comparison_stars.csv  Format sample for the comparison-star CSV
docs/
  Photometry.html            Native PixInsight help page (install into PI doc tree)
  X42597QE_photometry.csv    AAVSO VSP export for chart X42597QE
  X42597QE.png               AAVSO finder chart for T CrB
  aavso-extended-format.md   AAVSO Extended File Format field spec
  domain-knowledge.md        Photometry constants and science notes
  time-handling.md           Mid-exposure time specification
  pjsr-api-notes.md          Verified PJSR API patterns and pitfalls
screenshots/                 Dialog screenshots (all versions)
CLAUDE.md                    AI coding-assistant guidance
TODO.md                      Build checklist and roadmap
```

---

## Roadmap

- ~~Ensemble photometry~~ — done (v1.2.0)
- ~~Multiband TG + TB~~ — done (v1.3.0)
- TG→V, TB→B colour transformation (`TRANS=YES`)
- User-specifiable target star

---

## Author

Benno Schneider · AAVSO observer code **BSLA**

<br/>

<img src="docs/astrophotography%20and%20photometry%20meme.png" width="800"/>

---

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
