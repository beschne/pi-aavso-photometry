# AAVSO Extended File Format Reference

Authoritative spec: <https://www.aavso.org/aavso-extended-file-format> — verify against the live page before finalising the writer.

## File header

```
#TYPE=EXTENDED
#OBSCODE=BSLA
#SOFTWARE=BeSchne Photometry v<VERSION>
#DELIM=,
#DATE=JD
#OBSTYPE=CCD
```

- `OBSTYPE=CCD` — correct for the Seestar (dedicated astronomy camera; AAVSO uses "CCD" as the umbrella term for all dedicated astronomy cameras including CMOS). Use `DSLR` only for consumer camera bodies (Canon EOS, Nikon D-series, etc.).
- `DATE=JD` — all dates are Julian Day numbers
- Acceptable file extensions: `.txt`, `.csv`, `.tsv` only

## Per-observation line format

`NAME,DATE,MAG,MERR,FILT,TRANS,MTYPE,CNAME,CMAG,KNAME,KMAG,AMASS,GROUP,CHART,NOTES`

| Field | Our value | Notes |
|-------|-----------|-------|
| `NAME` | `T CRB` | |
| `DATE` | computed JD | Mid-exposure JD — see `time-handling.md` |
| `MAG` | computed | T CrB standardised magnitude |
| `MERR` | computed | 1-sigma magnitude error — see `domain-knowledge.md` for formula |
| `FILT` | `TG` | Green channel of OSC sensor |
| `TRANS` | `NO` | No transformation to a standard system |
| `MTYPE` | `STD` | Standardised — **not** `DIF` |
| `CNAME` | AUID | Comparison star AUID (≤20 chars); prefer AUID over chart label |
| `CMAG` | instrumental | Comp star's **raw instrumental** magnitude (can be negative) |
| `KNAME` | AUID | Check star AUID; must differ from `CNAME` |
| `KMAG` | instrumental | Check star's raw instrumental magnitude |
| `AMASS` | computed | Airmass at mid-exposure — see `domain-knowledge.md` |
| `GROUP` | `na` | |
| `CHART` | `X42597QE` | |
| `NOTES` | short text | Keep well under ~100 chars |

## `MTYPE=STD` vs `DIF`

Use `STD`. With `STD`, the target magnitude is standardised via the comp star's known V magnitude (resolved from `CNAME` + `CHART`). `DIF` records are **not** shown on the AAVSO light-curve generator and are not fully validated by AAVSO HQ.

## `CMAG` / `KMAG` — instrumental magnitudes

AAVSO HQ prefers raw instrumental values here so they can derive zero points and re-standardise later. Negative numbers are expected and fine.

## Comp/check star selection (T CrB at quiescence ~10.0 V)

| Label | AUID | V mag | Role | Notes |
|-------|------|-------|------|-------|
| `79` | `000-BBW-881` | 7.886 | Outburst comp | BINO_COMP — use when T CrB brightens |
| `84` | `000-BBW-888` | 8.361 | Outburst comp | BINO_COMP — use when T CrB brightens |
| `98` | `000-BBW-796` | 9.809 | Comp or check | Good at quiescence |
| `106` | `000-BJS-901` | 10.554 | Comp or check | Good at quiescence |
| `102` | `000-BBW-779` | 10.167 | **Avoid** | Combined magnitude of blended pair (10.21 + 13.75 mag, 8″ apart) — PSF fitting cannot separate them |

Default pairing at quiescence: comp=`98`, check=`106` (or swap). Near outburst, use brighter comps (`84`, `79`) — see Roadmap in CLAUDE.md.

## Ensemble photometry (future)

When multiple comp stars are used, set `CNAME=ENSEMBLE`, `CMAG=na`, keep one dedicated check star in `KNAME`/`KMAG` (must **not** be part of the ensemble), and list comp AUIDs/labels in `NOTES`. Mind the ~100-char `NOTES` limit.
