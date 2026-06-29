# BeSchne Photometry

![PixInsight](https://img.shields.io/badge/PixInsight-1.9.4%2B-blue)
![AAVSO](https://img.shields.io/badge/AAVSO-Extended_Format-green)
![platform](https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux-lightgrey)
![vibe coded](https://img.shields.io/badge/vibe_coded-Claude_Sonnet-blueviolet)

*[English version](README.md)*

Ein natives **PixInsight-PJSR-Skript**, das Differenzphotometrie von Veränderlichen Sternen
direkt in PixInsight durchführt und einen **AAVSO Extended File Format**-Bericht erstellt.

Aktuell konfiguriert für **T Coronae Borealis** ("Blaze Star"), eine rekurrente Nova,
die sich von Ruhelage (~10 mag) bis Ausbruch (~2 mag) um ~8 Größenklassen aufhellt.

Das Skript nutzt die eigenen PixInsight-Werkzeuge — die astrometrische WCS-Lösung,
FITS-Keywords und DynamicPSF — anstatt diese extern neu zu implementieren.

![Dialog und Verifikationsfenster](docs/screenshot%2C%20v1.0.0%2C%20with%20verification%20window.png)

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
Eine Referenzkopie für Karte X42597QE ist unter `docs/X42597QE_photometry.csv` enthalten.

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

### 5. Dialog ausfüllen

![Dialog](docs/screenshot%2C%20v1.0.0%2C%20dialog%20box%20only.png)

| Feld | Was tun |
|------|---------|
| **Aktives Bild** | Prüfen, ob der eigene Stack angezeigt wird |
| **Vergleichs-CSV** | Zur heruntergeladenen CSV aus Schritt 2 navigieren |
| **Comp / Check** | Für Ruhelage Standardwerte (`98` / `106`) belassen; siehe [Ausbruchsstrategie](#ausbruchsstrategie) |

**Photometrie starten** klicken. Das Skript:
- Passt PSFs für Ziel-, Vergleichs- und Prüfstern an (nur grüner Kanal)
- Berechnet die TG-Helligkeit von T CrB aus der Differenz zum Vergleichsstern
- Zeigt ein annotiertes Verifikations-Thumbnail — prüfen, ob die richtigen Sterne markiert sind
- Warnt in Orange, wenn die Abweichung des Prüfsterns 3×MERR überschreitet

### 6. Beobachtungszeiten eintragen

Mit den **Ordner-Schaltflächen** neben Start und Ende das erste und letzte verwendete
Subframe referenzieren. Das Skript liest `DATE-OBS` und `EXPTIME` aus dem FITS-Header
und berechnet den Belichtungsmittelpunkt automatisch als `(Start + Ende) / 2`.

**Mittlere JD**, **Luftmasse** und **Mond** auf Plausibilität prüfen.

### 7. Bericht erstellen und exportieren

1. **AAVSO Extended Format** auswählen
2. **Bericht erstellen** klicken — 15-Felder-CSV-Zeile in der Vorschau prüfen
3. **Exportieren …** klicken — Datei mit Endung `.txt` speichern

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
| `98`  | `000-BBW-796` | 9,809 | Ruhelage (~10 V) — **Standard** |
| `106` | `000-BJS-901` | 10,554 | Ruhelage — **Standard-Prüfstern** |
| `84`  | `000-BBW-888` | 8,361 | Aufhellung, ~7–9 mag |
| `79`  | `000-BBW-881` | 7,886 | Aufhellung, ~7–9 mag |

**Comp**- und **Check**-Dropdown im Dialog vor „Photometrie starten" anpassen.
Die Auswahl wird zwischen Sitzungen gespeichert.

### Phase 2 — Nova-Maximum (~2–6 mag): neue VSP-Karte laden

Am Maximum sättigt T CrB bei normalen Belichtungszeiten. Sehr kurze Subframes
(unter einer Sekunde) sind erforderlich; die schwachen Vergleichssterne aus X42597QE
sind möglicherweise nicht mehr erfassbar.

1. [AAVSO VSP](https://www.aavso.org/vsp) erneut aufrufen, Bildfeld **180′**,
   Grenzhelligkeit **5–6**
2. Neue Photometrietabelle als CSV herunterladen
3. Über **Durchsuchen** laden und passende Comp/Check-Labels eingeben
4. Konstante `CHART` im Skript (Zeile ~40) auf die neue Karten-ID aktualisieren

AAVSO gibt bei Ausbruchsbeginn Alert Notices mit konkreten Karten- und
Belichtungsempfehlungen heraus — [aavso.org/news](https://www.aavso.org/news) beobachten.

---

## Bekannte Einschränkungen

**TG-Band ≠ Johnson V.** Das Skript berichtet im **TG**-Band (Tricolor-Grün), nicht in
Johnson V. TG ist für rote Sterne ~0,1–0,3 mag heller als V — relevant, da T CrB einen
M3-III-Begleiter hat, der in Ruhelage dominiert. Der AAVSO-Bericht enthält korrekt
`FILT=TG` und `TRANS=NO`. TG-Messungen dürfen niemals als V deklariert werden.

**Seestar-Gesichtsfeld bei Nova-Maximum.** Der Seestar S50 hat ein Gesichtsfeld von
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
| *RGB-Bild (3 Kanäle) erwartet* | Bild ist Graustufen oder Kanalextraktion | Vollständigen OSC-Master verwenden |
| *Stern außerhalb des Bildfeldes* | Comp- oder Check-Stern-Label nicht im Sichtfeld | Anderes Label im Dropdown wählen |
| *PSF abgelehnt — zu schwach* | Stern zu schwach für Gauß-Fit | Helleres Comp/Check-Label wählen |
| *PSF abgelehnt — gesättigt* | Stern im Master beschnitten | Schwächeres Comp/Check-Label wählen oder Belichtung kürzen |
| *Keine verwendbaren V-Band-Zeilen* | Falsche CSV oder Spaltenformat abweichend | Erneut aus AAVSO VSP exportieren und CSV-Spalten prüfen |
| Rote Warnung: *verbotener Prozess erkannt* | Stack wurde gestretcht oder dekonvolviert | Stack aus kalibrierten Subs ohne Stretch/Schärfung neu erstellen |
| Orange Warnung: *Prüfstern-Abweichung > 3×MERR* | Möglicher systematischer Fehler | Verifikations-Thumbnail auf falschen Stern oder Blending prüfen; Atmosphäre begutachten |
| Verifikationsfenster nicht sichtbar | Dialog liegt im Vordergrund | Fenster erscheint auf manchen Plattformen hinter dem Dialog — im PixInsight-Arbeitsbereich nach *Verification* suchen |

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
- Überarbeitetes UI mit Tabs/Schritten und eingebettetem Verifikations-Thumbnail
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
