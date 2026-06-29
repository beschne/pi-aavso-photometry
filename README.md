# BeSchne Photometry

> **Work in progress — not yet ready for general use.**
> The script is functional for the author's own observations but lacks complete
> documentation, a full security audit, and end-to-end testing by other observers.
> Target release: **v1.0.0** (see [TODO.md](TODO.md) for remaining items).

A native **PixInsight PJSR script** that performs differential photometry of variable
stars directly inside PixInsight and writes an **AAVSO Extended File Format** report.

Currently configured for **T Coronae Borealis** ("Blaze Star"), a recurrent nova
expected to brighten by ~8 magnitudes from quiescence (~10 mag) to outburst (~2 mag).

The script reuses PixInsight's own facilities — the astrometric WCS solution,
FITS keywords, and DynamicPSF — rather than reimplementing them externally.

---

## Requirements

- **PixInsight 1.9.4 "Lockhart"** or later (V8 JS engine required)
- An open, plate-solved OSC RGB master light stack
- A comparison-star CSV exported from [AAVSO VSP](https://www.aavso.org/vsp)

## Input image preconditions

| Condition | Status |
|-----------|--------|
| Linear (unstretched) stack | **Required** |
| Plate-solved (ImageSolver) | **Required** |
| Any stretch applied | **Incompatible** — breaks PSF linearity |
| Deconvolution / BlurXTerminator | **Incompatible** — alters PSF shape |
| Background extraction (ABE / DBE / GradientCorrection) | Safe |
| SpectrophotometricColorCalibration (SPCC) | Safe |

## Installation

No installation or restart required during development:

1. Open PixInsight with your master light stack as the active window.
2. `Script > Execute Script File…` → select `aavso-photometry.js`.

The file is re-read from disk on every run. Debug output goes to the Process Console.

**Optional menu registration:** `Script > Feature Scripts… > Add` the script directory
once. PixInsight registers it under `Script > BeSchne > Photometry`.

## Usage

1. Open a **linear, plate-solved** OSC master stack in PixInsight.
2. Run the script. The **AAVSO Photometry** dialog opens.
3. Verify the active image shown at the top.
4. Choose (or confirm) the **comparison-star CSV** path.
5. Click **Run Photometry**. The script fits PSFs and derives the T CrB magnitude.
   - A red warning appears if forbidden processes are detected in FITS history.
   - Observer site coordinates are read from FITS keywords and shown in editable fields.
6. Set **Start** and **End** times using the reference-file buttons (pick the first and
   last surviving subframe). The mid-exposure time defaults to `(Start + End) / 2`.
7. Verify the mid-time JD and airmass.
8. Select **Human readable** (default) or **AAVSO Extended Format**.
9. Click **Create Report** to preview the output.
10. Click **Export…** to save the file.

## Output

**Human-readable report** (default): a formatted text summary suitable for personal
records and quick review.

**AAVSO Extended Format** (on demand): 15-field CSV for direct submission to
[AAVSO WebObs](https://www.aavso.org/webobs). Key choices:
`FILT=TG`, `TRANS=NO`, `MTYPE=STD`, `OBSTYPE=CCD`, `CHART=X42597QE`.

The green OSC channel is reported as **TG band** — it runs ~0.1–0.3 mag brighter
than V for red stars and must never be relabelled as V.

## Comparison-star CSV

Export from [AAVSO VSP](https://www.aavso.org/vsp) for chart **X42597QE**.
The script filters to `Band == "V"` and selects comp (`98`) and check (`106`) stars
by label. Stars marked as blended (label `102`) are excluded automatically.

See `sample_comparison_stars.csv` for the expected column layout and
`docs/X42597QE_photometry.csv` for the full reference export.

## Repository layout

```
aavso-photometry.js        Main script
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

## Roadmap

- Selectable comp/check stars in the dialog ✓ (switch to 84, 79, … for outburst)
- Annotated verification image (thumbnail with target + comp/check marked)
- Check-star gate (warn if comp/check deviation exceeds threshold)
- Ensemble photometry
- TG→V transformation

## Author

Benno Schneider · AAVSO observer code **BSLA**
