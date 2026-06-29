# PJSR API Notes (PixInsight 1.9.4 "Lockhart")

**Do not fabricate API signatures.** When unsure of a method name, class, or `#include` path, verify against PixInsight's official PJSR reference and the bundled scripts (e.g., `AnnotateImage.js`, `ImageSolver.js` under `src/scripts/`).

## JS engine: Google V8 (since 1.9.4)

PixInsight 1.9.4 "Lockhart" replaced SpiderMonkey 24 with **Google V8**. This means:
- Modern ES6+ syntax is available: `let`/`const`, arrow functions, template literals, destructuring, `Promise`, etc.
- Do **not** code around SpiderMonkey 24 limitations (e.g., no need to avoid ES6 features).
- If consulting older PJSR script examples written for pre-1.9.4, be aware they may use ES5-only patterns — these still work but are not required.

**Do NOT use `"use strict"`.** PJSR uses it as a hint to select the legacy SpiderMonkey ('sm') engine. In 1.9.4 that engine is gone, so the script fails with "The legacy 'sm' JavaScript engine is not available". Omit the directive entirely — V8 enforces modern semantics without it.

## Astrometric solution

Reuse the bundled WCS / `AstrometricMetadata` / `ImageMetadata` library — the same one used by `ImageSolver` and `AnnotateImage`. Do **not** hand-roll gnomonic projection or re-derive the distortion surface.

- Verify the exact `#include` path for the installed version
- Verify the method names for celestial → pixel and pixel → celestial conversions

## FITS keywords

```js
// Access from an open ImageWindow:
var kws = window.keywords;  // Array of FITSKeyword
// Each FITSKeyword has:
//   .name    (string, e.g. "DATE-OBS")
//   .value   (string — trim and parse manually)
//   .comment (string)
```

Values are always strings. Parse floats with `parseFloat()`, integers with `parseInt()`. Trim whitespace and surrounding quotes.

## DynamicPSF scripting

Pattern:
1. Construct a `DynamicPSF` object and populate its star input list (positions)
2. Call `executeGlobal()`
3. Read the results from the output table

Verify current property names for both the input star list and the PSF output columns (amplitude, background, sigma/FWHM, flux, MAD/residual) against the installed version.

## File dialogs

```js
var dlg = new OpenFileDialog();
dlg.caption = "Select subframe";
dlg.filters = [["FITS Files", "*.fits *.fit *.fts"], ["XISF Files", "*.xisf"]];
if (dlg.execute()) { var path = dlg.fileName; }

var saveDlg = new SaveFileDialog();
saveDlg.caption = "Save AAVSO report";
saveDlg.filters = [["Text/CSV", "*.txt *.csv *.tsv"]];
if (saveDlg.execute()) { var outPath = saveDlg.fileName; }
```

Verify `filters` property name and format against installed version.

## GUI dialog (acquisition-time UI)

**V8 / PI 1.9.4: use ES6 `class extends Dialog` — NOT the old `__base__` pattern.**

The old SpiderMonkey pattern (`this.__base__ = Dialog; this.__base__();` / `MyDialog.prototype = new Dialog`) does NOT work in V8. V8 requires proper ES6 class inheritance:

```js
class MyDialog extends Dialog {
   constructor() {
      super();   // initialises the native Dialog C++ object
      this.windowTitle = "My Dialog";

      // Controls — pass `this` as parent:
      this.lbl  = new Label( this );       this.lbl.text = "Label:";
      this.edit = new Edit( this );        this.edit.setFixedWidth( 200 );
      this.btn  = new PushButton( this );  this.btn.text = "Click";
      this.rb   = new RadioButton( this ); this.rb.text = "Option"; this.rb.checked = true;

      // Callbacks — use var self = this or arrow functions:
      var self = this;
      this.btn.onClick = function() { self.ok(); };
      this.rb.onCheck  = function( chk ) { if ( chk ) { /* ... */ } };

      // Layout:
      var row = new HorizontalSizer;   // no parent argument for sizers
      row.spacing = 8;
      row.add( this.lbl );
      row.add( this.edit );
      row.addStretch();

      this.sizer = new VerticalSizer;
      this.sizer.margin  = 12;
      this.sizer.spacing = 8;
      this.sizer.add( row );
      this.sizer.add( this.btn );
   }
}

var dlg = new MyDialog();
if ( dlg.execute() ) { /* OK pressed */ }
```

Key facts:
- `this.ok()` / `this.cancel()` close the dialog; `execute()` returns 1 (Ok) or 0 (Cancel).
- `TextAlignment.Right | TextAlignment.VertCenter` — no `#include` needed.
- `control.setFixedWidth(n)` — valid on Label, Edit, PushButton, etc.
- `sizer.addStretch()` / `sizer.addSpacing(n)` — both available.
- `control.enabled = false/true` — greys out a control.
- `control.toolTip = "..."` — hover tooltip.
- `StdIcon.Warning`, `StdIcon.Error`, `StdButton.Ok` — no `#include` needed.
- `new MessageBox( text, title, StdIcon.Warning, StdButton.Ok ).execute()` — modal alert.

## Header-only file read (no pixel load)

Read FITS/XISF keywords without loading pixel data:

