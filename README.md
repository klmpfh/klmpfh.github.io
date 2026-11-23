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
- `/fileshare/` – Gemeinsamer Datei-Pool für beliebig viele Browser per WebRTC (Peer-to-Peer), ohne Upload auf
  einen Server. Raumlink/QR-Code enthält eine zufällige 128-Bit-ID. Alle Geräte sind direkt miteinander verbunden
  (Mesh) und können jederzeit Dateien hinzufügen und laden; geladene Dateien bietet ein Gerät selbst weiter an.
  Ein Gerät hält den „Eingang“ (feste Peer-ID aus der Raum-ID) für neue Geräte – geht es, übernimmt ein anderes.
  Der Raum bleibt offen, bis das letzte Gerät ihn verlässt.
- `/mermaid/` – Live-Editor für Mermaid-Diagramme: geteilter Bildschirm mit Syntax-Highlighting
  links, gerenderter Vorschau rechts und Fehlerkonsole darunter.
- `/knallbum/` – Berechnet aus Preisen an der Bar die beste Option (ml Alkohol/€).
- `/laserfeelings/` – Szenario-Generator für Laser & Feelings.
- `/kwidt/` – Kwidt: Teilt gemeinsame Ausgaben in Gruppen auf (gleich, Beträge, Prozent, Anteile, Korrektur).
  Ohne Server: Daten liegen im Browser, Abgleich per Link oder live per WebRTC (`core.js` ist die Rechenlogik,
  `app.js` Oberfläche und Sync; PeerJS und QR-Code kommen aus `fileshare/vendor/`). `sw.js` hält die App offline bereit. Beim Anlegen einer Gruppe lässt sich ein Excel-Export aus Splid (.xls) übernehmen.
- `/gone/` – gone: Verleih-Liste in beide Richtungen
  (Schalter „Von mir“ / „An mich“): was, wann, an wen bzw. von wem, bis wann geplant.
  Status (offen/fällig/überfällig/zurück), Filter und Suche. Daten liegen nur im localStorage des Browsers,
  Backup als JSON-Datei herunterladen und wieder einlesen.
- `/wohnung/` – Wohnung kaufen oder mieten: persönliche Finanzen (Cash, Eigenkapital, Einkommen, Kreditrahmen der Bank,
  private Nebenkosten wie Strom/Internet/Rundfunk – je Wohnung abwählbar, wenn schon in Warmmiete/Hausgeld enthalten) auf der
  Übersicht. Mietwohnungen mit Kalt-/Warmmiete, Kaution und fester, Staffel- oder Indexmiete (Mietentwicklung über 10 Jahre),
  im selben Vergleich wie Kaufwohnungen. Je Kaufwohnung Kaufpreis, Nebenkosten (Grunderwerbsteuer je Bundesland), Hausgeld, WG-Zimmer mit Untermiete
  (inkl. grober Steuerschätzung), Annuitätendarlehen mit Zinsbindung/Anschlusszins/Sondertilgung. Monatsbilanz, Checks,
  Tilgungsplan, Diagramm und Vergleichstabelle. Objekt-Bewertung gegen Faustwerte (Hausgeld/m², Baujahr, Grundsteuer,
  Makler, Inventar, WG-Eignung) mit Rückfragen an Makler/Verwaltung zum Kopieren und Unterlagen-Checkliste. Wünsche & Bedingungen:
  Personen ergänzen frei formulierte Wünsche, jede Person gewichtet jeden Wunsch (0–100 %) und bewertet ihn in jeder Wohnung;
  daraus Passung je Person und gemeinsam (offene Gewichtungen/Bewertungen werden angezeigt). `js/calc.js` ist die Rechenlogik, `js/app.js` die Oberfläche. Daten im
  localStorage, Übertragung zwischen Geräten per JSON-Export/-Import (alles oder einzelne Wohnung) oder per Link/QR-Code
  (`#import=…`, Daten deflate-komprimiert im Hash, überschreibt nach Rückfrage alles auf dem Zielgerät).
- `/zauberkloppen/` – Szenario-Generator für Fantasy-Rollenspiele.
- `/zeitfresser/` – Zeitfresser: Wochenanalyse, wohin die Zeit geht. Themen mit Wert pro Woche oder pro Tag
  an gewählten Wochentagen, darunter eine Ebene Unterpunkte; nicht zugeordnete Zeit wird schraffiert gezeigt,
  Überschreitungen pulsieren rot. Verschieben per Drag & Drop oder ↑/↓, 12 Themenfarben zur Auswahl.
  Kreisdiagramm (innen Themen, außen Unterpunkte) und Balken je Wochentag. Mehrere Szenarien, gespeichert im localStorage.

## Entwicklung

Reines statisches HTML/CSS/JS, kein Build-Schritt nötig. Dateien direkt im Browser
öffnen oder lokal servieren, z. B. mit `npx serve` oder `python -m http.server`.

Idee von klmpfh, code von Claude
