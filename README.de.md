# AAVSO Photometry

![PixInsight](https://img.shields.io/badge/PixInsight-1.9.4%2B-blue)
![AAVSO](https://img.shields.io/badge/AAVSO-Extended_Format-green)
![platform](https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux-lightgrey)
![vibe coded](https://img.shields.io/badge/vibe_coded-Claude_Sonnet-blueviolet)

*[English version](README.md)*

Ein natives **PixInsight-PJSR-Skript**, das Differenzphotometrie von Veränderlichen Sternen
direkt in PixInsight durchführt und einen **AAVSO Extended File Format**-Bericht erstellt.

[PixInsight](https://pixinsight.com) ist eine professionelle Bildverarbeitungsplattform
für Astrofotografie; PJSR ist die darin enthaltene JavaScript-Skriptumgebung.

Es funktioniert für **jeden Veränderlichen mit einer AAVSO-Vergleichssternsequenz**: Den
AAVSO-Namen des Sterns eingeben, und das Skript lädt die Vergleichssterne selbst aus dem
AAVSO Variable Star Plotter (VSP) — kein manuelles Herunterladen von Karten oder CSVs.
Entwickelt wurde es für **T Coronae Borealis** ("Blaze Star"), eine rekurrente Nova,
die sich von Ruhelage (~10 mag) bis Ausbruch (~2 mag) um ~8 Größenklassen aufhellt.

Das Skript misst in **zwei photometrischen Bändern pro Durchlauf** — TG (grüner Kanal,
V-kalibriert) und TB (blauer Kanal, B-kalibriert) — und schreibt für jedes Band eine
AAVSO-Beobachtungszeile.

Das Skript nutzt die PixInsight-eigenen Werkzeuge — die astrometrische WCS-Lösung,
FITS-Keywords und DynamicPSF — anstatt diese extern neu zu implementieren.

Der Dialog ist ein sechsstufiger Assistent — Setup → Vergleichssterne → Photometrie → Mittlere Zeit → Verifikation → Bericht.

![Setup-Schritt](screenshots/screenshot%2C%20v1.3.0%2C%20%281%29%20setup.png)
![Vergleichssterne-Schritt](screenshots/screenshot%2C%20v1.2.0%2C%20%282%29%20comp%20stars.png)

---

## Voraussetzungen

- **PixInsight 1.9.4 „Lockhart"** oder neuer (V8-JS-Engine erforderlich)
- Ein geöffneter, plate-gesolvter OSC-(One-Shot-Color-)RGB-Master-Light-Stack, debayert in PixInsight
- Der AAVSO-(VSX-)Name des Ziels, z. B. `T CrB` — oder seine J2000-Koordinaten
- Eine Internetverbindung (die Vergleichssterne werden aus dem [AAVSO VSP](https://www.aavso.org/vsp) geladen)

## Vorbedingungen für das Eingabebild

| Bedingung | Status |
|-----------|--------|
| Debayerter OSC-(One-Shot-Color-)RGB-Stack (3 Kanäle) | **Erforderlich** — TG und TB werden aus separaten Farbkanälen extrahiert; Graustufenbilder werden beim Start abgelehnt |
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

### 2. Bild in PixInsight vorbereiten

Den **linearen, plate-gesolvten OSC-RGB-Master-Stack** als aktives Fenster öffnen.
Falls noch kein Plate-Solve vorliegt, zuerst `Skript > Astronomie > ImageSolver` ausführen.

> Das Skript liest beim Start die Prozesshistorie des Stacks aus den FITS-Keywords.
> Wurden inkompatible Prozesse angewendet (Stretch, Dekonvolution, BlurXTerminator),
> erscheint nach „Photometrie starten" eine rote Warnung.

### 3. Skript ausführen

- **Schnellstart (ohne Menüeintrag):** `Skript > Skriptdatei ausführen …` → `aavso-photometry.js` auswählen
- **Mit Menüeintrag:** `Skript > Feature Scripts … > Hinzufügen` einmalig auf den Skriptordner anwenden.
  PixInsight registriert das Skript unter `Skript > BeSchne > AAVSO Photometry` und lädt
  Codeänderungen bei jedem weiteren Start automatisch neu.

### 4. Die sechs Schritte des Assistenten durchlaufen

**Schritt 1 — Setup**

| Feld | Was tun |
|------|---------|
| **Aktives Bild** | Prüfen, ob der eigene Stack angezeigt wird |
| **Bildfeld** | Nur Anzeige: Gesichtsfeld des Bildes aus dem Plate-Solve |
| **Objekt** | AAVSO-(VSX-)Name des Ziels, z. B. `T CrB` oder `RS Oph` (wird gespeichert) |
| **Comp mag limit** | Schwächste herunterzuladende Vergleichssterne (Standard 14,5, wird gespeichert). Für helle Ziele verringern |
| **Koordinaten** | Nur wenn AAVSO den Namen nicht kennt: ankreuzen und RA (`HH:MM:SS` oder Grad) und Dec eingeben. Wird automatisch angekreuzt, wenn die Namenssuche fehlschlägt |
| **Beobachtercode** | Den eigenen AAVSO-Beobachtercode eingeben |

**Schritt 2 — Vergleichssterne**

Beim Öffnen dieses Schritts lädt das Skript die Vergleichssterne und vermisst sie. Die
Statuszeile zeigt jede Stufe:

1. Objekt bei AAVSO nachschlagen — liefert die Koordinaten des Ziels
2. Vergleichssterne herunterladen — die Karte wird aus dem Plate-Solve so bemessen,
   dass sie das ganze Bild um das Ziel abdeckt
3. Aufsuchkarte als Bild herunterladen (Abbruch nach 20 s; optional)
4. PSF-Fits von Ziel und allen Vergleichssternen im Bild

Die Kandidaten erscheinen in einer Tabelle mit V-Helligkeit, Δmag zum Ziel und
PSF-Qualität. Δmag bezieht sich auf eine vorläufige Helligkeitsschätzung des Ziels in
diesem Bild — eine Katalog-Helligkeit des Ziels ist nicht nötig. Sterne, die die
Qualitätsprüfungen bestehen und innerhalb von 2 Größenklassen des Ziels liegen, werden
automatisch für das Ensemble ausgewählt. Auf eine Zeile klicken, um sie ein- oder
auszuschalten. Den **Prüfstern** aus dem Dropdown am unteren Rand wählen.

Der Download wird wiederverwendet, solange Bild, Objekt, Koordinaten und Grenzhelligkeit
gleich bleiben — Hin- und Herwechseln zwischen den Schritten wiederholt ihn nicht.

**Schritt 3 — Photometrie**

Die Photometrie startet automatisch beim Öffnen dieses Schritts:
- **TG**-Helligkeit und **MERR** — grüner Kanal, kalibriert gegen V-Band-Kataloghelligkeiten
- **TB**-Helligkeit und **MERR** — blauer Kanal, kalibriert gegen B-Band-Kataloghelligkeiten (zeigt — nur wenn die blaue PSF fehlschlug; alle Sterne in einem Standard-AAVSO-VSP-Export enthalten B-Helligkeiten)
- **TG PSF-Fluss** — Instrumentalhelligkeiten für Ziel, Comp-Ensemble und Prüfstern (grüner Kanal)
- Rote Warnung bei erkannten inkompatiblen Prozessen in der Bildhistorie
- Orange Warnung, wenn Prüfstern-Abweichung 3×MERR überschreitet

**Schritt 4 — Mittlere Zeit**

Mit den **Ordner-Schaltflächen** neben Start und Ende das erste und letzte verwendete
Subframe referenzieren. Das Skript liest `DATE-OBS` und `EXPTIME` aus dem FITS-Header
und berechnet den Belichtungsmittelpunkt automatisch als `(Start + Ende) / 2`.

**Mittlere JD**, **Luftmasse** und **Mond** auf Plausibilität prüfen.

**Schritt 5 — Verifikation**

Annotiertes Thumbnail prüfen: Ziel (roter Kreis), Comp-Sterne (grün), Check (cyan).
Bestätigen, dass die Kreise auf den richtigen Sternen liegen. Die Stretch-Schaltflächen
verwenden, um schwache Sterne besser sichtbar zu machen.

![Verifikation](screenshots/screenshot%2C%20v1.2.0%2C%20%285%29%20verification.png)

**Schritt 6 — Bericht**

Der Bericht wird automatisch beim Öffnen dieses Schritts erzeugt.
Für die AAVSO-Einreichung **AAVSO Extended Format** wählen, dann **Exportieren …** klicken
und mit Endung `.txt` speichern.

Mit angekreuztem **Also save comparison stars and finder chart** (Standard, wird
gespeichert) schreibt der Export zusätzlich `<Karten-ID>.csv` — die verwendeten
Vergleichssterne — und `<Karten-ID>.png` (die Aufsuchkarte, falls sie geladen werden
konnte) in den Ordner des Berichts. Bereits vorhandene Dateien bleiben erhalten. AAVSO
überarbeitet Sequenzen mit der Zeit; so bleibt genau dokumentiert, worauf sich das
Feld `CHART` des Berichts bezieht.

### 5. Bericht bei AAVSO einreichen

1. Das Formular [AAVSO Submit Photometric Observations](https://apps.aavso.org/v2/data/submit/photometry/) aufrufen und einloggen
2. Im ersten Feld **File upload** auswählen (nicht Manual)
3. Die exportierte `.txt`-Datei hochladen
4. Vorschau prüfen — die Beobachtung wird gegen historische Daten geplottet
5. **Submit** klicken, um zu bestätigen

---

## Ausbruchsstrategie

T CrB erwartet man um ~8 Größenklassen heller — von Ruhelage (~10 V) bis Nova-Maximum (~2 V).

Detaillierte Ausrüstungsempfehlungen — welche Vergleichssterne bei welcher Helligkeit in
welches Bildfeld passen und welche Grenzhelligkeit in jeder Phase sinnvoll ist — finden
sich in [docs/outburst-strategy.de.md](docs/outburst-strategy.de.md).

### Warum TB für die Ausbruchserkennung am wichtigsten ist

T CrB ist ein symbiotisches System: ein kühler M3-III-Roter Riese überträgt Masse auf einen
Weißen Zwerg über eine Akkretionsscheibe. In Ruhelage dominiert der Rote Riese das kombinierte
Licht. Bei zunehmender Akkretion vor und während des Ausbruchs hellen der heiße Weiße Zwerg
und die Scheibe auf — und diese heiße Strahlung hat ihr Maximum im UV/Blauen.

| Band | Kanal | Kalibriert gegen | M-Riesen-Beitrag in Ruhelage | Empfindlichkeit für WD/Scheiben-Aufhellung |
|------|-------|-----------------|----------------------------|--------------------------------------------|
| **TB** | Blau | B-Band-Comp-Mag | Gering (M3 III hat B−V ≈ +1,6) | **Höchste** |
| **TG** | Grün | V-Band-Comp-Mag | Mittel | Mittel |
| TR | Rot | Rc-Band-Comp-Mag | Dominant | Geringste |

Der **TB−TG-Farbindex** approximiert B−V. In Ruhelage ist TB deutlich schwächer als TG,
weil der M-Riese kaum blaues Licht aussendet. Wenn die heiße Komponente aufhellt, verringert
sich dieser Abstand — TB hellt schneller auf als TG. Eine anhaltende Blauverschiebung in
TB−TG (Index nähert sich null) kann ein Frühwarnsignal für erhöhte Akkretion oder
Ausbruchsbeginn sein, möglicherweise bevor TG eine signifikante Helligkeitsänderung zeigt.

TR wird daher nicht gemessen: In Ruhelage dominiert der rote Kanal überwältigend die
M-Riesen-Photosphäre; der WD/Scheiben-Beitrag ist ein kleiner Bruchteil des gesamten
Rc-Flusses, was TR zum unempfindlichsten Band für die Erkennung von Nova-Vorläufern macht.

### Phase 1 — Frühe Aufhellung (~7–9 mag): nichts zu ändern

Das Comp-Ensemble wird relativ zur *im Bild gemessenen* Helligkeit des Ziels vorausgewählt.
Hellere Vergleichssterne (bei T CrB z. B. die Labels `84` mit 8,4 V und `79` mit 7,9 V)
werden daher automatisch gewählt, wenn T CrB aufhellt. Die Auswahl im Schritt
**Vergleichssterne** prüfen und bei Bedarf anpassen.

### Phase 2 — Nova-Maximum (~2–6 mag): Comp mag limit verringern

Am Maximum sättigt T CrB bei normalen Belichtungszeiten. Dann sind sehr kurze Subframes
(unter einer Sekunde) erforderlich, und schwache Vergleichssterne sind möglicherweise
nicht mehr erfassbar.

1. **Comp mag limit** im Setup auf etwa 2–3 Größenklassen schwächer als die erwartete
   Zielhelligkeit setzen (z. B. `8` für ein Ziel mit 5 mag)
2. Mit einer Grenze von **12 oder heller** erlaubt AAVSO VSP Karten über 180′ (im Skript
   bis 1200′) — Weitfeld-Instrumente erhalten so Vergleichssterne im ganzen Bild
3. Die Karten-ID der neuen Sequenz landet automatisch im Bericht

AAVSO gibt bei Ausbruchsbeginn _Alert Notices_ mit konkreten Karten- und
Belichtungsempfehlungen heraus — [aavso.org/news](https://www.aavso.org/news) beobachten.

---

## Bekannte Einschränkungen

**TG und TB ≠ Johnson V und B.** Das Skript berichtet in den Bändern **TG** (Tricolor-Grün)
und **TB** (Tricolor-Blau), nicht in Johnson V oder B. OSC-Passbänder unterscheiden sich von
Standard-Filterbandbreiten; TG ist für rote Sterne ~0,1–0,3 mag heller als V. Der AAVSO-Bericht
enthält korrekt `FILT=TG` und `FILT=TB` mit `TRANS=NO`. TG- und TB-Messungen dürfen
niemals als V bzw. B deklariert werden.

**TB−TG ist kein kalibrierter B−V-Index.** Der Farbunterschied approximiert B−V qualitativ,
trägt aber die kombinierten unkalibrierten Versätze beider Passbänder. Er eignet sich am
besten als relativer Indikator für Farbveränderungen über die Zeit, nicht als absoluter
Farbindex im Vergleich zu Standardphotometrie.

**Seestar-Gesichtsfeld bei Nova-Maximum.** Der Seestar S30 Pro hat ein Gesichtsfeld von
~4,3° × 2,4°. Bei Maximum (~2 mag) liegen die nächsten geeigneten Vergleichssterne
(1–4 mag) möglicherweise außerhalb dieses Fensters. In diesem Fall empfiehlt sich ein
Weitwinkelinstrument, visuelle Beobachtung oder Ensemble-Photometrie mit schwächeren
feldinternen Sternen.

**AAVSO-VSP-Kartengröße und Grenzhelligkeit.** VSP erlaubt Karten über 180′ nur mit
einer Grenzhelligkeit von 12 oder heller. Bei einer schwächeren Grenze (Standard 14,5)
fordert das Skript eine 180′-Karte an und warnt auf der Konsole, dass Vergleichssterne
in den Bildecken fehlen — bei einem weiten Feld wie dem 4,3° × 2,4° des Seestar die
Grenze auf 12 setzen, um das ganze Bild abzudecken.

**Internetverbindung erforderlich.** Die Vergleichssterne werden zur Laufzeit geladen;
einen Offline-Modus gibt es nicht. Das Bild der Aufsuchkarte ist optional: Antwortet der
VSP-Bildserver nicht innerhalb von 20 s, gibt die Konsole stattdessen die URL der Karte aus.

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
| *Debayertes OSC-RGB-Bild erwartet …* | Bild ist Graustufen, Kanalextraktion oder un-debayerter Bayer-Raw | Zuerst den Debayer-Prozess in PixInsight anwenden, dann den vollständigen debayerten RGB-Master verwenden |
| *AAVSO VSP: Star … does not exist in VSX* | AAVSO kennt den Objektnamen nicht | Schreibweise prüfen (z. B. `T CrB`) oder Koordinaten eingeben (**Koordinaten** wird automatisch angekreuzt) |
| *AAVSO VSP request failed* | Keine Internetverbindung oder AAVSO nicht erreichbar | Verbindung prüfen und erneut versuchen; die Konsole zeigt die Anfrage-URL |
| *Comp mag limit must be a V magnitude* | Grenzhelligkeit leer oder ungültig | Eine Zahl eingeben, z. B. `14.5` |
| *… is outside the image frame* | Das Ziel ist nicht in diesem Bild | Objektname / Koordinaten und Plate-Solve prüfen |
| *No comparison star with a usable PSF* | Alle Vergleichssterne im Bild fielen durch die PSF-Prüfung | Grenzhelligkeit anpassen; Fokus, Sättigung und Plate-Solve prüfen |
| *PSF abgelehnt — zu schwach* | Stern zu schwach für Gauß-Fit | Helleres Comp/Check-Label wählen |
| *PSF abgelehnt — gesättigt* | Stern im Master beschnitten | Schwächeres Comp/Check-Label wählen oder Belichtung kürzen |
| Rote Warnung: *verbotener Prozess erkannt* | Stack wurde gestretcht oder dekonvolviert | Stack aus kalibrierten Subs ohne Stretch/Schärfung neu erstellen |
| Orange Warnung: *Prüfstern-Abweichung > 3×MERR* | Möglicher systematischer Fehler | Verifikations-Thumbnail auf falschen Stern oder Blending prüfen; Atmosphäre begutachten |

---

## Ausgabe

**Lesbare Zusammenfassung** (Standard): formatierter Textbericht für persönliche Unterlagen.

**AAVSO Extended Format** (auf Anforderung): kommagetrennte CSV zur direkten Einreichung über das
Formular [AAVSO Submit Photometric Observations](https://apps.aavso.org/v2/data/submit/photometry/)
(**File upload** auswählen). Der Bericht enthält **eine Beobachtungszeile pro gemessenem Band**
(`FILT=TG` und `FILT=TB`) mit gemeinsamem Datum, Luftmasse und Karten-ID. Schlüsselwerte:
`TRANS=NO`, `MTYPE=STD`, `OBSTYPE=CCD`; `NAME` ist der Sternname, wie AAVSO ihn liefert
(z. B. `T CrB`), und `CHART` die Karten-ID der geladenen Sequenz (z. B. `X43358CRK`).

---

## PixInsight-interne Dokumentation

Das Skript wird mit einer nativen PixInsight-Hilfeseite ausgeliefert, die über die
`?`-Schaltfläche im Dialog geöffnet wird.

Installation:

1. Ordner erstellen: `<PI-Installation>/doc/scripts/Photometry/`
2. `docs/Photometry.html` in diesen Ordner kopieren
3. Darin einen Unterordner `images/` erstellen und die Screenshots aus `screenshots/`
   mit folgenden Namen hineinkopieren:

| Quelldatei (`screenshots/`) | Zielname (`images/`) |
|-----------------------------|----------------------|
| `screenshot, v1.3.0, (1) setup.png` | `setup.png` |
| `screenshot, v1.2.0, (2) comp stars.png` | `comp-stars.png` |
| `screenshot, v1.3.0, (3) photometry.png` | `photometry.png` |
| `screenshot, v1.2.0, (4) mid-time.png` | `mid-time.png` |
| `screenshot, v1.2.0, (5) verification.png` | `verification.png` |
| `screenshot, v1.3.0, (6) report, human readable.png` | `report-human.png` |
| `screenshot, v1.3.0, (6) report, aavso.png` | `report-aavso.png` |

---

## Verzeichnisstruktur

```
aavso-photometry.js          Hauptskript
docs/
  Photometry.html            Native PixInsight-Hilfeseite (in PI-Dokumentationsbaum installieren)
  aavso-extended-format.md   AAVSO Extended File Format Feldbeschreibung
  domain-knowledge.md        Photometrie-Konstanten und wissenschaftliche Hinweise
  outburst-strategy.de.md    T-CrB-Ausbruch: Ausrüstungsempfehlungen (auch .md)
  time-handling.md           Spezifikation der Belichtungsmittelzeit
  pjsr-api-notes.md          Verifizierte PJSR-API-Muster und Fallstricke
  plan-generic-target.md     Plan v2.0: beliebiges Ziel, automatische Vergleichssterne
screenshots/                 Dialog-Screenshots (alle Versionen)
CLAUDE.md                    Hinweise für KI-Coding-Assistenten
TODO.md                      Aufgabenliste und Roadmap
```

---

## Roadmap

- ~~Ensemble-Photometrie~~ — erledigt (v1.2.0)
- ~~Mehrband TG + TB~~ — erledigt (v1.3.0)
- ~~Frei wählbarer Zielstern, automatische Vergleichssterne aus AAVSO VSP~~ — erledigt (v2.0.0)
- TG→V-Farbtransformation (`TRANS=YES`)

---

## Autor

Benno Schneider · AAVSO-Beobachtercode **BSLA**

<br/>

<img src="docs/astrophotography%20and%20photometry%20meme.png" width="800"/>

---

🤖 Erstellt mit [Claude Code](https://claude.ai/claude-code)