```js
// Conceptual pattern — verify exact API:
var fmt  = new FileFormat(filePath, true /*read*/, false /*write*/);
var inst = new FileFormatInstance(fmt);
inst.open(filePath, "" /*format-specific options*/);
var kws = inst.keywords;   // Array of FITSKeyword
inst.close();
```

Verify the exact constructor signatures, the `open()` argument list, and whether `keywords` is the correct property name for the installed version.

## XISF image properties

XISF image properties are distinct from FITS keywords and are accessed via the `View` object:

```js
// List all property IDs on the active view (returns array of strings)
var ids = view.properties;   // e.g. ["Image:Id", "PCL:TotalExposureTime", ...]

// Read a specific property value
var val = view.propertyValue( "PCL:TotalExposureTime" );
```

**Key properties found on a Seestar OSC master-light stack (PI 1.9.4):**

| Property ID | Type | Example value | Notes |
|---|---|---|---|
| `Instrument:FrameExposureTime` | Float64 | `30` | Seconds per sub |
| `PCL:TotalExposureTime` | Float64 array | `[554.575,532.567,480.99]` | Per-channel total; channels vary due to rejection |
| `Observation:Time:Start` | String | ISO-8601 | Same as `DATE-OBS` FITS keyword |
| `Observation:Time:End` | String | ISO-8601 | Same as `DATE-END` FITS keyword |

**`PCL:TotalExposureTime` is a per-channel array.** `propertyValue()` returns it as a Variant whose string form is `[R,G,B]`. Parse with:

```js
var totNums = String( val ).replace( /[\[\]\s]/g, '' )
                .split( ',' ).map( parseFloat )
                .filter( function(x) { return !isNaN(x); } );
var maxTot = Math.max.apply( null, totNums );
```

**Deriving frame count:**

```js
var totalExp = view.propertyValue( "PCL:TotalExposureTime" );
var frameExp = view.propertyValue( "Instrument:FrameExposureTime" );
// parse totalExp array as above, then:
var frames = Math.round( maxTot / parseFloat( String( frameExp ) ) );
```

**`PixInsight:ProcessingHistory` is NOT loaded into the in-memory view.** It exists in the XISF file on disk (accessible via Python/XML parsing) but `view.propertyValue("PixInsight:ProcessingHistory")` returns `null`. Do not rely on it from PJSR.

## Non-ASCII characters in `format()` format strings

**Do not embed non-ASCII (non-Latin-1) characters directly inside a `format()` format string.** PJSR's `format()` is a C printf wrapper; multi-byte UTF-8 characters in the format string itself (not in string arguments) can cause it to misinterpret argument counts or types, resulting in an out-of-memory crash or silent wrong output.

- **Safe:** Latin-1 characters (codepoints ≤ 255) such as `°` (U+00B0) work in format strings.
- **Unsafe:** Characters with codepoints > 255 — for example `σ` (U+03C3), `→` (U+2192), `×` (U+00D7 is actually Latin-1 so fine, but test it) — must not appear inside the format string passed to `format()`.
- **Fix:** build the string with concatenation, using `format()` only for the numeric parts:

```js
// Wrong — "σ" in format string causes OOM:
console.writeln( format( "err=%.3f  σ=%.3f", a, b ) );

// Correct — non-ASCII only in plain JS string concatenation:
console.writeln( "err=" + format( "%.3f", a ) + "  sig=" + format( "%.3f", b ) );
```

Non-ASCII characters are safe in plain JS string literals that are not passed to `format()` — e.g., `Label.text = "Moon: 45°"` is fine.

## Settings persistence

Requires `#include <pjsr/DataType.jsh>` — the `DataType_*` constants are not automatically in scope.

```js
// Namespaced under "BeSchne/Photometry/"
var path = Settings.read("BeSchne/Photometry/comparisonCsvPath", DataType_String);
Settings.write("BeSchne/Photometry/comparisonCsvPath", DataType_String, value);
Settings.remove("BeSchne/Photometry/comparisonCsvPath");
```

Key constants from `DataType.jsh`:
- `DataType_String` / `DataType_String8` — ISO 8859-1 string (use for file paths)
- `DataType_UCString` — Unicode string (16-bit)
- `DataType_Double`, `DataType_Float`, `DataType_Int32`, `DataType_Boolean`

## Console output

```js
console.writeln("Normal message");
console.warningln("Warning — shown in yellow");
console.criticalln("Error — shown in red");
```

## Script header — correct pragma syntax

Pragmas are **bare directives with no `//` prefix**. They are processed by the PJSR preprocessor before the JS engine starts. Order matters: `#engine` must come first.

```
#engine v8

#feature-id    BeSchne > Photometry

#feature-info  Description text. Multi-line with trailing \
               continuation backslash.

CoreApplication.ensureMinimumVersion( 1, 9, 4 );
```

- **`#engine v8`** — mandatory in PI 1.9.4. Without it, `-x=auto` defaults to 'sm' (SpiderMonkey), which is gone in 1.9.4 → fatal error on launch.
- **`#feature-id` / `#feature-info`** — also bare pragmas, not JS comments.
- **`CoreApplication.ensureMinimumVersion( 1, 9, 4 )`** — first JS statement; fails fast with a clear message on older PI builds.
- `#feature-icon  path/to/icon.svg` — optional; omit if no icon file.

Required for `Script > Feature Scripts… > Add` registration under `Script > BeSchne > Photometry`. Not required for `Script > Execute Script File…` — the script runs either way.
