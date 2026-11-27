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
  `app.js` Oberfläche und Sync; PeerJS und QR-Code kommen aus `fileshare/vendor/`). Beim Öffnen einer Gruppe steht oben, was seit dem letzten Besuch neu ist (gebuchte Wiederholungen, Änderungen anderer). Beim Anlegen einer Gruppe lässt sich ein Excel-Export aus Splid (.xls) übernehmen.
- `/geldkugel/` – Geldkugel: Monatsbudget aus Einnahmen und Ausgaben. Kategorien gelten global für alle Szenarien
  (auch ihre Art: Einnahmen oder Ausgaben) und werden nur im eigenen Dialog „Kategorien“ im Kasten „Für alle Szenarien“
  angelegt, umbenannt, umgefärbt, sortiert und gelöscht (`js/categories.js`); dort stehen auch Export/Import, „Mit KI“ und
  Einmal-Link. In der Eingabe eines Szenarios sind Kategorien nur Überschriften. Je Szenario Zahlungen mit Betrag und Intervall (wöchentlich, zweiwöchentlich,
  monatlich, vierteljährlich, halbjährlich, jährlich), alles auf den Monat heruntergerechnet (Betrag × Zahlungen pro Jahr ÷ 12).
  Zahlungen lassen sich am Griff ziehen (Pointer-Events, auch per Finger) oder mit ↑/↓ verschieben, auch in eine andere Kategorie.
  Bilanz je Szenario: Statuszeile (passt / reicht nicht, was offen bleibt bzw. fehlt) und gestapelte Balken Einnahmen gegen
  Ausgaben. Geschichteter Donut der Ausgaben (innen Kategorien, außen Zahlungen; ganzer Kreis = Einnahmen, Offenes schraffiert,
  Fehlbetrag als rote Kante) mit Legende. „Deutung“ vergleicht zwei Szenarien: Wasserfall von A nach B über die Änderung je
  Kategorie – mit Einnahmen für das, was am Monatsende bleibt, sonst für die Ausgaben (rot = weniger übrig, blau = mehr übrig) –,
  dazu Tabelle getrennt nach Einnahmen und Ausgaben mit Differenzbalken und den Zahlungen, die dazukommen, wegfallen oder sich ändern
  (Zuordnung über den Namen innerhalb der Kategorie). Daten im localStorage, Export/Import aller Szenarien samt Kategorien als JSON
  (hinzufügen mit Zusammenlegen gleichnamiger Kategorien oder alles ersetzen) und Übertragung zwischen Geräten per Einmal-Link
  wie in Zeitfresser und Wohnung (`js/sync.js` mit `assets/js/sync-core.js` führt zusammen – je Feld gewinnt die neuere Änderung,
  gleichnamige Kategorien beider Geräte werden eins –, `js/transfer.js` mit `assets/js/transfer.js` verbindet).
  Neues Szenario aus Kontoumsätzen per KI: Prompt kopieren (mit den vorhandenen Kategorien, ohne Beträge), mit CSV/PDF der Bank in eine KI geben,
  Antwort einfügen oder als Datei importieren (`js/ai.js`; der Import verträgt Text um den JSON-Block, englische Intervalle, Beträge mit Minus).
  `js/state.js` Datenmodell und Rechnen, `js/editor.js` Eingabe, `js/charts.js` Bilanz und Donut, `js/compare.js` Vergleich,
  `js/dialog.js` wie im Zeitfresser.
- `/gone/` – gone: Verleih-Liste in beide Richtungen
  (Schalter „Von mir“ / „An mich“): was, wann, an wen bzw. von wem, bis wann geplant.
  Status (offen/fällig/überfällig/zurück), Filter und Suche. Daten liegen nur im localStorage des Browsers,
  Backup als JSON-Datei herunterladen und wieder einlesen.
