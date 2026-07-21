# klmpfh.github.io

Kleine Sammlung eigenständiger Web-Tools und Spielereien, statisch gehostet über GitHub Pages.

## Struktur

```
index.html              Startseite mit Links zu allen Projekten
<projekt>/index.html    jede Unterseite ist ein eigenständiges Tool
assets/css/reset.css     gemeinsamer CSS-Reset (box-sizing, margin, padding)
assets/js/escape-html.js        gemeinsamer escapeHtml()-Helfer
assets/js/scenario-generator.js gemeinsame Engine für die W12-Szenario-Generatoren
```

Jede Unterseite bleibt ansonsten bewusst eigenständig (eigenes Farbschema, eigenes
Layout, eigene Logik) – nur wirklich doppelter Code (Reset, escapeHtml, der
Szenario-Wurf) liegt zentral in `assets/`.

Alle Links und `<link>`/`<script>`-Pfade sind relativ (kein führender `/`), damit
die Seiten sowohl über GitHub Pages als auch direkt per Doppelklick (`file://`)
im Browser funktionieren.

## Projekte

- `/fragezeichen/` – Zeigt ein zufälliges Spotify-Album aus einer kuratierten Liste.
- `/abz/` – Arbeitszeit-Tracker, erfasst Arbeitszeiten für den Tag ohne Speicherung.
- `/choose/` – Choose Wisely: lost eine Option aus einer Liste oder markiert einen
  zufälligen Punkt auf einem Foto.
- `/ical/` – iCal Terminsuche, findet freie Termin-Slots anhand mehrerer iCal-Dateien.
- `/icaltools/` – entfernt/anonymisiert persönliche Daten aus iCal-Dateien und
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
