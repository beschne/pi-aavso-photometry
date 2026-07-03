# T CrB Ausbruchsstrategie

Praktische Ausrüstungs- und Kartenempfehlungen für alle, die für den Ausbruch von
T Coronae Borealis gerüstet sein wollen. Die Winkelabstände und Kartenabdeckung
stammen aus der AAVSO-Photometriesequenz X42615, die Bildfelder aus den
Instrumentendaten.

## Das Kernproblem

In Ruhe steht T CrB bei ~10 V, im Nova-Maximum bei ~2 V — ein Sprung von acht
Größenklassen. Für Differentialphotometrie braucht man Vergleichssterne, die nur
wenige Größenklassen vom Ziel entfernt **und** im selben Bildfeld liegen. Die
AAVSO-geprüften Vergleichssterne, die beim Ausbruch hell genug sind, um zu zählen,
sind fast alle andere Mitglieder der Corona Borealis — und die stehen 1–8° entfernt.

## Welche Vergleichssterne enthält die AAVSO-Sequenz?

Karte X42615CFQ (900′-Feld, die weiteste vorgehaltene Karte) listet folgende Sterne
heller als V = 5 samt ihrem Winkelabstand zu T CrB:

| Karten-Label | V-Mag | Abstand | dRA | dDec | Identität |
|:------------:|------:|--------:|----:|-----:|-----------|
| 41 | 4,14 | 1,05° | 0,43° | 0,96° | ε CrB |
| 48 | 4,83 | 3,18° | 0,64° | 3,12° | (Feldstern, fast genau nördlich) |
| 38 | 3,81 | 3,78° | 3,76° | 0,38° | γ CrB |
| 50 | 4,99 | 3,95° | 0,43° | 3,93° | ι CrB |

Zwei helle Sterne fehlen in der AAVSO-Sequenz von T CrB: δ CrB (4,63 V, 2,2°) und
β CrB (3,68 V, 7,7°).

## Welche Sterne passen in welches Bildfeld?

Ein Stern liegt im Bild, wenn sein RA-Abstand ≤ halbe Längsachse **und** sein
Dec-Abstand ≤ halbe Querachse (ungünstigste Ausrichtung, T CrB zentriert):

| Karten-Label | V | Abstand | Seestar S30 Pro (4,3°×2,4°) | RedCat 51 + ASI2600MC Air (5,4°×3,6°) | RedCat 51 + Vollformat (8,2°×5,5°) |
|:------------:|--:|--------:|:---:|:---:|:---:|
| **41** | **4,14** | **1,05°** | **✓** | **✓** | **✓** |
| 48 | 4,83 | 3,18° | ✗ (dDec 3,1° > 1,2°) | ✗ (dDec 3,1° > 1,8°) | ✗ (dDec 3,1° > 2,75°) |
| 38 | 3,81 | 3,78° | ✗ (dRA 3,8° > 2,15°) | ✗ (dRA 3,8° > 2,7°) | ✓ |
| 50 | 4,99 | 3,95° | ✗ | ✗ | ✗ (dDec 3,9° > 2,75°) |
| 22 (Alphecca) | 2,23 | 5,62° | ✗ | ✗ | ✗ (dRA 5,6° > 4,1°) |

**Kernergebnis:** Label 41 (ε CrB, V=4,14, 1,05° entfernt) ist der einzige
AAVSO-geprüfte helle Vergleichsstern, der in ein Teleskop-Bildfeld passt — und er
steht in jeder Konfiguration im Bild, auch beim Seestar S30 Pro.

## Ausrüstung im Vergleich beim Ausbruch

**Seestar S30 Pro (4,3°×2,4°)**

Bei jeder Ausbruchshelligkeit steht Label 41 (4,14 V) nur 1,05° entfernt und liegt
auf beiden Achsen bequem im Bild. Ein einzelner Vergleichsstern, der 2 oder mehr
Größenklassen schwächer ist als T CrB, genügt für einen Einband-Bericht: Label 41
als Comp, den besten verfügbaren schwächeren Stern als Check.

**RedCat 51 + ZWO ASI2600MC Air — APS-C 23,5×15,7 mm → 5,4°×3,6°, 3,1″/px**

Für die hellen Ausbruchs-Vergleichssterne dasselbe Bild wie beim Seestar: nur
Label 41 passt hinein. Das weitere Feld zahlt sich in der **Aufhellungsphase
(5–8 mag)** aus, weil es mehr schwache Ensemble-Vergleichssterne der 450′-Karte
mitnimmt und so den ZP-Fehler drückt.

