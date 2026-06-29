#engine v8

#feature-id    BeSchne > AAVSO Photometry

#feature-info  Differential photometry of variable stars. Measures the target \
               against CSV comparison stars and writes an AAVSO Extended File \
               Format report. Currently configured for T Coronae Borealis \
               (the "Blaze Star").

#include <pjsr/DataType.jsh>
#include <pjsr/astrometry/AstrometricMetadata.js>

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

// ============================================================
// Constants — tune here, not inside functions
// ============================================================

const TITLE   = "AAVSO Photometry";
const VERSION = "0.3.0";

// --- Target star -------------------------------------------------
// Factored as an object so other targets can be added later.
const TARGET = {
   name : "T CRB",       // AAVSO name (used in report NAME field)
   ra   : 239.8757,      // J2000 degrees
   dec  :  25.9202,      // J2000 degrees
};

// Observer site: no hardcoded fallback.
// Lat / lon are read from FITS keywords (SITELAT / SITELONG) and shown
// as editable fields in the dialog. Elevation defaults to 0 m if absent
// from FITS. If lat or lon remain blank, AMASS is written as "na".

// --- Default comp/check labels (chart X42597QE, quiescence ~10 V) -----------
// These are the startup defaults. The user can switch to brighter comps (84, 79)
// from the dialog when T CrB brightens — see docs/domain-knowledge.md.
const DEFAULT_COMP_LABEL  = "98";
const DEFAULT_CHECK_LABEL = "106";

// --- AAVSO report metadata ---------------------------------------
const OBSCODE = "BSLA";
const CHART   = "X42597QE";
const OBSTYPE = "CCD";    // Seestar is a dedicated astronomy camera, not a consumer DSLR

// --- Photometry thresholds ---------------------------------------
// Peak above this fraction of the image maximum AND a poor DynamicPSF
// fit → star is flagged as saturated/clipped.
// Calibrate once against a known clipped star.
const SATURATION_FRACTION = 0.90;

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

// --- Settings keys -----------------------------------------------
const SETTINGS_NS          = "BeSchne/Photometry";
const SETTINGS_CSV         = SETTINGS_NS + "/comparisonCsvPath";
const SETTINGS_LAST_DIR    = SETTINGS_NS + "/lastExportDir";
const SETTINGS_COMP_LABEL  = SETTINGS_NS + "/compLabel";
const SETTINGS_CHECK_LABEL = SETTINGS_NS + "/checkLabel";

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
// Returns an array of star objects filtered to Band == "V".
// Each object: { auid, ra, dec, label, magV, error, blended, comments }
// Throws a descriptive Error on any problem.
function loadComparisonStars( csvPath ) {
   var text = readTextFile( csvPath );
   text = text.replace( /\r\n/g, '\n' ).replace( /\r/g, '\n' );

   var pos     = [0];
   var lineNum = 0;
   var stars   = [];

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

   // Parse data rows
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

      if ( fields[4] !== "V" )
         continue;  // keep only V-band rows

      var comments = fields[7];
      var blended  = /blend|pair|combined/i.test( comments );

      stars.push( {
         auid    : fields[0],
         ra      : sexagesimalToDeg( fields[1] ) * 15,  // hours → degrees
         dec     : sexagesimalToDeg( fields[2] ),        // already degrees
         label   : fields[3],
         magV    : parseFloat( fields[5] ),
         error   : parseFloat( fields[6] ),
         blended : blended,
         comments: comments,
      } );
   }

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
         "Expected an RGB (3-channel) image; got " + image.numberOfChannels + " channel(s)." );

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

