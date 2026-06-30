#engine v8

#feature-id    BeSchne > AAVSO Photometry

#feature-info  Differential photometry of variable stars directly inside \
               PixInsight. Requires a linear, plate-solved OSC RGB master \
               stack and a comparison-star CSV from AAVSO VSP. Fits PSFs via \
               DynamicPSF (TG green + TB blue channels), derives the target \
               magnitude from an ensemble of comp stars (or a single comp), \
               checks quality against a check star, and writes an AAVSO \
               Extended File Format report. Currently configured for T Coronae \
               Borealis (the Blaze Star). Observer site coordinates are read \
               automatically from FITS keywords. See the project README on \
               GitHub for a full getting-started guide.

#include <pjsr/DataType.jsh>
#include <pjsr/UndoFlag.jsh>
#include <pjsr/astrometry/AstrometricMetadata.js>

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

// ============================================================
// Constants — tune here, not inside functions
// ============================================================

const TITLE   = "AAVSO Photometry";
const VERSION = "1.3.1";

// --- Target star -------------------------------------------------
// Factored as an object so other targets can be added later.
const TARGET = {
   name        : "T CRB",  // AAVSO name (used in report NAME field)
   ra          : 239.8757, // J2000 degrees
   dec         :  25.9202, // J2000 degrees
   magQuiescence: 10.0,    // expected V magnitude at quiescence — used to pick default comp/check
};

// Observer site: no hardcoded fallback.
// Lat / lon are read from FITS keywords (SITELAT / SITELONG) and shown
// as editable fields in the dialog. Elevation defaults to 0 m if absent
// from FITS. If lat or lon remain blank, AMASS is written as "na".

// --- AAVSO report metadata ---------------------------------------
const OBSCODE = "BSLA";
const CHART   = "X42597QE";
const OBSTYPE = "CCD";    // Seestar is a dedicated astronomy camera, not a consumer DSLR

// --- Photometry thresholds ---------------------------------------
// Peak above this fraction of the image maximum AND a poor DynamicPSF
// fit → star is flagged as saturated/clipped.
// Calibrate once against a known clipped star.
const SATURATION_FRACTION = 0.90;

// Separator line used in console output.
const SEP = "=".repeat( 60 );

// DynamicPSF MAD residual above this level indicates a poor fit.
// Combined with a high peak → probable clipping/saturation.
// A well-fitted star typically has MAD < 0.01.
const PSF_MAD_THRESHOLD = 0.01;

// Half-size (pixels) of the bounding box supplied to DynamicPSF per star.
// Must contain the PSF wings; keep small enough to avoid blending with
// a nearby star.
const PSF_BOX_HALF = 10;

// Maximum allowed distance (pixels) between the projected position
// and the DynamicPSF-fitted centroid before a star is rejected.
const MAX_CENTROID_DRIFT_PX = 5.0;

// --- Verification image ------------------------------------------
// Circle radius drawn around each star in the original image's pixel space.
const VERIFY_CIRCLE_RADIUS = 25;
// Padding around the bounding box of all three stars (original pixels).
const VERIFY_PADDING = 80;
// Maximum side length of the thumbnail shown in the verification window.
const VERIFY_MAX_SIDE = 1000;

// --- Ensemble photometry -----------------------------------------
// Stars more than this many magnitudes from TARGET.magQuiescence are not
// pre-selected by default (user can still tick them manually).
const ENSEMBLE_MAX_DELTA_MAG  = 2.0;
// Maximum number of stars pre-selected as comp ensemble by default.
const ENSEMBLE_DEFAULT_MAX_N  = 6;

// --- Settings keys -----------------------------------------------
const SETTINGS_NS          = "BeSchne/Photometry";
const SETTINGS_CSV         = SETTINGS_NS + "/comparisonCsvPath";
const SETTINGS_LAST_DIR    = SETTINGS_NS + "/lastExportDir";
const SETTINGS_OBSCODE     = SETTINGS_NS + "/obsCode";

// ============================================================
// CSV parsing
// ============================================================

// Reads a whole text file and returns it as a string.
// Verify: File constructor, openForReading, read(DataType_ByteArray, size),
// ByteArray.toString() — against PI 1.9.4 PJSR reference.
function readTextFile( path ) {
   var f = new File;
   f.openForReading( path );
   var text = f.read( DataType_ByteArray, f.size ).toString();
   f.close();
   return text;
}

