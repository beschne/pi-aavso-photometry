# BeSchne Photometry

![PixInsight](https://img.shields.io/badge/PixInsight-1.9.4%2B-blue)
![AAVSO](https://img.shields.io/badge/AAVSO-Extended_Format-green)
![platform](https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux-lightgrey)
![vibe coded](https://img.shields.io/badge/vibe_coded-Claude_Sonnet-blueviolet)

A native **PixInsight PJSR script** that performs differential photometry of variable
stars directly inside PixInsight and writes an **AAVSO Extended File Format** report.

Currently configured for **T Coronae Borealis** ("Blaze Star"), a recurrent nova
expected to brighten by ~8 magnitudes from quiescence (~10 mag) to outburst (~2 mag).

The script reuses PixInsight's own facilities — the astrometric WCS solution,
FITS keywords, and DynamicPSF — rather than reimplementing them externally.

![Dialog and verification window](docs/screenshot%2C%20v1.0.0%2C%20with%20verification%20window.png)

---

## Requirements

- **PixInsight 1.9.4 "Lockhart"** or later (V8 JS engine required)
- An open, plate-solved OSC RGB master light stack
- A comparison-star CSV exported from [AAVSO VSP](https://www.aavso.org/vsp)

## Input image preconditions

| Condition | Status |
|-----------|--------|
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

> The script saves the master stack path to disk before processing to enable full
> process-history detection. If you have used any incompatible processes (stretch,
> deconvolution, BlurXTerminator), the script will warn you in red after clicking
> Run Photometry.

### 4. Run the script

- **Quick run (no menu entry):** `Script > Execute Script File…` → select `aavso-photometry.js`
- **With menu entry:** `Script > Feature Scripts… > Add` the script directory once.
  PixInsight registers it under `Script > BeSchne > Photometry` and picks up code
  changes on every subsequent run without rescanning.

### 5. Fill in the dialog

![Dialog](docs/screenshot%2C%20v1.0.0%2C%20dialog%20box%20only.png)

| Field | What to do |
|-------|------------|
| **Active image** | Confirm it shows your stack |
| **Comparison CSV** | Browse to the CSV you downloaded in step 2 |
| **Comp / Check** | Leave at defaults (`98` / `106`) for quiescence; see [Outburst strategy](#outburst-strategy) for nova peak |

Click **Run Photometry**. The script:
- Fits PSFs for the target, comp, and check stars (green channel only)
- Derives T CrB TG magnitude from the comp-star differential
- Shows an annotated verification thumbnail — confirm the correct stars are circled
- Warns in orange if the check-star deviation exceeds 3×MERR (possible systematic error)

### 6. Set the observation times

Use the **folder buttons** next to Start and End to reference your first and last
surviving subframe. The script reads `DATE-OBS` and `EXPTIME` from the FITS header
and computes the mid-exposure time automatically as `(Start + End) / 2`.

Verify the **Mid JD**, **airmass**, and **moon** readouts look reasonable.

### 7. Create and export the report

1. Select **AAVSO Extended Format**
2. Click **Create Report** — preview the 15-field CSV line
3. Click **Export…** — save with a `.txt` extension

### 8. Submit to AAVSO WebObs

1. Go to [aavso.org/webobs](https://www.aavso.org/webobs) and log in
2. Click **Submit Observations** → **Upload File**
3. Upload the exported `.txt` file
4. Verify the observation appears correctly in your recent submissions

---

## Outburst strategy

T CrB is expected to brighten by ~8 magnitudes from quiescence (~10 V) to nova peak (~2 V).

### Stage 1 — Early brightening (~7–9 mag): change comp/check labels

Chart **X42597QE** contains brighter comp stars for this stage:

| Label | AUID | V mag | Use when T CrB is |
|-------|------|-------|-------------------|
| `98`  | `000-BBW-796` | 9.809 | Quiescence (~10 V) — **default** |
| `106` | `000-BJS-901` | 10.554 | Quiescence — **default check** |
| `84`  | `000-BBW-888` | 8.361 | Brightening, ~7–9 mag |
| `79`  | `000-BBW-881` | 7.886 | Brightening, ~7–9 mag |

Change the **Comp** and **Check** dropdowns in the dialog before clicking Run Photometry.
The selection persists between sessions.

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

**TG band ≠ Johnson V.** The script reports in the **TG** (tri-colour green) band, not
Johnson V. TG runs ~0.1–0.3 mag brighter than V for red stars — significant because
T CrB has an M3 III companion that dominates at quiescence. The AAVSO report correctly
records `FILT=TG` and `TRANS=NO`. Never relabel TG measurements as V.

**Seestar FOV constraint at nova peak.** The Seestar S50 has a ~1.4° × 1.0° FOV.
At nova peak (~2 mag) the nearest suitable comparison stars (1–4 mag) may lie outside
this window. In that case consider a wider-field instrument, visual observation, or
ensemble photometry of fainter in-frame stars (planned feature).

**Single comp star.** The current version uses one comp star and one check star.
Ensemble photometry (multiple comp stars) is a planned post-v1 feature and will reduce
the sensitivity to any single comparison star's variability or measurement noise.

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
| *Expected an RGB (3-channel) image* | Image is grayscale or a luminance extract | Use the full OSC master, not a channel extraction |
| *Star outside the image frame* | Comp or check star label not in the FOV | Choose a different label from the dropdown |
| *PSF rejected — too faint* | Star too dim for a reliable Gaussian fit | Choose a brighter comp/check label |
| *PSF rejected — saturated* | Star clipped in the master | Choose a fainter comp/check label or reduce exposure |
| *No usable V-band rows found* | Wrong CSV file or column mismatch | Re-export from AAVSO VSP and check the CSV has the expected columns |
| Red warning: *forbidden process detected* | Stack was stretched or deconvolved | Re-stack from calibrated subs without applying any stretch or sharpening |
| Orange warning: *check-star deviation > 3×MERR* | Possible systematic error | Check the verification thumbnail for wrong-star or blending issues; inspect atmospheric conditions |
| Verification window hidden | Dialog is in the foreground | The window appears behind the dialog on some platforms — look for the *Verification* entry in the PixInsight workspace |

---

## Output

**Human-readable report** (default): a formatted text summary suitable for personal
records and quick review.

**AAVSO Extended Format** (on demand): 15-field CSV for direct submission to
[AAVSO WebObs](https://www.aavso.org/webobs). Key choices:
`FILT=TG`, `TRANS=NO`, `MTYPE=STD`, `OBSTYPE=CCD`, `CHART=X42597QE`.

---

## Repository layout

```
aavso-photometry.js          Main script
sample_comparison_stars.csv  Format sample for the comparison-star CSV
docs/
  X42597QE_photometry.csv    AAVSO VSP export for chart X42597QE
  X42597QE.png               AAVSO finder chart for T CrB
  aavso-extended-format.md   AAVSO Extended File Format field spec
  domain-knowledge.md        Photometry constants and science notes
  time-handling.md           Mid-exposure time specification
  pjsr-api-notes.md          Verified PJSR API patterns and pitfalls
CLAUDE.md                    AI coding-assistant guidance
TODO.md                      Build checklist and roadmap
```

---

## Roadmap

- Full native PixInsight documentation (`Script > Feature Scripts > ?` help)
- Tabbed / step-oriented UI redesign with embedded verification thumbnail
- Ensemble photometry (`CNAME=ENSEMBLE`)
- TG→V colour transformation (`TRANS=YES`)
- User-specifiable target star

---

## Author

Benno Schneider · AAVSO observer code **BSLA**

<br/>

<img src="docs/astrophotography%20and%20photometry%20meme.png" width="800"/>

---

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
