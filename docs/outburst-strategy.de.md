# T CrB Ausbruchsstrategie

Praktische Ausrüstungs- und Kartenempfehlungen für Beobachter, die auf den Ausbruch
von T Coronae Borealis vorbereitet sein wollen. Winkelabstände und Bildfelddaten
wurden aus der AAVSO-Sequenz X42615 und den Instrumentenspezifikationen berechnet.

## Das Kernproblem

In Ruhelage ist T CrB ~10 V; am Nova-Maximum erreicht sie ~2 V — ein Sprung von
8 Größenklassen. Differentialphotometrie erfordert Vergleichssterne innerhalb weniger
Größenklassen des Ziels **und** im selben Bildfeld. Die AAVSO-geprüften Vergleichssterne
für T CrB, die beim Ausbruch relevant sind, sind überwiegend andere Mitglieder der Corona
Borealis, verteilt über 1–8° Abstand.

## Welche Vergleichssterne sind in der AAVSO-Sequenz?

Aus Karte X42615CFQ (900′-Feld, die breiteste vorberechnete Karte), Sterne heller als V = 5
und ihr Winkelabstand von T CrB:

| Karten-Label | V-Mag | Abstand | dRA | dDec | Identität |
|:------------:|------:|--------:|----:|-----:|-----------|
| 41 | 4,14 | 1,05° | 0,43° | 0,96° | ε CrB |
| 48 | 4,83 | 3,18° | 0,64° | 3,12° | (Feldstern, fast genau nördlich) |
| 38 | 3,81 | 3,78° | 3,76° | 0,38° | γ CrB |
| 50 | 4,99 | 3,95° | 0,43° | 3,93° | ι CrB |

Bemerkenswerte Sterne, die *nicht* in der AAVSO-T-CrB-Sequenz enthalten sind: δ CrB (4,63 V, 2,2°), β CrB (3,68 V, 7,7°).

## Welche Sterne passen in das Bildfeld welcher Ausrüstung?

Ein Stern liegt im Bildfeld, wenn sein RA-Abstand ≤ halbe Längsachse **und** sein
Dec-Abstand ≤ halbe Querachse (ungünstigste Ausrichtung, T CrB zentriert):

| Karten-Label | V | Abstand | Seestar S30 Pro (4,3°×2,4°) | RedCat 51 + ASI2600MC Air (5,4°×3,6°) | RedCat 51 + Vollformat (8,2°×5,5°) |
|:------------:|--:|--------:|:---:|:---:|:---:|
| **41** | **4,14** | **1,05°** | **✓** | **✓** | **✓** |
| 48 | 4,83 | 3,18° | ✗ (dDec 3,1° > 1,2°) | ✗ (dDec 3,1° > 1,8°) | ✗ (dDec 3,1° > 2,75°) |
| 38 | 3,81 | 3,78° | ✗ (dRA 3,8° > 2,15°) | ✗ (dRA 3,8° > 2,7°) | ✓ |
| 50 | 4,99 | 3,95° | ✗ | ✗ | ✗ (dDec 3,9° > 2,75°) |
| 22 (Alphecca) | 2,23 | 5,62° | ✗ | ✗ | ✗ (dRA 5,6° > 4,1°) |

**Kernergebnis:** Label 41 (ε CrB, V=4,14, 1,05° Abstand) ist der einzige
AAVSO-geprüfte helle Vergleichsstern, der in ein Teleskop-Bildfeld passt.
Er ist bei jeder Ausrüstung sichtbar, einschließlich des Seestar.

## Ausrüstungsvergleich beim Ausbruch

**Seestar S30 Pro (4,3°×2,4°)**

Bei jeder Ausbruchshelligkeit: Label 41 (4,14 V) ist 1,05° entfernt — bequem im
Bildfeld auf beiden Achsen. Ein einzelner Vergleichsstern, der 2+ Größenklassen
schwächer ist als T CrB, ist für einen Einband-Bericht akzeptabel; Label 41 als
Comp, den besten verfügbaren schwächeren Stern als Check verwenden.

**RedCat 51 + ZWO ASI2600MC Air — APS-C 23,5×15,7 mm → 5,4°×3,6°, 3,1″/px**

Gleiches Ergebnis wie der Seestar für helle Ausbruchs-Vergleichssterne: nur Label 41
passt ins Bildfeld. Das breitere Feld hilft in der **Aufhellungsphase (5–8 mag)**,
wo es mehr schwache Ensemble-Vergleichssterne aus der 450′-Karte erfasst und damit
den ZP-Fehler reduziert.

