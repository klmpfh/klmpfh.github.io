/* Wohnung – Status und Tagebuch einer Wohnung (ohne Oberfläche).
   flat.status = Schlüssel aus STEPS/ENDS ('' = noch keiner),
   flat.diary = [{ id, date: 'JJJJ-MM-TT', at: angelegt (ms), status, text }].
   Jeder Statuswechsel steht auch als Eintrag im Tagebuch (status gesetzt),
   eigene Einträge haben status ''. */
var DIARY = (function () {
    'use strict';

    var START = [['found', 'Vorgemerkt'], ['contact', 'Angefragt'], ['date', 'Besichtigung vereinbart'], ['viewed', 'Besichtigt']];

    // Typischer Ablauf; Schritte lassen sich überspringen.
    var STEPS = {
        buy: START.concat([
            ['second', 'Zweitbesichtigung'], ['check', 'Unterlagen prüfen'], ['bank', 'Finanzierung klären'],
            ['offer', 'Kaufangebot abgegeben'], ['reserved', 'Zusage / reserviert'], ['draft', 'Kaufvertrag prüfen'],
            ['notary', 'Beim Notar unterschrieben'], ['paid', 'Kaufpreis bezahlt'], ['keys', 'Schlüssel übergeben']
        ]),
        rent: START.concat([
            ['papers', 'Unterlagen zusammenstellen'], ['applied', 'Bewerbung abgegeben'], ['accepted', 'Zusage bekommen'],
            ['lease', 'Mietvertrag prüfen'], ['signed', 'Mietvertrag unterschrieben'], ['deposit', 'Kaution bezahlt'],
            ['keys', 'Schlüssel übergeben']
        ])
    };

    // Es geht (vorerst) nicht weiter – alle außer „hold“ gelten als aussortiert.
    var ENDS = [['hold', 'Zurückgestellt'], ['out', 'Kommt nicht in Frage'], ['refused', 'Absage bekommen'], ['gone', 'Nicht mehr verfügbar']];

    var LABELS = {};
    STEPS.buy.concat(STEPS.rent, ENDS).forEach(function (s) { LABELS[s[0]] = s[1]; });

    function known(key) { return Object.prototype.hasOwnProperty.call(LABELS, key) ? key : ''; }

    function label(key) { return known(key) ? LABELS[key] : ''; }

    /** Aussortiert? */
    function isOut(flat) { return ['out', 'refused', 'gone'].indexOf(flat.status) !== -1; }

    /** Art für die Darstellung: 'step' | 'hold' | 'out' | 'done'. */
    function tone(key) {
        return key === 'hold' ? 'hold' : key === 'keys' ? 'done' : isOut({ status: key }) ? 'out' : 'step';
    }

    function entry(id, date, status) {
        return { id: id, date: date, at: Date.now(), status: known(status), text: '' };
    }

    function isDate(s) {
        return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
    }

    /** Ältere oder fremde Daten: nur lesbare Einträge, fehlende Felder ergänzt. */
    function normalize(list, uid, today) {
        return (Array.isArray(list) ? list : []).filter(function (e) { return e && typeof e === 'object' && !Array.isArray(e); }).map(function (e) {
            return {
                id: e.id ? String(e.id) : uid(), date: isDate(e.date) ? e.date : today,
                at: typeof e.at === 'number' && isFinite(e.at) ? e.at : 0, status: known(e.status), text: String(e.text || '')
            };
        });
    }

    /** Neueste zuerst; am selben Tag zählt, was später eingetragen wurde. */
    function sorted(list) {
        return list.slice().sort(function (a, b) {
            if (a.date !== b.date) return a.date < b.date ? 1 : -1;
            return b.at - a.at || (a.id < b.id ? 1 : -1);
        });
    }

    /** Eintrag zum jetzigen Status (seit wann, warum) oder null, wenn er gelöscht wurde. */
    function current(flat) {
        return flat.status ? sorted(flat.diary).find(function (e) { return e.status === flat.status; }) || null : null;
    }

    function fmtDate(date) { return date.split('-').reverse().join('.'); }

    return { STEPS: STEPS, ENDS: ENDS, known: known, label: label, isOut: isOut, tone: tone, entry: entry, isDate: isDate,
        normalize: normalize, sorted: sorted, current: current, fmtDate: fmtDate };
})();
