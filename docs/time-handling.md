# Acquisition-Time Dialog — Specification

Handles mid-exposure time determination entirely within the script dialog.

## Dialog fields

### Start time and End time

- Displayed as UTC ISO-8601: `YYYY-MM-DDThh:mm:ss[.sss]`
- Corresponding JD shown alongside each field
- Both fields are **editable** — user verifies and corrects before proceeding

### Reference file buttons (two separate)

The dialog has two buttons for populating the time fields from subframe headers:

| Button | File to pick | Sets |
|--------|-------------|------|
| **First Sub → Start** | First surviving subframe | Start = `DATE-OBS` |
| **Last Sub → End** | Last surviving subframe | End = `DATE-OBS` + `EXPTIME` |

**`DATE-END` is deliberately not used** — it is one of the unreliable keywords this project avoids. End time is always derived from `DATE-OBS + EXPTIME`.

Both Start and End fields remain editable after auto-population so the user can verify or correct them.

**Stack's own `DATE-OBS`:** treat as a hint only. PixInsight's `ImageIntegration` writes it as the midpoint between the *first* and *last* subframe **start** times, ignoring exposure duration — not true mid-exposure time, and unreliable for Seestar stacks. Watch for duplicate `DATE-OBS` keywords after manual edits (only the first is read).

### Session-level usage

Reference the **first surviving subframe** for Start, and the **last surviving subframe** for End.

- "Surviving" = frames that made it through SubframeSelector and ImageIntegration pixel rejection — not last acquired, not last by filename.
- **End = last sub's `DATE-OBS` + `EXPTIME`** (bare `DATE-OBS` of the last sub is only its exposure *start*, so averaging first-start and last-start would reproduce ImageIntegration's own bug — short by half an exposure).

### Mid-time (three selectable modes)

| Mode | Behaviour | Notes |
|------|-----------|-------|
| `= Start` | Use Start time as-is | Naive/legacy |
| `= (Start + End) / 2` | Computed midpoint | **Recommended default** — correct for evenly spaced subs |
| `Manual` | Free entry | Overrides computed value |

The resulting mid-time JD flows into the AAVSO `DATE` field and the airmass computation. Show the final JD prominently so the user can sanity-check it.

## Sanity guards (minimal)

- `EXPTIME > 0`
- End time strictly after Start time
- When Start and End come from **different** subframes (a whole-session span), End − Start far exceeds a single `EXPTIME` — this is normal and must not be flagged as an error.

## PJSR implementation note

Read external file headers via `FileFormat` / `FileFormatInstance` (open → read `keywords` → close) — not via a full `ImageWindow` pixel load. See `pjsr-api-notes.md` for the pattern.