**RedCat 51 + Vollformatkamera — ca. 8,2°×5,5°**

Ergänzt Label 38 (γ CrB, 3,81 V, 3,78° Abstand). Damit stehen zwei helle
Vergleichssterne zur Verfügung, die T CrB in der Helligkeit einrahmen — bessere
ZP-Bestimmung am Maximum.

**Kameraobjektiv (50–135 mm Brennweite → 10–25° Bildfeld)**

Erfasst Alphecca (2,23 V, 5,62°) und den vollständigen Ring der CrB-Sterne. Ideal
für die Maximalhelligkeit (1–3 mag), wenn T CrB die hellsten Vergleichssterne in
jedem Teleskop-Bildfeld überstrahlt. Erfordert eine OSC- oder Monochromkamera;
dasselbe Skript und AAVSO-Berichtsformat gelten unverändert.

## Empfohlene Karte und Befehl pro Phase

| T-CrB-Helligkeit | Beste Ausrüstung | Karte | Befehl (falls neu laden nötig) |
|-----------------|-----------------|-------|--------------------------------|
| ~10 mag (Ruhelage) | Seestar | `charts/X42615CFD.csv` (450′) | bereits vorhanden |
| 8–10 mag (Aufhellung) | Seestar | `charts/X42615CFQ.csv` (900′) | bereits vorhanden |
| 4–8 mag | Seestar oder RedCat51+APS-C | `charts/X42615CFQ.csv` (900′) | bereits vorhanden |
| 2–4 mag | RedCat51+Vollformat | `charts/X42615CHL.csv` (900′, Grenzhelligkeit 5) | bereits vorhanden |
| ~2 mag (Maximum) | Kameraobjektiv | `charts/X42615CHL.csv` oder AAVSO-Alert-Notice-Karte | Alert Notice abwarten; fetch-vsp.py mit angegebenen Parametern |

Am Helligkeitsmaximum sättigt T CrB selbst bei sehr kurzen Belichtungszeiten im Teleskop.
Die kürzestmöglichen Subframes verwenden; die Referenzdatei-Zeiterfassung des Skripts
unterstützt beliebig kurze Belichtungszeiten.

## Wenn der Ausbruch bestätigt ist

AAVSO gibt einen Alert Notice mit Karten-, Belichtungs- und Meldeempfehlungen heraus —
[aavso.org/news](https://www.aavso.org/news) beobachten. Der Alert Notice nennt eine
spezifische Karten-ID; `fetch-vsp.py` mit dem entsprechenden Bildfeld und der
Grenzhelligkeit ausführen, um die passende CSV zu laden — oder auf die Wiederherstellung
der AAVSO-VSP-API (v2-Migration) warten.

Zwei Karten sind vorbereitend vorhanden:

- **`charts/X42615CFQ.csv`** — 900′, Grenzhelligkeit 14,5, 370 Sterne. Bei jeder
  Helligkeit verwendbar; die schwachen Sterne tragen das Ensemble in Ruhelage,
  die hellen (Labels 22–50) decken den Ausbruchsbereich ab.
- **`charts/X42615CHL.csv`** — 900′, Grenzhelligkeit 5, 9 Sterne (V 2,2–5,0).
  Die Ausbruchs-Karte: weniger Ablenkung, nur helle Sterne. Enthaltene Sterne:

  | Label | V | Hinweis |
  |:-----:|--:|---------|
  | 22 | 2,23 | Alphecca (α CrB), 5,6° — nur Kameraobjektiv |
  | 28 | 2,78 | 8,3° — nur Kameraobjektiv |
  | 37 | 3,68 | β CrB, 7,7° — nur Kameraobjektiv |
  | 37 | 3,75 | 8,5° — nur Kameraobjektiv |
  | 38 | 3,81 | γ CrB, 3,8° — RedCat51+Vollformat oder Kameraobjektiv |
  | 41 | 4,14 | ε CrB, 1,05° — **bei jeder Ausrüstung, auch Seestar** |
  | 45 | 4,52 | 7,5° — nur Kameraobjektiv |
  | 48 | 4,83 | 3,2° — nur Kameraobjektiv (nördlich von T CrB) |
  | 50 | 4,99 | ι CrB, 4,0° — nur Kameraobjektiv |