// RFC 4180-compliant single-row parser.
// `pos` is a one-element array used as an in/out cursor into `text`.
function parseCSVRow( text, pos ) {
   var fields = [];
   var i = pos[0];
   var n = text.length;
   var afterComma = false;

   while ( i < n && text[i] !== '\n' && text[i] !== '\r' ) {
      afterComma = false;
      if ( text[i] === '"' ) {
         // Quoted field — consume embedded "" as a literal "
         var field = "";
         i++;
         while ( i < n ) {
            if ( text[i] === '"' ) {
               if ( i + 1 < n && text[i + 1] === '"' ) {
                  field += '"';
                  i += 2;
               } else {
                  i++;  // closing quote
                  break;
               }
            } else {
               field += text[i++];
            }
         }
         fields.push( field );
      } else {
         // Unquoted field
         var start = i;
         while ( i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r' )
            i++;
         fields.push( text.slice( start, i ).trim() );
      }

      if ( i < n && text[i] === ',' ) {
         i++;          // consume separator; loop reads next field
         afterComma = true;
      }
   }

   // A trailing comma means the final field is empty (e.g. an empty Comments column)
   if ( afterComma )
      fields.push( "" );

   // Advance past line terminator
   if ( i < n && text[i] === '\r' ) i++;
   if ( i < n && text[i] === '\n' ) i++;
   pos[0] = i;

   return fields;
}

// Converts a sexagesimal string to decimal degrees.
// RA strings are hours (H:MM:SS.ss) — multiply by 15 after calling.
// Dec strings may lack a leading '+' for positive values (AAVSO VSP format).
function sexagesimalToDeg( s ) {
   var neg   = s.charAt( 0 ) === '-';
   var parts = s.replace( /^[+-]/, '' ).split( ':' );
   var deg   = parseFloat( parts[0] )
             + parseFloat( parts[1] ) / 60
             + parseFloat( parts[2] ) / 3600;
   return neg ? -deg : deg;
}

// Expected column header (AAVSO VSP export format)
const CSV_COLUMNS = [ "AUID", "RA", "Dec", "Label", "Band", "Mag", "Error", "Comments" ];

// Loads and parses the comparison-star CSV.
// Returns an array of star objects for all V-band rows, with B-band magnitudes
// attached where present in the CSV.
// Each object: { auid, ra, dec, label, magV, errorV, magB, errorB, blended, comments }
// magB / errorB are null when no B-band row exists for that star.
// Throws a descriptive Error on any problem.
function loadComparisonStars( csvPath ) {
   var text = readTextFile( csvPath );
   text = text.replace( /\r\n/g, '\n' ).replace( /\r/g, '\n' );

   var pos     = [0];
   var lineNum = 0;
   var vStars  = {};  // auid → star object (V-band rows)
   var bMags   = {};  // auid → { mag, error }

   // Validate header
   var header = parseCSVRow( text, pos );
   lineNum++;
   for ( var c = 0; c < CSV_COLUMNS.length; c++ ) {
      if ( header[c] !== CSV_COLUMNS[c] )
         throw new Error(
            "Comparison CSV column mismatch at position " + (c + 1) +
            ": expected \"" + CSV_COLUMNS[c] + "\", got \"" + header[c] + "\""
         );
   }

   // Parse data rows — collect V and B bands
   while ( pos[0] < text.length ) {
      var fields = parseCSVRow( text, pos );
      lineNum++;

      if ( fields.length === 0 || ( fields.length === 1 && fields[0] === '' ) )
         continue;  // blank line

      if ( fields.length < CSV_COLUMNS.length )
         throw new Error(
            "Comparison CSV: only " + fields.length + " columns on line " + lineNum +
            " (expected " + CSV_COLUMNS.length + ")"
         );

      var band = fields[4];
      if ( band !== "V" && band !== "B" )
         continue;

      var auid = fields[0];
      var mag  = parseFloat( fields[5] );

      if ( band === "V" ) {
         if ( !isFinite( mag ) ) {
            console.warningln( "CSV line " + lineNum + ": skipping star \"" + fields[3] +
                               "\" — non-numeric V magnitude \"" + fields[5] + "\"" );
            continue;
         }
         var comments = fields[7];
         var blended  = /blend|pair|combined/i.test( comments );
         vStars[ auid ] = {
            auid    : auid,
            ra      : sexagesimalToDeg( fields[1] ) * 15,  // hours → degrees
            dec     : sexagesimalToDeg( fields[2] ),        // already degrees
            label   : fields[3],
            magV    : mag,
            errorV  : parseFloat( fields[6] ),
            magB    : null,   // filled below if a B-band row is present
            errorB  : null,
            blended : blended,
            comments: comments,
         };
      } else {  // band === "B"
         if ( isFinite( mag ) )
            bMags[ auid ] = { mag: mag, error: parseFloat( fields[6] ) };
      }
   }

   // Attach B-band magnitudes to matching V-band star objects
   for ( var k in bMags ) {
      if ( vStars[k] ) {
         vStars[k].magB  = bMags[k].mag;
         vStars[k].errorB = bMags[k].error;
      }
   }

   var stars = [];
   for ( var k in vStars ) stars.push( vStars[k] );

   if ( stars.length === 0 )
      throw new Error( "No usable V-band rows found in: " + csvPath );

   return stars;
}

// ============================================================
// Astrometric projection
// ============================================================

// Validates the active window and loads its astrometric solution.
// Throws if the window is null, not RGB, or has no plate solve.
function loadAstrometry( window ) {
   if ( window === null || window === undefined || window.isNull )
      throw new Error( "No active image window. Open a plate-solved OSC stack first." );

   var image = window.mainView.image;
   if ( image.numberOfChannels !== 3 )
      throw new Error(
         "Expected a debayered OSC (one-shot colour) RGB image (3 channels); got " +
         image.numberOfChannels + " channel(s). " +
         "Run the Debayer process on your Bayer-pattern master before running this script." );

   var metadata = new AstrometricMetadata( SETTINGS_NS );
   metadata.ExtractMetadata( window );
   if ( metadata.ref_I_G == null )
      throw new Error( "Image has no astrometric solution. Run ImageSolver first." );

   return metadata;
}

// Projects a J2000 (ra, dec) in degrees to pixel coordinates.
// Returns a Point(x, y) or null if the position is behind the projection hemisphere.
function celestialToPixel( metadata, ra, dec ) {
   return metadata.Convert_RD_I( new Point( ra, dec ) );
}

// Projects an array of star objects into pixel space.
// Returns only stars that fall strictly within the image bounds.
function projectStars( metadata, stars, width, height ) {
   var inFrame = [];
   for ( var i = 0; i < stars.length; i++ ) {
      var pix = celestialToPixel( metadata, stars[i].ra, stars[i].dec );
      if ( pix === null ) {
         console.warningln( "  Off-projection (behind tangent plane): label " + stars[i].label );
         continue;
      }
      if ( pix.x < 0 || pix.y < 0 || pix.x >= width || pix.y >= height ) {
         console.warningln( "  Off-frame: label " + stars[i].label +
                            " at pixel (" + pix.x.toFixed(0) + ", " + pix.y.toFixed(0) + ")" );
         continue;
      }
      inFrame.push( { star: stars[i], x: pix.x, y: pix.y } );
   }
   return inFrame;
}

// ============================================================
// PSF measurement (DynamicPSF)
// ============================================================

// Fits a Gaussian PSF to each position in starsIn on the given channel.
// channel: 0=red, 1=green (default, TG), 2=blue (TB) — PixInsight R/G/B ordering.
// starsIn: array of { label, x, y }
// Returns an object keyed by label → { B, A, cx, cy, sx, sy, theta, mad }
//   or null if the fit did not converge for that star.
function fitPSF( window, starsIn, channel ) {
   if ( channel === undefined ) channel = 1;  // default: green
   var DPSF = new DynamicPSF;
   DPSF.views         = [ [ window.mainView.id ] ];
   DPSF.autoPSF       = false;
   DPSF.gaussianPSF   = true;   // Gaussian: good general choice for PSF photometry
   DPSF.circularPSF   = false;
   DPSF.moffatPSF     = false;
   DPSF.moffat10PSF   = false;
   DPSF.moffat8PSF    = false;
   DPSF.moffat6PSF    = false;
   DPSF.moffat4PSF    = false;
   DPSF.moffat25PSF   = false;
   DPSF.moffat15PSF   = false;
   DPSF.lorentzianPSF = false;
   DPSF.regenerate    = true;
   DPSF.searchRadius  = MAX_CENTROID_DRIFT_PX;  // don't lock on a wrong nearby star

   var stars = [];
   for ( var i = 0; i < starsIn.length; i++ ) {
      var x = starsIn[i].x;
      var y = starsIn[i].y;
      stars.push( [
         0,                          // viewIndex
         channel,                    // channel: 1=green (TG), 2=blue (TB)
         DynamicPSF.Star_DetectedOk, // status
         x - PSF_BOX_HALF, y - PSF_BOX_HALF,  // x0, y0
         x + PSF_BOX_HALF, y + PSF_BOX_HALF,  // x1, y1
         x, y                        // initial centre
      ] );
   }
   DPSF.stars = stars;
   DPSF.executeGlobal();

   // Map psf table back to input stars (take first PSF_FittedOk per star)
   var byStarIdx = {};
   var psfTable  = DPSF.psf;
   for ( var i = 0; i < psfTable.length; i++ ) {
      var row     = psfTable[i];
      var starIdx = row[ DynamicPSF.psf_starIndex ];
      if ( row[ DynamicPSF.psf_status ] === DynamicPSF.PSF_FittedOk &&
           !( starIdx in byStarIdx ) ) {
         byStarIdx[ starIdx ] = {
            B     : row[ DynamicPSF.psf_B     ],
            A     : row[ DynamicPSF.psf_A     ],
            cx    : row[ DynamicPSF.psf_cx    ],
            cy    : row[ DynamicPSF.psf_cy    ],
            sx    : row[ DynamicPSF.psf_sx    ],
            sy    : row[ DynamicPSF.psf_sy    ],
            theta : row[ DynamicPSF.psf_theta ],
            mad   : row[ DynamicPSF.psf_mad   ],
         };
      }
   }

   var results = {};
   for ( var i = 0; i < starsIn.length; i++ )
      results[ starsIn[i].label ] = byStarIdx[i] || null;
   return results;
}

// Instrumental magnitude from a Gaussian PSF result.
// Flux ∝ A·σx·σy (integral of a 2D Gaussian; the 2π factor cancels in
// differential magnitudes so it is omitted here).
function psfInstrumentalMag( psf ) {
   var flux = psf.A * psf.sx * psf.sy;
   return ( flux > 0 ) ? -2.5 * Math.log10( flux ) : null;
}

// 1-sigma magnitude error from Gaussian PSF fit residuals.
// Treats psf.mad (per-pixel mean absolute deviation of fit residuals) as the
// empirical pixel noise — capturing Poisson photon noise + sky background noise
// + read noise in one number, without needing gain or read-noise FITS keywords.
//
// Derivation:
//   σ_pix = mad / 0.6745          (MAD → 1-sigma for Gaussian noise)
//   σ_A   = σ_pix × sqrt(2/(π·sx·sy))   (noise in amplitude from matched filter)
//   SNR   = A / σ_A
//   σ_mag = 2.5/ln(10) / SNR = 1.08574 / SNR
//
// Returns null if any PSF parameter is invalid.
function psfMagError( psf ) {
   if ( !psf || psf.A <= 0 || psf.sx <= 0 || psf.sy <= 0 || psf.mad <= 0 )
      return null;
   var sigmaPix = psf.mad / 0.6745;
   var sigmaA   = sigmaPix * Math.sqrt( 2.0 / (Math.PI * psf.sx * psf.sy) );
   var snr      = psf.A / sigmaA;
   return snr > 0 ? 1.08574 / snr : null;
}

// Applies quality filters to one PSF result.
// Returns null on pass, or a descriptive string on rejection.
function checkPSFQuality( psf, projX, projY ) {
   if ( psf === null )
      return "PSF fit did not converge";

   if ( psf.A <= 0 )
      return "non-positive amplitude — star not detected";

   var dx    = psf.cx - projX;
   var dy    = psf.cy - projY;
   var drift = Math.sqrt( dx*dx + dy*dy );
   if ( drift > MAX_CENTROID_DRIFT_PX )
      return format( "centroid %.1f px from projected position (max %.1f px)",
                     drift, MAX_CENTROID_DRIFT_PX );

   // Clipped/saturated: high peak AND poor fit residual
   if ( ( psf.A + psf.B ) > SATURATION_FRACTION && psf.mad > PSF_MAD_THRESHOLD )
      return format( "probable clipping: peak=%.3f (threshold=%.2f), MAD=%.4f",
                     psf.A + psf.B, SATURATION_FRACTION, psf.mad );

   return null;  // pass
}

// ============================================================
// ISO-8601 ↔ Julian Day conversions  (Meeus, Astron. Algorithms ch. 7)
// ============================================================

// Parses "YYYY-MM-DDTHH:MM:SS[.sss]" (UTC) → Julian Day.
// Returns NaN on any parse failure.
function isoToJD( iso ) {
   var m = String( iso ).trim().match(
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/ );
   if ( !m ) return NaN;
   var Y  = parseInt(   m[1], 10 );
   var M  = parseInt(   m[2], 10 );
   var D  = parseInt(   m[3], 10 );
   var h  = parseInt(   m[4], 10 );
   var mn = parseInt(   m[5], 10 );
   var s  = parseFloat( m[6]      );
   if ( M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || mn > 59 || s >= 61 )
      return NaN;
   if ( M <= 2 ) { Y -= 1; M += 12; }
   var A = Math.floor( Y / 100 );
   var B = 2 - A + Math.floor( A / 4 );
   return Math.floor( 365.25 * (Y + 4716) )
        + Math.floor( 30.6001 * (M + 1) )
        + D + h/24 + mn/1440 + s/86400
        + B - 1524.5;
}

// Julian Day → "YYYY-MM-DDTHH:MM:SS" UTC string  (Meeus ch. 7).
function jdToISO( jd ) {
   var jd1 = jd + 0.5;
   var Z   = Math.floor( jd1 );
   var sec = Math.round( (jd1 - Z) * 86400 );
   if ( sec >= 86400 ) { sec -= 86400; Z += 1; }   // carry fractional day
   var A = Z;
   if ( Z >= 2299161 ) {
      var alpha = Math.floor( (Z - 1867216.25) / 36524.25 );
      A = Z + 1 + alpha - Math.floor( alpha / 4 );
   }
   var B     = A + 1524;
   var C     = Math.floor( (B - 122.1) / 365.25 );
   var D     = Math.floor( 365.25 * C );
   var E     = Math.floor( (B - D) / 30.6001 );
   var day   = B - D - Math.floor( 30.6001 * E );
   var month = ( E < 14 ) ? E - 1 : E - 13;
   var year  = ( month > 2 ) ? C - 4716 : C - 4715;
   var hh    = Math.floor( sec / 3600 ); sec -= hh * 3600;
   var mm    = Math.floor( sec / 60   ); sec -= mm * 60;
   return format( "%04d-%02d-%02dT%02d:%02d:%02d", year, month, day, hh, mm, sec );
}

// ============================================================
// FITS / XISF keyword reader
// ============================================================

// Reads the XISF binary header from disk and returns the number of frames fed to
// ImageIntegration.  PixInsight:ProcessingHistory is never loaded into the in-memory
// View (propertyValue() always returns null), so we parse the raw file instead.
// The header XML is ~282 KB; the full image data is never read.
function readXISFFrameCount( filePath ) {
   if ( !filePath ) return NaN;
   try {
      var f = new File;
      f.openForReading( filePath );

      // XISF monolithic fixed header: signature (8) + XML-header length (4, LE uint32) + reserved (4)
      var sigBytes = f.read( DataType_ByteArray, 8 );
      if ( sigBytes[0] !== 88 || sigBytes[1] !== 73 ||   // 'X','I'
           sigBytes[2] !== 83 || sigBytes[3] !== 70 )    // 'S','F'
         { f.close(); return NaN; }

      var lenBytes = f.read( DataType_ByteArray, 4 );
      var hdrLen   = lenBytes[0] | (lenBytes[1] << 8) |
                     (lenBytes[2] << 16) | (lenBytes[3] << 24);
      f.read( DataType_ByteArray, 4 );   // reserved

      if ( hdrLen <= 0 || hdrLen > 8 * 1024 * 1024 ) { f.close(); return NaN; }

      var xmlBytes = f.read( DataType_ByteArray, hdrLen );
      f.close();

      // Convert ByteArray → JS string in 8 KB chunks to avoid O(n²) concatenation.
      var xml = "", CHUNK = 8192;
      for ( var i = 0; i < xmlBytes.length; i += CHUNK ) {
         var arr = [];
         for ( var j = i, end = Math.min( i + CHUNK, xmlBytes.length ); j < end; ++j )
            arr.push( xmlBytes[j] );
         xml += String.fromCharCode.apply( null, arr );
      }

      // ProcessingHistory is entity-encoded inside the outer XISF XML:
      //   class=&quot;ImageIntegration&quot; ... <table ... rows=&quot;N&quot;
      var m = xml.match( /class=&quot;ImageIntegration&quot;[\s\S]*?rows=&quot;(\d+)&quot;/ );
      return m ? parseInt( m[1], 10 ) : NaN;

   } catch ( e ) {
      console.warningln( "readXISFFrameCount: " + e.message );
      return NaN;
   }
}

// Returns an array of FITSKeyword objects from a file on disk.
// readImage() is called to ensure keywords are populated (format requirement).
function readFileKeywords( filePath ) {
   var ext = File.extractExtension( filePath ).toLowerCase();
   var F   = new FileFormat( ext, true/*read*/, false/*write*/ );
   if ( F.isNull )
      throw new Error( "No installed format supports '" + ext + "' files." );
   var f = new FileFormatInstance( F );
   if ( f.isNull )
      throw new Error( "Cannot instantiate file format: " + F.name );
   var d = f.open( filePath );
   if ( !d || d.length < 1 )
      throw new Error( "Cannot open file: " + filePath );
   var img = new Image;
   if ( !f.readImage( img ) )
      throw new Error( "Cannot read image data from: " + filePath );
   var kws = f.keywords;
   f.close();
   return kws || [];
}

// Returns the trimmed string value of the first keyword matching `name`, or null.
// FITS string values may carry surrounding single-quotes and padding whitespace.
function findKeyword( kws, name ) {
   for ( var i = 0; i < kws.length; i++ )
      if ( kws[i].name === name )
         return kws[i].value.replace( /['\s]/g, '' );
   return null;
}

// Remove characters that would corrupt the comma-delimited AAVSO report format.
// Applied to every field sourced from CSV or FITS before interpolation into the data line.
function sanitizeField( s ) {
   return String( s ).replace( /[,\r\n]/g, " " ).trim();
}

function escHtml( s ) {
   return String( s ).replace( /&/g, "&amp;" ).replace( /</g, "&lt;" ).replace( />/g, "&gt;" );
}

// Parse a coordinate string and return the float value only if it is finite and
// within [lo, hi]; otherwise return NaN so callers fall back to "na" or a warning.
function parseCoord( s, lo, hi ) {
   var v = parseFloat( s );
   return ( isFinite(v) && v >= lo && v <= hi ) ? v : NaN;
}

// ============================================================
// Airmass — Kasten & Young (1989)
// ============================================================

// Returns airmass X for the target at the given UTC Julian Day.
// lat / lon in degrees (North / East positive); ra / dec J2000 in degrees.
// Throws if the target is at or below the horizon.
function computeAirmass( jdUT, lat_deg, lon_deg, ra_deg, dec_deg ) {
   var T    = (jdUT - 2451545.0) / 36525.0;
   var GMST = 280.46061837
            + 360.98564736629 * (jdUT - 2451545.0)
            + 0.000387933 * T * T
            - (T * T * T) / 38710000.0;
   GMST = ((GMST % 360) + 360) % 360;
   var LST  = ((GMST + lon_deg) % 360 + 360) % 360;
   var H    = LST - ra_deg;
   if ( H >  180 ) H -= 360;
   if ( H < -180 ) H += 360;
   var lat_r  = lat_deg * Math.PI / 180;
   var dec_r  = dec_deg * Math.PI / 180;
   var H_r    = H       * Math.PI / 180;
   var sinAlt = Math.sin( lat_r ) * Math.sin( dec_r )
              + Math.cos( lat_r ) * Math.cos( dec_r ) * Math.cos( H_r );
   var altDeg = Math.asin( sinAlt ) * 180 / Math.PI;
   if ( altDeg <= 0 )
      throw new Error( format( "target is below the horizon (altitude %.1f\xb0)", altDeg ) );
   return 1.0 / (sinAlt + 0.50572 * Math.pow( altDeg + 6.07995, -1.6364 ));
}

// Returns lunar illuminated fraction as an integer percentage (0–100).
// Known new moon: JD 2451549.5 (2000 Jan 6). Synodic period: 29.53058867 d.
function moonPhase( jd ) {
   var phase = ((jd - 2451549.5) % 29.53058867 + 29.53058867) % 29.53058867;
   return Math.round( (1 - Math.cos( 2 * Math.PI * phase / 29.53058867 )) / 2 * 100 );
}

// Returns Moon altitude above the horizon in degrees (negative = below).
// Simplified Meeus Ch. 47 ecliptic coordinates, accurate to ~1°.
function moonAltitude( jd, lat_deg, lon_deg ) {
   var d2r = Math.PI / 180;
   var D   = jd - 2451545.0;
   var Lp  = ((218.316 + 13.176396  * D) % 360 + 360) % 360;
   var M   = ((357.529 +  0.9856003 * D) % 360 + 360) % 360;
   var Mp  = ((134.963 + 13.064993  * D) % 360 + 360) % 360;
   var Dm  = ((297.850 + 12.190749  * D) % 360 + 360) % 360;
   var F   = (( 93.272 + 13.229350  * D) % 360 + 360) % 360;
   var lam = Lp
           + 6.289 * Math.sin( Mp      * d2r )
           + 1.274 * Math.sin( (2*Dm - Mp) * d2r )
           + 0.658 * Math.sin(  2*Dm   * d2r )
           + 0.214 * Math.sin(  2*Mp   * d2r )
           - 0.186 * Math.sin(  M      * d2r )
           - 0.114 * Math.sin(  2*F    * d2r );
   var bet = 5.128 * Math.sin(  F          * d2r )
           + 0.280 * Math.sin( (Mp + F)    * d2r )
           + 0.277 * Math.sin( (Mp - F)    * d2r )
           + 0.173 * Math.sin( (2*Dm - F)  * d2r )
           + 0.055 * Math.sin( (2*Dm - Mp + F) * d2r )
           - 0.046 * Math.sin( (2*Dm - Mp - F) * d2r );
   var eps = (23.439 - 0.0000004 * D) * d2r;
   var lam_r = lam * d2r;
   var bet_r = bet * d2r;
   var ra  = Math.atan2( Math.sin(lam_r) * Math.cos(eps) - Math.tan(bet_r) * Math.sin(eps),
                         Math.cos(lam_r) );
   ra = ((ra / d2r) % 360 + 360) % 360;
   var dec = Math.asin( Math.sin(bet_r) * Math.cos(eps)
                      + Math.cos(bet_r) * Math.sin(eps) * Math.sin(lam_r) );
   var T    = D / 36525.0;
   var GMST = 280.46061837 + 360.98564736629 * D + 0.000387933 * T * T - (T*T*T) / 38710000.0;
   GMST     = ((GMST % 360) + 360) % 360;
   var LST  = ((GMST + lon_deg) % 360 + 360) % 360;
   var H    = LST - ra;
   if ( H >  180 ) H -= 360;
   if ( H < -180 ) H += 360;
   var sinAlt = Math.sin( lat_deg * d2r ) * Math.sin( dec )
              + Math.cos( lat_deg * d2r ) * Math.cos( dec ) * Math.cos( H * d2r );
   return Math.asin( sinAlt ) / d2r;
}

// ============================================================
// Observer site coordinates
// ============================================================

// Reads observer latitude and longitude from FITS keywords.
// Tries several keyword names used by common capture software.
// Returns { lat, lon } in decimal degrees (North / East positive),
// with null for any value not found.
// Elevation is not attempted — it is not reliably present in Seestar FITS headers.
// Convention assumed: SITELONG is degrees East (positive = East), matching
// FITS WCS and ZWO/Seestar practice. Negate if your software uses West-positive.
function readSiteCoords( kws ) {
   function tryKw( names ) {
      for ( var i = 0; i < names.length; i++ ) {
         var v = findKeyword( kws, names[i] );
         if ( v !== null ) {
            var f = parseFloat( v );
            if ( !isNaN(f) ) return f;
         }
      }
      return null;
   }
   return {
      lat  : tryKw( ["SITELAT",  "OBSLAT",  "LAT-OBS",  "LATITUDE"  ] ),
      lon  : tryKw( ["SITELONG", "OBSLONG", "LONG-OBS", "LONGITUDE" ] ),
      elev : tryKw( ["SITEELEV", "OBSELEV", "ELEVATIO", "ALTITUDE"  ] ),
   };
}

// ============================================================
// Forbidden-process detector
// ============================================================

// Scans the FITS HISTORY keywords of an open ImageWindow for known
// processes that break PSF linearity. Returns an array of matched
// process names (empty if none found or if history is not recorded).
// Note: PixInsight only writes HISTORY keywords when "Add FITS keywords"
// is enabled and/or when the file is saved — in-session modifications
// made without a save may not be captured.
function detectForbiddenHistory( win ) {
   var FORBIDDEN = [
      "HistogramTransformation",
      "GHSStretch",
      "MaskedStretch",
      "CurveTransformation",
      "Deconvolution",
      "BlurXTerminator",
      "LocalHistogramEqualization",
      "ExponentialTransformation",
      "HDRMultiscaleTransform",
   ];
   var found = [];
   var kws = win.keywords;
   for ( var i = 0; i < kws.length; i++ ) {
      if ( kws[i].name !== "HISTORY" ) continue;
      var val = kws[i].value;
      for ( var j = 0; j < FORBIDDEN.length; j++ ) {
         if ( val.indexOf( FORBIDDEN[j] ) >= 0 && found.indexOf( FORBIDDEN[j] ) < 0 )
            found.push( FORBIDDEN[j] );
      }
   }
   return found;
}

// ============================================================
// Verification image
// ============================================================

// Creates a new ImageWindow showing an auto-stretched thumbnail of `win`
// with coloured circles marking the target, comp, and check stars.
// checkPix may be null if the check star PSF was rejected.
// Called after PSF fitting succeeds, before writing the report.
// Works on a private temporary copy — the original image is never modified.
// compEntries: array of {x, y, star:{label, magV}} from _allInFrame (ensemble comp stars).
function createVerificationImage( win, targetPix, compEntries, checkStar, checkPix, stretchMode ) {
   if ( stretchMode === undefined ) stretchMode = 1;
   var img  = win.mainView.image;
   var imgW = img.width;
   var imgH = img.height;

   // Bounding box around all located stars, plus padding.
   var xs = [ targetPix.x ];
   var ys = [ targetPix.y ];
   compEntries.forEach( function(e) { xs.push( e.x ); ys.push( e.y ); } );
   if ( checkPix ) { xs.push( checkPix.x ); ys.push( checkPix.y ); }

   var x0 = Math.max( 0,    Math.floor( Math.min.apply( null, xs ) ) - VERIFY_PADDING );
   var y0 = Math.max( 0,    Math.floor( Math.min.apply( null, ys ) ) - VERIFY_PADDING );
   var x1 = Math.min( imgW, Math.ceil(  Math.max.apply( null, xs ) ) + VERIFY_PADDING );
   var y1 = Math.min( imgH, Math.ceil(  Math.max.apply( null, ys ) ) + VERIFY_PADDING );

   var thumbBmp = null;
   var scale    = 1.0;
   var tempW    = null;

   try {
      // Create a private copy of the active image so the original is never touched.
      tempW = new ImageWindow( imgW, imgH, img.numberOfChannels,
                               win.bitsPerSample, win.isFloatSample,
                               img.isColor, "verify_tmp" );
      tempW.mainView.beginProcess( UndoFlag_NoSwapFile );
      tempW.mainView.image.assign( img );
      tempW.mainView.endProcess();

      // Crop to the region of interest.
      var cropP          = new Crop;
      cropP.leftMargin   = -x0;
      cropP.topMargin    = -y0;
      cropP.rightMargin  = -(imgW - x1);
      cropP.bottomMargin = -(imgH - y1);
      cropP.executeOn( tempW.mainView, false );

      var cropW = tempW.mainView.image.width;
      var cropH = tempW.mainView.image.height;

      // Scale down if larger than VERIFY_MAX_SIDE.
      if ( Math.max( cropW, cropH ) > VERIFY_MAX_SIDE ) {
         var factor = Math.ceil( Math.max( cropW, cropH ) / VERIFY_MAX_SIDE );
         var rs = new IntegerResample;
         rs.zoomFactor = -factor;
         rs.executeOn( tempW.mainView, false );
         scale = 1.0 / factor;
      }

      // Apply stretch via HistogramTransformation (Image.render() uses raw pixel
      // values, so the stretch must be baked into the temp copy).
      // stretchMode 0 = no stretch (linear), 1 = auto, 2 = boosted.
      var mv    = tempW.mainView;
      if ( stretchMode > 0 ) {
         var med   = mv.image.median();
         var sigma = mv.image.stdDev();
         var c0, mVal;
         if ( stretchMode === 2 ) {
            // Boosted: no shadow clip; set mVal = med so the sky background maps
            // directly to output 0.5 — roughly 3× more aggressive than auto.
            c0   = 0;
            mVal = ( isFinite(med) && med > 0.001 && med < 1 ) ? med : 0.02;
         } else {
            // Auto: standard PI STF formula — background at ~25% output.
            c0   = ( isFinite( sigma ) && sigma > 0 )
                     ? Math.range( med - 2.8 * sigma, 0.0, 1.0 ) : 0;
            var arg1 = med - c0;
            mVal = ( arg1 > 0 && arg1 < 1 ) ? Math.mtf( 0.25, arg1 ) : 0.25;
         }
         // H format: [shadows, midtones, highlights, r0, r1] — 5 rows required.
         var ht = new HistogramTransformation;
         ht.H = [ [ c0, mVal, 1, 0, 1 ],
                  [ c0, mVal, 1, 0, 1 ],
                  [ c0, mVal, 1, 0, 1 ],
                  [ c0, mVal, 1, 0, 1 ],  // gray/L channel — applies to single-channel images
                  [ 0,  0.5,  1, 0, 1 ] ];
         ht.executeOn( mv, false );
      }

      thumbBmp = mv.image.render();

   } catch ( e ) {
      console.warningln( "Verification image failed: " + String(e) );
   } finally {
      if ( tempW ) tempW.forceClose();
   }

   if ( !thumbBmp ) return null;

   // Draw annotation circles and labels on the bitmap.
   var g = new Graphics( thumbBmp );
   g.antialiasing     = true;
   g.textAntialiasing = true;

   var font = new Font( g.font );
   font.pixelSize = 13;
   g.font = font;

   var r = Math.max( 8, Math.round( VERIFY_CIRCLE_RADIUS * scale ) );

   function starAnnotation( pix, color, label ) {
      var sx = Math.round( ( pix.x - x0 ) * scale );
      var sy = Math.round( ( pix.y - y0 ) * scale );
      g.pen = new Pen( color, 2 );
      g.drawEllipse( sx - r, sy - r, sx + r, sy + r );
      g.pen = new Pen( 0xffffffff, 1 );
      g.drawText( sx + r + 5, sy + Math.round( font.pixelSize / 2 ), label );
   }

   starAnnotation( targetPix, 0xffff4444, TARGET.name );
   compEntries.forEach( function(e) {
      starAnnotation( { x: e.x, y: e.y }, 0xff44ff44,
         "C" + e.star.label + "  " + format( "%.3f", e.star.magV ) + " V" );
   });
   if ( checkPix && checkStar )
      starAnnotation( checkPix, 0xff44ffff,
         "K" + checkStar.label + "  " + format( "%.3f", checkStar.magV ) + " V" );

   g.end();

   return thumbBmp;
}

// ============================================================
// Main photometry dialog
// ============================================================

class PhotometryDialog extends Dialog {
   constructor() {
      super();

      this.windowTitle = TITLE;
      this.minWidth    = 860;

      var self = this;

      // ---- Internal state ----
      var _photDone      = false;
      var _discoveryDone = false;
      var _checkStar     = null;
      var _startJD       = NaN;
      var _endJD         = NaN;
      var _midMode       = 0;       // 0=(Start+End)/2  1=Start  2=Manual
      var _window        = ImageWindow.activeWindow;
      var _currentStep   = 0;
      var _csvPath       = Settings.read( SETTINGS_CSV, DataType_String ) || "";
      var _tcrb_mag      = NaN;
      var _merr          = NaN;
      var _instMag_T     = null;
      var _instMag_K     = null;
      var _checkGateWarn = false;
      var _reportText    = "";
      var _verifyBmp     = null;
      var _scaledBmp     = null;
      var _verifyStretch = 1;    // 0=none  1=auto  2=boosted
      var _verifyArgs    = null; // cached args for re-render on stretch change

      // ---- Ensemble state (set by runDiscovery / runPhotometry) ----
      var _allInFrame     = [];   // [{star, x, y, psf, qualityMsg, deltaMag, recommended, instMag}]
      var _checkEligible  = [];   // subset of _allInFrame eligible as check star
      var _ensembleEntries= [];   // selected _allInFrame entries used as comp ensemble
      var _instMag_Cs     = [];   // instrumental mag for each ensemble entry (parallel array)
      var _ensembleZP     = NaN;  // mean zero-point = mean(magV_i - instMag_i)
      var _targetPix      = null; // cached from discovery
      var _targetPSF      = null; // cached from discovery (green/TG)
      var _targetPSF_B    = null; // cached from discovery (blue/TB)
      var _tcrb_mag_B     = NaN;
      var _merr_B         = NaN;
      var _instMag_T_B    = null;
      var _instMag_Cs_B   = [];
      var _ensembleZP_B   = NaN;
      var _instMag_K_B    = null;

      // ---- Public result ----
      this.midJD = NaN;

      // ============================================================
      // Step management
      // ============================================================

      var _stepBtns = [];

      function isStepEnabled( idx ) {
         if ( idx <= 1 ) return true;                                   // Setup, Comp Stars
         if ( idx === 2 ) return _discoveryDone && _ensembleEntries.length > 0; // Photometry
         if ( idx === 3 ) return _photDone;                             // Mid-time
         if ( idx === 4 ) return _photDone;                             // Verification
         if ( idx === 5 ) return _photDone && !isNaN( self.midJD );     // Report
         return false;
      }

      function updateStepNav() {
         _stepBtns.forEach( function( ctrl ) { ctrl.repaint(); } );
         if ( _currentStep === 5 ) {
            self.nextBtn.text    = "Close";
            self.nextBtn.enabled = true;
         } else {
            self.nextBtn.text    = "Next ›";
            self.nextBtn.enabled = isStepEnabled( _currentStep + 1 );
         }
      }

      function activateStep( idx ) {
         if ( !isStepEnabled( idx ) ) return;
         _currentStep = idx;
         var panels = [ setupPanel, compStarsPanel, runPanel, midtimePanel, verifyPanel, reportPanel ];
         panels.forEach( function( p, i ) { p.visible = ( i === idx ); } );
         updateStepNav();
         if ( idx === 1 ) {
            try { runDiscovery(); }
            catch ( e ) {
               new MessageBox( (e && e.message) ? e.message : String(e),
                               TITLE, StdIcon.Warning, StdButton.Ok ).execute();
            }
         }
         if ( idx === 2 ) {
            try { runPhotometry(); }
            catch ( e ) {
               new MessageBox( (e && e.message) ? e.message : String(e),
                               TITLE, StdIcon.Warning, StdButton.Ok ).execute();
            }
         }
         if ( idx === 5 ) generateReport();
      }

      // ============================================================
      // Helpers
      // ============================================================

      function refreshMid() {
         var mid = NaN;
         if      ( _midMode === 0 ) mid = (!isNaN(_startJD) && !isNaN(_endJD))
                                          ? (_startJD + _endJD) / 2 : NaN;
         else if ( _midMode === 1 ) mid = _startJD;
         else                       mid = isoToJD( self.midEdit.text );
         self.midJD = mid;
         if ( isNaN(mid) ) {
            self.midJDLbl.text   = "—";
            self.midISOLbl.text  = "—";
            self.airmassLbl.text = "—";
            self.moonLbl.text    = "—";
         } else {
            self.midJDLbl.text  = format( "%.6f", mid );
            self.midISOLbl.text = jdToISO( mid ) + " UTC";
            var lat = parseCoord( self.latEdit.text, -90, 90 );
            var lon = parseCoord( self.lonEdit.text, -180, 360 );
            if ( isNaN(lat) || isNaN(lon) ) {
               self.airmassLbl.text = "— (lat/lon not set)";
            } else {
               try {
                  var am = computeAirmass( mid, lat, lon, TARGET.ra, TARGET.dec );
                  self.airmassLbl.text = format( "%.3f", am );
               } catch ( e ) {
                  self.airmassLbl.text = "below horizon";
               }
            }
            var mp = moonPhase( mid );
            if ( !isNaN(lat) && !isNaN(lon) ) {
               var mAlt = moonAltitude( mid, lat, lon );
               self.moonLbl.text = mp + "%, "
                  + format( "%.0f", Math.abs(mAlt) ) + "\xb0"
                  + (mAlt >= 0 ? " above horizon" : " below horizon");
            } else {
               self.moonLbl.text = mp + "%";
            }
         }
         checkWriteEnabled();
      }

      function applyStart( jd ) {
         _startJD = jd;
         self.startJDLbl.text      = isNaN(jd) ? "—" : format( "%.6f", jd );
         self.summaryStartLbl.text = isNaN(jd) ? "—" : jdToISO( jd ) + " UTC";
         refreshMid();
      }

      function applyEnd( jd ) {
         _endJD = jd;
         self.endJDLbl.text      = isNaN(jd) ? "—" : format( "%.6f", jd );
         self.summaryEndLbl.text = isNaN(jd) ? "—" : jdToISO( jd ) + " UTC";
         refreshMid();
      }

      function checkWriteEnabled() {
         updateStepNav();
      }

      function openSubDialog( caption ) {
         var fdlg = new OpenFileDialog;
         fdlg.caption = caption;
         fdlg.filters = [
            ["XISF / FITS files", "*.xisf *.fits *.fit *.fts"],
            ["XISF files",        "*.xisf"],
            ["FITS files",        "*.fits *.fit *.fts"],
            ["All files",         "*"]
         ];
         return fdlg.execute() ? fdlg.filePath : null;
      }

      function updateVerifyBitmap() {
         if ( !_verifyBmp ) { _scaledBmp = null; return; }
         var w = self.verifyCtrl.width;
         var h = self.verifyCtrl.height;
         if ( w < 4 || h < 4 ) return;
         var bw = _verifyBmp.width, bh = _verifyBmp.height;
         var sc = Math.min( w / bw, h / bh );
         _scaledBmp = _verifyBmp.scaled( sc );
      }

      function reRenderVerify() {
         if ( !_verifyArgs ) return;
         _verifyBmp = createVerificationImage(
            _verifyArgs.win, _verifyArgs.targetPix,
            _verifyArgs.compEntries,
            _verifyArgs.checkStar, _verifyArgs.checkPix,
            _verifyStretch
         );
         updateVerifyBitmap();
         self.verifyCtrl.repaint();
      }

      // Ghost labels — referenced by applyStart/applyEnd but not shown in wizard
      this.summaryStartLbl = new Label( this );
      this.summaryStartLbl.visible = false;
      this.summaryEndLbl   = new Label( this );
      this.summaryEndLbl.visible   = false;

      // ============================================================
      // Step 0 — Setup
      // ============================================================

      var setupPanel = new Control( this );
      setupPanel.visible = true;

      var titleLbl = new Label( setupPanel );
      titleLbl.useRichText = true;
      titleLbl.text = "<b>" + TITLE + " v" + VERSION + "   ·   Benno Schneider © 2026</b>";

      var precon1 = new Label( setupPanel );
      precon1.text = "✓  Required: linear (unstretched) stack; plate-solved (ImageSolver); debayered OSC (one-shot colour) RGB stack.";

      var precon2 = new Label( setupPanel );
      precon2.text = "✗  Incompatible (break PSF linearity): any stretch, deconvolution, BlurXTerminator.";

      var precon3 = new Label( setupPanel );
      precon3.text = "✓  Safe to apply: background extraction (ABE/DBE/GradientCorrection), SPCC.";

      var precon4 = new Label( setupPanel );
      precon4.text = "ℹ  Save your master stack to disk before running to enable full process-history detection.";

      var imageLblTag = new Label( setupPanel );
      imageLblTag.text          = "Active image:";
      imageLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      imageLblTag.setFixedWidth( 110 );

      this.imageLbl = new Label( setupPanel );
      this.imageLbl.useRichText = true;
      this.imageLbl.toolTip     = "The image window that will be measured. Must be a linear, " +
                                  "plate-solved OSC RGB master stack. Make it the active window " +
                                  "before running the script.";
      this.imageLbl.text = (_window && !_window.isNull)
         ? _window.mainView.id
         : "<font color='#cc2222'>(no active window)</font>";

      var imageRow = new HorizontalSizer;
      imageRow.spacing = 8;
      imageRow.add( imageLblTag );
      imageRow.add( this.imageLbl );
      imageRow.addStretch();

      var csvLblTag = new Label( setupPanel );
      csvLblTag.text          = "Comparison CSV:";
      csvLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      csvLblTag.setFixedWidth( 110 );

      this.csvEdit = new Edit( setupPanel );
      this.csvEdit.text    = _csvPath;
      this.csvEdit.toolTip = "Path to AAVSO VSP comparison-star CSV export";
      this.csvEdit.onTextUpdated = function() { _csvPath = self.csvEdit.text.trim(); };

      this.csvBrowseBtn = new PushButton( setupPanel );
      this.csvBrowseBtn.text    = "Browse...";
      this.csvBrowseBtn.toolTip = "Open a comparison-star CSV exported from AAVSO VSP";
      this.csvBrowseBtn.onClick = function() {
         var dlg = new OpenFileDialog;
         dlg.caption = "Select comparison-star CSV (AAVSO VSP export)";
         dlg.filters = [["CSV files", "*.csv"], ["All files", "*"]];
         if ( dlg.execute() ) {
            _csvPath = dlg.filePath;
            self.csvEdit.text = _csvPath;
            Settings.write( SETTINGS_CSV, DataType_String, _csvPath );
         }
      };

      var csvRow = new HorizontalSizer;
      csvRow.spacing = 8;
      csvRow.add( csvLblTag );
      csvRow.add( this.csvEdit, 100 );
      csvRow.add( this.csvBrowseBtn );

      var obscodeLblTag = new Label( setupPanel );
      obscodeLblTag.text          = "Observer code:";
      obscodeLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      obscodeLblTag.setFixedWidth( 110 );

      this.obscodeEdit = new Edit( setupPanel );
      this.obscodeEdit.text    = Settings.read( SETTINGS_OBSCODE, DataType_String ) || OBSCODE;
      this.obscodeEdit.setFixedWidth( 60 );
      this.obscodeEdit.toolTip = "Your AAVSO observer code — written into the report header (#OBSCODE)";
      this.obscodeEdit.onTextUpdated = function( txt ) {
         Settings.write( SETTINGS_OBSCODE, DataType_String, txt );
      };

      var obscodeRow = new HorizontalSizer;
      obscodeRow.spacing = 8;
      obscodeRow.add( obscodeLblTag      );
      obscodeRow.add( this.obscodeEdit   );
      obscodeRow.addStretch();

      var setupSizer = new VerticalSizer;
      setupSizer.spacing = 8;
      setupSizer.add( titleLbl );
      setupSizer.addSpacing( 4 );
      setupSizer.add( precon1  );
      setupSizer.add( precon2  );
      setupSizer.add( precon3  );
      setupSizer.add( precon4  );
      setupSizer.addSpacing( 8 );
      setupSizer.add( imageRow   );
      setupSizer.add( csvRow     );
      setupSizer.add( obscodeRow );
      setupSizer.addStretch();
      setupPanel.sizer = setupSizer;

      // ============================================================
      // Step 1 — Comp Stars
      // ============================================================

      var compStarsPanel = new Control( this );
      compStarsPanel.visible = false;

      var discoveryLbl = new Label( compStarsPanel );
      discoveryLbl.text = "Click 'Next ›' from Setup to run discovery.";

      this.compTreeBox = new TreeBox( compStarsPanel );
      this.compTreeBox.numberOfColumns  = 5;
      this.compTreeBox.rootDecoration   = false;
      this.compTreeBox.alternateRowColor = true;
      this.compTreeBox.setHeaderText( 0, "Comp" );
      this.compTreeBox.setHeaderText( 1, "Label" );
      this.compTreeBox.setHeaderText( 2, "V mag" );
      this.compTreeBox.setHeaderText( 3, "Δ mag" );
      this.compTreeBox.setHeaderText( 4, "Notes" );
      this.compTreeBox.setColumnWidth( 0, 40  );
      this.compTreeBox.setColumnWidth( 1, 55  );
      this.compTreeBox.setColumnWidth( 2, 60  );
      this.compTreeBox.setColumnWidth( 3, 60  );
      this.compTreeBox.setMinHeight( 160 );
      this.compTreeBox.toolTip =
         "Click any row to toggle it as a comparison star.\n" +
         "✓ = selected as comp.  — = not selected.\n" +
         "Pre-ticked stars are recommended based on magnitude proximity and PSF quality.";
      this.compTreeBox.onNodeClicked = function( node, col ) {
         node.isCompSelected = !node.isCompSelected;
         node.setText( 0, node.isCompSelected ? "✓" : "—" );
         _ensembleEntries = [];
         for ( var i = 0; i < self.compTreeBox.numberOfChildren; ++i ) {
            var n = self.compTreeBox.child( i );
            if ( n.isCompSelected && n._entry ) _ensembleEntries.push( n._entry );
         }
         updateCheckCombo();
         updateCompCount();
      };

      var checkLblTag2 = new Label( compStarsPanel );
      checkLblTag2.text          = "Check star:";
      checkLblTag2.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      checkLblTag2.setFixedWidth( 80 );

      this.checkCombo = new ComboBox( compStarsPanel );
      this.checkCombo.setMinWidth( 160 );
      this.checkCombo.toolTip = "Check star — measured independently; excluded from the comp ensemble";
      this.checkCombo.onItemSelected = function( idx ) {
         if ( idx >= 0 && idx < _checkEligible.length )
            _checkStar = _checkEligible[ idx ].star;
      };

      var checkRow2 = new HorizontalSizer;
      checkRow2.spacing = 8;
      checkRow2.add( checkLblTag2    );
      checkRow2.add( this.checkCombo );
      checkRow2.addStretch();

      var compCountLbl = new Label( compStarsPanel );
      compCountLbl.text = "";

      function updateCompCount() {
         var n = _ensembleEntries.length;
         compCountLbl.text = n === 0
            ? "No comp stars selected — select at least one."
            : n + " comp star" + (n === 1 ? "" : "s") + " selected.";
         updateStepNav();
      }

      function updateCheckCombo() {
         var selectedLabels = {};
         _ensembleEntries.forEach( function(e) { selectedLabels[ e.star.label ] = true; } );
         _checkEligible = _allInFrame.filter( function(e) {
            return !selectedLabels[ e.star.label ] && e.instMag !== null;
         });
         var prevLabel = _checkStar ? _checkStar.label : null;
         while ( self.checkCombo.numberOfItems > 0 ) self.checkCombo.removeItem( 0 );
         _checkEligible.forEach( function(e) {
            self.checkCombo.addItem( e.star.label + "  (" + format( "%.3f", e.star.magV ) + " V)" );
         });
         var keepIdx = prevLabel
            ? _checkEligible.findIndex( function(e) { return e.star.label === prevLabel; } ) : -1;
         var selIdx = keepIdx >= 0 ? keepIdx : 0;
         self.checkCombo.currentItem = selIdx;
         _checkStar = ( _checkEligible.length > 0 ) ? _checkEligible[ selIdx ].star : null;
      }

      var compStarsSizer = new VerticalSizer;
      compStarsSizer.spacing = 8;
      compStarsSizer.add( discoveryLbl );
      compStarsSizer.add( self.compTreeBox, 100 );
      compStarsSizer.add( checkRow2   );
      compStarsSizer.add( compCountLbl );
      compStarsSizer.addStretch();
      compStarsPanel.sizer = compStarsSizer;

      // ============================================================
      // Step 2 — Run Photometry
      // ============================================================

      var runPanel = new Control( this );
      runPanel.visible = false;

      this.compCheckLbl = new Label( runPanel );
      this.compCheckLbl.text = "—";
      this.compCheckLbl.toolTip = "Comp and check stars used for this run (from the CSV loaded in Setup)";

      this.warningLbl = new Label( runPanel );
      this.warningLbl.useRichText = true;
      this.warningLbl.visible     = false;

      this.linearityLbl = new Label( runPanel );
      this.linearityLbl.useRichText = true;
      this.linearityLbl.visible     = false;

      var magTag = new Label( runPanel );
      magTag.text          = "TG:";
      magTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      magTag.setFixedWidth( 80 );
      magTag.toolTip       = "TG = tri-colour green (OSC green channel). " +
                             "Not the same as Johnson V — TG runs ~0.1–0.3 mag brighter for red stars like T CrB.";

      this.magLbl = new Label( runPanel );
      this.magLbl.text    = "—";
      this.magLbl.toolTip = "Derived TG magnitude of " + TARGET.name + " from differential photometry " +
                            "against the selected comp stars (ensemble ZP). TG (tri-colour green) is not " +
                            "Johnson V — it runs ~0.1–0.3 mag brighter for red stars.";
      this.magLbl.setFixedWidth( 52 );

      var merrTag = new Label( runPanel );
      merrTag.text          = "MERR:";
      merrTag.textAlignment = TextAlignment.VertCenter;

      this.merrLbl = new Label( runPanel );
      this.merrLbl.text    = "—";
      this.merrLbl.toolTip = "Photometric magnitude error: target and comp PSF noise added in quadrature " +
                             "via matched-filter formula (Poisson + sky background).";

      var magRow = new HorizontalSizer;
      magRow.spacing = 8;
      magRow.add( magTag );
      magRow.add( this.magLbl );
      magRow.add( merrTag );
      magRow.add( this.merrLbl );
      magRow.addStretch();

      var tbMagTag = new Label( runPanel );
      tbMagTag.text          = "TB:";
      tbMagTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      tbMagTag.setFixedWidth( 80 );
      tbMagTag.toolTip       = "TB = tri-colour blue (OSC blue channel, calibrated against B-band comp star magnitudes).";

      this.tbMagLbl = new Label( runPanel );
      this.tbMagLbl.text    = "—";
      this.tbMagLbl.toolTip = "Derived TB magnitude of " + TARGET.name + " from the blue OSC channel. " +
                              "Calibrated against B-band magnitudes from the comparison CSV. " +
                              "Shown as '—' if no comp stars have B-band catalogue data.";
      this.tbMagLbl.setFixedWidth( 52 );

      var tbMerrTag = new Label( runPanel );
      tbMerrTag.text          = "MERR:";
      tbMerrTag.textAlignment = TextAlignment.VertCenter;

      this.tbMerrLbl = new Label( runPanel );
      this.tbMerrLbl.text    = "—";
      this.tbMerrLbl.toolTip = "Photometric error for TB magnitude.";

      var tbMagRow = new HorizontalSizer;
      tbMagRow.spacing = 8;
      tbMagRow.add( tbMagTag );
      tbMagRow.add( this.tbMagLbl );
      tbMagRow.add( tbMerrTag );
      tbMagRow.add( this.tbMerrLbl );
      tbMagRow.addStretch();

      var instTag = new Label( runPanel );
      instTag.text          = "TG PSF flux:";
      instTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      instTag.setFixedWidth( 80 );
      instTag.toolTip       = "Green-channel instrumental magnitudes = -2.5 × log₁₀(PSF flux). " +
                              "These are raw, instrument-dependent values. " +
                              "Differential photometry cancels all systematic offsets: " +
                              TARGET.name + " magnitude = comp catalog V + (inst T − inst C). " +
                              "TB blue-channel PSF values appear in the Process Console.";

      this.instLbl = new Label( runPanel );
      this.instLbl.text    = "—";
      this.instLbl.toolTip = instTag.toolTip;

      var instRow = new HorizontalSizer;
      instRow.spacing = 8;
      instRow.add( instTag );
      instRow.add( this.instLbl );
      instRow.addStretch();

      this.checkGateLbl = new Label( runPanel );
      this.checkGateLbl.useRichText = true;
      this.checkGateLbl.visible     = false;

      var runPanelSizer = new VerticalSizer;
      runPanelSizer.spacing = 8;
      runPanelSizer.add( this.warningLbl    );
      runPanelSizer.add( this.linearityLbl  );
      runPanelSizer.addSpacing( 8 );
      runPanelSizer.add( magRow             );
      runPanelSizer.add( tbMagRow           );
      runPanelSizer.add( instRow            );
      runPanelSizer.add( this.compCheckLbl  );
      runPanelSizer.add( this.checkGateLbl  );
      runPanelSizer.addStretch();
      runPanel.sizer = runPanelSizer;

      // ============================================================
      // Step 3 — Mid-time
      // All timing controls parented to midtimePanel so hiding the panel
      // hides all children (Qt parent-child visibility cascade).
      // Mid-time RadioButtons are parented to midtimePanel — this makes them
      // one exclusive group, separate from the format RadioButtons in step 4.
      // ============================================================

      var midtimePanel = new Control( this );
      midtimePanel.visible = false;

      this.firstSubBtn = new ToolButton( midtimePanel );
      this.firstSubBtn.icon = this.scaledResource( ":/icons/folder-open.png" );
      this.firstSubBtn.setScaledFixedSize( 20, 20 );
      this.firstSubBtn.toolTip =
         "Select the first (earliest) surviving subframe — sets Start = its DATE-OBS.";
      this.firstSubBtn.onClick = function() {
         var path = openSubDialog( "Select first (earliest) subframe" );
         if ( !path ) return;
         try {
            var kws     = readFileKeywords( path );
            var dateObs = findKeyword( kws, "DATE-OBS" );
            if ( !dateObs )
               throw new Error( "DATE-OBS keyword not found in:\n" + path );
            var startJD = isoToJD( dateObs );
            if ( isNaN(startJD) )
               throw new Error( "Cannot parse DATE-OBS: " + dateObs );
            self.startEdit.text = dateObs.replace( /\.\d+$/, '' );
            applyStart( startJD );
         } catch ( e ) {
            new MessageBox( String(e.message || e), TITLE, StdIcon.Warning, StdButton.Ok ).execute();
         }
      };

      this.lastSubBtn = new ToolButton( midtimePanel );
      this.lastSubBtn.icon = this.scaledResource( ":/icons/folder-open.png" );
      this.lastSubBtn.setScaledFixedSize( 20, 20 );
      this.lastSubBtn.toolTip =
         "Select the last (latest) surviving subframe — sets End = its DATE-OBS + EXPTIME.";
      this.lastSubBtn.onClick = function() {
         var path = openSubDialog( "Select last (latest) subframe" );
         if ( !path ) return;
         try {
            var kws     = readFileKeywords( path );
            var dateObs = findKeyword( kws, "DATE-OBS" );
            var expSec  = parseFloat( findKeyword( kws, "EXPTIME" ) || "NaN" );
            if ( !dateObs )
               throw new Error( "DATE-OBS keyword not found in:\n" + path );
            var lastStartJD = isoToJD( dateObs );
            if ( isNaN(lastStartJD) )
               throw new Error( "Cannot parse DATE-OBS: " + dateObs );
            if ( isNaN(expSec) || expSec <= 0 )
               throw new Error( "EXPTIME missing or zero — cannot compute End time.\nEnter End manually." );
            var endJD = lastStartJD + expSec / 86400.0;
            self.endEdit.text     = jdToISO( endJD );
            self.exptimeEdit.text = format( "%.1f", expSec );
            applyEnd( endJD );
         } catch ( e ) {
            new MessageBox( String(e.message || e), TITLE, StdIcon.Warning, StdButton.Ok ).execute();
         }
      };

      var startLblTag = new Label( midtimePanel );
      startLblTag.text          = "Start (UTC):";
      startLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      startLblTag.setFixedWidth( 90 );

      this.startEdit = new Edit( midtimePanel );
      this.startEdit.setFixedWidth( 200 );
      this.startEdit.toolTip = "Session start — YYYY-MM-DDTHH:MM:SS";
      this.startEdit.onTextUpdated   = function() { applyStart( isoToJD( self.startEdit.text ) ); };
      this.startEdit.onEditCompleted = function() { applyStart( isoToJD( self.startEdit.text ) ); };

      var startJDTag = new Label( midtimePanel );
      startJDTag.text = "JD:";

      this.startJDLbl = new Label( midtimePanel );
      this.startJDLbl.text    = "—";
      this.startJDLbl.toolTip = "Julian Day of the session start time (read-only)";
      this.startJDLbl.setFixedWidth( 130 );

      var startRow = new HorizontalSizer;
      startRow.spacing = 8;
      startRow.add( startLblTag );
      startRow.add( this.startEdit );
      startRow.add( this.firstSubBtn );
      startRow.add( startJDTag );
      startRow.add( this.startJDLbl );
      startRow.addStretch();

      var endLblTag = new Label( midtimePanel );
      endLblTag.text          = "End (UTC):";
      endLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      endLblTag.setFixedWidth( 90 );

      this.endEdit = new Edit( midtimePanel );
      this.endEdit.setFixedWidth( 200 );
      this.endEdit.toolTip = "Session end — YYYY-MM-DDTHH:MM:SS\n(last sub DATE-OBS + EXPTIME)";
      this.endEdit.onTextUpdated   = function() { applyEnd( isoToJD( self.endEdit.text ) ); };
      this.endEdit.onEditCompleted = function() { applyEnd( isoToJD( self.endEdit.text ) ); };

      var endJDTag = new Label( midtimePanel );
      endJDTag.text = "JD:";

      this.endJDLbl = new Label( midtimePanel );
      this.endJDLbl.text    = "—";
      this.endJDLbl.toolTip = "Julian Day of the session end time (read-only)";
      this.endJDLbl.setFixedWidth( 130 );

      var endRow = new HorizontalSizer;
      endRow.spacing = 8;
      endRow.add( endLblTag );
      endRow.add( this.endEdit );
      endRow.add( this.lastSubBtn );
      endRow.add( endJDTag );
      endRow.add( this.endJDLbl );
      endRow.addStretch();

      var framesTag = new Label( midtimePanel );
      framesTag.text          = "Frames:";
      framesTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      framesTag.setFixedWidth( 90 );

      this.framesEdit = new Edit( midtimePanel );
      this.framesEdit.setFixedWidth( 60 );
      this.framesEdit.toolTip = "Number of integrated subframes (from PixInsight processing history)";

      var exptimeTag = new Label( midtimePanel );
      exptimeTag.text          = "Exp/sub:";
      exptimeTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;

      this.exptimeEdit = new Edit( midtimePanel );
      this.exptimeEdit.setFixedWidth( 80 );
      this.exptimeEdit.toolTip = "Exposure time per subframe in seconds (from last-sub EXPTIME)";

      var exptimeRow = new HorizontalSizer;
      exptimeRow.spacing = 8;
      exptimeRow.add( framesTag );
      exptimeRow.add( this.framesEdit );
      exptimeRow.add( exptimeTag );
      exptimeRow.add( this.exptimeEdit );
      exptimeRow.addStretch();

      var midLblTag = new Label( midtimePanel );
      midLblTag.text          = "Mid-exposure:";
      midLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      midLblTag.setFixedWidth( 90 );

      this.rbMidpoint = new RadioButton( midtimePanel );
      this.rbMidpoint.text    = "= (S+E)/2";
      this.rbMidpoint.checked = true;
      this.rbMidpoint.toolTip = "Recommended: arithmetic midpoint of the session span";
      this.rbMidpoint.onCheck = function( chk ) {
         if ( chk ) { _midMode = 0; self.midEdit.enabled = false; refreshMid(); }
      };

      this.rbStart = new RadioButton( midtimePanel );
      this.rbStart.text    = "= Start";
      this.rbStart.checked = false;
      this.rbStart.toolTip = "Use session start as mid-exposure (single-sub sessions)";
      this.rbStart.onCheck = function( chk ) {
         if ( chk ) { _midMode = 1; self.midEdit.enabled = false; refreshMid(); }
      };

      this.rbManual = new RadioButton( midtimePanel );
      this.rbManual.text    = "Manual:";
      this.rbManual.checked = false;
      this.rbManual.toolTip = "Enter mid-exposure time directly";
      this.rbManual.onCheck = function( chk ) {
         if ( chk ) { _midMode = 2; self.midEdit.enabled = true; refreshMid(); }
      };

      this.midEdit = new Edit( midtimePanel );
      this.midEdit.setFixedWidth( 160 );
      this.midEdit.enabled = false;
      this.midEdit.toolTip = "Manual mid-exposure — YYYY-MM-DDTHH:MM:SS";
      this.midEdit.onTextUpdated   = function() { if ( _midMode === 2 ) refreshMid(); };
      this.midEdit.onEditCompleted = function() { if ( _midMode === 2 ) refreshMid(); };

      var midModeRow = new HorizontalSizer;
      midModeRow.spacing = 8;
      midModeRow.add( midLblTag );
      midModeRow.add( this.rbMidpoint );
      midModeRow.add( this.rbStart    );
      midModeRow.add( this.rbManual   );
      midModeRow.add( this.midEdit    );
      midModeRow.addStretch();

      var midJDTag = new Label( midtimePanel );
      midJDTag.text          = "Mid JD:";
      midJDTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      midJDTag.setFixedWidth( 90 );

      this.midJDLbl = new Label( midtimePanel );
      this.midJDLbl.text    = "—";
      this.midJDLbl.toolTip = "Mid-exposure Julian Day — this value is written to the AAVSO DATE field";
      this.midJDLbl.setFixedWidth( 130 );

      var midJDRow = new HorizontalSizer;
      midJDRow.spacing = 8;
      midJDRow.add( midJDTag );
      midJDRow.add( this.midJDLbl );
      midJDRow.addStretch();

      var midISOTag = new Label( midtimePanel );
      midISOTag.text          = "Mid UTC:";
      midISOTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      midISOTag.setFixedWidth( 90 );

      this.midISOLbl = new Label( midtimePanel );
      this.midISOLbl.text    = "—";
      this.midISOLbl.toolTip = "Mid-exposure time in UTC — human-readable equivalent of Mid JD";

      var midISORow = new HorizontalSizer;
      midISORow.spacing = 8;
      midISORow.add( midISOTag );
      midISORow.add( this.midISOLbl );
      midISORow.addStretch();

      var latTag = new Label( midtimePanel );
      latTag.text          = "Lat:";
      latTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      latTag.setFixedWidth( 30 );

      this.latEdit = new Edit( midtimePanel );
      this.latEdit.setFixedWidth( 80 );
      this.latEdit.toolTip = "Observer latitude in decimal degrees (North positive)";
      this.latEdit.onTextUpdated = function() { refreshMid(); };

      var latUnit = new Label( midtimePanel );
      latUnit.text = "\xb0";

      var lonTag = new Label( midtimePanel );
      lonTag.text          = "Lon:";
      lonTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      lonTag.setFixedWidth( 30 );

      this.lonEdit = new Edit( midtimePanel );
      this.lonEdit.setFixedWidth( 80 );
      this.lonEdit.toolTip = "Observer longitude in decimal degrees (East positive)";
      this.lonEdit.onTextUpdated = function() { refreshMid(); };

      var lonUnit = new Label( midtimePanel );
      lonUnit.text = "\xb0";

      var elevTag = new Label( midtimePanel );
      elevTag.text          = "Elev:";
      elevTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      elevTag.setFixedWidth( 38 );

      this.elevEdit = new Edit( midtimePanel );
      this.elevEdit.setFixedWidth( 55 );
      this.elevEdit.toolTip = "Observer elevation in metres (informational; not used in airmass formula)";

      var elevUnit = new Label( midtimePanel );
      elevUnit.text = "m";

      var siteRow = new HorizontalSizer;
      siteRow.spacing = 6;
      siteRow.add( latTag       );
      siteRow.add( this.latEdit );
      siteRow.add( latUnit      );
      siteRow.addSpacing( 12   );
      siteRow.add( lonTag       );
      siteRow.add( this.lonEdit );
      siteRow.add( lonUnit      );
      siteRow.addSpacing( 12   );
      siteRow.add( elevTag       );
      siteRow.add( this.elevEdit );
      siteRow.add( elevUnit      );
      siteRow.addStretch();

      var airmassTag = new Label( midtimePanel );
      airmassTag.text          = "Airmass:";
      airmassTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      airmassTag.setFixedWidth( 90 );

      this.airmassLbl = new Label( midtimePanel );
      this.airmassLbl.text    = "—";
      this.airmassLbl.toolTip = "Airmass at mid-exposure (Kasten & Young 1989 formula). " +
                                "Computed from mid-JD, observer lat/lon, and target J2000 position. " +
                                "Shows 'na' if lat or lon is blank or out of range.";

      var airmassRow = new HorizontalSizer;
      airmassRow.spacing = 8;
      airmassRow.add( airmassTag );
      airmassRow.add( this.airmassLbl );
      airmassRow.addStretch();

      var moonTag = new Label( midtimePanel );
      moonTag.text          = "Moon:";
      moonTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      moonTag.setFixedWidth( 90 );

      this.moonLbl = new Label( midtimePanel );
      this.moonLbl.text    = "—";
      this.moonLbl.toolTip = "Lunar illuminated fraction and altitude above/below horizon at mid-exposure time";

      var moonRow = new HorizontalSizer;
      moonRow.spacing = 8;
      moonRow.add( moonTag );
      moonRow.add( this.moonLbl );
      moonRow.addStretch();

      var midtimeSizer = new VerticalSizer;
      midtimeSizer.spacing = 8;
      midtimeSizer.add( startRow   );
      midtimeSizer.add( endRow     );
      midtimeSizer.add( exptimeRow );
      midtimeSizer.add( midModeRow );
      midtimeSizer.add( midJDRow   );
      midtimeSizer.add( midISORow  );
      midtimeSizer.add( siteRow    );
      midtimeSizer.add( airmassRow );
      midtimeSizer.add( moonRow    );
      midtimeSizer.addStretch();
      midtimePanel.sizer = midtimeSizer;

      // ============================================================
      // Step 4 — Verification image
      // ============================================================

      var verifyPanel = new Control( this );
      verifyPanel.visible = false;

      this.verifyCtrl = new Control( verifyPanel );
      this.verifyCtrl.setMinSize( 200, 200 );
      this.verifyCtrl.toolTip =
         "Annotated thumbnail — red: T CrB, green: comp, cyan: check. " +
         "Resize the dialog to scale the image.";
      this.verifyCtrl.onPaint = function( x0, y0, x1, y1 ) {
         var g = new Graphics( this );
         g.fillRect( 0, 0, this.width, this.height, new Brush( 0xff1a1a1a ) );
         if ( _scaledBmp ) {
            var dx = Math.round( (this.width  - _scaledBmp.width  ) / 2 );
            var dy = Math.round( (this.height - _scaledBmp.height ) / 2 );
            g.drawBitmap( dx, dy, _scaledBmp );
         } else {
            g.pen = new Pen( 0xff555555, 1 );
            g.drawText( 20, Math.round( this.height / 2 ),
                        "Run Photometry to see verification image" );
         }
         g.end();
      };
      this.verifyCtrl.onResize = function( ww, hh ) {
         if ( _verifyBmp && ww > 3 && hh > 3 ) {
            var bw = _verifyBmp.width, bh = _verifyBmp.height;
            var sc = Math.min( ww / bw, hh / bh );
            _scaledBmp = _verifyBmp.scaled( sc );
         }
         this.repaint();
      };

      // Stretch controls — separate Control parent for exclusive RadioButton group
      var stretchGrp = new Control( verifyPanel );

      var rbNoStretch = new RadioButton( stretchGrp );
      rbNoStretch.text    = "No stretch";
      rbNoStretch.checked = false;
      rbNoStretch.toolTip = "Show linear (unstretched) pixel values";
      rbNoStretch.onCheck = function( chk ) {
         if ( chk ) { _verifyStretch = 0; reRenderVerify(); }
      };

      var rbAutoStretch = new RadioButton( stretchGrp );
      rbAutoStretch.text    = "Auto stretch";
      rbAutoStretch.checked = true;
      rbAutoStretch.toolTip = "Standard auto-stretch: shadow clip at median - 2.8 sigma";
      rbAutoStretch.onCheck = function( chk ) {
         if ( chk ) { _verifyStretch = 1; reRenderVerify(); }
      };

      var rbBoosted = new RadioButton( stretchGrp );
      rbBoosted.text    = "Boosted stretch";
      rbBoosted.checked = false;
      rbBoosted.toolTip = "Aggressive stretch: tighter shadow clip, lower midtone — reveals faint stars";
      rbBoosted.onCheck = function( chk ) {
         if ( chk ) { _verifyStretch = 2; reRenderVerify(); }
      };

      var stretchRow = new HorizontalSizer;
      stretchRow.spacing = 16;
      stretchRow.add( rbNoStretch   );
      stretchRow.add( rbAutoStretch );
      stretchRow.add( rbBoosted     );
      stretchRow.addStretch();
      stretchGrp.sizer = stretchRow;

      var verifyPanelSizer = new VerticalSizer;
      verifyPanelSizer.spacing = 6;
      verifyPanelSizer.add( self.verifyCtrl, 100 );
      verifyPanelSizer.add( stretchGrp );
      verifyPanel.sizer = verifyPanelSizer;

      // ============================================================
      // Step 5 — Report
      // Format RadioButtons parented to fmtGrp (child of reportPanel),
      // so they form a separate exclusive group from the mid-time radios.
      // ============================================================

      var reportPanel = new Control( this );
      reportPanel.visible = false;

      var fmtLblTag = new Label( reportPanel );
      fmtLblTag.text          = "Format:";
      fmtLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      fmtLblTag.setFixedWidth( 90 );

      var fmtGrp = new Control( reportPanel );

      this.rbHuman = new RadioButton( fmtGrp );
      this.rbHuman.text    = "Human readable";
      this.rbHuman.checked = true;
      this.rbHuman.toolTip = "Formatted text summary — easy to read and archive";
      this.rbHuman.onCheck = function( chk ) {
         if ( chk && _reportText !== "" ) generateReport();
      };

      this.rbAavso = new RadioButton( fmtGrp );
      this.rbAavso.text    = "AAVSO Extended Format";
      this.rbAavso.checked = false;
      this.rbAavso.toolTip = "CSV format for direct submission to AAVSO WebObs";
      this.rbAavso.onCheck = function( chk ) {
         if ( chk && _reportText !== "" ) generateReport();
      };

      var fmtGrpSizer = new HorizontalSizer;
      fmtGrpSizer.spacing = 16;
      fmtGrpSizer.add( this.rbHuman );
      fmtGrpSizer.add( this.rbAavso );
      fmtGrpSizer.addStretch();
      fmtGrp.sizer = fmtGrpSizer;

      var fmtRow = new HorizontalSizer;
      fmtRow.spacing = 8;
      fmtRow.add( fmtLblTag );
      fmtRow.add( fmtGrp    );
      fmtRow.addStretch();

      this.reportBox = new TextBox( reportPanel );
      this.reportBox.readOnly = true;
      this.reportBox.setMinHeight( 80 );
      this.reportBox.toolTip = "Generated report — review before exporting";

      this.outBrowseBtn = new PushButton( reportPanel );
      this.outBrowseBtn.text    = "Export...";
      this.outBrowseBtn.toolTip = "Choose a file and write the report";
      this.outBrowseBtn.onClick = function() {
         if ( _reportText === "" ) {
            new MessageBox( "Create a report first.", TITLE, StdIcon.Warning, StdButton.Ok ).execute();
            return;
         }
         var saveDlg = new SaveFileDialog;
         saveDlg.caption         = "Export Report";
         saveDlg.overwritePrompt = true;
         saveDlg.filters = [
            ["Text file", "*.txt"],
            ["CSV file",  "*.csv"],
         ];
         var _now    = new Date;
         var dateStr = !isNaN(self.midJD)
            ? jdToISO( self.midJD ).substring( 0, 10 )
            : format( "%04d-%02d-%02d", _now.getFullYear(), _now.getMonth() + 1, _now.getDate() );
         var suggestedName = "tcrb_photometry_" + dateStr;
         var lastDir = Settings.read( SETTINGS_LAST_DIR, DataType_String )
            || ( (_window && !_window.isNull && _window.filePath)
                 ? File.extractDirectory( _window.filePath )
                 : File.systemTempDirectory );
         saveDlg.initialPath = lastDir + "/" + suggestedName;
         if ( saveDlg.execute() ) {
            var outPath = saveDlg.filePath;
            var ext = File.extractExtension( outPath ).toLowerCase();
            if ( ext !== ".txt" && ext !== ".csv" && ext !== ".tsv" ) {
               outPath += ".txt";
               if ( File.exists( outPath ) ) {
                  var answer = new MessageBox(
                     outPath + " already exists. Overwrite?",
                     TITLE, StdIcon.Warning, StdButton.Yes, StdButton.No
                  ).execute();
                  if ( answer !== StdButton.Yes )
                     return;
               }
            }
            File.writeTextFile( outPath, _reportText );
            Settings.write( SETTINGS_LAST_DIR, DataType_String,
                            File.extractDirectory( outPath ) );
            console.writeln( SEP );
            console.writeln( "Report exported to:\n  " + outPath );
            console.writeln( SEP );
         }
      };

      var outRow = new HorizontalSizer;
      outRow.addStretch();
      outRow.add( this.outBrowseBtn );
      outRow.addStretch();

      var reportSizer = new VerticalSizer;
      reportSizer.spacing = 8;
      reportSizer.add( fmtRow          );
      reportSizer.add( this.reportBox, 100 );
      reportSizer.add( outRow          );
      reportPanel.sizer = reportSizer;

      // ============================================================
      // Step navigator (left column PushButtons)
      // ============================================================

      var STEP_NAMES = [
         "1   Setup",
         "2   Comp Stars",
         "3   Photometry",
         "4   Mid-time",
         "5   Verification",
         "6   Report"
      ];

      STEP_NAMES.forEach( function( name, idx ) {
         var ctrl = new Control( self );
         ctrl.setMinSize( 110, 18 );
         ctrl.onPaint = function( x0, y0, x1, y1 ) {
            var g = new Graphics( this );
            var isCurrent = ( idx === _currentStep );
            var enabled   = isStepEnabled( idx );
            var f = new Font( g.font );
            f.bold      = isCurrent;
            f.pixelSize = 11;
            g.font = f;
            g.pen = new Pen( !enabled   ? 0xff999999
                           : isCurrent  ? 0xff000000
                                        : 0xff303030 );
            var ty = Math.round( ( this.height + f.ascent - f.descent ) / 2 );
            g.drawText( 6, ty, name );
            g.end();
         };
         ctrl.onMousePress = function( x, y, button, buttons, modifiers ) {
            activateStep( idx );
         };
         _stepBtns.push( ctrl );
      } );

      // ============================================================
      // Help / Close buttons
      // ============================================================

      this.helpBtn = new ToolButton( this );
      this.helpBtn.icon    = this.scaledResource( ":/process-interface/browse-documentation.png" );
      this.helpBtn.setScaledFixedSize( 20, 20 );
      this.helpBtn.flat    = true;
      this.helpBtn.toolTip = "Open script documentation";
      this.helpBtn.onClick = function() {
         var docPath = CoreApplication.docDirPath + "/scripts/Photometry/Photometry.html";
         if ( File.exists( docPath ) )
            Dialog.openBrowser( "file://" + docPath, TITLE );
         else
            new MessageBox(
               "<p><b>AAVSO Photometry v" + VERSION + "</b></p>" +
               "<p>Documentation not found in the PixInsight doc tree.</p>" +
               "<p>Install <tt>docs/Photometry.html</tt> into<br/>" +
               "<tt>&lt;PI&gt;/doc/scripts/Photometry/</tt><br/>" +
               "or visit the online guide:</p>" +
               "<p><a href='https://github.com/beschne/pi-aavso-photometry'>" +
               "github.com/beschne/pi-aavso-photometry</a></p>",
               TITLE, StdIcon.Information, StdButton.Ok
            ).execute();
      };

      var btnRow = new HorizontalSizer;
      btnRow.add( this.helpBtn );
      btnRow.addStretch();

      // ============================================================
      // Vertical separator helper
      // ============================================================

      function vSep() {
         var s = new Control( self );
         s.setFixedWidth( 1 );
         s.onPaint = function( x0, y0, x1, y1 ) {
            var g = new Graphics( this );
            g.pen = new Pen( 0xff505050, 1 );
            g.drawLine( 0, 0, 0, this.height );
            g.end();
         };
         return s;
      }

      // ============================================================
      // Left column — step buttons + help/close at bottom
      // ============================================================

      var leftCol = new VerticalSizer;
      leftCol.spacing = 0;
      _stepBtns.forEach( function( btn ) { leftCol.add( btn ); } );
      leftCol.addStretch();
      leftCol.add( btnRow );

      // ============================================================
      // Next / Close button (bottom-right of right column)
      // ============================================================

      this.nextBtn = new PushButton( this );
      this.nextBtn.onClick = function() {
         if ( _currentStep === 5 ) self.cancel();
         else activateStep( _currentStep + 1 );
      };

      var nextRow = new HorizontalSizer;
      nextRow.addStretch();
      nextRow.add( this.nextBtn );

      // ============================================================
      // Right column — one panel visible at a time
      // ============================================================

      var rightCol = new VerticalSizer;
      rightCol.spacing = 0;
      rightCol.add( setupPanel,      100 );
      rightCol.add( compStarsPanel,  100 );
      rightCol.add( runPanel,        100 );
      rightCol.add( midtimePanel,    100 );
      rightCol.add( verifyPanel,     100 );
      rightCol.add( reportPanel,     100 );
      rightCol.addSpacing( 8 );
      rightCol.add( nextRow );

      // ============================================================
      // Main sizer
      // ============================================================

      updateStepNav();   // bold step 0; grey steps 3-4

      var contentRow = new HorizontalSizer;
      contentRow.spacing = 12;
      contentRow.add( leftCol        );
      contentRow.add( vSep()         );
      contentRow.add( rightCol, 100  );

      this.sizer = new VerticalSizer;
      this.sizer.margin  = 12;
      this.sizer.spacing = 8;
      this.sizer.add( contentRow, 100 );

      // ============================================================
      // Discovery — PSF-fits all in-frame V-band stars + target;
      // populates _allInFrame, _targetPix, _targetPSF, TreeBox.
      // Runs automatically on entering the Comp Stars step.
      // ============================================================

      function runDiscovery() {
         _discoveryDone   = false;
         _photDone        = false;
         _allInFrame      = [];
         _ensembleEntries = [];
         _instMag_Cs      = [];
         _checkEligible   = [];
         _targetPix       = null;
         _targetPSF       = null;
         _targetPSF_B     = null;

         self.compTreeBox.clear();
         discoveryLbl.text = "Running discovery…";
         updateCompCount();
         updateStepNav();

         _window = ImageWindow.activeWindow;
         if ( !_window || _window.isNull )
            throw new Error( "No active image window. Open a plate-solved OSC stack first." );

         if ( !_csvPath || !File.exists( _csvPath ) )
            throw new Error( "Comparison CSV not found — use Browse in Setup to select it." );

         console.writeln( SEP );
         console.writeln( TITLE + " v" + VERSION + " — Discovery" );
         console.writeln( SEP );

         // Astrometry
         var metadata = loadAstrometry( _window );
         var image    = _window.mainView.image;
         self.imageLbl.text = _window.mainView.id;

         // Project target
         _targetPix = celestialToPixel( metadata, TARGET.ra, TARGET.dec );
         if ( !_targetPix || _targetPix.x < 0 || _targetPix.y < 0 ||
              _targetPix.x >= image.width || _targetPix.y >= image.height )
            throw new Error( TARGET.name + " is outside the image frame." );

         // Load comparison stars and project in-frame ones
         var allStars   = loadComparisonStars( _csvPath );
         var nonBlended = allStars.filter( function(s) { return !s.blended; } );
         allStars.filter( function(s) { return s.blended; } ).forEach( function(s) {
            console.warningln( "Excluded (blended): " + s.label + " (" + s.auid + ") — " + s.comments );
         });

         var inFrame = [];
         nonBlended.forEach( function(s) {
            var pix = celestialToPixel( metadata, s.ra, s.dec );
            if ( pix && pix.x >= 0 && pix.y >= 0 &&
                 pix.x < image.width && pix.y < image.height )
               inFrame.push( { star: s, x: pix.x, y: pix.y } );
         });

         console.writeln( "V-band stars in frame: " + inFrame.length +
                          " of " + nonBlended.length + " (non-blended)" );
         if ( inFrame.length === 0 )
            throw new Error( "No non-blended V-band comparison stars in frame." );

         // PSF measurement — target + all in-frame candidates in one pass
         var psfInput = [ { label: TARGET.name, x: _targetPix.x, y: _targetPix.y } ];
         inFrame.forEach( function(e) {
            psfInput.push( { label: e.star.label, x: e.x, y: e.y } );
         });
         var psfFits   = fitPSF( _window, psfInput );      // green channel (TG)
         var psfFits_B = fitPSF( _window, psfInput, 2 );  // blue channel (TB)

         _targetPSF   = psfFits[   TARGET.name ];
         _targetPSF_B = psfFits_B[ TARGET.name ];
         var targetReject = checkPSFQuality( _targetPSF, _targetPix.x, _targetPix.y );
         if ( targetReject )
            throw new Error( TARGET.name + " PSF rejected: " + targetReject );
         var targetRejectB = checkPSFQuality( _targetPSF_B, _targetPix.x, _targetPix.y );
         if ( targetRejectB ) {
            console.warningln( TARGET.name + " blue-channel PSF rejected: " + targetRejectB +
                               " — TB will not be computed." );
            _targetPSF_B = null;
         }

         function psfLine( psf ) {
            if ( !psf ) return "fit failed";
            return format( "A=%.4f B=%.4f sx=%.2f sy=%.2f MAD=%.5f  centre(%.1f,%.1f)",
                           psf.A, psf.B, psf.sx, psf.sy, psf.mad, psf.cx, psf.cy );
         }
         console.writeln( "PSF — " + TARGET.name + ": " + psfLine( _targetPSF ) );

         // Build _allInFrame
         inFrame.forEach( function(e) {
            var psf     = psfFits[   e.star.label ];
            var psfB    = psfFits_B[ e.star.label ];
            var qMsg    = checkPSFQuality( psf,  e.x, e.y );
            var qMsgB   = checkPSFQuality( psfB, e.x, e.y );
            var instMag  = ( !qMsg  && psf  ) ? psfInstrumentalMag( psf  ) : null;
            var instMagB = ( !qMsgB && psfB ) ? psfInstrumentalMag( psfB ) : null;
            var delta   = Math.abs( e.star.magV - TARGET.magQuiescence );
            var notes;
            if      ( qMsg )                        notes = qMsg;
            else if ( instMag === null )            notes = "flux zero";
            else if ( delta > ENSEMBLE_MAX_DELTA_MAG )
                                                    notes = format( "%.1f", delta ) + " mag from target";
            else                                    notes = "OK";
            var recommended = ( !qMsg && instMag !== null && delta <= ENSEMBLE_MAX_DELTA_MAG );
            _allInFrame.push({
               star       : e.star,
               x          : e.x,
               y          : e.y,
               psf        : psf,
               psfB       : psfB,
               instMag    : instMag,
               instMagB   : instMagB,
               qualityMsg : qMsg || null,
               deltaMag   : delta,
               recommended: recommended,
               notes      : notes
            });
            console.writeln( "  " + e.star.label + " (" + format("%.3f",e.star.magV) + " V)" +
                             "  " + psfLine(psf) + "  -> " + notes );
         });

         // Sort: recommended first, then by proximity to target mag
         _allInFrame.sort( function(a,b) {
            if ( a.recommended !== b.recommended ) return a.recommended ? -1 : 1;
            return a.deltaMag - b.deltaMag;
         });

         // Default selection: top recommended stars, capped at ENSEMBLE_DEFAULT_MAX_N
         var recommended = _allInFrame.filter( function(e) { return e.recommended; } );
         var defSelected = recommended.slice( 0, ENSEMBLE_DEFAULT_MAX_N );
         var selectedLabels = {};
         defSelected.forEach( function(e) { selectedLabels[ e.star.label ] = true; } );
         _ensembleEntries = defSelected.slice();

         // Populate TreeBox
         self.compTreeBox.clear();
         _allInFrame.forEach( function(e) {
            var node = new TreeBoxNode( self.compTreeBox );
            node.isCompSelected = !!selectedLabels[ e.star.label ];
            node._entry = e;
            node.setText( 0, node.isCompSelected ? "✓" : "—" );
            node.setText( 1, e.star.label );
            node.setText( 2, format( "%.3f", e.star.magV ) );
            node.setText( 3, format( "+%.2f", e.deltaMag ) );
            node.setText( 4, e.notes );
         });

         updateCheckCombo();
         updateCompCount();

         discoveryLbl.text = inFrame.length + " V-band stars in frame.  " +
            _ensembleEntries.length + " pre-selected as comp.  " +
            "Click rows to toggle.";

         _discoveryDone = true;
         updateStepNav();
      }

      // ============================================================
      // Photometry — uses cached PSF from discovery; ensemble math.
      // Runs automatically on entering the Photometry step.
      // ============================================================

      function runPhotometry() {
         _photDone        = false;
         _instMag_T       = null;
         _instMag_Cs      = [];
         _instMag_K       = null;
         _ensembleZP      = NaN;
         _checkGateWarn   = false;
         _tcrb_mag_B      = NaN;
         _merr_B          = NaN;
         _instMag_T_B     = null;
         _instMag_Cs_B    = [];
         _ensembleZP_B    = NaN;
         _instMag_K_B     = null;
         self.magLbl.text           = "—";
         self.merrLbl.text          = "—";
         self.tbMagLbl.text         = "—";
         self.tbMerrLbl.text        = "—";
         self.instLbl.text          = "—";
         self.compCheckLbl.text     = "—";
         self.checkGateLbl.visible  = false;
         checkWriteEnabled();

         if ( !_discoveryDone || _targetPSF === null )
            throw new Error( "Run discovery first (go back to the Comp Stars step)." );
         if ( _ensembleEntries.length === 0 )
            throw new Error( "No comparison stars selected. Tick at least one in the Comp Stars step." );

         // Check FITS HISTORY keywords for forbidden processes
         var forbidden = detectForbiddenHistory( _window );
         if ( forbidden.length > 0 ) {
            self.warningLbl.text =
               "<b><font color='#cc2222'>⚠  Forbidden process in FITS history: " +
               forbidden.join( ", " ) +
               " — image may not be linear. Results are unreliable.</font></b>";
            self.warningLbl.visible = true;
         } else {
            self.warningLbl.visible = false;
         }

         // Heuristic linearity checks
         var img = _window.mainView.image;
         var prevChannel = img.selectedChannel;
         img.selectedChannel = 1;
         var greenMedian = img.median();
         img.selectedChannel = prevChannel;
         console.writeln( "Green channel median: " + format( "%.4f", greenMedian ) );

         var histIdx = _window.mainView.historyIndex;
         var linearityMsgs = [];
         if ( greenMedian > 0.15 ) {
            linearityMsgs.push(
               "<font color='#cc4400'>⚠  Green median " + format( "%.4f", greenMedian ) +
               " — image is likely stretched. Photometry will be unreliable.</font>"
            );
         } else if ( greenMedian >= 0.05 ) {
            linearityMsgs.push(
               "<font color='#997700'>⚠  Green median " + format( "%.4f", greenMedian ) +
               " is in the ambiguous range — verify the stack is unstretched.</font>"
            );
         }
         if ( histIdx > 0 && forbidden.length === 0 ) {
            linearityMsgs.push(
               "<font color='#997700'>⚠  Image has " + histIdx + " unsaved edit" +
               ( histIdx === 1 ? "" : "s" ) + " this session.<br/>" +
               "&nbsp;&nbsp;&nbsp;Process history is not recorded in FITS keywords.<br/>" +
               "&nbsp;&nbsp;&nbsp;Save to disk for reliable detection.</font>"
            );
         }
         if ( linearityMsgs.length > 0 ) {
            self.linearityLbl.text    = "<b>" + linearityMsgs.join( "<br/>" ) + "</b>";
            self.linearityLbl.visible = true;
         } else {
            self.linearityLbl.visible = false;
         }

         // Observer site fields (pre-fill from FITS if not already set)
         var siteKw = readSiteCoords( _window.keywords );
         if ( siteKw.lat  !== null ) self.latEdit.text  = format( "%.4f", siteKw.lat  );
         if ( siteKw.lon  !== null ) self.lonEdit.text  = format( "%.4f", siteKw.lon  );
         self.elevEdit.text = ( siteKw.elev !== null )
            ? format( "%.0f", siteKw.elev ) : ( self.elevEdit.text || "0" );

         // Frame count from FITS/XISF properties — three methods in priority order
         var _kws    = _window.keywords;
         var expFits = findKeyword( _kws, "EXPTIME" );
         var _mv     = _window.mainView;
         var _n = NaN;
         var _nSource = "";

         // 1) ProcessingHistory from the XISF file on disk — reads only the 282 KB XML header,
         //    not the image data.  View.propertyValue("PixInsight:ProcessingHistory") always
         //    returns null (the property is never loaded into memory), so we read the file directly.
         var _xisfPath = _window.filePath;
         if ( _xisfPath && !File.exists( _xisfPath ) ) {
            // File has moved (PI project relocated, different machine, etc.).
            // Offer the user a chance to locate it so the exact frame count can be read.
            var _relDlg = new OpenFileDialog();
            _relDlg.caption = "Locate master light XISF to read frame count";
            _relDlg.filters = [["XISF Files", "*.xisf"]];
            _xisfPath = _relDlg.execute() ? _relDlg.filePath : null;
         }
         if ( _xisfPath && File.exists( _xisfPath ) ) {
            var _nHist = readXISFFrameCount( _xisfPath );
            if ( _nHist > 0 ) { _n = _nHist; _nSource = "ProcessingHistory"; }
         }

         // 2) NCOMBINE FITS keyword — written by standalone ImageIntegration but absent in WBPP masters.
         if ( isNaN(_n) ) {
            var _nc = findKeyword( _kws, "NCOMBINE" );
            if ( _nc ) { _n = parseInt( _nc, 10 ); _nSource = "NCOMBINE"; }
         }

         // 3) Exposure-derived fallback: PCL:TotalExposureTime / Instrument:FrameExposureTime.
         //    Known to under-count when some subs lack the Instrument:ExposureTime XISF property.
         var _nExp = NaN;
         var _totalExp = _mv.propertyValue( "PCL:TotalExposureTime" );
         var _frameExp = _mv.propertyValue( "Instrument:FrameExposureTime" );
         if ( _totalExp !== null && _frameExp !== null ) {
            var _totNums = String( _totalExp ).replace( /[\[\]\s]/g, '' )
                              .split( ',' ).map( parseFloat )
                              .filter( function(x) { return !isNaN(x); } );
            var _maxTot = _totNums.length ? Math.max.apply( null, _totNums ) : NaN;
            _nExp = Math.round( _maxTot / parseFloat( String( _frameExp ) ) );
         }
         if ( isNaN(_n) && _nExp > 0 ) { _n = _nExp; _nSource = "exposure-derived"; }

         if ( _n > 0 ) {
            self.framesEdit.text = String( _n );
            if ( _nSource === "ProcessingHistory" ) {
               console.writeln( "Frame count: " + _n + " (from " + _nSource + ")" +
                  ( (!isNaN(_nExp) && _nExp !== _n)
                    ? "  [exposure-derived was " + _nExp + " — " + (_n - _nExp) + " subs lacked XISF exposure metadata]"
                    : "" ) );
            } else {
               console.warningln( "Frame count: " + _n + " (from " + _nSource +
                  ") — ProcessingHistory unavailable; verify the Frames field manually." );
            }
         }
         if ( expFits && !self.exptimeEdit.text ) {
            var expVal = parseFloat( expFits );
            if ( !isNaN(expVal) ) self.exptimeEdit.text = format( "%.1f", expVal );
         }

         var N = _ensembleEntries.length;
         console.writeln( SEP );
         console.writeln( TITLE + " v" + VERSION + " — Photometry (" +
                          N + " comp star" + (N === 1 ? "" : "s") + ")" );
         console.writeln( SEP );

         // Target instrumental magnitude (from cached discovery PSF)
         _instMag_T = psfInstrumentalMag( _targetPSF );
         if ( _instMag_T === null )
            throw new Error( TARGET.name + ": flux zero or negative." );

         // Ensemble zero-point: ZP_i = magV_i - instMag_i;  ZP = mean(ZP_i)
         var zpValues = [];
         _instMag_Cs  = [];
         _ensembleEntries.forEach( function(e) {
            var im = e.instMag;   // cached from discovery PSF
            _instMag_Cs.push( im );
            if ( im !== null ) zpValues.push( e.star.magV - im );
         });

         if ( zpValues.length === 0 )
            throw new Error( "None of the selected comp stars produced a valid flux." );

         _ensembleZP = zpValues.reduce( function(a,b) { return a+b; } ) / zpValues.length;
         _tcrb_mag   = _ensembleZP + _instMag_T;

         // MERR = sqrt(sigZP^2 + sigT^2)
         var sigT  = psfMagError( _targetPSF );
         var sigZP;
         if ( zpValues.length >= 2 ) {
            var zpMean = _ensembleZP;
            var zpVar  = zpValues.reduce( function(acc,zp) {
               return acc + (zp - zpMean) * (zp - zpMean);
            }, 0 ) / zpValues.length;
            sigZP = Math.sqrt( zpVar ) / Math.sqrt( zpValues.length );
         } else {
            sigZP = psfMagError( _ensembleEntries[0].psf );
         }

         if ( sigT !== null && sigZP !== null ) {
            _merr = Math.sqrt( sigT * sigT + sigZP * sigZP );
         } else {
            _merr = 0.999;
            console.warningln( "MERR: PSF noise estimation failed — set to 0.999" );
         }

         // Console summary
         console.writeln( format( "  %ls = %.3f TG   MERR = %.3f   ZP = %.4f",
                                  TARGET.name, _tcrb_mag, _merr, _ensembleZP ) );
         console.writeln( "  inst T = " + format( "%.4f", _instMag_T ) +
                          "  sigT=" + ( sigT !== null ? format("%.4f",sigT) : "n/a" ) );
         _ensembleEntries.forEach( function(e, i) {
            console.writeln( "  comp " + e.star.label + ": inst=" + format("%.4f",_instMag_Cs[i]) +
                             "  V=" + format("%.3f",e.star.magV) +
                             "  ZP=" + format("%.4f", zpValues[i]) );
         });

         // Check star (from _allInFrame cache; no second PSF fit)
         var checkEntry = _checkStar
            ? _allInFrame.find( function(e) { return e.star.label === _checkStar.label; } )
            : null;
         var checkPix    = checkEntry ? { x: checkEntry.x, y: checkEntry.y } : null;
         var checkReject = checkEntry ? checkEntry.qualityMsg : null;
         _instMag_K = ( checkEntry && !checkReject ) ? checkEntry.instMag : null;

         // ---- TB photometry (blue channel, B-band comp star magnitudes) ----
         if ( _targetPSF_B !== null ) {
            _instMag_T_B = psfInstrumentalMag( _targetPSF_B );
         }
         if ( _instMag_T_B !== null ) {
            var zpValuesB = [];
            _instMag_Cs_B = [];
            _ensembleEntries.forEach( function(e) {
               if ( e.star.magB === null || e.instMagB === null ) {
                  _instMag_Cs_B.push( null );
               } else {
                  _instMag_Cs_B.push( e.instMagB );
                  zpValuesB.push( e.star.magB - e.instMagB );
               }
            });
            if ( zpValuesB.length > 0 ) {
               _ensembleZP_B = zpValuesB.reduce( function(a,b) { return a+b; } ) / zpValuesB.length;
               _tcrb_mag_B   = _ensembleZP_B + _instMag_T_B;
               var sigT_B = psfMagError( _targetPSF_B );
               var sigZP_B;
               if ( zpValuesB.length >= 2 ) {
                  var zpMeanB = _ensembleZP_B;
                  var zpVarB  = zpValuesB.reduce( function(acc, zp) {
                     return acc + (zp - zpMeanB) * (zp - zpMeanB);
                  }, 0 ) / zpValuesB.length;
                  sigZP_B = Math.sqrt( zpVarB ) / Math.sqrt( zpValuesB.length );
               } else {
                  var bEntry = _ensembleEntries.find( function(e) { return e.instMagB !== null; } );
                  sigZP_B = bEntry ? psfMagError( bEntry.psfB ) : null;
               }
               _merr_B = ( sigT_B !== null && sigZP_B !== null )
                       ? Math.sqrt( sigT_B * sigT_B + sigZP_B * sigZP_B ) : 0.999;
               if ( _merr_B === 0.999 )
                  console.warningln( "TB MERR: PSF noise estimation failed — set to 0.999" );
               console.writeln( format( "  %ls = %.3f TB   MERR = %.3f   ZP_B = %.4f",
                                        TARGET.name, _tcrb_mag_B, _merr_B, _ensembleZP_B ) );
               console.writeln( "  TB inst T = " + format( "%.4f", _instMag_T_B ) );
               _ensembleEntries.forEach( function(e, i) {
                  if ( _instMag_Cs_B[i] !== null )
                     console.writeln( "  TB comp " + e.star.label + ": inst=" +
                                      format("%.4f", _instMag_Cs_B[i]) +
                                      "  B=" + format("%.3f", e.star.magB) );
               });
            } else {
               console.warningln( "TB: no comp stars with B-band catalogue magnitudes — TB skipped." );
            }
         }
         if ( checkEntry && !checkReject && checkEntry.instMagB !== null )
            _instMag_K_B = checkEntry.instMagB;

         // Verification image (baked into _verifyArgs for reRenderVerify)
         _verifyArgs = {
            win         : _window,
            targetPix   : _targetPix,
            compEntries : _ensembleEntries,
            checkStar   : checkReject ? null : _checkStar,
            checkPix    : checkReject ? null : checkPix,
         };
         _verifyBmp = createVerificationImage(
            _verifyArgs.win, _verifyArgs.targetPix,
            _verifyArgs.compEntries,
            _verifyArgs.checkStar, _verifyArgs.checkPix,
            _verifyStretch
         );
         updateVerifyBitmap();

         // Check-star quality gate
         if ( _instMag_K !== null && _checkStar ) {
            var checkStd = _ensembleZP + _instMag_K;
            var checkDev = Math.abs( checkStd - _checkStar.magV );
            console.writeln( "  Check " + _checkStar.label + ": derived " + format("%.3f",checkStd) +
                             "  catalogue V=" + format("%.3f",_checkStar.magV) +
                             "  deviation " + format("%.3f",checkDev) );
            if ( checkDev > 3.0 * _merr ) {
               _checkGateWarn = true;
               console.warningln( "  Check star deviation > 3x MERR — possible systematic error." );
               self.checkGateLbl.text =
                  "<b><font color='#cc6600'>⚠  Check star " + escHtml( _checkStar.label ) +
                  ": deviation " + format( "%.3f", checkDev ) + " mag" +
                  " &gt; 3\xd7 MERR (" + format( "%.3f", _merr ) + ")<br/>" +
                  "Possible systematic error — wrong star, blending, or atmospheric gradient." +
                  "</font></b>";
               self.checkGateLbl.visible = true;
            }
         }

         // Update Photometry step display
         var cname = N === 1
            ? _ensembleEntries[0].star.label + " (" + format("%.3f",_ensembleEntries[0].star.magV) + " V)"
            : "ENSEMBLE (" + N + " stars)";
         self.compCheckLbl.text =
            "Comp: " + cname + "    Check: " +
            ( _checkStar ? _checkStar.label + " (" + format("%.3f",_checkStar.magV) + " V)" : "none" );

         self.magLbl.text    = format( "%.3f", _tcrb_mag );
         self.merrLbl.text   = format( "%.3f", _merr );
         self.tbMagLbl.text  = !isNaN( _tcrb_mag_B ) ? format( "%.3f", _tcrb_mag_B ) : "—";
         self.tbMerrLbl.text = !isNaN( _merr_B )     ? format( "%.3f", _merr_B )     : "—";

         var instLine = TARGET.name + ": " + format( "%.4f", _instMag_T );
         _ensembleEntries.forEach( function(e, i) {
            instLine += "   " + e.star.label + ": " + format( "%.4f", _instMag_Cs[i] );
         });
         if ( _instMag_K !== null )
            instLine += "   Check " + _checkStar.label + ": " + format( "%.4f", _instMag_K );
         self.instLbl.text = instLine;

         _photDone = true;
         checkWriteEnabled();
      }

      // ============================================================
      // Report generator and format builders
      // ============================================================

      function generateReport() {
         var midJD = self.midJD;
         var amassStr;
         var lat = parseCoord( self.latEdit.text, -90, 90 );
         var lon = parseCoord( self.lonEdit.text, -180, 360 );
         if ( isNaN(lat) || isNaN(lon) ) {
            amassStr = "na";
         } else {
            try {
               amassStr = format( "%.3f", computeAirmass( midJD, lat, lon, TARGET.ra, TARGET.dec ) );
            } catch ( e ) {
               amassStr = "na";
            }
         }
         var kmag       = (_instMag_K !== null) ? format( "%.4f", _instMag_K ) : "na";
         var framesVal  = self.framesEdit.text.trim();
         var exptimeVal = self.exptimeEdit.text.trim();
         var stackInfo  = "";
         if ( framesVal  ) stackInfo += framesVal + " frames";
         if ( exptimeVal ) stackInfo += (stackInfo ? " x " : "") + exptimeVal + "s";
         var moonVal    = self.moonLbl.text !== "—" ? "moon " + self.moonLbl.text : "";

         var N = _ensembleEntries.length;
         var compList = _ensembleEntries.map( function(e) { return e.star.label; } ).join("+");
         var notes = "TG green channel; DynamicPSF"
                   + "; comp " + compList
                   + ( _checkStar ? "; check " + _checkStar.label : "" )
                   + (stackInfo ? "; " + stackInfo : "")
                   + (moonVal   ? "; " + moonVal   : "");

         var tbNotes = null;
         if ( !isNaN(_tcrb_mag_B) ) {
            var tbCompList = _ensembleEntries
               .filter( function(e) { return e.star.magB !== null && e.instMagB !== null; } )
               .map( function(e) { return e.star.label; } ).join("+");
            tbNotes = "TB blue channel; DynamicPSF"
                    + "; comp " + tbCompList
                    + ( _checkStar ? "; check " + _checkStar.label : "" )
                    + (stackInfo ? "; " + stackInfo : "")
                    + (moonVal   ? "; " + moonVal   : "");
         }

         _reportText = self.rbHuman.checked
            ? buildHumanReport( midJD, amassStr, kmag, notes, tbNotes )
            : buildAavsoReport( midJD, amassStr, kmag, notes, tbNotes );

         self.reportBox.text = _reportText;
      }

      function buildHumanReport( midJD, amassStr, kmag, notes, tbNotes ) {
         function kv( key, val ) {
            return (key + ":                   ").slice( 0, 20 ) + val;
         }
         var framesVal  = self.framesEdit.text.trim();
         var exptimeVal = self.exptimeEdit.text.trim();
         var stackStr   = framesVal ? framesVal + " frames" : "—";
         if ( exptimeVal ) stackStr += " x " + exptimeVal + " s";
         var N    = _ensembleEntries.length;
         var bar  = "=".repeat( 52 );
         var lines = [
            bar,
            TITLE + " v" + VERSION + "  —  Observation Report",
            bar,
            "",
            kv( "Target",          TARGET.name                                        ),
            kv( "Magnitude (TG)",  format( "%.3f", _tcrb_mag ) + " TG"               ),
            kv( "Error (TG)",      format( "%.3f", _merr     )                        ),
            kv( "Magnitude (TB)",  tbNotes !== null ? format( "%.3f", _tcrb_mag_B ) + " TB" : "—" ),
            kv( "Error (TB)",      tbNotes !== null ? format( "%.3f", _merr_B )               : "—" ),
            "",
            kv( "Date (UTC)",      jdToISO( midJD )                                  ),
            kv( "Date (JD)",       format( "%.6f", midJD )                            ),
            kv( "Airmass",         amassStr                                           ),
            kv( "Moon",            self.moonLbl.text                                  ),
            kv( "Stack",           stackStr                                            ),
            "",
         ];
         if ( N === 1 ) {
            var e = _ensembleEntries[0];
            lines.push( kv( "Comparison star", "label " + e.star.label + " / " + e.star.auid +
                                               " / V = " + format( "%.3f", e.star.magV )  ) );
            lines.push( kv( "  Inst. mag",     format( "%.4f", _instMag_Cs[0] )            ) );
         } else {
            lines.push( kv( "Ensemble (" + N + " comps)", "" ) );
            _ensembleEntries.forEach( function(e, i) {
               lines.push( "  " + e.star.label + " / " + e.star.auid +
                           "  V=" + format("%.3f",e.star.magV) +
                           "  inst=" + format("%.4f",_instMag_Cs[i]) );
            });
            lines.push( kv( "  Zero-point",    format( "%.4f", _ensembleZP )               ) );
         }
         if ( _checkStar ) {
            lines.push( kv( "Check star",      "label " + _checkStar.label + " / " + _checkStar.auid +
                                               " / V = " + format( "%.3f", _checkStar.magV )          ) );
            lines.push( kv( "  Inst. mag",     kmag                                                    ) );
         }
         lines.push( "" );
         lines.push( kv( "Observer code",   self.obscodeEdit.text ) );
         lines.push( kv( "Chart",           CHART                 ) );
         lines.push( kv( "Software",        TITLE + " v" + VERSION) );
         lines.push( kv( "Notes",           notes                 ) );
         lines.push( bar );
         lines.push( "" );
         return lines.join( "\n" );
      }

      function buildAavsoReport( midJD, amassStr, kmag, notes, tbNotes ) {
         var headerLines = [
            "#TYPE=EXTENDED",
            "#OBSCODE=" + self.obscodeEdit.text.replace( /[\r\n]/g, "" ).trim(),
            "#SOFTWARE=" + TITLE + " v" + VERSION,
            "#DELIM=,",
            "#DATE=JD",
            "#OBSTYPE=" + OBSTYPE,
         ];
         var N     = _ensembleEntries.length;
         var cname = N === 1 ? sanitizeField( _ensembleEntries[0].star.auid ) : "ENSEMBLE";
         var cmag  = N === 1 ? format( "%.4f", _instMag_Cs[0] ) : "na";
         var kname = _checkStar ? sanitizeField( _checkStar.auid ) : "na";
         var tgLine = [
            TARGET.name,
            format( "%.6f", midJD      ),
            format( "%.3f", _tcrb_mag  ),
            format( "%.3f", _merr      ),
            "TG", "NO", "STD",
            cname, cmag,
            kname, kmag,
            amassStr,
            "na", CHART,
            sanitizeField( notes ),
         ].join( "," );
         var output = headerLines.join( "\n" ) + "\n" + tgLine;
         if ( tbNotes !== null ) {
            var tbCmag  = ( N === 1 && _instMag_Cs_B[0] !== null && _instMag_Cs_B[0] !== undefined )
                        ? format( "%.4f", _instMag_Cs_B[0] ) : "na";
            var tbKmag  = ( _instMag_K_B !== null ) ? format( "%.4f", _instMag_K_B ) : "na";
            var tbLine  = [
               TARGET.name,
               format( "%.6f", midJD        ),
               format( "%.3f", _tcrb_mag_B  ),
               format( "%.3f", _merr_B      ),
               "TB", "NO", "STD",
               cname, tbCmag,
               kname, tbKmag,
               amassStr,
               "na", CHART,
               sanitizeField( tbNotes ),
            ].join( "," );
            output += "\n" + tbLine;
         }
         return output + "\n";
      }
   }
}

// ============================================================
// Entry point
// ============================================================

function main() {
   console.show();
   new PhotometryDialog().execute();
}

// Top-level error handler so unhandled exceptions surface clearly
// in the Process Console rather than silently aborting.
try {
   main();
} catch ( e ) {
   var msg = (e && e.message) ? e.message : String( e );
   console.criticalln( TITLE + ": unexpected error — " + msg );
   if ( e && e.stack ) console.criticalln( e.stack );
}