- `/wohnung/` – Wohnung kaufen oder mieten: Personen (gelten für Kostenaufteilung, ein Maximum pro Monat je Person und Wünsche; faire Miete je Zimmer nach Größe, Lage und Ausstattung), Finanzierung laut Bank (max. Monatsrate, max. Darlehen, Eigenkapital, Konditionen – gilt für alle Kaufwohnungen, mit Anleitung zum Selberrechnen), dazu die Grenze für die eigenen Netto-Wohnkosten (das eigene Maximum; Kauf- und Mietwohnungen darüber werden auf Karte, im Vergleich und in den Checks markiert, beim Kauf mit der Rate, die noch passt),
  private Nebenkosten (Strom/Internet/Rundfunk, mit Zeitraum (Monat bis Jahr) und Aufteilung (gleichmäßig, Prozent, je Person,
  komplett), je Wohnung abwählbar, wenn schon in Warmmiete/Hausgeld enthalten; Heizung als eigener Posten, je Wohnung extra oder enthalten) auf der
  Übersicht. Mietwohnungen mit Kalt-/Warmmiete, Kaution und fester, Staffel- oder Indexmiete (Mietentwicklung über 10 Jahre),
  im selben Vergleich wie Kaufwohnungen. Je Kaufwohnung Kaufpreis, Nebenkosten (Grunderwerbsteuer je Bundesland), Hausgeld, WG-Zimmer mit Untermiete
  (ohne Steuer), Annuitätendarlehen mit Zinsbindung/Anschlusszins/Sondertilgung (Rate standardmäßig die max. Monatsrate der Bank). Monatsbilanz, Checks,
  Tilgungsplan, Diagramm und Vergleichstabelle. Objekt-Bewertung gegen Faustwerte (Hausgeld/m², Baujahr, Energieverbrauch und Heizung mit geschätzten Heizkosten, Grundsteuer,
  Makler, Inventar, WG-Eignung) mit Rückfragen an Makler/Verwaltung zum Kopieren und Unterlagen-Checkliste. Wünsche & Bedingungen:
  gemeinsame Liste frei formulierter Wünsche (für alle gleich oder bezogen auf einen Ort je Person), jede Person gewichtet jeden Wunsch (0–100 %) und bewertet ihn in jeder Wohnung;
  daraus Passung je Person und gemeinsam (offene Gewichtungen/Bewertungen werden angezeigt). `js/calc.js` ist die Rechenlogik, `js/app.js` die Oberfläche. Je Wohnung Status (typische Schritte bei Kauf bzw. Miete, auch „Kommt nicht in Frage“) und Tagebuch (`js/diary.js`); Aussortierte stehen auf der Übersicht zugeklappt und fehlen im Vergleich. Daten im
  localStorage, Übertragung zwischen Geräten per Einmal-Link oder JSON-Export/-Import (alles oder einzelne Wohnung). Der Einmal-Link überträgt per WebRTC alles genau einmal,
  wahlweise nur in eine Richtung oder als Abgleich in beide (je Feld gewinnt die neuere Änderung; `js/sync.js` mit `assets/js/sync-core.js` führt zusammen, `assets/js/transfer.js` verbindet, PeerJS und QR-Code kommen aus `fileshare/vendor/`). Angebote lassen sich per KI übernehmen:
  Prompt auf der Wohnungsseite kopieren, Antwort (JSON) dort einfügen (`js/offer.js`: Felder, Prompt und Einlesen). Wichtige Orte der Personen (Arbeit, Familie …) und die Wünsche gehen in den Prompt (eindeutig Erfülltes wird vorausgefüllt; Wünsche mit Ort je Person haben dort je Person eine Kennung, Namen stehen nicht darin);
  Entfernungen zu den Orten und zur nächsten U-/S-Bahn stehen je Wohnung und im Vergleich. Karte der Wohnungen und wichtigen Orte auf der Übersicht (`js/map.js`, Leaflet in `vendor/`, Kacheln von tile.openstreetmap.de):
  lädt erst nach Zustimmung, weil die Adressen zum Finden an Photon (photon.komoot.io, `js/geo.js`, höchstens eine Anfrage pro Sekunde) gehen. Jede Adresse wird nur einmal gesucht, die Koordinaten stehen danach bei der Wohnung bzw. beim Ort (`geo`, auch im Abgleich und Export).
  Beträge tragen ihre Bezugsgröße: „für alle“ (ganze Wohnung) oder „für <Name>“ (was nach den Beiträgen der anderen bei der Person „Ich“ bleibt).
- `/zauberkloppen/` – Szenario-Generator für Fantasy-Rollenspiele.
- `/zeitfresser/` – Zeitfresser: Wochenanalyse, wohin die Zeit geht. Themen mit Wert pro Woche oder pro Tag
  an gewählten Wochentagen, darunter eine Ebene Unterpunkte; nicht zugeordnete Zeit wird schraffiert gezeigt,
  Überschreitungen pulsieren rot. Ein Thema ohne eigenen Wert übernimmt die Summe seiner Unterpunkte;
  ein Tageswert gilt je Tag für sich, der Rest eines Wochenwerts wird flexibel auf die Tage verteilt (blasser schraffiert). Verschieben per Drag & Drop oder ↑/↓, 12 Themenfarben zur Auswahl.
  Kreisdiagramm (innen Themen, außen Unterpunkte) und Balken je Wochentag. Mehrere Szenarien, gespeichert im localStorage,
  Übertragung zwischen Geräten per Einmal-Link wie in Wohnung (`js/sync.js`, `js/transfer.js`) oder JSON-Export/-Import je Szenario.

## Entwicklung

Reines statisches HTML/CSS/JS, kein Build-Schritt nötig. Dateien direkt im Browser
öffnen oder lokal servieren, z. B. mit `npx serve` oder `python -m http.server`.

Idee von klmpfh, code von Claude