**RedCat 51 + Vollformatkamera — ca. 8,2°×5,5°**

Nimmt zusätzlich Label 38 (γ CrB, 3,81 V, 3,78° entfernt) mit. Jetzt hat man zwei
helle Vergleichssterne, die T CrB in der Helligkeit einrahmen — das verbessert die
ZP-Bestimmung am Maximum.

**Kameraobjektiv (50–135 mm Brennweite → 10–25° Bildfeld)**

Fängt Alphecca (2,23 V, 5,62°) und den ganzen Ring der CrB-Sterne ein. Ideal für die
Maximalhelligkeit (1–3 mag), wenn T CrB die hellsten Vergleichssterne in jedem
Teleskop-Bildfeld überstrahlt. Man braucht dafür einen OSC- oder Monochrom-Body;
Skript und AAVSO-Berichtsformat bleiben dieselben.

## Empfohlene Karte und Befehl je Phase

| T-CrB-Helligkeit | Beste Ausrüstung | Karte | Befehl (falls neu laden nötig) |
|-----------------|-----------------|-------|--------------------------------|
| ~10 mag (Ruhe) | Seestar S30 Pro | `charts/X42615CFD.csv` (450′) | bereits vorhanden |
| 8–10 mag (Aufhellung) | Seestar S30 Pro | `charts/X42615CFQ.csv` (900′) | bereits vorhanden |
| 4–8 mag | Seestar S30 Pro oder RedCat51 + APS-C | `charts/X42615CFQ.csv` (900′) | bereits vorhanden |
| 2–4 mag | RedCat51 + Vollformat | `charts/X42615CHL.csv` (900′, Grenzhelligkeit 5) | bereits vorhanden |
| ~2 mag (Maximum) | Kameraobjektiv | `charts/X42615CHL.csv` oder Karte aus der AAVSO Alert Notice | Alert Notice folgen; fetch-vsp.py mit dem angegebenen Bildfeld ausführen |

Am Maximum sättigt T CrB selbst bei sehr kurzen Belichtungen im Teleskop. Nimm die
kürzestmöglichen Subframes im Sekundenbruchteil, die deine Kamera zulässt — die
Referenzdatei-Zeiterfassung des Skripts kommt mit beliebigen Belichtungszeiten
zurecht.

## Wenn der Ausbruch bestätigt ist

Die AAVSO gibt eine Alert Notice mit Karten-, Belichtungs- und Meldeempfehlungen
heraus — behalte [aavso.org/news](https://www.aavso.org/news) im Auge. Die Alert
Notice nennt eine konkrete Karten-ID; führe `fetch-vsp.py` mit deren Bildfeld und
Grenzhelligkeit aus, um die passende CSV zu ziehen — oder warte, bis die AAVSO-VSP-API
nach der v2-Migration wieder läuft.

Zwei Karten liegen bereits fertig vor:

- **`charts/X42615CFQ.csv`** — 900′, Grenzhelligkeit 14,5, 370 Sterne. Bei jeder
  Helligkeit brauchbar: Die schwachen Vergleichssterne tragen in Ruhe das Ensemble,
  die hellen (Labels 22–50) decken den Ausbruchsbereich ab.
- **`charts/X42615CHL.csv`** — 900′, Grenzhelligkeit 5, 9 Sterne (V 2,2–5,0). Die
  Ausbruchskarte: weniger Ablenkung, nur helle Sterne. Sie enthält:

  | Label | V | Hinweis |
  |:-----:|--:|---------|
  | 22 | 2,23 | Alphecca (α CrB), 5,6° — nur Kameraobjektiv |
  | 28 | 2,78 | 8,3° — nur Kameraobjektiv |
  | 37 | 3,68 | β CrB, 7,7° — nur Kameraobjektiv |
  | 37 | 3,75 | 8,5° — nur Kameraobjektiv |
  | 38 | 3,81 | γ CrB, 3,8° — RedCat51+Vollformat oder Kameraobjektiv |
  | 41 | 4,14 | ε CrB, 1,05° — **in jeder Konfiguration, auch Seestar S30 Pro** |
  | 45 | 4,52 | 7,5° — nur Kameraobjektiv |
  | 48 | 4,83 | 3,2° — nur Kameraobjektiv (nördlich von T CrB) |
  | 50 | 4,99 | ι CrB, 4,0° — nur Kameraobjektiv |
