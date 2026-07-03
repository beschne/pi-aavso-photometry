# T CrB Outburst Observing Strategy

Practical equipment and chart guidance for observers who want to be ready when
T Coronae Borealis erupts. Star separations and chart coverage were computed from
the AAVSO X42615 photometry sequence; FOVs from instrument specs.

## The core challenge

At quiescence T CrB is ~10 V; at nova peak it reaches ~2 V — an 8-magnitude jump.
Differential photometry requires comparison stars within a few magnitudes of the target
**and** in the same frame. The AAVSO-vetted comp stars for T CrB that are bright enough
to matter at outburst are mostly the other members of Corona Borealis, spread 1–8° away.

## Which comp stars are in the AAVSO sequence?

From chart X42615CFQ (900′ field, the widest pre-fetched chart), stars brighter than V = 5
and their angular distance from T CrB:

| Chart label | V mag | Sep. | dRA | dDec | Identity |
|:-----------:|------:|-----:|----:|-----:|----------|
| 41 | 4.14 | 1.05° | 0.43° | 0.96° | ε CrB |
| 48 | 4.83 | 3.18° | 0.64° | 3.12° | (field star, nearly due north) |
| 38 | 3.81 | 3.78° | 3.76° | 0.38° | γ CrB |
| 50 | 4.99 | 3.95° | 0.43° | 3.93° | ι CrB |

Notable stars *not* in the AAVSO T CrB sequence: δ CrB (4.63V, 2.2°), β CrB (3.68V, 7.7°).

## Which stars fit in each instrument's frame?

Frame coverage analysis — a star is in-frame if its RA offset ≤ long half-axis **and**
its Dec offset ≤ short half-axis (worst-case alignment with T CrB centred):

| Chart label | V | Sep. | Seestar S30 Pro (4.3°×2.4°) | RedCat 51 + ASI2600MC Air (5.4°×3.6°) | RedCat 51 + full-frame (8.2°×5.5°) |
|:-----------:|--:|-----:|:---:|:---:|:---:|
| **41** | **4.14** | **1.05°** | **✓** | **✓** | **✓** |
| 48 | 4.83 | 3.18° | ✗ (dDec 3.1° > 1.2°) | ✗ (dDec 3.1° > 1.8°) | ✗ (dDec 3.1° > 2.75°) |
| 38 | 3.81 | 3.78° | ✗ (dRA 3.8° > 2.15°) | ✗ (dRA 3.8° > 2.7°) | ✓ |
| 50 | 4.99 | 3.95° | ✗ | ✗ | ✗ (dDec 3.9° > 2.75°) |
| 22 (Alphecca) | 2.23 | 5.62° | ✗ | ✗ | ✗ (dRA 5.6° > 4.1°) |

**Key finding:** label 41 (ε CrB, V=4.14, 1.05° away) is the only AAVSO-vetted bright
comp star that fits in a telescope frame. It is in every setup including the Seestar.

## Instrument comparison at outburst

**Seestar S30 Pro (4.3°×2.4°)**

At any outburst brightness: label 41 (4.14V) is 1.05° away — comfortably in frame on
both axes. A single comp star 2+ magnitudes fainter than T CrB is acceptable for a
single-band report; use label 41 as comp and the best available fainter star as check.

**RedCat 51 + ZWO ASI2600MC Air — APS-C 23.5×15.7 mm → 5.4°×3.6°, 3.1″/px**

Same result as the Seestar for outburst bright comp stars: only label 41 fits.
The wider frame helps during the **brightening phase (5–8 mag)**, where it captures
more of the faint ensemble comp stars from the 450′ chart, reducing ZP scatter.

**RedCat 51 + full-frame camera — approx. 8.2°×5.5°**

Adds label 38 (γ CrB, 3.81V, 3.78° away). Now you have two bright comp stars,
bracketing T CrB in magnitude — better ZP determination at peak.

**Camera lens (50–135mm focal length → 10–25° FOV)**

Captures Alphecca (2.23V, 5.62°) and the full ring of CrB stars. Ideal for
peak brightness (1–3 mag) where T CrB rivals the brightest comp stars in any
telescope frame. Requires an OSC or monochrome camera body; the same script
and AAVSO report format apply.

## Recommended chart and command per phase

| T CrB brightness | Best instrument | Chart | Fetch command (if needed) |
|-----------------|-----------------|-------|---------------------------|
| ~10 mag (quiescence) | Seestar | `charts/X42615CFD.csv` (450′) | already available |
| 8–10 mag (brightening) | Seestar | `charts/X42615CFQ.csv` (900′) | already available |
| 4–8 mag | Seestar or RedCat51+APS-C | `charts/X42615CFQ.csv` (900′) | already available |
| 2–4 mag | RedCat51+full-frame | `charts/X42615CHL.csv` (900′, maglimit 5) | already available |
| ~2 mag (peak) | Camera lens | `charts/X42615CHL.csv` or AAVSO Alert Notice chart | follow Alert Notice; run fetch-vsp.py with specified FOV |

At peak brightness T CrB will saturate even with very short exposures in a telescope.
Use the shortest sub-second frames your camera allows; the script's reference-file time
entry handles arbitrary sub durations.

## When the outburst is confirmed

AAVSO will issue an Alert Notice with chart, exposure, and reporting guidance —
monitor [aavso.org/news](https://www.aavso.org/news). The Alert Notice will name a
specific chart ID; run `fetch-vsp.py` with that chart's FOV and maglimit to get the
matching CSV, or wait for the AAVSO VSP API to come back online (v2 migration).

Two charts are pre-fetched and ready:

- **`charts/X42615CFQ.csv`** — 900′, maglimit 14.5, 370 stars. Use at any brightness;
  the faint comp stars carry the ensemble at quiescence, and the bright ones (labels 22–50)
  cover the outburst range.
- **`charts/X42615CHL.csv`** — 900′, maglimit 5, 9 stars (V 2.2–5.0). The outburst-focused
  chart: fewer distractions, bright stars only. Stars it contains:

  | Label | V | Notes |
  |:-----:|--:|-------|
  | 22 | 2.23 | Alphecca (α CrB), 5.6° — camera lens only |
  | 28 | 2.78 | 8.3° — camera lens only |
  | 37 | 3.68 | β CrB, 7.7° — camera lens only |
  | 37 | 3.75 | 8.5° — camera lens only |
  | 38 | 3.81 | γ CrB, 3.8° — RedCat51+full-frame or camera lens |
  | 41 | 4.14 | ε CrB, 1.05° — **in every setup including Seestar** |
  | 45 | 4.52 | 7.5° — camera lens only |
  | 48 | 4.83 | 3.2° — camera lens only (north of T CrB) |
  | 50 | 4.99 | ι CrB, 4.0° — camera lens only |