// Fits a Gaussian PSF to each position in starsIn using the green channel
// (channel 1, PixInsight R/G/B ordering).
// starsIn: array of { label, x, y }
// Returns an object keyed by label → { B, A, cx, cy, sx, sy, theta, mad }
//   or null if the fit did not converge for that star.
function fitPSF( window, starsIn ) {
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
         1,                          // channel: green (R=0, G=1, B=2)
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
// Main photometry dialog
// ============================================================

class PhotometryDialog extends Dialog {
   constructor() {
      super();

      this.windowTitle = TITLE;
      this.minWidth    = 560;

      var self = this;

      // ---- Internal state ----
      var _photDone   = false;
      var _compStar   = null;   // set by runPhotometry(); used by generateReport()
      var _checkStar  = null;
      var _csvUsable  = [];     // sorted non-blended V-band stars; drives the ComboBoxes
      var _startJD    = NaN;
      var _endJD     = NaN;
      var _midMode   = 0;       // 0=(Start+End)/2  1=Start  2=Manual
      var _window    = ImageWindow.activeWindow;
      var _csvPath   = Settings.read( SETTINGS_CSV, DataType_String ) || "";
      var _tcrb_mag  = NaN;
      var _merr      = NaN;
      var _instMag_T   = null;
      var _instMag_C   = null;
      var _instMag_K   = null;    // null = check star not available
      var _reportText  = "";      // last generated report text; "" = not yet created

      // ---- Public result ----
      this.midJD = NaN;

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
            var lat = parseFloat( self.latEdit.text );
            var lon = parseFloat( self.lonEdit.text );
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
            var lat = parseFloat( self.latEdit.text );
            var lon = parseFloat( self.lonEdit.text );
            if ( !isNaN(lat) && !isNaN(lon) ) {
               var mAlt = moonAltitude( mid, lat, lon );
               self.moonLbl.text = mp + "%, "
                  + format( "%.0f°", Math.abs(mAlt) )
                  + (mAlt >= 0 ? " above horizon" : " below horizon");
            } else {
               self.moonLbl.text = mp + "%";
            }
         }
         checkWriteEnabled();
      }

      function applyStart( jd ) {
         _startJD = jd;
         self.startJDLbl.text = isNaN(jd) ? "—" : format( "%.6f", jd );
         refreshMid();
      }

      function applyEnd( jd ) {
         _endJD = jd;
         self.endJDLbl.text = isNaN(jd) ? "—" : format( "%.6f", jd );
         refreshMid();
      }

      function checkWriteEnabled() {
         self.createReportBtn.enabled = _photDone && !isNaN(self.midJD);
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

      // ============================================================
      // Header
      // ============================================================

      var titleLbl = new Label( this );
      titleLbl.text = TITLE + " v" + VERSION + "   ·   Benno Schneider © 2026";

      var precon1 = new Label( this );
      precon1.text = "✓  Required: linear (unstretched) stack; plate-solved (ImageSolver).";

      var precon2 = new Label( this );
      precon2.text = "✗  Incompatible (break PSF linearity): any stretch, deconvolution, BlurXTerminator.";

      var precon3 = new Label( this );
      precon3.text = "✓  Safe to apply: background extraction (ABE/DBE/GradientCorrection), SPCC.";

      this.warningLbl = new Label( this );
      this.warningLbl.useRichText = true;
      this.warningLbl.visible     = false;

      this.linearityLbl = new Label( this );
      this.linearityLbl.useRichText = true;
      this.linearityLbl.visible     = false;

      // ============================================================
      // Input — active image + comparison CSV
      // ============================================================

      var imageLblTag = new Label( this );
      imageLblTag.text          = "Active image:";
      imageLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      imageLblTag.setFixedWidth( 110 );

      this.imageLbl = new Label( this );
      this.imageLbl.useRichText = true;
      this.imageLbl.text = (_window && !_window.isNull)
         ? _window.mainView.id
         : "<font color='#cc2222'>(no active window)</font>";

      var imageRow = new HorizontalSizer;
      imageRow.spacing = 8;
      imageRow.add( imageLblTag );
      imageRow.add( this.imageLbl );
      imageRow.addStretch();

      var csvLblTag = new Label( this );
      csvLblTag.text          = "Comparison CSV:";
      csvLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      csvLblTag.setFixedWidth( 110 );

      this.csvEdit = new Edit( this );
      this.csvEdit.text    = _csvPath;
      this.csvEdit.toolTip = "Path to AAVSO VSP comparison-star CSV export";
      this.csvEdit.onTextUpdated = function() { _csvPath = self.csvEdit.text.trim(); };

      this.csvBrowseBtn = new PushButton( this );
      this.csvBrowseBtn.text = "Browse...";
      this.csvBrowseBtn.onClick = function() {
         var dlg = new OpenFileDialog;
         dlg.caption = "Select comparison-star CSV (AAVSO VSP export)";
         dlg.filters = [["CSV files", "*.csv"], ["All files", "*"]];
         if ( dlg.execute() ) {
            _csvPath = dlg.filePath;
            self.csvEdit.text = _csvPath;
            Settings.write( SETTINGS_CSV, DataType_String, _csvPath );
            try {
               var _browseStars = loadComparisonStars( _csvPath );
               populateStarCombos( _browseStars.filter( s => !s.blended ) );
            } catch(e) { /* error surfaced at Run */ }
         }
      };

      var csvRow = new HorizontalSizer;
      csvRow.spacing = 8;
      csvRow.add( csvLblTag );
      csvRow.add( this.csvEdit, 100 );
      csvRow.add( this.csvBrowseBtn );

      // ---- Comp / check ComboBox selectors ----
      // Populated by populateStarCombos() when the CSV is loaded.
      // Items are sorted brightest-first so outburst comps (79, 84) appear at the top.
      function populateStarCombos( usable ) {
         // Remember current label selections before clearing
         var prevComp  = ( _csvUsable.length > 0 && self.compCombo.currentItem  >= 0 )
                         ? _csvUsable[ self.compCombo.currentItem  ].label : null;
         var prevCheck = ( _csvUsable.length > 0 && self.checkCombo.currentItem >= 0 )
                         ? _csvUsable[ self.checkCombo.currentItem ].label : null;
         if ( !prevComp  ) prevComp  = Settings.read( SETTINGS_COMP_LABEL,  DataType_String ) || DEFAULT_COMP_LABEL;
         if ( !prevCheck ) prevCheck = Settings.read( SETTINGS_CHECK_LABEL, DataType_String ) || DEFAULT_CHECK_LABEL;

         _csvUsable = usable.slice().sort( function(a,b) { return a.magV - b.magV; } );

         while ( self.compCombo.numberOfItems  > 0 ) self.compCombo.removeItem(  0 );
         while ( self.checkCombo.numberOfItems > 0 ) self.checkCombo.removeItem( 0 );

         _csvUsable.forEach( function(s) {
            var text = s.label + "  (" + format( "%.3f", s.magV ) + " V)";
            self.compCombo.addItem( text );
            self.checkCombo.addItem( text );
         } );

         var compIdx  = _csvUsable.findIndex( s => s.label === prevComp  );
         var checkIdx = _csvUsable.findIndex( s => s.label === prevCheck );
         self.compCombo.currentItem  = compIdx  >= 0 ? compIdx  : 0;
         self.checkCombo.currentItem = checkIdx >= 0 ? checkIdx : Math.min( 1, _csvUsable.length - 1 );
      }

      var compLblTag = new Label( this );
      compLblTag.text          = "Comp:";
      compLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      compLblTag.setFixedWidth( 110 );

      this.compCombo = new ComboBox( this );
      this.compCombo.setMinWidth( 160 );
      this.compCombo.toolTip = "Comparison star — select from non-blended V-band stars in the loaded CSV";
      this.compCombo.onItemSelected = function( idx ) {
         if ( idx >= 0 && idx < _csvUsable.length )
            Settings.write( SETTINGS_COMP_LABEL, DataType_String, _csvUsable[idx].label );
      };

      var checkLblTag = new Label( this );
      checkLblTag.text          = "Check:";
      checkLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;

      this.checkCombo = new ComboBox( this );
      this.checkCombo.setMinWidth( 160 );
      this.checkCombo.toolTip = "Check star — must differ from comp; used as independent quality indicator";
      this.checkCombo.onItemSelected = function( idx ) {
         if ( idx >= 0 && idx < _csvUsable.length )
            Settings.write( SETTINGS_CHECK_LABEL, DataType_String, _csvUsable[idx].label );
      };

      // Pre-populate if a valid CSV path is already persisted
      if ( _csvPath && File.exists( _csvPath ) ) {
         try {
            var _initStars = loadComparisonStars( _csvPath );
            populateStarCombos( _initStars.filter( s => !s.blended ) );
         } catch(e) { /* silently ignore — error will surface at Run */ }
      }

      var compRow = new HorizontalSizer;
      compRow.spacing = 8;
      compRow.add( compLblTag       );
      compRow.add( this.compCombo   );
      compRow.addSpacing( 12 );
      compRow.add( checkLblTag      );
      compRow.add( this.checkCombo  );
      compRow.addStretch();

      // ============================================================
      // Run Photometry button
      // ============================================================

      this.runBtn = new PushButton( this );
      this.runBtn.text    = "Run Photometry";
      this.runBtn.toolTip = "Measure target and comparison stars via DynamicPSF";
      this.runBtn.onClick = function() {
         try {
            runPhotometry();
         } catch ( e ) {
            new MessageBox( (e && e.message) ? e.message : String(e),
                            TITLE, StdIcon.Warning, StdButton.Ok ).execute();
         }
      };

      var runRow = new HorizontalSizer;
      runRow.addStretch();
      runRow.add( this.runBtn );
      runRow.addStretch();

      // ============================================================
      // Results display
      // ============================================================

      var magTag = new Label( this );
      magTag.text          = TARGET.name + ":";
      magTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      magTag.setFixedWidth( 60 );

      this.magLbl = new Label( this );
      this.magLbl.text = "—";
      this.magLbl.setFixedWidth( 72 );

      var merrTag = new Label( this );
      merrTag.text          = "TG    MERR:";
      merrTag.textAlignment = TextAlignment.VertCenter;

      this.merrLbl = new Label( this );
      this.merrLbl.text = "—";

      var magRow = new HorizontalSizer;
      magRow.spacing = 8;
      magRow.add( magTag );
      magRow.add( this.magLbl );
      magRow.add( merrTag );
      magRow.add( this.merrLbl );
      magRow.addStretch();

      var instTag = new Label( this );
      instTag.text          = "Instrumental:";
      instTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      instTag.setFixedWidth( 80 );

      this.instLbl = new Label( this );
      this.instLbl.text = "—";

      var instRow = new HorizontalSizer;
      instRow.spacing = 8;
      instRow.add( instTag );
      instRow.add( this.instLbl );
      instRow.addStretch();

      // ============================================================
      // Timing — subframe reference buttons
      // ============================================================

      this.firstSubBtn = new ToolButton( this );
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

      this.lastSubBtn = new ToolButton( this );
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

      // ---- Start row ----
      var startLblTag = new Label( this );
      startLblTag.text          = "Start (UTC):";
      startLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      startLblTag.setFixedWidth( 90 );

      this.startEdit = new Edit( this );
      this.startEdit.setFixedWidth( 200 );
      this.startEdit.toolTip = "Session start — YYYY-MM-DDTHH:MM:SS";
      this.startEdit.onTextUpdated   = function() { applyStart( isoToJD( self.startEdit.text ) ); };
      this.startEdit.onEditCompleted = function() { applyStart( isoToJD( self.startEdit.text ) ); };

      var startJDTag = new Label( this );
      startJDTag.text = "JD:";

      this.startJDLbl = new Label( this );
      this.startJDLbl.text = "—";
      this.startJDLbl.setFixedWidth( 130 );

      var startRow = new HorizontalSizer;
      startRow.spacing = 8;
      startRow.add( startLblTag );
      startRow.add( this.startEdit );
      startRow.add( this.firstSubBtn );
      startRow.add( startJDTag );
      startRow.add( this.startJDLbl );
      startRow.addStretch();

      // ---- End row ----
      var endLblTag = new Label( this );
      endLblTag.text          = "End (UTC):";
      endLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      endLblTag.setFixedWidth( 90 );

      this.endEdit = new Edit( this );
      this.endEdit.setFixedWidth( 200 );
      this.endEdit.toolTip = "Session end — YYYY-MM-DDTHH:MM:SS\n(last sub DATE-OBS + EXPTIME)";
      this.endEdit.onTextUpdated   = function() { applyEnd( isoToJD( self.endEdit.text ) ); };
      this.endEdit.onEditCompleted = function() { applyEnd( isoToJD( self.endEdit.text ) ); };

      var endJDTag = new Label( this );
      endJDTag.text = "JD:";

      this.endJDLbl = new Label( this );
      this.endJDLbl.text = "—";
      this.endJDLbl.setFixedWidth( 130 );

      var endRow = new HorizontalSizer;
      endRow.spacing = 8;
      endRow.add( endLblTag );
      endRow.add( this.endEdit );
      endRow.add( this.lastSubBtn );
      endRow.add( endJDTag );
      endRow.add( this.endJDLbl );
      endRow.addStretch();

      // ---- Exposure row ----
      var framesTag = new Label( this );
      framesTag.text          = "Frames:";
      framesTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      framesTag.setFixedWidth( 90 );

      this.framesEdit = new Edit( this );
      this.framesEdit.setFixedWidth( 60 );
      this.framesEdit.toolTip = "Number of integrated subframes (from PixInsight processing history)";

      var exptimeTag = new Label( this );
      exptimeTag.text          = "Exp/sub:";
      exptimeTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;

      this.exptimeEdit = new Edit( this );
      this.exptimeEdit.setFixedWidth( 80 );
      this.exptimeEdit.toolTip = "Exposure time per subframe in seconds (from last-sub EXPTIME)";

      var exptimeRow = new HorizontalSizer;
      exptimeRow.spacing = 8;
      exptimeRow.add( framesTag );
      exptimeRow.add( this.framesEdit );
      exptimeRow.add( exptimeTag );
      exptimeRow.add( this.exptimeEdit );
      exptimeRow.addStretch();

      // ---- Mid-time mode radios ----
      var midLblTag = new Label( this );
      midLblTag.text          = "Mid-exposure:";
      midLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      midLblTag.setFixedWidth( 90 );

      this.rbMidpoint = new RadioButton( this );
      this.rbMidpoint.text    = "= (S+E)/2";
      this.rbMidpoint.checked = true;
      this.rbMidpoint.toolTip = "Recommended: arithmetic midpoint of the session span";
      this.rbMidpoint.onCheck = function( chk ) {
         if ( chk ) { _midMode = 0; self.midEdit.enabled = false; refreshMid(); }
      };

      this.rbStart = new RadioButton( this );
      this.rbStart.text    = "= Start";
      this.rbStart.checked = false;
      this.rbStart.toolTip = "Use session start as mid-exposure (single-sub sessions)";
      this.rbStart.onCheck = function( chk ) {
         if ( chk ) { _midMode = 1; self.midEdit.enabled = false; refreshMid(); }
      };

      this.rbManual = new RadioButton( this );
      this.rbManual.text    = "Manual:";
      this.rbManual.checked = false;
      this.rbManual.toolTip = "Enter mid-exposure time directly";
      this.rbManual.onCheck = function( chk ) {
         if ( chk ) { _midMode = 2; self.midEdit.enabled = true; refreshMid(); }
      };

      this.midEdit = new Edit( this );
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

      // ---- Mid-time result ----
      var midJDTag = new Label( this );
      midJDTag.text          = "Mid JD:";
      midJDTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      midJDTag.setFixedWidth( 90 );

      this.midJDLbl = new Label( this );
      this.midJDLbl.text = "—";
      this.midJDLbl.setFixedWidth( 130 );

      var midJDRow = new HorizontalSizer;
      midJDRow.spacing = 8;
      midJDRow.add( midJDTag );
      midJDRow.add( this.midJDLbl );
      midJDRow.addStretch();

      var midISOTag = new Label( this );
      midISOTag.text          = "Mid UTC:";
      midISOTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      midISOTag.setFixedWidth( 90 );

      this.midISOLbl = new Label( this );
      this.midISOLbl.text = "—";

      var midISORow = new HorizontalSizer;
      midISORow.spacing = 8;
      midISORow.add( midISOTag );
      midISORow.add( this.midISOLbl );
      midISORow.addStretch();

      // ---- Observer site (editable, populated from FITS in runPhotometry) ----
      var latTag = new Label( this );
      latTag.text          = "Lat:";
      latTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      latTag.setFixedWidth( 30 );

      this.latEdit = new Edit( this );
      this.latEdit.setFixedWidth( 80 );
      this.latEdit.toolTip = "Observer latitude in decimal degrees (North positive)";
      this.latEdit.onTextUpdated = function() { refreshMid(); };

      var latUnit = new Label( this );
      latUnit.text = "°";

      var lonTag = new Label( this );
      lonTag.text          = "Lon:";
      lonTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      lonTag.setFixedWidth( 30 );

      this.lonEdit = new Edit( this );
      this.lonEdit.setFixedWidth( 80 );
      this.lonEdit.toolTip = "Observer longitude in decimal degrees (East positive)";
      this.lonEdit.onTextUpdated = function() { refreshMid(); };

      var lonUnit = new Label( this );
      lonUnit.text = "°";

      var elevTag = new Label( this );
      elevTag.text          = "Elev:";
      elevTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      elevTag.setFixedWidth( 38 );

      this.elevEdit = new Edit( this );
      this.elevEdit.setFixedWidth( 55 );
      this.elevEdit.toolTip = "Observer elevation in metres (informational; not used in airmass formula)";

      var elevUnit = new Label( this );
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

      var airmassTag = new Label( this );
      airmassTag.text          = "Airmass:";
      airmassTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      airmassTag.setFixedWidth( 90 );

      this.airmassLbl = new Label( this );
      this.airmassLbl.text = "—";

      var airmassRow = new HorizontalSizer;
      airmassRow.spacing = 8;
      airmassRow.add( airmassTag );
      airmassRow.add( this.airmassLbl );
      airmassRow.addStretch();

      var moonTag = new Label( this );
      moonTag.text          = "Moon:";
      moonTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      moonTag.setFixedWidth( 90 );

      this.moonLbl = new Label( this );
      this.moonLbl.text    = "—";
      this.moonLbl.toolTip = "Lunar illuminated fraction and altitude above/below horizon at mid-exposure time";

      var moonRow = new HorizontalSizer;
      moonRow.spacing = 8;
      moonRow.add( moonTag );
      moonRow.add( this.moonLbl );
      moonRow.addStretch();

      // ============================================================
      // Output file
      // ============================================================

      var fmtLblTag = new Label( this );
      fmtLblTag.text          = "Format:";
      fmtLblTag.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      fmtLblTag.setFixedWidth( 90 );

      // Separate Control parent so this group does not share an exclusive
      // Qt button group with the mid-time RadioButtons (same dialog parent).
      var fmtGrp = new Control( this );

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

      // ---- Create Report button ----
      this.createReportBtn = new PushButton( this );
      this.createReportBtn.text    = "Create Report";
      this.createReportBtn.enabled = false;
      this.createReportBtn.toolTip = "Generate report text in the selected format";
      this.createReportBtn.onClick = function() { generateReport(); };

      var createReportRow = new HorizontalSizer;
      createReportRow.addStretch();
      createReportRow.add( this.createReportBtn );
      createReportRow.addStretch();

      // ---- Report text preview ----
      this.reportBox = new TextBox( this );
      this.reportBox.readOnly = true;
      this.reportBox.setFixedHeight( 200 );
      this.reportBox.toolTip = "Generated report — review before exporting";

      this.outBrowseBtn = new PushButton( this );
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
         var dateStr = !isNaN(self.midJD)
            ? jdToISO( self.midJD ).substring( 0, 10 )   // "YYYY-MM-DD"
            : format( "%04d-%02d-%02d",
                 (new Date).getFullYear(),
                 (new Date).getMonth() + 1,
                 (new Date).getDate() );
         var suggestedName = "tcrb_photometry_" + dateStr;
         var lastDir = Settings.read( SETTINGS_LAST_DIR, DataType_String )
            || ( (_window && !_window.isNull && _window.filePath)
                 ? File.extractDirectory( _window.filePath )
                 : File.systemTempDirectory );
         saveDlg.initialPath = lastDir + "/" + suggestedName;
         if ( saveDlg.execute() ) {
            var outPath = saveDlg.filePath;
            var ext = File.extractExtension( outPath ).toLowerCase();
            if ( ext !== ".txt" && ext !== ".csv" && ext !== ".tsv" )
               outPath += ".txt";
            File.writeTextFile( outPath, _reportText );
            Settings.write( SETTINGS_LAST_DIR, DataType_String,
                            File.extractDirectory( outPath ) );
            const sep = "=".repeat(60);
            console.writeln( sep );
            console.writeln( "Report exported to:\n  " + outPath );
            console.writeln( sep );
         }
      };

      var outRow = new HorizontalSizer;
      outRow.addStretch();
      outRow.add( this.outBrowseBtn );
      outRow.addStretch();

      // ============================================================
      // Action buttons
      // ============================================================

      this.closeBtn = new PushButton( this );
      this.closeBtn.text    = "Close";
      this.closeBtn.onClick = function() { self.cancel(); };

      var btnRow = new HorizontalSizer;
      btnRow.addStretch();
      btnRow.add( this.closeBtn );

      // ============================================================
      // Main sizer — top to bottom
      // ============================================================

      function hSep() {
         var s = new Label( self );
         s.useRichText = true;
         s.text = "<hr/>";
         return s;
      }

      this.sizer = new VerticalSizer;
      this.sizer.margin  = 12;
      this.sizer.spacing = 8;

      // Header
      this.sizer.add( titleLbl         );
      this.sizer.addSpacing( 4         );
      this.sizer.add( precon1          );
      this.sizer.add( precon2          );
      this.sizer.add( precon3          );
      this.sizer.add( this.warningLbl   );
      this.sizer.add( this.linearityLbl );

      // Input
      this.sizer.add( hSep()    );
      this.sizer.add( imageRow  );
      this.sizer.add( csvRow    );
      this.sizer.add( compRow   );

      // Run
      this.sizer.addSpacing( 4 );
      this.sizer.add( runRow   );

      // Results
      this.sizer.add( hSep()    );
      this.sizer.add( magRow    );
      this.sizer.add( instRow   );

      // Timing
      this.sizer.add( hSep()      );
      this.sizer.add( startRow );
      this.sizer.add( endRow   );
      this.sizer.add( exptimeRow  );
      this.sizer.add( midModeRow  );
      this.sizer.add( midJDRow    );
      this.sizer.add( midISORow   );
      this.sizer.add( siteRow     );
      this.sizer.add( airmassRow  );
      this.sizer.add( moonRow     );

      // Output
      this.sizer.add( hSep()             );
      this.sizer.add( fmtRow             );
      this.sizer.add( createReportRow    );
      this.sizer.add( this.reportBox     );
      this.sizer.add( outRow             );

      // Buttons
      this.sizer.add( hSep()  );
      this.sizer.add( btnRow  );

      // ============================================================
      // Photometry logic — runs when Run Photometry is clicked
      // ============================================================

      function runPhotometry() {
         _photDone  = false;
         _instMag_T = null;
         _instMag_C = null;
         _instMag_K = null;
         self.magLbl.text  = "—";
         self.merrLbl.text = "—";
         self.instLbl.text = "—";
         checkWriteEnabled();

         _window = ImageWindow.activeWindow;
         if ( !_window || _window.isNull )
            throw new Error( "No active image window. Open a plate-solved OSC stack and make it the active window first." );

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

         // Heuristic linearity checks: green-channel median + historyIndex.
         // Supplementary signals only — never block; shown in addition to HISTORY warnings.
         var img = _window.mainView.image;
         var prevChannel = img.selectedChannel;
         img.selectedChannel = 1;   // green channel
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
               ( histIdx === 1 ? "" : "s" ) +
               " this session — process history not recorded in FITS keywords. " +
               "Save to disk for reliable detection.</font>"
            );
         }

         if ( linearityMsgs.length > 0 ) {
            self.linearityLbl.text    = "<b>" + linearityMsgs.join( "<br/>" ) + "</b>";
            self.linearityLbl.visible = true;
         } else {
            self.linearityLbl.visible = false;
         }

         // Populate observer site fields from FITS keywords (only if the field is
         // currently blank or was set by a previous FITS read — never overwrite a
         // value the user has typed manually by checking if the field changed).
         var siteKw = readSiteCoords( _window.keywords );
         if ( siteKw.lat  !== null ) self.latEdit.text  = format( "%.4f", siteKw.lat  );
         if ( siteKw.lon  !== null ) self.lonEdit.text  = format( "%.4f", siteKw.lon  );
         self.elevEdit.text = ( siteKw.elev !== null )
            ? format( "%.0f", siteKw.elev ) : ( self.elevEdit.text || "0" );

         // Read stack metadata from FITS keywords.
         var _kws   = _window.keywords;
         var expFits = findKeyword( _kws, "EXPTIME" );

         // Frame count: PCL:TotalExposureTime / Instrument:FrameExposureTime (both in seconds).
         // Falls back to NCOMBINE FITS keyword for non-PixInsight stacks.
         var _mv       = _window.mainView;
         var _totalExp = _mv.propertyValue( "PCL:TotalExposureTime" );
         var _frameExp = _mv.propertyValue( "Instrument:FrameExposureTime" );
         if ( _totalExp !== null && _frameExp !== null ) {
            // TotalExposureTime is a per-channel array e.g. [554.575,532.567,480.99]
            var _totNums = String( _totalExp ).replace( /[\[\]\s]/g, '' )
                              .split( ',' ).map( parseFloat )
                              .filter( function(x) { return !isNaN(x); } );
            var _maxTot = _totNums.length ? Math.max.apply( null, _totNums ) : NaN;
            var _n = Math.round( _maxTot / parseFloat( String( _frameExp ) ) );
            if ( _n > 0 ) self.framesEdit.text = String( _n );
         }
         if ( !self.framesEdit.text ) {
            var _nc = findKeyword( _kws, "NCOMBINE" );
            if ( _nc ) self.framesEdit.text = _nc;
         }
         if ( expFits && !self.exptimeEdit.text ) {
            var expVal = parseFloat( expFits );
            if ( !isNaN(expVal) ) self.exptimeEdit.text = format( "%.1f", expVal );
         }

         if ( !_csvPath || !File.exists( _csvPath ) )
            throw new Error( "Comparison CSV not found — use Browse to select it." );

         const sep = "=".repeat(60);
         console.writeln( sep );
         console.writeln( TITLE + " v" + VERSION + " — Run Photometry" );
         console.writeln( sep );

         // Astrometry
         var metadata = loadAstrometry( _window );
         var image    = _window.mainView.image;
         self.imageLbl.text = _window.mainView.id;   // clears red "(no active window)" if shown
         console.writeln( "Astrometric solution loaded (" +
                          image.width + " x " + image.height + " px)." );
         console.writeln( format( "Observer site: lat %ls°  lon %ls°  elev %ls m  (%ls)",
                                  self.latEdit.text  || "not set",
                                  self.lonEdit.text  || "not set",
                                  self.elevEdit.text || "0",
                                  (siteKw.lat !== null) ? "from FITS" : "not in FITS — enter manually" ) );

         // Comparison CSV
         var allStars = loadComparisonStars( _csvPath );
         var usable   = allStars.filter( s => !s.blended );
         var blended  = allStars.filter( s =>  s.blended );
         console.writeln( "Comparison stars: " + allStars.length + " V-band rows from " +
                          File.extractName( _csvPath ) );
         blended.forEach( s =>
            console.warningln( "  Excluded (blended): label " + s.label +
                               " (" + s.auid + ") — " + s.comments )
         );

         // Refresh ComboBoxes and read selected comp/check stars
         populateStarCombos( usable );
         var compStar  = _csvUsable[ self.compCombo.currentItem  ];
         var checkStar = _csvUsable[ self.checkCombo.currentItem ];
         if ( !compStar  ) throw new Error( "No comparison star selected." );
         if ( !checkStar ) throw new Error( "No check star selected." );

         // Project to pixels
         var targetPix = celestialToPixel( metadata, TARGET.ra, TARGET.dec );
         if ( !targetPix )
            throw new Error( TARGET.name + " is outside the image projection." );
         if ( targetPix.x < 0 || targetPix.y < 0 ||
              targetPix.x >= image.width || targetPix.y >= image.height )
            throw new Error( TARGET.name + " projects outside the image frame." );

         var compPix  = celestialToPixel( metadata, compStar.ra,  compStar.dec  );
         var checkPix = celestialToPixel( metadata, checkStar.ra, checkStar.dec );
         if ( !compPix || compPix.x < 0 || compPix.y < 0 ||
              compPix.x >= image.width || compPix.y >= image.height )
            throw new Error( "Comparison star " + compStar.label + " is outside the image frame." );
         if ( !checkPix || checkPix.x < 0 || checkPix.y < 0 ||
              checkPix.x >= image.width || checkPix.y >= image.height )
            throw new Error( "Check star " + checkStar.label + " is outside the image frame." );

         console.writeln( TARGET.name + " -> pixel (" + targetPix.x.toFixed(1) +
                          ", " + targetPix.y.toFixed(1) + ")" );
         console.writeln( "Comp  " + compStar.label  + " -> pixel (" +
                          compPix.x.toFixed(1)  + ", " + compPix.y.toFixed(1)  + ")" );
         console.writeln( "Check " + checkStar.label + " -> pixel (" +
                          checkPix.x.toFixed(1) + ", " + checkPix.y.toFixed(1) + ")" );

         // PSF measurement
         var psfInput = [
            { label: TARGET.name,      x: targetPix.x, y: targetPix.y },
            { label: compStar.label,   x: compPix.x,   y: compPix.y   },
            { label: checkStar.label,  x: checkPix.x,  y: checkPix.y  },
         ];
         var psfFits  = fitPSF( _window, psfInput );

         var targetPSF = psfFits[ TARGET.name     ];
         var compPSF   = psfFits[ compStar.label  ];
         var checkPSF  = psfFits[ checkStar.label ];

         var targetReject = checkPSFQuality( targetPSF, targetPix.x, targetPix.y );
         var compReject   = checkPSFQuality( compPSF,   compPix.x,   compPix.y   );
         var checkReject  = checkPSFQuality( checkPSF,  checkPix.x,  checkPix.y  );

         if ( targetReject )
            throw new Error( TARGET.name + " PSF rejected: " + targetReject );
         if ( compReject )
            throw new Error( "Comp " + compStar.label + " PSF rejected: " + compReject );
         if ( checkReject )
            console.warningln( "Check " + checkStar.label + " PSF rejected: " + checkReject +
                               " — MERR will be unreliable." );

         function psfLine( psf ) {
            if ( !psf ) return "fit failed";
            return format( "A=%.4f B=%.4f sx=%.2f sy=%.2f MAD=%.5f  centre(%.1f,%.1f)",
                           psf.A, psf.B, psf.sx, psf.sy, psf.mad, psf.cx, psf.cy );
         }
         console.writeln( "PSF fits (green channel):" );
         console.writeln( "  " + TARGET.name + ":       " + psfLine( targetPSF ) );
         console.writeln( "  comp  " + compStar.label  + ":  " + psfLine( compPSF  ) );
         console.writeln( "  check " + checkStar.label + ":  " + psfLine( checkPSF ) );

         // Photometry math
         _instMag_T = psfInstrumentalMag( targetPSF );
         _instMag_C = psfInstrumentalMag( compPSF   );
         _instMag_K = checkPSF ? psfInstrumentalMag( checkPSF ) : null;

         if ( _instMag_T === null )
            throw new Error( TARGET.name + ": flux zero or negative — cannot compute magnitude." );
         if ( _instMag_C === null )
            throw new Error( "Comp " + compStar.label + ": flux zero or negative — cannot compute magnitude." );

         _tcrb_mag = compStar.magV + ( _instMag_T - _instMag_C );

         // Store for report generator
         _compStar  = compStar;
         _checkStar = checkStar;

         // MERR: propagate per-star PSF noise in quadrature (Poisson + sky background)
         var sigT = psfMagError( targetPSF );
         var sigC = psfMagError( compPSF   );
         var sigK = (_instMag_K !== null) ? psfMagError( checkPSF ) : null;
         if ( sigT !== null && sigC !== null ) {
            _merr = Math.sqrt( sigT * sigT + sigC * sigC );
         } else {
            _merr = 0.999;
            console.warningln( "MERR: PSF noise estimation failed — set to 0.999" );
         }

         console.writeln( "Photometry:" );
         console.writeln( format( "  %ls = %.3f TG   MERR = %.3f  (comp %ls, V = %.3f)",
                                  TARGET.name, _tcrb_mag, _merr, compStar.label, compStar.magV ) );
         console.writeln( "  inst T = " + format( "%.4f", _instMag_T ) +
                          "  err=" + format( "%.3f", sigT || 0 ) +
                          "   inst C = " + format( "%.4f", _instMag_C ) +
                          "  err=" + format( "%.3f", sigC || 0 ) +
                          "   inst K = " + ((_instMag_K !== null) ? format( "%.4f", _instMag_K ) : "n/a") +
                          ((sigK !== null) ? "  err=" + format( "%.3f", sigK ) : "") );

         // Check-star quality gate — independent of MERR
         if ( _instMag_K !== null ) {
            var checkStd = compStar.magV + ( _instMag_K - _instMag_C );
            var checkDev = Math.abs( checkStd - checkStar.magV );
            console.writeln( "  Check star: derived " + format( "%.3f", checkStd ) +
                             " vs catalogue V=" + format( "%.3f", checkStar.magV ) +
                             " -> deviation " + format( "%.3f", checkDev ) + " mag" );
            if ( checkDev > 3.0 * _merr )
               console.warningln( "  Check star deviation (" + format( "%.3f", checkDev ) +
                                  ") is > 3x MERR (" + format( "%.3f", _merr ) +
                                  ") -- possible systematic error." );
         }

         // Update results display
         self.magLbl.text  = format( "%.3f", _tcrb_mag );
         self.merrLbl.text = format( "%.3f", _merr );
         self.instLbl.text = format( "T = %.4f   C = %.4f   K = %ls",
                                     _instMag_T, _instMag_C,
                                     (_instMag_K !== null) ? format("%.4f", _instMag_K) : "n/a" );

         _photDone = true;
         checkWriteEnabled();
      }

      // ============================================================
      // Report generator and format builders
      // ============================================================

      function generateReport() {
         var midJD = self.midJD;
         var amassStr;
         var lat = parseFloat( self.latEdit.text );
         var lon = parseFloat( self.lonEdit.text );
         if ( isNaN(lat) || isNaN(lon) ) {
            amassStr = "na";
         } else {
            try {
               amassStr = format( "%.3f", computeAirmass( midJD, lat, lon, TARGET.ra, TARGET.dec ) );
            } catch ( e ) {
               amassStr = "na";
            }
         }
         var kmag  = (_instMag_K !== null) ? format( "%.4f", _instMag_K ) : "na";
         var stackInfo = "";
         var framesVal  = self.framesEdit.text.trim();
         var exptimeVal = self.exptimeEdit.text.trim();
         if ( framesVal  ) stackInfo += framesVal + " frames";
         if ( exptimeVal ) stackInfo += (stackInfo ? " x " : "") + exptimeVal + "s";
         var moonVal = self.moonLbl.text !== "—" ? "moon " + self.moonLbl.text : "";
         var notes = "TG green channel; DynamicPSF; comp " + _compStar.label + "; check " + _checkStar.label
                   + (stackInfo ? "; " + stackInfo : "")
                   + (moonVal   ? "; " + moonVal   : "");

         _reportText = self.rbHuman.checked
            ? buildHumanReport( midJD, amassStr, kmag, notes )
            : buildAavsoReport( midJD, amassStr, kmag, notes );

         self.reportBox.text = _reportText;
      }

      function buildHumanReport( midJD, amassStr, kmag, notes ) {
         function kv( key, val ) {
            return (key + ":                   ").slice( 0, 20 ) + val;
         }
         var framesVal  = self.framesEdit.text.trim();
         var exptimeVal = self.exptimeEdit.text.trim();
         var stackStr   = framesVal  ? framesVal + " frames" : "—";
         if ( exptimeVal ) stackStr += " × " + exptimeVal + " s";
         var bar = "=".repeat( 52 );
         return [
            bar,
            TITLE + " v" + VERSION + "  —  Observation Report",
            bar,
            "",
            kv( "Target",          TARGET.name                                        ),
            kv( "Magnitude",       format( "%.3f", _tcrb_mag ) + " TG"               ),
            kv( "Magnitude error", format( "%.3f", _merr     )                        ),
            "",
            kv( "Date (UTC)",      jdToISO( midJD )                                  ),
            kv( "Date (JD)",       format( "%.6f", midJD )                            ),
            kv( "Airmass",         amassStr                                           ),
            kv( "Moon",            self.moonLbl.text                                  ),
            kv( "Stack",           stackStr                                            ),
            "",
            kv( "Comparison star", "label " + _compStar.label  + " / " + _compStar.auid  +
                                   " / V = " + format( "%.3f", _compStar.magV  )     ),
            kv( "  Inst. mag",     format( "%.4f", _instMag_C )                      ),
            kv( "Check star",      "label " + _checkStar.label + " / " + _checkStar.auid +
                                   " / V = " + format( "%.3f", _checkStar.magV )     ),
            kv( "  Inst. mag",     kmag                                               ),
            "",
            kv( "Observer code",   OBSCODE                                            ),
            kv( "Chart",           CHART                                              ),
            kv( "Software",        TITLE + " v" + VERSION                             ),
            kv( "Notes",           notes                                              ),
            bar,
            "",
         ].join( "\n" );
      }

      function buildAavsoReport( midJD, amassStr, kmag, notes ) {
         var headerLines = [
            "#TYPE=EXTENDED",
            "#OBSCODE=" + OBSCODE,
            "#SOFTWARE=" + TITLE + " v" + VERSION,
            "#DELIM=,",
            "#DATE=JD",
            "#OBSTYPE=" + OBSTYPE,
         ];
         var dataLine = [
            TARGET.name,
            format( "%.6f", midJD      ),
            format( "%.3f", _tcrb_mag  ),
            format( "%.3f", _merr      ),
            "TG", "NO", "STD",
            _compStar.auid,
            format( "%.4f", _instMag_C ),
            _checkStar.auid,
            kmag,
            amassStr,
            "na", CHART, notes,
         ].join( "," );
         return headerLines.join( "\n" ) + "\n" + dataLine + "\n";
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
