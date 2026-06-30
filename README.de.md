# AAVSO Photometry

![PixInsight](https://img.shields.io/badge/PixInsight-1.9.4%2B-blue)
![AAVSO](https://img.shields.io/badge/AAVSO-Extended_Format-green)
![platform](https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux-lightgrey)
![vibe coded](https://img.shields.io/badge/vibe_coded-Claude_Sonnet-blueviolet)

*[English version](README.md)*

Ein natives **PixInsight-PJSR-Skript**, das Differenzphotometrie von Veränderlichen Sternen
direkt in PixInsight durchführt und einen **AAVSO Extended File Format**-Bericht erstellt.

Aktuell konfiguriert für **T Coronae Borealis** ("Blaze Star"), eine rekurrente Nova,
die sich von Ruhelage (~10 mag) bis Ausbruch (~2 mag) um ~8 Größenklassen aufhellt.

Das Skript nutzt die PixInsight-eigenen Werkzeuge — die astrometrische WCS-Lösung,
FITS-Keywords und DynamicPSF — anstatt diese extern neu zu implementieren.

Der Dialog ist ein fünfstufiger Assistent — Setup → Photometrie → Mittlere Zeit → Verifikation → Bericht.

![Setup-Schritt](docs/screenshot%2C%20v1.1.0%2C%20%281%29%20setup.png)
![Verifikationsschritt](docs/screenshot%2C%20v1.1.0%2C%20%285%29%20verification.png)

---

## Voraussetzungen

- **PixInsight 1.9.4 „Lockhart"** oder neuer (V8-JS-Engine erforderlich)
- Ein geöffneter, plate-gesolvter OSC-RGB-Master-Light-Stack
- Eine Vergleichsstern-CSV aus dem [AAVSO VSP](https://www.aavso.org/vsp)

## Vorbedingungen für das Eingabebild

| Bedingung | Status |
|-----------|--------|
| Linearer (ungestretchter) Stack | **Erforderlich** — PSF-Fluss ist auf einem gestretchten Bild nicht linear |
| Plate-gesolvt (ImageSolver) | **Erforderlich** — Koordinatenprojektion benötigt die WCS-Lösung |
| Stretch angewendet | **Inkompatibel** — zerstört PSF-Linearität |
| Dekonvolution / BlurXTerminator | **Inkompatibel** — verändert die PSF-Form |
| Hintergrundextraktion (ABE / DBE / GradientCorrection) | Unbedenklich |
| SpectrophotometricColorCalibration (SPCC) | Unbedenklich |

---

## Schnellstart

### 1. Skript herunterladen

Repository klonen oder herunterladen und in einem beliebigen Ordner ablegen.
Keine Installation, kein Neustart von PixInsight erforderlich.

### 2. Vergleichsstern-CSV vom AAVSO VSP herunterladen

Das Skript benötigt eine Photometrietabelle mit Vergleichssternen und ihren Kataloghelligkeiten.

1. AAVSO Variable Star Plotter aufrufen: [aavso.org/vsp](https://www.aavso.org/vsp)
2. Zielname eingeben: **T CrB**
3. **Bildfeld** auf **60′** setzen (entspricht einem typischen Seestar/Kleinteleskop-Gesichtsfeld)
4. **Grenzhelligkeit** auf **12,0** setzen (erfasst Vergleichssterne bis ~11 mag)
5. **Karte zeichnen** klicken — Karten-ID notieren (z. B. `X42597QE`)
6. **Photometrietabelle** → **Herunterladen** → als **CSV** speichern

Die heruntergeladene Datei ist die Vergleichsstern-CSV.
Eine Referenzkopie für Karte X42597QE ist unter `docs/X42597QE_photometry.csv` zu finden.

### 3. Bild in PixInsight vorbereiten

Den **linearen, plate-gesolvten OSC-RGB-Master-Stack** als aktives Fenster öffnen.
Falls noch kein Plate-Solve vorliegt, zuerst `Skript > Astronomie > ImageSolver` ausführen.

> Das Skript liest beim Start die Prozesshistorie des Stacks aus den FITS-Keywords.
> Wurden inkompatible Prozesse angewendet (Stretch, Dekonvolution, BlurXTerminator),
> erscheint nach „Photometrie starten" eine rote Warnung.

### 4. Skript ausführen

- **Schnellstart (ohne Menüeintrag):** `Skript > Skriptdatei ausführen …` → `aavso-photometry.js` auswählen
- **Mit Menüeintrag:** `Skript > Feature Scripts … > Hinzufügen` einmalig auf den Skriptordner anwenden.
  PixInsight registriert das Skript unter `Skript > BeSchne > Photometry` und lädt
  Codeänderungen bei jedem weiteren Start automatisch neu.

### 5. Die fünf Schritte des Assistenten durchlaufen

**Schritt 1 — Setup**

| Feld | Was tun |
|------|---------|
| **Aktives Bild** | Prüfen, ob der eigene Stack angezeigt wird |
| **Vergleichs-CSV** | Zur heruntergeladenen CSV aus Schritt 2 navigieren |
| **Comp / Check** | Die Dropdowns zeigen die zwei hellsten verwendbaren V-Band-Sterne; für Ruhelage sind diese in der Regel korrekt — siehe [Ausbruchsstrategie](#ausbruchsstrategie) |

**Schritt 2 — Photometrie**

Die Photometrie startet automatisch beim Öffnen dieses Schritts:
- PSF-Fits für Ziel-, Vergleichs- und Prüfstern (nur grüner Kanal)
- TG-Helligkeit von T CrB aus der Differenz zum Vergleichsstern
- Rote Warnung bei erkannten inkompatiblen Prozessen
- Orange Warnung, wenn Prüfstern-Abweichung 3×MERR überschreitet

**Schritt 3 — Mittlere Zeit**

Mit den **Ordner-Schaltflächen** neben Start und Ende das erste und letzte verwendete
Subframe referenzieren. Das Skript liest `DATE-OBS` und `EXPTIME` aus dem FITS-Header
und berechnet den Belichtungsmittelpunkt automatisch als `(Start + Ende) / 2`.

**Mittlere JD**, **Luftmasse** und **Mond** auf Plausibilität prüfen.

**Schritt 4 — Verifikation**

Annotiertes Thumbnail prüfen: Ziel (grüner Kreis), Comp (blau), Check (gelb).
Bestätigen, dass die Kreise auf den richtigen Sternen liegen.

**Schritt 5 — Bericht**

Der Bericht wird automatisch beim Öffnen dieses Schritts erzeugt.
Für die AAVSO-Einreichung **AAVSO Extended Format** wählen, dann **Exportieren …** klicken
und mit Endung `.txt` speichern.

### 8. Bericht bei AAVSO WebObs einreichen

1. [aavso.org/webobs](https://www.aavso.org/webobs) aufrufen und einloggen
2. **Beobachtungen einreichen** → **Datei hochladen**
3. Die exportierte `.txt`-Datei hochladen
4. Prüfen, ob die Beobachtung korrekt in den eigenen Einreichungen erscheint

---

## Ausbruchsstrategie

T CrB erwartet man um ~8 Größenklassen heller — von Ruhelage (~10 V) bis Nova-Maximum (~2 V).

### Phase 1 — Frühe Aufhellung (~7–9 mag): Comp/Check wechseln

Karte **X42597QE** enthält hellere Vergleichssterne für diese Phase:

| Label | AUID | V-Mag | Einsatz wenn T CrB |
|-------|------|-------|---------------------|
| `98`  | `000-BBW-796` | 9,809 | Ruhelage (~10 V) |
| `106` | `000-BJS-901` | 10,554 | Ruhelage (Prüfstern) |
| `84`  | `000-BBW-888` | 8,361 | Aufhellung, ~7–9 mag |
| `79`  | `000-BBW-881` | 7,886 | Aufhellung, ~7–9 mag |

**Comp**- und **Check**-Dropdown im Setup-Schritt vor dem Fortfahren anpassen.
Die Dropdowns werden bei jedem Start zurückgesetzt und schlagen die hellsten verfügbaren Sterne vor.

### Phase 2 — Nova-Maximum (~2–6 mag): neue VSP-Karte laden

Am Maximum sättigt T CrB bei normalen Belichtungszeiten. Dann sind sehr kurze Subframes
(unter einer Sekunde) erforderlich. Die schwachen Vergleichssterne aus X42597QE
sind dann möglicherweise nicht mehr erfassbar.

1. [AAVSO VSP](https://www.aavso.org/vsp) erneut aufrufen, Bildfeld **180′**,
   Grenzhelligkeit **5–6**
2. Neue Photometrietabelle als CSV herunterladen
3. Über **Durchsuchen** laden und passende Comp/Check-Labels eingeben
4. Konstante `CHART` im Skript (Zeile ~40) auf die neue Karten-ID aktualisieren

AAVSO gibt bei Ausbruchsbeginn _Alert Notices_ mit konkreten Karten- und
Belichtungsempfehlungen heraus — [aavso.org/news](https://www.aavso.org/news) beobachten.

---

## Bekannte Einschränkungen

**TG-Band ≠ Johnson V.** Das Skript berichtet im **TG**-Band (Tricolor-Grün), nicht in
Johnson V. TG ist für rote Sterne ~0,1–0,3 mag heller als V — relevant, da T CrB einen
M3-III-Begleiter hat, der in Ruhelage dominiert. Der AAVSO-Bericht enthält korrekt
`FILT=TG` und `TRANS=NO`. TG-Messungen dürfen niemals als V deklariert werden.

**Seestar-Gesichtsfeld bei Nova-Maximum.** Der Seestar S50 Pro hat ein Gesichtsfeld von
~1,4° × 1,0°. Bei Maximum (~2 mag) liegen die nächsten geeigneten Vergleichssterne
(1–4 mag) möglicherweise außerhalb dieses Fensters. In diesem Fall empfiehlt sich ein
Weitwinkelinstrument, visuelle Beobachtung oder Ensemble-Photometrie mit schwächeren
feldinternen Sternen (geplante Funktion).

**Einzelner Vergleichsstern.** Die aktuelle Version verwendet einen Vergleichs- und
einen Prüfstern. Ensemble-Photometrie (mehrere Vergleichssterne) ist als Post-v1-Feature
geplant und reduziert die Empfindlichkeit gegenüber Variabilität einzelner Sterne.

**DATE-OBS bei gestackten Mastern unzuverlässig.** PixInsights `ImageIntegration`
schreibt `DATE-OBS` als Mittelpunkt der Sub-Startzeiten ohne Belichtungsdauer.
Immer die **Referenz-Schaltflächen** in der Zeitsektion verwenden, um Start und Ende
aus echten Subframes zu setzen.

---

## Fehlerbehebung

| Fehler / Symptom | Ursache | Lösung |
|------------------|---------|--------|
| *Kein aktives Bildfenster* | Kein Stack geöffnet oder nicht aktiv | Master-Stack öffnen und Titelleiste anklicken |
| *Kein Plate-Solve* | Keine WCS-Lösung gefunden | `Skript > Astronomie > ImageSolver` auf den Stack anwenden |
| *RGB-Bild (3 Kanäle) erwartet* | Bild ist in Graustufen oder Kanalextraktion | Vollständigen OSC-Master verwenden |
| *Stern außerhalb des Bildfeldes* | Comp- oder Check-Stern-Label nicht im Sichtfeld | Anderes Label im Dropdown wählen |
| *PSF abgelehnt — zu schwach* | Stern zu schwach für Gauß-Fit | Helleres Comp/Check-Label wählen |
| *PSF abgelehnt — gesättigt* | Stern im Master beschnitten | Schwächeres Comp/Check-Label wählen oder Belichtung kürzen |
| *Keine verwendbaren V-Band-Zeilen* | Falsche CSV oder Spaltenformat abweichend | Erneut aus AAVSO VSP exportieren und CSV-Spalten prüfen |
| Rote Warnung: *verbotener Prozess erkannt* | Stack wurde gestretcht oder dekonvolviert | Stack aus kalibrierten Subs ohne Stretch/Schärfung neu erstellen |
| Orange Warnung: *Prüfstern-Abweichung > 3×MERR* | Möglicher systematischer Fehler | Verifikations-Thumbnail auf falschen Stern oder Blending prüfen; Atmosphäre begutachten |

---

## Ausgabe

**Lesbare Zusammenfassung** (Standard): formatierter Textbericht für persönliche Unterlagen.

**AAVSO Extended Format** (auf Anforderung): 15-Felder-CSV zur direkten Einreichung bei
[AAVSO WebObs](https://www.aavso.org/webobs). Schlüsselwerte:
`FILT=TG`, `TRANS=NO`, `MTYPE=STD`, `OBSTYPE=CCD`, `CHART=X42597QE`.

---

## Verzeichnisstruktur

```
aavso-photometry.js          Hauptskript
sample_comparison_stars.csv  Formatbeispiel für die Vergleichsstern-CSV
docs/
  X42597QE_photometry.csv    AAVSO-VSP-Export für Karte X42597QE
  X42597QE.png               AAVSO-Aufsuchkarte für T CrB
  aavso-extended-format.md   AAVSO Extended File Format Feldbeschreibung
  domain-knowledge.md        Photometrie-Konstanten und wissenschaftliche Hinweise
  time-handling.md           Spezifikation der Belichtungsmittelzeit
  pjsr-api-notes.md          Verifizierte PJSR-API-Muster und Fallstricke
CLAUDE.md                    Hinweise für KI-Coding-Assistenten
TODO.md                      Aufgabenliste und Roadmap
```

---

## Roadmap

- Vollständige native PixInsight-Dokumentation (`Skript > Feature Scripts > ?`)
- Ensemble-Photometrie (`CNAME=ENSEMBLE`)
- TG→V-Farbtransformation (`TRANS=YES`)
- Frei wählbarer Zielstern

---

## Autor

Benno Schneider · AAVSO-Beobachtercode **BSLA**

<br/>

<img src="docs/astrophotography%20and%20photometry%20meme.png" width="800"/>

---

🤖 Erstellt mit [Claude Code](https://claude.ai/claude-code)
