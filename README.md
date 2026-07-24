# klmpfh.github.io

Kleine Sammlung eigenständiger Web-Tools und Spielereien, statisch gehostet über GitHub Pages.

## Struktur

```
index.html              Startseite mit Links zu allen Projekten
<projekt>/index.html    jede Unterseite ist ein eigenständiges Tool
assets/css/reset.css     gemeinsamer CSS-Reset (box-sizing, margin, padding)
assets/css/theme.css     gemeinsames Design-System (Farb-/Radius-/Schatten-Tokens)
assets/js/nav.js                gemeinsames, minimales Kopfmenü (siehe unten)
assets/js/escape-html.js        gemeinsamer escapeHtml()-Helfer
assets/js/scenario-generator.js gemeinsame Engine für die W12-Szenario-Generatoren
```

Alle Seiten teilen sich ein einheitliches, modernes Design (helles Grau, akzentuiert
durch eine Highlight-Farbe) und ein gemeinsames Kopfmenü. Jede Unterseite bleibt
technisch trotzdem eigenständig: eigenes `<style>` mit eigenem Layout/eigener Logik,
das aber die Tokens aus `assets/css/theme.css` referenziert (z. B.
`--primary: var(--theme-accent);`) statt eigene Farbwerte fest zu verdrahten. Wer
Farbe, Radius oder Schatten global ändern will, tut das an einer Stelle in
`theme.css` – nicht auf jeder Seite einzeln.

**Kopfmenü (`assets/js/nav.js`):** Jede Seite bindet es direkt nach `<body>` per
`<script src="../assets/js/nav.js"></script>` ein. Das Script fügt sich selbst an
dieser Stelle in die Seite ein (Logo + Menü-Button mit Liste aller Tools) und
erkennt anhand des Pfads, welche Seite gerade aktiv ist. Neue Unterseiten,
umbenannte Tools oder ein geändertes Menü-Design werden ausschließlich in `nav.js`
gepflegt – keine einzelne Seite muss dafür angefasst werden.

**Zufällige Highlight-Farbe & Verlauf:** `nav.js` würfelt bei jedem Seitenaufruf
sowohl die Richtung des Hintergrund-Verlaufs als auch den Farbton (Hue) der
Akzentfarbe neu (Sättigung/Helligkeit bleiben über `--theme-accent-hue` in
`theme.css` konstant) und schreibt beides als CSS-Variablen auf `<html>`.

Alle Links und `<link>`/`<script>`-Pfade sind relativ (kein führender `/`), damit
die Seiten sowohl über GitHub Pages als auch direkt per Doppelklick (`file://`)
im Browser funktionieren. `nav.js` bestimmt den Pfad zur Startseite ebenfalls
relativ, über die eigene `src`-Angabe.

## Projekte

- `/fragezeichen/` – Zeigt ein zufälliges Spotify-Album aus einer kuratierten Liste.
- `/abz/` – Arbeitszeit-Tracker, erfasst Arbeitszeiten für den Tag ohne Speicherung.
- `/choose/` – Choose Wisely: lost eine Option aus einer Liste oder markiert einen
  zufälligen Punkt auf einem Foto.
- `/ical/` – iCal Terminsuche, findet freie Termin-Slots anhand mehrerer iCal-Dateien.
- `/ical/tools/` – entfernt/anonymisiert persönliche Daten aus iCal-Dateien und
  exportiert sie im gewünschten Zeitraum als .ics oder als maschinenlesbares CSV.
- `/fileshare/` – Teilt Dateien direkt zwischen zwei Browsern per WebRTC (Peer-to-Peer),
  ohne Upload auf einen Server. Sitzungslink/QR-Code enthält eine zufällige 128-Bit-ID.
- `/mermaid/` – Live-Editor für Mermaid-Diagramme: geteilter Bildschirm mit Syntax-Highlighting
  links, gerenderter Vorschau rechts und Fehlerkonsole darunter.
- `/knallbum/` – Berechnet aus Preisen an der Bar die beste Option (ml Alkohol/€).
- `/laserfeelings/` – Szenario-Generator für Laser & Feelings.
- `/zauberkloppen/` – Szenario-Generator für Fantasy-Rollenspiele.

## Entwicklung

Reines statisches HTML/CSS/JS, kein Build-Schritt nötig. Dateien direkt im Browser
öffnen oder lokal servieren, z. B. mit `npx serve` oder `python -m http.server`.

Idee von klmpfh, code von Claude
