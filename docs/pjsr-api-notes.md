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

## Per-channel image statistics

`Image.median()` (and `MAD()`, `mean()`, etc.) operates on the **currently selected channel**. To get a single-channel statistic, set `selectedChannel` first and restore it afterwards:

```js
var img  = view.image;
var prev = img.selectedChannel;
img.selectedChannel = 1;          // 0=R, 1=G, 2=B for an RGB image
var greenMedian = img.median();
img.selectedChannel = prev;       // always restore
```

Verified in `statisticalstretch.js` (bundled PI script). Calling `median()` without setting `selectedChannel` returns the statistic for whatever channel was last selected, not a combined value.

## Drawing annotations on a bitmap (Graphics)

**Use `Graphics`, not `VectorGraphics`.** `VectorGraphics` is a C++ class only available inside `DynamicPaint` callbacks. In scripts run via `Execute Script File…`, the drawing class is `Graphics` — same API, different name. Using `VectorGraphics` throws "VectorGraphics is not defined".


Pattern verified in `AperturePhotometry.js` and `DrawAnnotationEngine.js`:

```js
// 1. Render image to bitmap (respects the view's current STF)
var bmp = view.image.render();           // → Bitmap at full image resolution

// 2. Scale bitmap
var scaled = bmp.scaled( 0.5 );         // factor; also: bmp.scaledTo( w, h )

// 3. Crop a region into a new bitmap using drawBitmapRect
var thumb = new Bitmap( thumbW, thumbH );
thumb.fill( 0xff000000 );               // fill with opaque black
var gCrop = new Graphics( thumb );
gCrop.drawBitmapRect( new Point( 0, 0 ), scaled, new Rect( x0, y0, x1, y1 ) );
gCrop.end();

// 4. Draw on the thumbnail
var g = new Graphics( thumb );
g.antialiasing     = true;
g.textAntialiasing = true;

// Pen color is 0xAARRGGBB (A=opacity, fully opaque = 0xff)
g.pen = new Pen( 0xffff4444, 2 );       // red, 2px width
g.drawEllipse( cx-r, cy-r, cx+r, cy+r );

var font = new Font( g.font );          // copy current font
font.pixelSize = 13;
g.font = font;
g.pen = new Pen( 0xffffffff, 1 );       // white text
g.drawText( x, y, "label" );           // top-left of text at (x,y)

g.end();

// 5. Blend into a new ImageWindow
var outW = new ImageWindow( thumbW, thumbH, 3, 8, false, true, "Verification" );
outW.mainView.beginProcess( UndoFlag_NoSwapFile );
outW.mainView.image.blend( thumb );
outW.mainView.endProcess();
outW.show();
outW.zoomToFit();
```

## Auto-STF (temporary display stretch)

From `GAME.js` `ApplyAutoSTF` — applies a non-destructive display stretch to a view and can be restored:

```js
// Save current STF
var origSTF = view.stf;

// Compute auto-STF parameters (linked RGB)
var median = view.computeOrFetchProperty( "Median" );
var mad    = view.computeOrFetchProperty( "MAD" );
mad.mul( 1.4826 );
var c0 = 0, mVal = 0;
for ( var c = 0; c < 3; c++ ) {
   if ( 1 + mad.at(c) != 1 )
      c0 += median.at(c) + (-2.8) * mad.at(c);
   mVal += median.at(c);
}
c0   = Math.range( c0 / 3, 0.0, 1.0 );
mVal = Math.mtf( 0.25, mVal / 3 - c0 );  // Math.mtf is a PJSR extension

var stf = new ScreenTransferFunction;
stf.STF = [ [c0, 1, mVal, 0, 1],   // R: [c0, c1, m, r0, r1]
            [c0, 1, mVal, 0, 1],   // G
            [c0, 1, mVal, 0, 1],   // B
            [0,  1, 0.5,  0, 1] ]; // L (unused for RGB)
stf.executeOn( view );

// ... render() here to get STF-stretched bitmap ...

// Restore original STF
var stfRestore = new ScreenTransferFunction;
stfRestore.STF = origSTF;
stfRestore.executeOn( view );
```

`ScreenTransferFunction` only modifies the display — it does **not** alter pixel values.

## DynamicPSF scripting

Pattern:
1. Construct a `DynamicPSF` object and populate its star input list (positions)
2. Call `executeGlobal()`
3. Read the results from the output table

Verify current property names for both the input star list and the PSF output columns (amplitude, background, sigma/FWHM, flux, MAD/residual) against the installed version.

### PSF model choice for photometry: Gaussian only, not Auto

The script uses `autoPSF = false` with `gaussianPSF = true`. **Do not switch to `autoPSF = true`** for photometry, even though the PixInsight GUI defaults to Auto.

**Why Auto is wrong for differential photometry:**

When `autoPSF = true`, DynamicPSF tries Gaussian + several Moffat variants and picks the best-fitting model per star. That is useful for PSF analysis but harmful for photometry: the model can differ between the target and the comp star, making the flux values not directly comparable.

**Why Gaussian is correct here:**

1. **MERR formula validity.** The matched-filter noise formula used in `psfMagError()` —
   `σ_A = σ_pix × √(2 / (π · sx · sy))` — is derived for a 2D Gaussian PSF. It gives
   wrong noise estimates for a Moffat fit.

2. **Systematic cancellation.** The flux proxy `A × sx × sy` (with the 2π constant
   dropping out in the magnitude difference) is consistent only when both target and
   comp are fitted with the same model. Any Gaussian-model bias cancels in
   `instMag_T − instMag_C`.

3. **Adequate accuracy.** For a stacked master (20+ frames, typical amateur seeing)
   the PSF is well sampled and close to Gaussian. Moffat fits mainly help for
   undersampled or saturated stars — neither of which passes the quality filters anyway.

**Configuration used:**

```js
DPSF.autoPSF       = false;
DPSF.gaussianPSF   = true;
DPSF.moffatPSF     = false;   // and all other Moffat variants false
DPSF.lorentzianPSF = false;
```

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

**`PixInsight:ProcessingHistory` is NOT loaded into the in-memory view.** `view.propertyValue("PixInsight:ProcessingHistory")` always returns `null`. Read the raw XISF binary header from disk instead (it is only ~282 KB — the image data is not touched):

```js
// XISF fixed header layout: signature (8 bytes) + XML length (4 bytes LE uint32) + reserved (4 bytes)
var f = new File;
f.openForReading( filePath );   // NOT f.open(path, FileMode_Read) — FileMode_Read is undefined in PJSR
var sigBytes = f.read( DataType_ByteArray, 8 );   // "XISF0100"
var lenBytes = f.read( DataType_ByteArray, 4 );
var hdrLen   = lenBytes[0] | (lenBytes[1] << 8) | (lenBytes[2] << 16) | (lenBytes[3] << 24);
f.read( DataType_ByteArray, 4 );                  // reserved
var xmlBytes = f.read( DataType_ByteArray, hdrLen );
f.close();

// Convert ByteArray to string in chunks (avoids O(n²) concatenation in V8):
var xml = "", CHUNK = 8192;
for ( var i = 0; i < xmlBytes.length; i += CHUNK ) {
   var arr = [];
   for ( var j = i, end = Math.min( i + CHUNK, xmlBytes.length ); j < end; ++j )
      arr.push( xmlBytes[j] );
   xml += String.fromCharCode.apply( null, arr );
}

// ProcessingHistory is entity-encoded inside the outer XISF XML (&quot; for ", &lt; for <).
// To get ImageIntegration's frame count:
var m = xml.match( /class=&quot;ImageIntegration&quot;[\s\S]*?rows=&quot;(\d+)&quot;/ );
var frameCount = m ? parseInt( m[1], 10 ) : NaN;
```

**Frame count priority for WBPP masters** (NCOMBINE is not written by WBPP):
1. Parse `PixInsight:ProcessingHistory` from the XISF file on disk (method above) — authoritative.
2. `NCOMBINE` FITS keyword — present for standalone ImageIntegration runs.
3. `PCL:TotalExposureTime` / `Instrument:FrameExposureTime` — unreliable: the total is a weighted/scaled signal metric that differs per channel and does not equal N × frameExp when some subs lack `Instrument:ExposureTime` XISF metadata.

## TreeBox

Verified against `FitsDataView.js` (bundled PI script).

```js
var tb = new TreeBox( parent );
tb.numberOfColumns   = 5;        // property assignment — NOT setColumnCount()
tb.rootDecoration    = false;    // hides the expand/collapse arrow for top-level nodes
tb.alternateRowColor = true;
tb.setHeaderText( 0, "Col 0" );  // setHeaderText(col, text) is the correct method
tb.setHeaderText( 1, "Col 1" );
tb.setColumnWidth( 0, 40 );      // setColumnWidth(col, pixels)
tb.adjustColumnWidthToContents( 0 );  // auto-size after population
tb.setMinHeight( 160 );

var node = new TreeBoxNode( tb );  // creates and appends a top-level node
node.setText( 0, "value" );        // node.setText(col, text)
// node.text( col )                // getter for node text
node.checkable = true;             // shows a native checkbox
node.checked   = false;            // checkbox state

// Custom JS properties can be attached freely:
node.isCompSelected = true;
node._entry = someObject;

// Callbacks:
tb.onNodeClicked = function( node, col ) { /* col = column index clicked */ };
tb.onCurrentNodeUpdated = function( node ) { /* fires on selection change */ };

// Traversal:
tb.numberOfChildren;     // top-level node count
tb.child( idx );         // top-level node at index idx
tb.clear();              // remove all nodes
```

**Key gotcha:** `setColumnCount()` does NOT exist in PJSR. Use `numberOfColumns = n` (property).

## ComboBox

```js
this.myCombo = new ComboBox( this );
this.myCombo.setMinWidth( 160 );
this.myCombo.addItem( "item text" );         // append one item
this.myCombo.removeItem( 0 );                // remove item at index
this.myCombo.currentItem = 2;               // set selected index (integer)
// this.myCombo.currentItem                 // read selected index
this.myCombo.numberOfItems;                 // item count
this.myCombo.itemText( idx );               // text of item at index
this.myCombo.onItemSelected = function( idx ) { /* idx is the new selection */ };
```

To clear all items: `while ( combo.numberOfItems > 0 ) combo.removeItem( 0 );`

`onItemSelected` fires when `currentItem` is set programmatically as well as by the user — guard against spurious writes in repopulation loops if needed.

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
