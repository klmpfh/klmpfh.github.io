/* Wohnungskauf – Oberfläche, Speicherung, Export/Import.
   Zwei Ansichten über den URL-Hash: Übersicht ("" / "#") mit den persönlichen
   Finanzen und dem Vergleich aller Wohnungen, und "#w=<id>" mit allem, was zu
   einer einzelnen Wohnung gehört. Rechenlogik liegt in calc.js (WK). */
(function () {
    'use strict';

    var KEY = 'klmpfh-wohnung';
    var n = WK.n, eur = WK.eur, pct = WK.pct;

    var PROFILE_DEFAULTS = {
        cash: null, equity: null, reserve: null,
        netIncome: null, livingCosts: null, otherDebt: null, currentRent: null,
        bankMaxLoan: null, bankMaxRate: null,
        taxRate: 30, altReturn: 2, appreciation: 1.5,
        state: '', notaryPct: 2, brokerPct: 3.57,
        defRate: 3.6, defRepay: 2, defFixed: 10, defFollowRate: 4.5
    };

    function uid() {
        return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
    }

    function newLoan(p, main) {
        return {
            id: uid(), name: main ? 'Hauptdarlehen' : 'Weiteres Darlehen', amount: null,
            rate: p.defRate, mode: 'repay', repay: p.defRepay, term: 30, payment: null,
            fixedYears: p.defFixed, extra: null, followRate: p.defFollowRate
        };
    }

    function newRoom(self) {
        return { id: uid(), name: self ? 'Mein Zimmer' : 'Zimmer', size: null, rent: null, self: !!self };
    }

    function newFlat(p) {
        return {
            id: uid(), name: 'Neue Wohnung', address: '', link: '', notes: '',
            area: null, year: null, price: null, inventory: null,
            state: p.state, transferTaxPct: WK.transferTaxFor(p.state),
            notaryPct: p.notaryPct, brokerPct: p.brokerPct,
            renovation: null, otherOneOff: null,
            hoa: null, propertyTax: null, maintenance: null, utilities: null,
            equity: null, appreciation: null,
            loans: [newLoan(p, true)],
            wg: { rooms: [newRoom(true), newRoom(false)], vacancyPct: 5, taxable: true, buildingPct: 75, afaPct: 2 },
            ratings: {}   // { wishId: { personId: 0–100 } } – wie gut die Wohnung den Wunsch erfüllt
        };
    }

    function newPerson() {
        return { id: uid(), name: '' };
    }

    /** weights: { personId: 0–100 } – wie wichtig der Wunsch der jeweiligen Person ist. */
    function newWish(by) {
        return { id: uid(), text: '', by: by, weights: {} };
    }

    function isObj(x) {
        return !!x && typeof x === 'object' && !Array.isArray(x);
    }

    /** Ergänzt fehlende Felder (ältere Exporte, handbearbeitete Dateien). */
    function normalizeFlat(f, p) {
        var base = newFlat(p);
        var out = Object.assign({}, base, f || {});
        out.id = out.id ? String(out.id) : uid();
        out.loans = Array.isArray(out.loans) && out.loans.length ? out.loans.map(function (l, i) {
            return Object.assign(newLoan(p, i === 0), l, { id: l && l.id ? String(l.id) : uid() });
        }) : base.loans;
        out.wg = Object.assign({}, base.wg, out.wg || {});
        out.wg.rooms = Array.isArray(out.wg.rooms) ? out.wg.rooms.map(function (r) {
            return Object.assign(newRoom(false), r, { id: r && r.id ? String(r.id) : uid() });
        }) : base.wg.rooms;
        out.ratings = {};
        if (isObj(f && f.ratings)) Object.keys(f.ratings).forEach(function (wid) {
            if (isObj(f.ratings[wid])) out.ratings[wid] = Object.assign({}, f.ratings[wid]);
        });
        return out;
    }

    function normalizeState(data) {
        var profile = Object.assign({}, PROFILE_DEFAULTS, (data && data.profile) || {});
        var flats = (data && Array.isArray(data.flats) ? data.flats : []).map(function (f) { return normalizeFlat(f, profile); });
        // Ältere Daten ohne Personen: mit zwei leeren Personen starten.
        var people = data && Array.isArray(data.people)
            ? data.people.filter(isObj).map(function (p) { return { id: p.id ? String(p.id) : uid(), name: String(p.name || '') }; })
            : [newPerson(), newPerson()];
        var ids = people.map(function (p) { return p.id; });
        var wishes = (data && Array.isArray(data.wishes) ? data.wishes : []).filter(isObj).map(function (w) {
            var by = w.by ? String(w.by) : null;
            return {
                id: w.id ? String(w.id) : uid(),
                text: String(w.text || ''),
                by: ids.indexOf(by) !== -1 ? by : (ids[0] || null),
                weights: isObj(w.weights) ? Object.assign({}, w.weights) : {}
            };
        });
        return { profile: profile, flats: flats, people: people, wishes: wishes };
    }

    function dataOut() {
        return { profile: state.profile, people: state.people, wishes: state.wishes, flats: state.flats };
    }

    /* ---------- Speichern ---------- */

    var state = load();
    var saveTimer = null;
    var saveWarned = false;

    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            if (raw) return normalizeState(JSON.parse(raw));
        } catch (e) { /* kaputte oder fehlende Daten → frisch starten */ }
        return normalizeState(null);
    }

    function saveNow() {
        clearTimeout(saveTimer);
        saveTimer = null;
        try {
            localStorage.setItem(KEY, JSON.stringify(Object.assign({ version: 1 }, dataOut())));
        } catch (e) {
            if (!saveWarned) {
                saveWarned = true;
                alert('Speichern im Browser nicht möglich (privater Modus?). Bitte zwischendurch exportieren.');
            }
        }
    }

    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 300);
    }

    window.addEventListener('pagehide', function () { if (saveTimer) saveNow(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && saveTimer) saveNow(); });

    /* ---------- DOM-Helfer ---------- */

    var app = document.getElementById('app');
    var currentUpdate = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function el(tag, props, children) {
        var e = document.createElement(tag);
        if (props) Object.keys(props).forEach(function (k) {
            var v = props[k];
            if (v === null || v === undefined || v === false) return;
            if (k === 'class') e.className = v;
            else if (k === 'text') e.textContent = v;
            else if (k === 'html') e.innerHTML = v;
            else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
            else e.setAttribute(k, v === true ? '' : v);
        });
        (children || []).forEach(function (c) {
            if (c === null || c === undefined || c === false) return;
            e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return e;
    }

    function changed() {
        scheduleSave();
        if (currentUpdate) currentUpdate();
    }

    /** Liest deutsche und englische Schreibweisen: "350.000", "350000",
     *  "3,5", "3.5", "1.234,56 €". */
    function parseNum(s) {
        s = String(s).replace(/m²|[\s€%]/g, '');
        if (!s) return null;
        if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
        else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
        var v = parseFloat(s);
        return isFinite(v) ? v : null;
    }

    function fmtInput(v, dec, noGroup) {
        if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return '';
        return new Intl.NumberFormat('de-DE', { maximumFractionDigits: dec, useGrouping: !noGroup }).format(Number(v));
    }

    function fieldWrap(label, control, hint, cls) {
        return el('label', { class: 'field' + (cls ? ' ' + cls : '') }, [
            el('span', { class: 'field-label', text: label }),
            control,
            hint ? el('small', { class: 'field-hint', text: hint }) : null
        ]);
    }

    function numField(obj, key, label, o) {
        o = o || {};
        var dec = o.dec !== undefined ? o.dec : (o.unit === '%' ? 3 : 2);
        var input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: o.placeholder || '' });
        input.value = fmtInput(obj[key], dec, o.noGroup);
        input.addEventListener('input', function () {
            obj[key] = parseNum(input.value);
            if (o.onchange) o.onchange();
            changed();
        });
        input.addEventListener('blur', function () { input.value = fmtInput(obj[key], dec, o.noGroup); });
        var wrap = el('span', { class: 'input-wrap' }, [input, o.unit ? el('span', { class: 'unit', text: o.unit }) : null]);
        var f = fieldWrap(label, wrap, o.hint, o.cls);
        f._input = input;
        return f;
    }

    function textField(obj, key, label, o) {
        o = o || {};
        var input = el(o.multiline ? 'textarea' : 'input', o.multiline ? { rows: 3 } : { type: 'text', autocomplete: 'off', placeholder: o.placeholder || '' });
        input.value = obj[key] || '';
        input.addEventListener('input', function () {
            obj[key] = input.value;
            if (o.onchange) o.onchange();
            changed();
        });
        return fieldWrap(label, input, o.hint, o.cls);
    }

    function stateSelect(obj, key, label, onchange) {
        var sel = el('select', null, [el('option', { value: '', text: 'anderes / manuell' })].concat(WK.STATES.map(function (s) {
            return el('option', { value: s[0], text: s[1] + ' (' + String(s[2]).replace('.', ',') + ' %)' });
        })));
        sel.value = obj[key] || '';
        sel.addEventListener('change', function () {
            obj[key] = sel.value;
            if (onchange) onchange();
            changed();
        });
        return fieldWrap(label, sel);
    }

    function panel(title, children, o) {
        o = o || {};
        return el('section', { class: 'panel' + (o.cls ? ' ' + o.cls : '') }, [
            el('div', { class: 'panel-head' }, [el('h2', { text: title })].concat(o.actions || [])),
            o.hint ? el('p', { class: 'panel-hint', text: o.hint }) : null
        ].concat(children));
    }

    function group(title, fields) {
        return el('div', { class: 'group' }, [
            title ? el('h3', { class: 'group-title', text: title }) : null,
            el('div', { class: 'grid' }, fields)
        ]);
    }

    function btn(text, cls, onclick, title) {
        return el('button', { type: 'button', class: 'btn ' + (cls || ''), text: text, onclick: onclick, title: title });
    }

    /* ---------- Export / Import ---------- */

    function download(name, data) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        var a = el('a', { href: url, download: name, style: 'display:none' });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    }

    function stamp() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function slug(s) {
        return String(s || 'wohnung').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'wohnung';
    }

    function exportAll() {
        saveNow();
        download('wohnungskauf-' + stamp() + '.json',
            Object.assign({ app: 'wohnungskauf', version: 1, exported: new Date().toISOString() }, dataOut()));
    }

    function exportFlat(f) {
        saveNow();
        download('wohnung-' + slug(f.name) + '-' + stamp() + '.json', {
            app: 'wohnungskauf', version: 1, kind: 'flat', exported: new Date().toISOString(), flat: f
        });
    }

    /* ---------- Deep Link ----------
       Alle Daten (wie beim JSON-Export) komprimiert im #-Teil der URL:
       "#import=z<base64url(deflate-raw(JSON))>", ohne CompressionStream
       "#import=j<base64url(JSON)>". Der #-Teil wird nie an den Server
       geschickt – der Link selbst enthält aber alle Daten. */

    var MAX_DECOMPRESSED = 4 * 1024 * 1024;

    function toBase64Url(bytes) {
        var bin = '';
        for (var i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function fromBase64Url(text) {
        var bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    function readAll(stream) {
        var reader = stream.getReader();
        var chunks = [], size = 0;
        function pump() {
            return reader.read().then(function (part) {
                if (part.done) {
                    var out = new Uint8Array(size), offset = 0;
                    chunks.forEach(function (c) { out.set(c, offset); offset += c.length; });
                    return out;
                }
                size += part.value.length;
                if (size > MAX_DECOMPRESSED) {
                    reader.cancel();
                    throw new Error('Link-Inhalt zu groß');
                }
                chunks.push(part.value);
                return pump();
            });
        }
        return pump();
    }

    function encodeData(data) {
        var json = new TextEncoder().encode(JSON.stringify(data));
        if (typeof CompressionStream === 'undefined') return Promise.resolve('j' + toBase64Url(json));
        return readAll(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw')))
            .then(function (bytes) { return 'z' + toBase64Url(bytes); });
    }

    function decodeData(text) {
        return Promise.resolve().then(function () {
            var bytes = fromBase64Url(text.slice(1));
            if (text.charAt(0) === 'z') {
                if (typeof DecompressionStream === 'undefined') throw new Error('Browser kann den Link nicht entpacken');
                return readAll(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
            }
            if (text.charAt(0) !== 'j') throw new Error('unbekanntes Link-Format');
            return bytes;
        }).then(function (bytes) {
            return JSON.parse(new TextDecoder().decode(bytes));
        });
    }

    function buildShareLink() {
        saveNow();
        return encodeData(Object.assign({ app: 'wohnungskauf', version: 1 }, dataOut())).then(function (code) {
            return location.href.split('#')[0] + '#import=' + code;
        });
    }

    /** Zeigt den erzeugten Link mit Kopieren/Teilen und – wenn er kurz genug ist – als QR-Code. */
    function renderShareLink(box, link) {
        box.innerHTML = '';
        var input = el('input', { type: 'text', readonly: true, 'aria-label': 'Link mit allen Daten', onfocus: function (e) { e.target.select(); } });
        input.value = link;
        box.appendChild(el('div', { class: 'link-row' }, [
            input,
            btn('Kopieren', 'btn-primary', function (e) { copyText(link, e.currentTarget); }),
            navigator.share ? btn('Teilen …', 'btn-ghost', function () {
                navigator.share({ title: 'Wohnungskauf – meine Daten', url: link }).catch(function () { /* abgebrochen */ });
            }) : null
        ]));

        var qr = el('div', { class: 'qr' });
        var qrOk = false;
        if (typeof QRCode !== 'undefined') {
            try {
                new QRCode(qr, { text: link, width: 300, height: 300, colorDark: '#14121a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });
                qrOk = true;
            } catch (err) { qr.innerHTML = ''; }
        }
        if (qrOk) box.appendChild(qr);
        box.appendChild(el('p', { class: 'muted small link-note', text:
            (qrOk ? 'QR-Code mit dem anderen Gerät scannen oder den Link dort öffnen' : 'Zu viele Daten für einen QR-Code – den Link auf dem anderen Gerät öffnen') +
            ' (' + new Intl.NumberFormat('de-DE').format(link.length) + ' Zeichen). Beim Öffnen werden alle Daten dort überschrieben. ' +
            'Wer den Link hat, sieht alle deine Finanzdaten – nur an dich selbst oder Vertraute schicken. Der Link ist ein Schnappschuss: spätere Änderungen sind nicht enthalten.' }));
    }

    function importFromLink(code) {
        // Hash sofort entfernen: Neuladen importiert nicht erneut, und der
        // Link mit allen Daten bleibt nicht als aktuelle Adresse stehen.
        history.replaceState(null, '', location.href.split('#')[0]);
        decodeData(code).then(function (data) {
            if (!data || !Array.isArray(data.flats)) throw new Error('keine Wohnungsdaten im Link');
            var next = normalizeState(data);
            var msg = 'Daten aus dem Link übernehmen?\n\nLink: Meine Finanzen + ' + next.flats.length + ' Wohnung(en)\n' +
                'Alle bisherigen Daten hier werden überschrieben (' + state.flats.length + ' Wohnung(en)).';
            if (confirm(msg)) {
                state = next;
                saveNow();
            }
            route();
        }).catch(function () {
            alert('Der Link ist unvollständig oder beschädigt – wurde er vollständig kopiert? Es wurde nichts geändert.');
            route();
        });
    }

    var importInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    document.body.appendChild(importInput);
    importInput.addEventListener('change', function () {
        var file = importInput.files[0];
        importInput.value = '';
        if (!file) return;
        file.text().then(function (text) {
            var data;
            try { data = JSON.parse(text); } catch (e) { alert('Die Datei ist kein gültiges JSON.'); return; }
            if (data && Array.isArray(data.flats)) {
                var next = normalizeState(data);
                var msg = 'Alles durch die Datei ersetzen?\n\nDatei: Meine Finanzen + ' + next.flats.length + ' Wohnung(en)\n' +
                    'Jetzt hier: ' + state.flats.length + ' Wohnung(en) – gehen verloren, falls nicht exportiert.';
                if (!confirm(msg)) return;
                state = next;
                saveNow();
                location.hash = '';
                route();
            } else if (data && data.flat && typeof data.flat === 'object') {
                var f = normalizeFlat(data.flat, state.profile);
                var idx = state.flats.findIndex(function (x) { return x.id === f.id; });
                if (idx !== -1) {
                    if (confirm('„' + state.flats[idx].name + '“ gibt es hier schon. Mit der Version aus der Datei überschreiben?\n\nAbbrechen = als Kopie hinzufügen.')) {
                        state.flats[idx] = f;
                    } else {
                        f.id = uid();
                        f.name += ' (Import)';
                        state.flats.push(f);
                    }
                } else {
                    state.flats.push(f);
                }
                saveNow();
                location.hash = 'w=' + f.id;
                route();
            } else {
                alert('In der Datei wurden keine Wohnungsdaten gefunden.');
            }
        });
    });

    /* ---------- Übersicht ---------- */

    var TIER = { bad: 3, warn: 2, info: 1, ok: 0 };
    var TIER_LABEL = { bad: 'kritisch', warn: 'Achtung', info: 'Hinweis', ok: 'passt' };
    var ICON = { bad: '✕', warn: '!', info: 'i', ok: '✓' };

    function worst(a) {
        var w = 'ok';
        a.warnings.concat(a.review).forEach(function (x) { if (TIER[x.level] > TIER[w] && x.level !== 'info') w = x.level; });
        return w;
    }

    var COMPARE = [
        { label: 'Kaufpreis', get: function (a) { return a.price; }, f: eur },
        { label: 'Wohnfläche', get: function (a) { return a.area || null; }, f: function (v) { return v === null ? '–' : fmtInput(v, 1) + ' m²'; } },
        { label: 'Preis pro m²', get: function (a) { return a.pricePerSqm; }, f: eur, best: 'min' },
        { label: 'Kaufnebenkosten', get: function (a) { return a.closing; }, f: eur, best: 'min' },
        { label: 'Gesamtkosten', get: function (a) { return a.total; }, f: eur, best: 'min' },
        { label: 'Eigenkapital-Einsatz', get: function (a) { return a.equity; }, f: eur },
        { label: 'Darlehen', get: function (a) { return a.loanTotal; }, f: eur, best: 'min' },
        { label: 'Beleihung', get: function (a) { return a.ltv; }, f: pct, best: 'min' },
        { label: 'Kreditrate / Monat', get: function (a) { return a.payment; }, f: eur, best: 'min', sep: true },
        { label: 'Nebenkosten / Monat', get: function (a) { return a.runningCosts; }, f: eur, best: 'min' },
        { label: 'Hausgeld pro m²', get: function (a) { return a.hoaPerSqm; }, f: perSqm, best: 'min' },
        { label: 'WG-Einnahmen netto', get: function (a) { return a.rentNet; }, f: eur, best: 'max' },
        { label: 'Netto-Wohnkosten', get: function (a) { return a.netHousing; }, f: eur, best: 'min', strong: true },
        { label: 'ggü. aktueller Miete', get: function (a) { return a.vsRent; }, f: signed, best: 'min' },
        { label: 'Echte Kosten', get: function (a) { return a.trueCost; }, f: eur, best: 'min', strong: true },
        { label: 'Vermögensaufbau (Tilgung)', get: function (a) { return a.wealthBuild; }, f: eur, best: 'max' },
        { label: 'Frei verfügbar', get: function (a) { return a.netIncome > 0 ? a.available : null; }, f: eur, best: 'max', strong: true },
        { label: 'Kreditrate / Netto-Einkommen', get: function (a) { return a.burden; }, f: pct, best: 'min' },
        { label: 'Restschuld nach Zinsbindung', get: function (a) { return a.balanceAtFixed; }, f: eur, best: 'min', sep: true },
        { label: 'Schuldenfrei nach', get: function (a) { return a.payoffYears; }, f: WK.years, best: 'min' },
        { label: 'Zinsen gesamt', get: function (a) { return a.totalInterest; }, f: eur, best: 'min' },
        { label: 'Cash nach Kauf', get: function (a) { return a.cashAfter; }, f: eur, best: 'max' },
        { label: 'Auffälligkeiten am Objekt', get: function (a) { return a.price > 0 ? a.review.filter(function (r) { return r.level === 'warn' || r.level === 'bad'; }).length : null; }, f: function (v) { return v === null ? '–' : String(v); }, best: 'min', sep: true }
    ];

    function perSqm(v) {
        if (v === null || v === undefined || !isFinite(v)) return '–';
        return fmtInput(v, 2) + ' €/m²';
    }

    function signed(v) {
        if (v === null || v === undefined || !isFinite(v)) return '–';
        if (Math.round(v) === 0) return '± 0 €';
        return (v > 0 ? '+ ' : '− ') + eur(Math.abs(v));
    }

    function renderMain() {
        var p = state.profile;
        document.title = 'Wohnungskauf';
        app.innerHTML = '';

        var budgetBox = el('div', { class: 'tiles' });
        var listBox = el('div');

        app.appendChild(el('header', { class: 'page-head' }, [
            el('h1', { text: 'Wohnungskauf' }),
            el('p', { text: 'Rechnet durch, ob und welche Wohnung sich ausgeht – mit WG-Untermiete, Kredit und allem drumherum.' })
        ]));

        app.appendChild(panel('Meine Finanzen', [
            group('Vermögen', [
                numField(p, 'cash', 'Cash (liquide Ersparnisse)', { unit: '€', dec: 0 }),
                numField(p, 'equity', 'Davon als Eigenkapital einsetzen', { unit: '€', dec: 0, hint: 'Standard für jede Wohnung, dort überschreibbar.' }),
                numField(p, 'reserve', 'Notreserve, die bleiben soll', { unit: '€', dec: 0, hint: 'Faustregel: 3–6 Netto-Monatsgehälter.' })
            ]),
            group('Einkommen & Ausgaben (monatlich)', [
                numField(p, 'netIncome', 'Nettoeinkommen', { unit: '€' }),
                numField(p, 'livingCosts', 'Lebenshaltung ohne Wohnen', { unit: '€', hint: 'Essen, Mobilität, Versicherungen, Freizeit, Sparpläne …' }),
                numField(p, 'otherDebt', 'Andere Kreditraten', { unit: '€', hint: 'Auto, Studienkredit, Ratenkäufe.' }),
                numField(p, 'currentRent', 'Aktuelle Warmmiete', { unit: '€', hint: 'Vergleichswert: Was kostet Wohnen heute?' })
            ]),
            group('Kreditwürdigkeit (laut Bank)', [
                numField(p, 'bankMaxLoan', 'Max. Darlehen', { unit: '€', dec: 0, hint: 'Was die Bank dir maximal leihen würde.' }),
                numField(p, 'bankMaxRate', 'Max. Monatsrate', { unit: '€', hint: 'Leer = Faustregel 35 % vom Netto minus andere Kredite.' })
            ]),
            group('Steuer & Annahmen', [
                numField(p, 'taxRate', 'Grenzsteuersatz', { unit: '%', hint: 'Für die Steuer auf Untermiete (inkl. Soli/KiSt, falls zutreffend).' }),
                numField(p, 'altReturn', 'Alternative Rendite fürs Eigenkapital', { unit: '%', hint: 'Was das Geld sonst bringen würde (Tagesgeld, ETF) – fließt in die „echten Kosten“.' }),
                numField(p, 'appreciation', 'Wertsteigerung pro Jahr', { unit: '%' })
            ]),
            group('Standards für neue Wohnungen', [
                stateSelect(p, 'state', 'Bundesland'),
                numField(p, 'notaryPct', 'Notar & Grundbuch', { unit: '%' }),
                numField(p, 'brokerPct', 'Makler', { unit: '%' }),
                numField(p, 'defRate', 'Sollzins', { unit: '%' }),
                numField(p, 'defRepay', 'Anfängliche Tilgung', { unit: '%' }),
                numField(p, 'defFixed', 'Zinsbindung', { unit: 'Jahre', dec: 0 }),
                numField(p, 'defFollowRate', 'Anschlusszins (Annahme)', { unit: '%' })
            ]),
            el('h3', { class: 'group-title', text: 'Was ist drin?' }),
            budgetBox
        ], { hint: 'Alles Persönliche, das für jede Wohnung gleich ist. Wird nur in diesem Browser gespeichert.' }));

        var wishBox = el('div');
        var wishStatus = el('div', { class: 'wish-status' });
        app.appendChild(panel('Wünsche & Bedingungen', [wishBox, wishStatus], {
            hint: 'Jede Person ergänzt eigene Wünsche, frei formuliert – z. B. „Balkon“, „max. 30 Minuten zur Arbeit“, „kein Erdgeschoss“. ' +
                'Danach gibt jede Person bei jedem Wunsch an, wie wichtig er ihr ist (0 % = egal). ' +
                '100 % heißt Muss: Erfüllt eine Wohnung das nicht voll, kommt sie nicht in Frage. ' +
                'In jeder Wohnung bewerten dann alle, wie gut sie die Wünsche erfüllt.'
        }));
        renderWishEditor(wishBox);

        app.appendChild(panel('Wohnungen', [listBox], {
            actions: [btn('+ Wohnung', 'btn-primary', function () {
                var f = newFlat(state.profile);
                f.name = 'Wohnung ' + (state.flats.length + 1);
                state.flats.push(f);
                saveNow();
                location.hash = 'w=' + f.id;
            })]
        }));

        var linkBox = el('div', { class: 'link-box' });
        app.appendChild(panel('Daten übertragen', [
            el('div', { class: 'actions' }, [
                btn('Link mit allen Daten erzeugen', 'btn-primary', function (e) {
                    var b = e.currentTarget;
                    b.disabled = true;
                    buildShareLink().then(function (link) { renderShareLink(linkBox, link); })
                        .catch(function () { alert('Link konnte nicht erzeugt werden.'); })
                        .then(function () { b.disabled = false; });
                }),
                btn('Alles exportieren (JSON)', 'btn-ghost', exportAll),
                btn('Importieren …', 'btn-ghost', function () { importInput.click(); })
            ]),
            linkBox
        ], { hint: 'Link und Export enthalten „Meine Finanzen“, Personen & Wünsche und alle Wohnungen. Link öffnen oder Gesamt-Datei importieren ersetzt alles auf dem Zielgerät; eine einzeln exportierte Wohnung wird nur hinzugefügt.' }));

        currentUpdate = function () {
            renderBudget(budgetBox);
            renderWishStatus(wishStatus);
            renderFlatList(listBox);
            linkBox.innerHTML = '';   // ein schon erzeugter Link wäre nach Änderungen veraltet
        };
        currentUpdate();
    }

    function tile(label, value, sub, cls) {
        return '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="tile-label">' + esc(label) + '</div>' +
            '<div class="tile-value">' + esc(value) + '</div>' + (sub ? '<div class="tile-sub">' + esc(sub) + '</div>' : '') + '</div>';
    }

    function renderBudget(box) {
        var p = state.profile;
        var b = WK.budget(p);
        if (!(n(p.netIncome) > 0) && !(n(p.bankMaxLoan) > 0)) {
            box.innerHTML = '<p class="muted">Trag Nettoeinkommen oder den Kreditrahmen der Bank ein, dann steht hier dein grobes Budget.</p>';
            return;
        }
        box.innerHTML =
            tile('Max. Darlehen', eur(b.maxLoan), n(p.bankMaxLoan) > 0 ? (b.loanFromRate < n(p.bankMaxLoan) ? 'begrenzt durch die Rate' : 'laut Bank') : 'aus der Rate bei ' + fmtInput(n(p.defRate) + n(p.defRepay), 2) + ' % Zins + Tilgung') +
            tile('Max. Monatsrate', eur(b.maxRate), n(p.bankMaxRate) > 0 ? 'laut Bank' : 'Faustregel 35 % vom Netto') +
            tile('Kaufpreis-Budget', eur(b.maxPrice), 'Eigenkapital + Darlehen, abzgl. ~' + fmtInput(b.closingPct, 1) + ' % Nebenkosten') +
            tile('Cash über Notreserve', eur(n(p.cash) - n(p.reserve)), n(p.equity) > n(p.cash) - n(p.reserve) ? 'weniger als dein geplantes Eigenkapital' : 'Puffer fürs Eigenkapital', n(p.equity) > n(p.cash) - n(p.reserve) ? 'tile-warn' : '');
    }

    /* ---------- Wünsche & Bedingungen ---------- */

    function personName(p) {
        var name = (p.name || '').trim();
        return name || 'Person ' + (state.people.indexOf(p) + 1);
    }

    /** Namens-Span, der beim Umbenennen live mitgeändert wird. */
    function nameTag(p) {
        return el('span', { 'data-person': p.id, text: personName(p) });
    }

    function fmtScore(v) {
        return v === null || v === undefined || !isFinite(v) ? '–' : Math.round(v * 100) + ' %';
    }

    function wishesInOrder() {
        // Gruppiert nach Person (Reihenfolge der Personen), innerhalb in Eingabereihenfolge.
        var out = [];
        state.people.forEach(function (p) {
            state.wishes.forEach(function (w) { if (w.by === p.id) out.push(w); });
        });
        return out;
    }

    function removeWish(w) {
        state.wishes.splice(state.wishes.indexOf(w), 1);
        state.flats.forEach(function (f) { delete f.ratings[w.id]; });
    }

    function removePerson(p) {
        state.wishes.filter(function (w) { return w.by === p.id; }).forEach(removeWish);
        state.wishes.forEach(function (w) { delete w.weights[p.id]; });
        state.flats.forEach(function (f) {
            Object.keys(f.ratings).forEach(function (wid) { delete f.ratings[wid][p.id]; });
        });
        state.people.splice(state.people.indexOf(p), 1);
    }

    /** Personen und Wünsche bearbeiten (Übersicht). Wird nur bei Struktur-
     *  änderungen neu gezeichnet, nicht bei jeder Eingabe (sonst Fokusverlust). */
    function renderWishEditor(box, focusId) {
        box.innerHTML = '';
        var people = state.people;

        var peopleRow = el('div', { class: 'people' });
        people.forEach(function (p, idx) {
            var input = el('input', { type: 'text', autocomplete: 'off', placeholder: 'Person ' + (idx + 1), 'aria-label': 'Name von Person ' + (idx + 1) });
            input.value = p.name || '';
            input.addEventListener('input', function () {
                p.name = input.value;
                box.querySelectorAll('[data-person="' + p.id + '"]').forEach(function (e) { e.textContent = personName(p); });
                changed();
            });
            var del = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Person entfernen', title: 'Person entfernen', text: '×', onclick: function () {
                var own = state.wishes.filter(function (w) { return w.by === p.id; }).length;
                if (!confirm(personName(p) + ' entfernen?\n\nDabei gehen ' + (own ? 'ihre ' + own + ' Wünsche sowie ' : '') + 'alle Gewichtungen und Bewertungen dieser Person verloren.')) return;
                removePerson(p);
                renderWishEditor(box);
                changed();
            } });
            peopleRow.appendChild(el('div', { class: 'person' }, [input, del]));
        });
        peopleRow.appendChild(btn('+ Person', 'btn-ghost', function () {
            var p = newPerson();
            state.people.push(p);
            renderWishEditor(box, 'person:' + p.id);
            changed();
        }));
        box.appendChild(el('h3', { class: 'group-title', text: 'Personen' }));
        box.appendChild(peopleRow);

        if (!people.length) {
            box.appendChild(el('p', { class: 'muted', text: 'Leg zuerst mindestens eine Person an.' }));
            return;
        }

        var cols = String(people.length);
        people.forEach(function (author) {
            var mine = state.wishes.filter(function (w) { return w.by === author.id; });
            var g = el('div', { class: 'wish-group', style: '--cols:' + cols });
            g.appendChild(el('h3', { class: 'group-title' }, ['Wünsche von ', nameTag(author)]));

            if (mine.length) {
                g.appendChild(el('div', { class: 'wish-row wish-head' }, [el('span', { text: 'Wunsch / Bedingung' })]
                    .concat(people.map(function (p) { return el('span', null, ['Wichtig für ', nameTag(p)]); }))
                    .concat([el('span')])));
            }

            mine.forEach(function (w) {
                var text = el('input', { type: 'text', class: 'wish-text', autocomplete: 'off', 'data-wish': w.id, 'aria-label': 'Wunsch', placeholder: 'z. B. Balkon, ruhige Lage, max. 30 min zur Arbeit' });
                text.value = w.text || '';
                text.addEventListener('input', function () { w.text = text.value; changed(); });

                var cells = people.map(function (p) {
                    var cell = el('div', { class: 'wish-cell' });
                    var mark = function () {
                        var v = w.weights[p.id];
                        cell.classList.toggle('missing', !WK.isSet(v));
                        cell.classList.toggle('must', WK.isSet(v) && Number(v) >= WK.MUST);
                        cell.title = WK.isSet(v) && Number(v) >= WK.MUST ? 'Muss-Kriterium: nicht voll erfüllt = Wohnung kommt nicht in Frage' : '';
                    };
                    var f = numField(w.weights, p.id, '', { unit: '%', dec: 0, placeholder: '?', onchange: mark });
                    f._input.setAttribute('aria-label', 'Wie wichtig für ' + personName(p));
                    cell.appendChild(el('span', { class: 'cell-label' }, ['Wichtig für ', nameTag(p)]));
                    cell.appendChild(f.querySelector('.input-wrap'));
                    mark();
                    return cell;
                });

                var del = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Wunsch entfernen', title: 'Wunsch entfernen', text: '×', onclick: function () {
                    var rated = state.flats.some(function (f) { return f.ratings[w.id] && Object.keys(f.ratings[w.id]).length; });
                    if ((w.text || rated) && !confirm('„' + (w.text || 'Wunsch') + '“ entfernen?' + (rated ? '\n\nDie Bewertungen in den Wohnungen gehen dabei verloren.' : ''))) return;
                    removeWish(w);
                    renderWishEditor(box);
                    changed();
                } });

                g.appendChild(el('div', { class: 'wish-row' }, [text].concat(cells).concat([del])));
            });

            g.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-add', onclick: function () {
                var w = newWish(author.id);
                state.wishes.push(w);
                renderWishEditor(box, 'wish:' + w.id);
                changed();
            } }, ['+ Wunsch von ', nameTag(author)]));
            box.appendChild(g);
        });

        if (focusId) {
            var target = focusId.indexOf('wish:') === 0
                ? box.querySelector('[data-wish="' + focusId.slice(5) + '"]')
                : peopleRow.querySelectorAll('.person input')[people.length - 1];
            if (target) target.focus();
        }
    }

    function checkItem(level, text) {
        return '<li class="check-' + level + '"><span class="check-icon" aria-label="' + TIER_LABEL[level] + '">' + ICON[level] + '</span><span>' + esc(text) + '</span></li>';
    }

    /** Was noch fehlt: Gewichtungen je Person und Bewertungen je Wohnung. */
    function renderWishStatus(box) {
        var wishes = state.wishes, people = state.people;
        if (!wishes.length || !people.length) { box.innerHTML = ''; return; }
        var items = [];
        var allWeighted = true;
        people.forEach(function (p) {
            var missing = wishes.filter(function (w) { return !WK.isSet(w.weights[p.id]); }).length;
            if (missing) {
                allWeighted = false;
                items.push(checkItem('warn', personName(p) + ' hat ' + (missing === 1 ? 'einen Wunsch' : missing + ' Wünsche') + ' noch nicht gewichtet.'));
            }
        });
        if (allWeighted) items.push(checkItem('ok', 'Alle Wünsche sind von ' + (people.length > 1 ? 'allen Personen' : personName(people[0])) + ' gewichtet.'));
        var scored = state.flats.map(function (f) { return { f: f, s: WK.wishScore(f, people, wishes) }; });
        scored.filter(function (x) { return x.s.ko.length; }).forEach(function (x) {
            items.push(checkItem('bad', (x.f.name || 'Ohne Namen') + ' kommt nicht in Frage – Muss nicht erfüllt: ' + x.s.ko.map(function (k) {
                var p = people.find(function (q) { return q.id === k.personId; });
                return wishNames([k.wishId]) + ' (' + personName(p) + ')';
            }).join(', ') + '.'));
        });
        var openFlats = scored.filter(function (x) { return x.s.open > 0; });
        if (openFlats.length) {
            items.push(checkItem('warn', 'Noch nicht fertig bewertet: ' + openFlats.map(function (x) {
                return (x.f.name || 'Ohne Namen') + ' (' + x.s.open + ' offen)';
            }).join(', ') + '.'));
        } else if (state.flats.length && allWeighted) {
            items.push(checkItem('ok', 'Alle Wohnungen sind fertig bewertet.'));
        }
        box.innerHTML = '<ul class="checks">' + items.join('') + '</ul>';
    }

    /** Bewertung der Wünsche in einer Wohnung (Detailansicht). */
    function wishRatingPanel(f) {
        var people = state.people, wishes = wishesInOrder();
        var summary = el('div', { class: 'tiles' });
        if (!people.length || !wishes.length) {
            return { el: panel('Wünsche & Bedingungen', [el('p', { class: 'muted' }, [
                'Noch keine Wünsche angelegt – das geht auf der ',
                el('a', { href: '#', text: 'Übersicht' }),
                ' unter „Wünsche & Bedingungen“.'
            ])]), update: function () {} };
        }

        var LEVELS = [['', '– offen –'], ['0', '0 % – gar nicht'], ['25', '25 % – kaum'], ['50', '50 % – teilweise'], ['75', '75 % – größtenteils'], ['100', '100 % – voll']];
        var list = el('div', { class: 'wish-group rate-list', style: '--cols:' + people.length });
        list.appendChild(el('div', { class: 'rate-row wish-head' }, [el('span', { text: 'Wunsch' })]
            .concat(people.map(function (p) { return el('span', { text: personName(p) }); }))));

        wishes.forEach(function (w) {
            var author = people.find(function (p) { return p.id === w.by; });
            var cells = people.map(function (p) {
                var r = f.ratings[w.id] || {};
                var imp = w.weights[p.id];
                var sel = el('select', { 'aria-label': 'Wie gut erfüllt – ' + personName(p) }, LEVELS.map(function (l) {
                    return el('option', { value: l[0], text: l[1] });
                }));
                var cur = r[p.id];
                // Ältere/handbearbeitete Werte zwischen den Stufen trotzdem anzeigen.
                if (WK.isSet(cur) && !LEVELS.some(function (l) { return l[0] === String(cur); })) {
                    sel.appendChild(el('option', { value: String(cur), text: fmtInput(cur, 0) + ' %' }));
                }
                sel.value = WK.isSet(cur) ? String(cur) : '';
                var cell = el('div', { class: 'wish-cell' });
                var required = !WK.isSet(imp) || Number(imp) > 0;
                var must = WK.isSet(imp) && Number(imp) >= WK.MUST;
                var mark = function () {
                    cell.classList.toggle('missing', required && sel.value === '');
                    cell.classList.toggle('ko', must && sel.value !== '' && Number(sel.value) < 100);
                };
                sel.addEventListener('change', function () {
                    if (sel.value === '') {
                        if (f.ratings[w.id]) delete f.ratings[w.id][p.id];
                    } else {
                        (f.ratings[w.id] = f.ratings[w.id] || {})[p.id] = Number(sel.value);
                    }
                    mark();
                    changed();
                });
                mark();
                cell.appendChild(el('span', { class: 'cell-label', text: personName(p) }));
                cell.appendChild(sel);
                cell.appendChild(el('small', { class: 'field-hint', text: !WK.isSet(imp) ? 'Wichtigkeit noch offen' : must ? 'Muss – nur „voll“ reicht' : Number(imp) > 0 ? 'wichtig: ' + fmtInput(Math.min(100, Number(imp)), 0) + ' %' : 'egal – zählt nicht' }));
                return cell;
            });
            list.appendChild(el('div', { class: 'rate-row' }, [
                el('div', { class: 'rate-text' }, [
                    el('div', { text: w.text || '(ohne Text)' }),
                    author ? el('small', { class: 'field-hint', text: 'von ' + personName(author) }) : null
                ])
            ].concat(cells)));
        });

        return {
            el: panel('Wünsche & Bedingungen', [summary, list], { hint: 'Jede Person bewertet, wie gut diese Wohnung ihre und die Wünsche der anderen erfüllt. Daraus und aus der Wichtigkeit ergibt sich die Passung.' }),
            update: function () { renderWishSummary(summary, f); }
        };
    }

    function renderWishSummary(box, f) {
        var people = state.people;
        var s = WK.wishScore(f, people, state.wishes);
        var html = s.persons.map(function (x, i) {
            var p = people[i];
            if (x.ko.length) {
                return tile('Passt zu ' + personName(p), '✕ K.-o.', 'Muss nicht erfüllt: ' + wishNames(x.ko) + ' (sonst ' + fmtScore(x.raw) + ')', 'tile-bad');
            }
            var sub = x.needed === 0 ? (x.unweighted ? 'erst Wünsche gewichten' : 'keine relevanten Wünsche')
                : x.done + ' von ' + x.needed + ' bewertet' + (x.unweighted ? ', ' + x.unweighted + ' ungewichtet' : '');
            return tile('Passt zu ' + personName(p), fmtScore(x.score), sub, x.open || x.unweighted ? 'tile-warn' : '');
        }).join('');
        if (people.length > 1) {
            html += s.ko.length
                ? tile('Passt zu uns', '✕ passt nicht', 'Ein Muss-Kriterium ist nicht erfüllt (ohne K.-o. ' + fmtScore(s.raw) + ')', 'tile-bad')
                : tile('Passt zu uns', fmtScore(s.overall), s.complete ? 'Durchschnitt aller Personen' : 'vorläufig – noch nicht alles bewertet', s.complete ? '' : 'tile-warn');
        }
        box.innerHTML = html;
    }

    function wishNames(ids) {
        return ids.map(function (id) {
            var w = state.wishes.find(function (x) { return x.id === id; });
            return '„' + ((w && w.text) || 'Wunsch') + '“';
        }).join(', ');
    }

    /** Text für Karten/Vergleich: K.-o. statt 0 %. */
    function fmtWish(v, ko) {
        return ko ? '✕ K.-o.' : fmtScore(v);
    }

    function renderFlatList(box) {
        var p = state.profile;
        if (!state.flats.length) {
            box.innerHTML = '<p class="muted">Noch keine Wohnung angelegt. Mit „+ Wohnung“ geht’s los – Kaufpreis, Hausgeld, WG-Zimmer und Finanzierung kommen dort rein.</p>';
            return;
        }
        var results = state.flats.map(function (f) {
            var a = WK.analyze(f, p, state.flats);
            a.wish = WK.wishScore(f, state.people, state.wishes);
            return a;
        });
        var hasWishes = state.wishes.length > 0 && state.people.length > 0;

        var rows = COMPARE;
        if (hasWishes) {
            rows = rows.concat([{ label: state.people.length > 1 ? 'Passt zu uns (Wünsche)' : 'Passt zu ' + personName(state.people[0]) + ' (Wünsche)', get: function (a) { return a.wish.overall; }, f: function (v, a) { return fmtWish(v, a.wish.ko.length); }, best: 'max', strong: true, sep: true }]);
            if (state.people.length > 1) {
                rows = rows.concat(state.people.map(function (person, i) {
                    return { label: 'Passt zu ' + personName(person), get: function (a) { return a.wish.persons[i].score; }, f: function (v, a) { return fmtWish(v, a.wish.persons[i].ko.length); }, best: 'max' };
                }));
            }
            rows = rows.concat([{ label: 'Bewertungen offen', get: function (a) { return a.wish.open; }, f: function (v) { return v ? String(v) : '–'; } }]);
        }

        var cards = '<div class="cards">' + results.map(function (a) {
            var f = a.flat, w = worst(a);
            return '<a class="card" href="#w=' + encodeURIComponent(f.id) + '">' +
                '<div class="card-head"><span class="card-name">' + esc(f.name || 'Ohne Namen') + '</span>' +
                '<span class="badge badge-' + w + '" title="' + TIER_LABEL[w] + '">' + ICON[w] + ' ' + TIER_LABEL[w] + '</span></div>' +
                (f.address ? '<div class="card-sub">' + esc(f.address) + '</div>' : '') +
                '<dl class="card-facts">' +
                '<dt>Kaufpreis</dt><dd>' + eur(a.price) + (a.area ? ' · ' + fmtInput(a.area, 1) + ' m²' : '') + '</dd>' +
                (a.hoaPerSqm ? '<dt>Hausgeld</dt><dd>' + perSqm(a.hoaPerSqm) + '</dd>' : '') +
                '<dt>Netto-Wohnkosten</dt><dd>' + eur(a.netHousing) + ' / Monat</dd>' +
                '<dt>Frei verfügbar</dt><dd>' + (a.netIncome > 0 ? eur(a.available) : '–') + '</dd>' +
                (hasWishes ? '<dt>Passt zu ' + (state.people.length > 1 ? 'uns' : esc(personName(state.people[0]))) + '</dt>' +
                    (a.wish.ko.length
                        ? '<dd class="bad-text" title="Muss nicht erfüllt: ' + esc(wishNames(a.wish.ko.map(function (k) { return k.wishId; }))) + '">✕ passt nicht</dd>'
                        : '<dd>' + fmtScore(a.wish.overall) + (a.wish.open ? ' <span class="muted">(' + a.wish.open + ' offen)</span>' : '') + '</dd>') : '') +
                '</dl></a>';
        }).join('') + '</div>';

        var table = '';
        if (results.length) {
            table = '<h3 class="group-title">Vergleich</h3><div class="table-scroll"><table class="compare"><thead><tr><th></th>' +
                results.map(function (a) { return '<th><a href="#w=' + encodeURIComponent(a.flat.id) + '">' + esc(a.flat.name || 'Ohne Namen') + '</a></th>'; }).join('') +
                '</tr></thead><tbody>' +
                rows.map(function (row) {
                    var vals = results.map(function (a) { return row.get(a); });
                    var valid = vals.filter(function (v) { return v !== null && v !== undefined && isFinite(v); });
                    var best = null;
                    if (row.best && valid.length >= 2) {
                        best = row.best === 'min' ? Math.min.apply(null, valid) : Math.max.apply(null, valid);
                        if (Math.min.apply(null, valid) === Math.max.apply(null, valid)) best = null;
                    }
                    return '<tr class="' + (row.sep ? 'sep ' : '') + (row.strong ? 'strong' : '') + '"><th>' + esc(row.label) + '</th>' +
                        vals.map(function (v, i) {
                            var isBest = best !== null && v === best;
                            return '<td' + (isBest ? ' class="best" title="bester Wert"' : '') + '>' + esc(row.f(v, results[i])) + '</td>';
                        }).join('') + '</tr>';
                }).join('') +
                '<tr class="sep"><th>Status</th>' + results.map(function (a) {
                    var w = worst(a);
                    return '<td><span class="badge badge-' + w + '">' + ICON[w] + ' ' + TIER_LABEL[w] + '</span></td>';
                }).join('') + '</tr>' +
                '</tbody></table></div>' +
                (results.length >= 2 ? '<p class="muted small">Markiert = bester Wert der Zeile. „Echte Kosten“ = Zinsen + Nebenkosten + entgangene Rendite aufs Eigenkapital − WG-Einnahmen (Tilgung zählt als Sparen).' +
                    (hasWishes ? ' „Passt zu …“ = wie gut die Wohnung die Wünsche erfüllt, gewichtet nach Wichtigkeit; gemeinsam = Durchschnitt aller Personen.' : '') + '</p>' : '');
        }
        box.innerHTML = cards + table;
    }

    /* ---------- Detailansicht einer Wohnung ---------- */

    function renderDetail(f) {
        var p = state.profile;
        app.innerHTML = '';
        window.scrollTo(0, 0);
        document.title = (f.name || 'Wohnung') + ' – Wohnungskauf';

        var nameInput = el('input', { type: 'text', class: 'name-input', 'aria-label': 'Name der Wohnung', autocomplete: 'off' });
        nameInput.value = f.name || '';
        nameInput.addEventListener('input', function () {
            f.name = nameInput.value;
            document.title = (f.name || 'Wohnung') + ' – Wohnungskauf';
            changed();
        });

        app.appendChild(el('div', { class: 'detail-top' }, [
            el('a', { class: 'back', href: '#', text: '← Übersicht' }),
            nameInput,
            el('div', { class: 'actions' }, [
                btn('Duplizieren', 'btn-ghost', function () {
                    var copy = normalizeFlat(JSON.parse(JSON.stringify(f)), p);
                    copy.id = uid();
                    copy.loans.forEach(function (l) { l.id = uid(); });
                    copy.wg.rooms.forEach(function (r) { r.id = uid(); });
                    copy.name = (f.name || 'Wohnung') + ' (Kopie)';
                    state.flats.splice(state.flats.indexOf(f) + 1, 0, copy);
                    saveNow();
                    location.hash = 'w=' + copy.id;
                }, 'Kopie anlegen, z. B. um eine andere Finanzierung durchzuspielen'),
                btn('Exportieren', 'btn-ghost', function () { exportFlat(f); }, 'Nur diese Wohnung als JSON speichern'),
                btn('Löschen', 'btn-ghost btn-danger', function () {
                    if (!confirm('„' + (f.name || 'Wohnung') + '“ wirklich löschen?')) return;
                    state.flats.splice(state.flats.indexOf(f), 1);
                    saveNow();
                    location.hash = '';
                })
            ])
        ]));

        // --- Eingaben ---
        var taxField = numField(f, 'transferTaxPct', 'Grunderwerbsteuer', { unit: '%' });

        var roomsBox = el('div', { class: 'rooms' });
        var loansBox = el('div', { class: 'loans' });

        var taxable = el('input', { type: 'checkbox' });
        taxable.checked = !!f.wg.taxable;
        taxable.addEventListener('change', function () { f.wg.taxable = taxable.checked; changed(); });

        var wishPanel = wishRatingPanel(f);

        var inputs = el('div', { class: 'detail-inputs' }, [
            panel('Objekt', [
                group(null, [
                    textField(f, 'address', 'Adresse / Lage', { cls: 'span-2' }),
                    textField(f, 'link', 'Link zum Exposé', { placeholder: 'https://…', cls: 'span-2' }),
                    numField(f, 'area', 'Wohnfläche', { unit: 'm²', dec: 1 }),
                    numField(f, 'year', 'Baujahr', { dec: 0, noGroup: true, hint: 'Für die AfA: vor 1925 → 2,5 %, ab 2023 → 3 %, sonst 2 %.' }),
                    textField(f, 'notes', 'Notizen', { multiline: true, cls: 'span-2' })
                ])
            ]),
            wishPanel.el,
            panel('Kaufpreis & Nebenkosten', [
                group(null, [
                    numField(f, 'price', 'Kaufpreis', { unit: '€', dec: 0 }),
                    numField(f, 'inventory', 'Davon Küche / Inventar', { unit: '€', dec: 0, hint: 'Separat ausgewiesen → keine Grunderwerbsteuer darauf.' }),
                    stateSelect(f, 'state', 'Bundesland', function () {
                        if (f.state) {
                            f.transferTaxPct = WK.transferTaxFor(f.state);
                            taxField._input.value = fmtInput(f.transferTaxPct, 3);
                        }
                    }),
                    taxField,
                    numField(f, 'notaryPct', 'Notar & Grundbuch', { unit: '%', hint: 'Üblich ca. 1,5–2 %.' }),
                    numField(f, 'brokerPct', 'Makler (Käuferanteil)', { unit: '%', hint: 'Meist 3,57 % inkl. MwSt., 0 ohne Makler.' }),
                    numField(f, 'renovation', 'Renovierung / Modernisierung', { unit: '€', dec: 0 }),
                    numField(f, 'otherOneOff', 'Sonstiges einmalig', { unit: '€', dec: 0, hint: 'Umzug, Möbel, Gutachter, Bereitstellungszinsen …' })
                ])
            ]),
            panel('Laufende Kosten (monatlich)', [
                group(null, [
                    numField(f, 'hoa', 'Hausgeld', { unit: '€', hint: 'Gesamt laut Wirtschaftsplan, inkl. Heizung & Erhaltungsrücklage.' }),
                    numField(f, 'propertyTax', 'Grundsteuer pro Jahr', { unit: '€' }),
                    numField(f, 'maintenance', 'Eigene Rücklage für die Wohnung', { unit: '€', hint: 'Reparaturen im Sondereigentum (Bad, Böden, Geräte). Faustregel ~0,5–1 €/m².' }),
                    numField(f, 'utilities', 'Strom, Internet, Rundfunk', { unit: '€', hint: 'Zahlt die WG meist über die Warmmiete mit.' })
                ])
            ]),
            panel('WG & Untermieter', [
                roomsBox,
                group('Annahmen', [
                    numField(f.wg, 'vacancyPct', 'Leerstand / Mietausfall', { unit: '%', hint: 'Wechsel, Suche, Ausfälle – 5 % ≈ 2–3 Wochen pro Jahr.' }),
                    numField(f.wg, 'buildingPct', 'Gebäudeanteil am Kaufpreis', { unit: '%', hint: 'Rest ist Grundstück (nicht abschreibbar). Stadtlagen oft 60–80 %.' }),
                    numField(f.wg, 'afaPct', 'AfA-Satz', { unit: '%' }),
                    fieldWrap('Mieteinnahmen versteuern', el('span', { class: 'check' }, [taxable, ' mit ' + fmtInput(p.taxRate, 2) + ' % Grenzsteuersatz']), 'Untervermietung ist steuerpflichtig; anteilige Kosten und AfA sind absetzbar.')
                ])
            ], { hint: 'Zimmer mit Warmmiete. Dein eigenes Zimmer als „Ich“ markieren – zählt für die Aufteilung von Gemeinschaftsflächen.' }),
            panel('Finanzierung', [
                group(null, [
                    numField(f, 'equity', 'Eigenkapital-Einsatz', { unit: '€', dec: 0, placeholder: fmtInput(p.equity, 0) || '0', hint: 'Leer = Wert aus „Meine Finanzen“ (' + eur(n(p.equity)) + ').' }),
                    numField(f, 'appreciation', 'Wertsteigerung pro Jahr', { unit: '%', placeholder: fmtInput(p.appreciation, 2), hint: 'Leer = Standard (' + fmtInput(p.appreciation, 2) + ' %).' })
                ]),
                loansBox,
                btn('+ Weiteres Darlehen', 'btn-ghost btn-add', function () {
                    f.loans.push(newLoan(p, false));
                    renderLoans();
                    changed();
                }, 'z. B. KfW-Förderkredit oder Privatdarlehen')
            ])
        ]);

        var results = el('div', { class: 'detail-results' });
        results.addEventListener('click', function (e) {
            var b = e.target.closest('[data-copy-questions]');
            if (b && results._analysis) copyText(questionsText(results._analysis), b);
        });
        var chartPanel = el('div', { class: 'chart-box' });
        var planBox = el('div');

        app.appendChild(el('div', { class: 'detail-layout' }, [inputs, el('aside', { class: 'detail-aside' }, [results])]));
        app.appendChild(panel('Schulden & Vermögen über die Zeit', [chartPanel, planBox], { cls: 'panel-wide' }));

        function renderRooms() {
            roomsBox.innerHTML = '';
            var head = el('div', { class: 'room room-head' }, [
                el('span', { text: 'Zimmer' }), el('span', { text: 'Größe' }), el('span', { text: 'Warmmiete' }), el('span', { text: 'Ich' }), el('span')
            ]);
            roomsBox.appendChild(head);
            f.wg.rooms.forEach(function (r, idx) {
                var name = el('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Zimmername' });
                name.value = r.name || '';
                name.addEventListener('input', function () { r.name = name.value; changed(); });
                var size = numField(r, 'size', '', { unit: 'm²', dec: 1 });
                var rent = numField(r, 'rent', '', { unit: '€' });
                if (r.self) { rent._input.disabled = true; rent._input.placeholder = 'selbst'; rent._input.value = ''; }
                var self = el('input', { type: 'checkbox', 'aria-label': 'Mein Zimmer' });
                self.checked = !!r.self;
                self.addEventListener('change', function () { r.self = self.checked; renderRooms(); changed(); });
                var del = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zimmer entfernen', text: '×', onclick: function () {
                    f.wg.rooms.splice(idx, 1); renderRooms(); changed();
                } });
                roomsBox.appendChild(el('div', { class: 'room' }, [name, size.querySelector('.input-wrap'), rent.querySelector('.input-wrap'), el('span', { class: 'room-self' }, [self]), del]));
            });
            roomsBox.appendChild(btn('+ Zimmer', 'btn-ghost btn-add', function () {
                f.wg.rooms.push(newRoom(false));
                renderRooms();
                changed();
            }));
        }

        function renderLoans() {
            loansBox.innerHTML = '';
            f.loans.forEach(function (l, idx) {
                var name = el('input', { type: 'text', class: 'loan-name', autocomplete: 'off', 'aria-label': 'Name des Darlehens' });
                name.value = l.name || '';
                name.addEventListener('input', function () { l.name = name.value; changed(); });

                var modeSel = el('select', null, [
                    el('option', { value: 'repay', text: 'Anfängliche Tilgung (%)' }),
                    el('option', { value: 'term', text: 'Laufzeit bis schuldenfrei (Jahre)' }),
                    el('option', { value: 'payment', text: 'Monatsrate (€)' })
                ]);
                modeSel.value = l.mode || 'repay';
                modeSel.addEventListener('change', function () { l.mode = modeSel.value; renderLoans(); changed(); });

                var modeField = l.mode === 'term' ? numField(l, 'term', 'Laufzeit', { unit: 'Jahre', dec: 1 })
                    : l.mode === 'payment' ? numField(l, 'payment', 'Monatsrate', { unit: '€' })
                    : numField(l, 'repay', 'Anfängliche Tilgung', { unit: '%' });

                var amount = idx === 0
                    ? fieldWrap('Betrag', el('div', { class: 'auto-amount', 'data-auto': '' }), 'Automatisch: Gesamtkosten − Eigenkapital − weitere Darlehen.')
                    : numField(l, 'amount', 'Betrag', { unit: '€', dec: 0 });

                loansBox.appendChild(el('div', { class: 'loan' }, [
                    el('div', { class: 'loan-head' }, [
                        name,
                        idx > 0 ? el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Darlehen entfernen', text: '×', onclick: function () {
                            f.loans.splice(idx, 1); renderLoans(); changed();
                        } }) : null
                    ]),
                    el('div', { class: 'grid' }, [
                        amount,
                        numField(l, 'rate', 'Sollzins', { unit: '%' }),
                        fieldWrap('Tilgung festlegen über', modeSel),
                        modeField,
                        numField(l, 'fixedYears', 'Zinsbindung', { unit: 'Jahre', dec: 0 }),
                        numField(l, 'followRate', 'Anschlusszins (Annahme)', { unit: '%', hint: 'Gilt nach der Zinsbindung, bei gleicher Rate.' }),
                        numField(l, 'extra', 'Sondertilgung pro Jahr', { unit: '€', dec: 0 })
                    ]),
                    el('div', { class: 'loan-out', 'data-loan-out': String(idx) })
                ]));
            });
        }

        renderRooms();
        renderLoans();

        currentUpdate = function () {
            var a = WK.analyze(f, state.profile, state.flats);
            wishPanel.update();
            renderDetailResults(results, a);
            loansBox.querySelectorAll('[data-auto]').forEach(function (e) { e.textContent = eur(a.loanAmounts[0]); });
            loansBox.querySelectorAll('[data-loan-out]').forEach(function (e) {
                var i = Number(e.getAttribute('data-loan-out'));
                var s = a.sims[i], l = f.loans[i];
                if (!s || !l) return;
                if (s.amount <= 0) { e.textContent = 'Kein Betrag – wird nicht gebraucht.'; return; }
                var annual = s.payment * 12 / s.amount * 100;
                e.innerHTML = '<span><b>' + eur(s.payment) + '</b> / Monat</span>' +
                    '<span>Tilgung anfangs ' + fmtInput(Math.max(0, annual - n(l.rate)), 2) + ' %</span>' +
                    (n(l.fixedYears) > 0 ? '<span>Restschuld nach ' + Math.round(n(l.fixedYears)) + ' J.: <b>' + eur(s.balanceAtFixed) + '</b></span>' : '') +
                    '<span>' + (s.stuck ? '<b class="bad-text">Rate deckt die Zinsen nicht</b>' : 'schuldenfrei nach ' + WK.years(s.payoffYears)) + '</span>';
            });
            drawChart(chartPanel, a.timeline, a.fixedYears);
            renderPlan(planBox, a);
        };
        currentUpdate();
    }

    function line(label, value, cls) {
        return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th>' + label + '</th><td>' + esc(value) + '</td></tr>';
    }

    function renderDetailResults(box, a) {
        var p = state.profile;
        if (a.price <= 0) {
            box.innerHTML = '<div class="panel results-panel"><p class="muted">Sobald ein Kaufpreis drin ist, steht hier die Auswertung: Monatsbilanz, Kaufkosten, Finanzierung und Checks.</p></div>';
            return;
        }
        var fixed = a.fixedYears;
        var vacancy = n(a.flat.wg.vacancyPct);
        var html = '<div class="panel results-panel">';

        html += '<div class="tiles tiles-2">' +
            tile('Netto-Wohnkosten', eur(a.netHousing), a.currentRent > 0 ? signed(a.vsRent) + ' ggü. Miete heute' : 'pro Monat, nach WG-Einnahmen') +
            tile('Frei verfügbar', a.netIncome > 0 ? eur(a.available) : '–', a.netIncome > 0 ? 'pro Monat, nach allen Fixkosten' : 'Nettoeinkommen fehlt', a.netIncome > 0 && a.available < 0 ? 'tile-bad' : '') +
            tile('Echte Kosten', eur(a.trueCost), 'ohne Tilgung, inkl. entgangener Rendite') +
            tile('Schuldenfrei nach', WK.years(a.payoffYears), 'Zinsen gesamt ' + eur(a.totalInterest)) +
            '</div>';

        html += '<h3>Checks</h3><ul class="checks">' + a.warnings.slice().sort(function (x, y) { return TIER[y.level] - TIER[x.level]; }).map(function (w) {
            return '<li class="check-' + w.level + '"><span class="check-icon" aria-label="' + TIER_LABEL[w.level] + '">' + ICON[w.level] + '</span><span>' + esc(w.text) + '</span></li>';
        }).join('') + '</ul>';

        html += renderReview(box, a);

        html += '<h3>Monatsbilanz</h3><table class="calc">' +
            line('Kreditrate (Zins + Tilgung)', eur(a.payment)) +
            line('Hausgeld', eur(a.hoa)) +
            line('Grundsteuer (anteilig)', eur(a.propertyTax)) +
            line('Eigene Rücklage', eur(a.maintenance)) +
            line('Strom, Internet & Co.', eur(a.utilities)) +
            line('Ausgaben', eur(a.outflow), 'sum') +
            (a.rentGross > 0 ?
                line('WG-Mieten (' + a.roomsRented + ' Zi., ' + fmtInput(vacancy, 1) + ' % Leerstand)', '− ' + eur(a.rentEff)) +
                (a.flat.wg.taxable ? line(a.rentTax >= 0 ? 'Steuer auf Untermiete' : 'Steuerersparnis (Verlust)', signed(a.rentTax)) : '')
                : line('WG-Mieten', 'keine eingetragen', 'muted-row')) +
            line('Netto-Wohnkosten', eur(a.netHousing), 'sum strong') +
            (a.currentRent > 0 ? line('ggü. aktueller Warmmiete (' + eur(a.currentRent) + ')', signed(a.vsRent)) : '') +
            '</table>';

        html += '<table class="calc calc-split">' +
            line('davon Vermögensaufbau (Tilgung)', eur(a.wealthBuild)) +
            line('Entgangene Rendite aufs Eigenkapital', '+ ' + eur(a.opportunity)) +
            line('Echte Kosten', eur(a.trueCost), 'sum strong') +
            (a.currentRent > 0 ? line('ggü. aktueller Warmmiete', signed(a.trueVsRent)) : '') +
            '</table><p class="muted small">Echte Kosten = Zinsen + laufende Kosten + entgangene Rendite − WG-Einnahmen nach Steuer. Die Tilgung ist kein Verlust, sondern landet in der Wohnung.</p>';

        if (a.netIncome > 0) {
            html += '<h3>Haushalt</h3><table class="calc">' +
                line('Nettoeinkommen', eur(a.netIncome)) +
                line('Lebenshaltung', '− ' + eur(n(p.livingCosts))) +
                (n(p.otherDebt) > 0 ? line('Andere Kreditraten', '− ' + eur(n(p.otherDebt))) : '') +
                line('Netto-Wohnkosten', '− ' + eur(a.netHousing)) +
                line('Frei verfügbar', eur(a.available), 'sum strong') +
                line('Kreditraten / Netto (ohne WG)', pct(a.burden)) +
                line('Wohnkosten / Netto (mit WG)', pct(a.burdenNet)) +
                '</table>';
        }

        html += '<h3>Kauf</h3><table class="calc">' +
            line('Kaufpreis', eur(a.price)) +
            line('Grunderwerbsteuer (' + fmtInput(n(a.flat.transferTaxPct), 2) + ' %)', eur(a.transferTax)) +
            line('Notar & Grundbuch', eur(a.notary)) +
            line('Makler', eur(a.broker)) +
            (a.oneOff > 0 ? line('Renovierung & Sonstiges', eur(a.oneOff)) : '') +
            line('Gesamtkosten', eur(a.total), 'sum strong') +
            line('Kaufnebenkosten', eur(a.closing) + ' (' + pct(a.price > 0 ? a.closing / a.price : null) + ')') +
            (a.pricePerSqm ? line('Preis pro m²', eur(a.pricePerSqm)) : '') +
            '</table>';

        html += '<h3>Finanzierung</h3><table class="calc">' +
            line('Eigenkapital-Einsatz', eur(a.equity) + (a.equityRatio !== null ? ' (' + pct(a.equityRatio) + ')' : '')) +
            line('Darlehen gesamt', eur(a.loanTotal)) +
            line('Beleihung (Darlehen / Kaufpreis)', pct(a.ltv)) +
            line('Cash nach dem Kauf', eur(a.cashAfter)) +
            (fixed > 0 ? line('Restschuld nach ' + fixed + ' J. Zinsbindung', eur(a.balanceAtFixed), 'sum') : '') +
            (fixed > 0 ? line('Wert nach ' + fixed + ' J. (' + fmtInput(a.appreciation, 2) + ' % p. a.)', eur(a.valueAtFixed)) : '') +
            (fixed > 0 ? line('Netto-Vermögen in der Wohnung dann', eur(a.netAtFixed), 'strong') : '') +
            '</table>';

        if (a.rentGross > 0) {
            html += '<h3>Steuer auf Untermiete <span class="muted small">(grobe Schätzung, Jahr 1)</span></h3><table class="calc">' +
                line('Mieteinnahmen pro Jahr', eur(a.rentEff * 12)) +
                line('Vermieteter Anteil der Wohnung', pct(a.rentedShare)) +
                line('AfA anteilig', '− ' + eur(a.afa * a.rentedShare)) +
                line('Kosten anteilig (Zinsen, Hausgeld, …)', '− ' + eur(a.deductible - a.afa * a.rentedShare)) +
                line('Zu versteuern', eur(a.taxableIncome), 'sum') +
                line('Steuer (' + fmtInput(n(p.taxRate), 2) + ' %) pro Monat', a.flat.wg.taxable ? signed(a.rentTax) : 'nicht berücksichtigt') +
                '</table>';
        }

        html += '</div>';
        box.innerHTML = html;
    }

    function reviewKey(r) {
        return r.title.replace(/\s*\(.*\)$/, '');
    }

    /** Objekt-Bewertung: aufklappbare Hinweise mit Erklärung und Rückfragen.
     *  Der Aufklapp-Zustand bleibt erhalten, obwohl die Auswertung bei jeder
     *  Eingabe neu gezeichnet wird. */
    function renderReview(box, a) {
        var openState = box._reviewOpen || (box._reviewOpen = {});
        box.querySelectorAll('details[data-review]').forEach(function (d) {
            openState[d.getAttribute('data-review')] = d.open;
        });
        box._analysis = a;
        var items = a.review.slice().sort(function (x, y) { return TIER[y.level] - TIER[x.level]; });
        var questionCount = items.reduce(function (s, r) { return s + r.questions.length; }, 0);
        var docsOpen = openState.__docs === true;

        var html = '<h3>Objekt & Rückfragen</h3>';
        html += '<p class="muted small review-intro">Faustwerte für Deutschland – Lage und Ausstattung können Abweichungen erklären. Aufklappen für Erklärung und Fragen an Makler oder Verwaltung.</p>';
        html += '<div class="review">' + items.map(function (r) {
            var key = reviewKey(r);
            var open = key in openState ? openState[key] : (r.level === 'bad' || r.level === 'warn');
            return '<details class="review-item check-' + r.level + '" data-review="' + esc(key) + '"' + (open ? ' open' : '') + '>' +
                '<summary><span class="check-icon" aria-label="' + TIER_LABEL[r.level] + '">' + ICON[r.level] + '</span><span class="review-title">' + esc(r.title) + '</span>' +
                (r.questions.length ? '<span class="review-count" title="Rückfragen">' + r.questions.length + ' ?</span>' : '') + '</summary>' +
                '<div class="review-body"><p>' + esc(r.text) + '</p>' +
                (r.questions.length ? '<div class="review-q-title">Nachfragen</div><ul>' + r.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>' : '') +
                '</div></details>';
        }).join('') + '</div>';
        html += '<details class="review-item check-info docs" data-review="__docs"' + (docsOpen ? ' open' : '') + '><summary><span class="check-icon">i</span><span class="review-title">Unterlagen-Checkliste vor dem Kauf</span></summary>' +
            '<div class="review-body"><ul>' + WK.DOCUMENTS.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div></details>';
        html += '<button type="button" class="btn btn-ghost btn-copy" data-copy-questions>Rückfragen & Unterlagen kopieren' + (questionCount ? ' (' + questionCount + ')' : '') + '</button>';
        return html;
    }

    function questionsText(a) {
        var seen = {};
        var lines = ['Rückfragen zu „' + (a.flat.name || 'Wohnung') + '“' + (a.flat.address ? ' (' + a.flat.address + ')' : ''), ''];
        a.review.forEach(function (r) {
            var qs = r.questions.filter(function (q) { if (seen[q]) return false; seen[q] = true; return true; });
            if (!qs.length) return;
            lines.push(r.title + ':');
            qs.forEach(function (q) { lines.push('- ' + q); });
            lines.push('');
        });
        lines.push('Unterlagen:');
        WK.DOCUMENTS.forEach(function (d) { lines.push('- ' + d); });
        return lines.join('\n');
    }

    function copyText(text, button) {
        var done = function () {
            var old = button.textContent;
            button.textContent = 'Kopiert ✓';
            setTimeout(function () { button.textContent = old; }, 1600);
        };
        var fallback = function () {
            var ta = el('textarea', { style: 'position:fixed;opacity:0' });
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { alert(text); }
            ta.remove();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
        else fallback();
    }

    function renderPlan(box, a) {
        var rows = a.timeline.slice(1);
        var last = rows.findIndex(function (r) { return r.balance <= 0; });
        if (last !== -1) rows = rows.slice(0, last + 1);
        var open = box.querySelector('details') && box.querySelector('details').open;
        box.innerHTML = '<details' + (open ? ' open' : '') + '><summary>Tilgungsplan (jährlich, alle Darlehen)</summary><div class="table-scroll"><table class="plan"><thead><tr>' +
            '<th>Jahr</th><th>Zinsen</th><th>Tilgung</th><th>Sondertilgung</th><th>Restschuld</th><th>Wert</th><th>Netto-Vermögen</th></tr></thead><tbody>' +
            rows.map(function (r) {
                return '<tr' + (r.year === a.fixedYears ? ' class="mark"' : '') + '><td>' + r.year + '</td><td>' + eur(r.interest) + '</td><td>' + eur(r.principal) + '</td><td>' +
                    (r.extra ? eur(r.extra) : '–') + '</td><td>' + eur(r.balance) + '</td><td>' + eur(r.value) + '</td><td>' + eur(r.net) + '</td></tr>';
            }).join('') + '</tbody></table></div></details>';
    }

    /* ---------- Diagramm ---------- */

    var SERIES = [
        { key: 'value', label: 'Immobilienwert', cls: 's1' },
        { key: 'balance', label: 'Restschuld', cls: 's2' },
        { key: 'cumInterest', label: 'Gezahlte Zinsen', cls: 's3' }
    ];

    function niceStep(raw) {
        if (raw <= 0) return 1;
        var mag = Math.pow(10, Math.floor(Math.log10(raw)));
        var r = raw / mag;
        return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
    }

    function drawChart(box, rows, fixedYears) {
        box._rows = rows;
        box._fixed = fixedYears;
        if (!box._observed && window.ResizeObserver) {
            box._observed = true;
            var lastW = 0;
            new ResizeObserver(function () {
                if (Math.abs(box.clientWidth - lastW) > 4 && box._rows) { lastW = box.clientWidth; drawChart(box, box._rows, box._fixed); }
            }).observe(box);
        }
        if (!rows.length || !(rows[0].value > 0)) { box.innerHTML = ''; return; }

        var W = Math.max(280, box.clientWidth || 600), H = 280;
        var m = { l: 62, r: W < 520 ? 82 : 112, t: 16, b: 34 };
        var iw = W - m.l - m.r, ih = H - m.t - m.b;
        var N = rows[rows.length - 1].year;
        var max = 0;
        rows.forEach(function (r) { SERIES.forEach(function (s) { max = Math.max(max, r[s.key]); }); });
        var step = niceStep(max / 4);
        var ymax = Math.ceil(max / step) * step || 1;
        var x = function (yr) { return m.l + iw * yr / N; };
        var y = function (v) { return m.t + ih * (1 - v / ymax); };

        var svg = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Immobilienwert, Restschuld und gezahlte Zinsen über ' + N + ' Jahre">';
        for (var v = 0; v <= ymax + 1e-6; v += step) {
            svg += '<line class="grid" x1="' + m.l + '" x2="' + (m.l + iw) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
                '<text class="axis" x="' + (m.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + WK.short(v) + '</text>';
        }
        var xStep = N <= 12 ? 2 : N <= 30 ? 5 : 10;
        for (var t = 0; t <= N; t += xStep) {
            svg += '<text class="axis" x="' + x(t) + '" y="' + (H - m.b + 18) + '" text-anchor="middle">' + t + '</text>';
        }
        svg += '<text class="axis" x="' + (m.l + iw) + '" y="' + (H - 2) + '" text-anchor="end">Jahre</text>';
        if (fixedYears > 0 && fixedYears < N) {
            svg += '<line class="fixed" x1="' + x(fixedYears) + '" x2="' + x(fixedYears) + '" y1="' + m.t + '" y2="' + (m.t + ih) + '"/>' +
                '<text class="axis" x="' + (x(fixedYears) + 4) + '" y="' + (m.t + 10) + '">Zinsbindung</text>';
        }

        SERIES.forEach(function (s) {
            var d = rows.map(function (r, i) { return (i ? 'L' : 'M') + x(r.year).toFixed(1) + ',' + y(r[s.key]).toFixed(1); }).join('');
            svg += '<path class="line ' + s.cls + '" d="' + d + '"/>';
        });

        // Direkte Beschriftung am Linienende, Überlappungen nach unten/oben schieben.
        var lastRow = rows[rows.length - 1];
        var labels = SERIES.map(function (s) { return { s: s, y: y(lastRow[s.key]) }; }).sort(function (p, q) { return p.y - q.y; });
        for (var i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
        var overflow = labels[labels.length - 1].y - (m.t + ih);
        if (overflow > 0) labels.forEach(function (l) { l.y -= overflow; });
        labels.forEach(function (l) {
            svg += '<text class="end-label" x="' + (m.l + iw + 8) + '" y="' + (l.y + 4) + '">' + l.s.label + '</text>';
        });

        svg += '<line class="crosshair" y1="' + m.t + '" y2="' + (m.t + ih) + '" visibility="hidden"/>';
        SERIES.forEach(function (s) { svg += '<circle class="dot ' + s.cls + '" r="4" visibility="hidden"/>'; });
        svg += '<rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '"/></svg>';

        box.innerHTML = '<div class="legend">' + SERIES.map(function (s) {
            return '<span class="legend-item"><span class="key ' + s.cls + '"></span>' + s.label + '</span>';
        }).join('') + '</div><div class="chart-area">' + svg + '<div class="tooltip" hidden></div></div>';

        var area = box.querySelector('.chart-area');
        var svgEl = area.querySelector('svg');
        var hair = svgEl.querySelector('.crosshair');
        var dots = svgEl.querySelectorAll('.dot');
        var tip = area.querySelector('.tooltip');

        function show(evt) {
            var rect = svgEl.getBoundingClientRect();
            var px = evt.clientX - rect.left;
            var yr = Math.max(0, Math.min(N, Math.round((px - m.l) / iw * N)));
            var r = rows[yr];
            if (!r) return;
            var cx = x(yr);
            hair.setAttribute('x1', cx); hair.setAttribute('x2', cx); hair.setAttribute('visibility', 'visible');
            SERIES.forEach(function (s, i) {
                dots[i].setAttribute('cx', cx); dots[i].setAttribute('cy', y(r[s.key])); dots[i].setAttribute('visibility', 'visible');
            });
            tip.innerHTML = '';
            tip.appendChild(el('div', { class: 'tip-title', text: yr === 0 ? 'Kauf' : 'Nach ' + yr + ' Jahr' + (yr === 1 ? '' : 'en') }));
            SERIES.forEach(function (s) {
                tip.appendChild(el('div', { class: 'tip-row' }, [el('span', { class: 'key ' + s.cls }), el('b', { text: eur(r[s.key]) }), el('span', { text: s.label })]));
            });
            tip.appendChild(el('div', { class: 'tip-row tip-net' }, [el('span', { class: 'key key-none' }), el('b', { text: eur(r.net) }), el('span', { text: 'Netto-Vermögen' })]));
            tip.hidden = false;
            var tw = tip.offsetWidth;
            var left = cx + 12 + tw > W ? cx - 12 - tw : cx + 12;
            tip.style.left = Math.max(0, left) + 'px';
            tip.style.top = m.t + 'px';
        }
        function hide() {
            hair.setAttribute('visibility', 'hidden');
            dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
            tip.hidden = true;
        }
        var hit = svgEl.querySelector('.hit');
        hit.addEventListener('pointermove', show);
        hit.addEventListener('pointerdown', show);
        hit.addEventListener('pointerleave', hide);
    }

    /* ---------- Routing ---------- */

    function route() {
        if (saveTimer) saveNow();
        currentUpdate = null;
        var imp = location.hash.match(/^#import=([A-Za-z0-9_-]+)/);
        if (imp) { importFromLink(imp[1]); return; }
        var m = location.hash.match(/^#w=(.+)$/);
        var id = m ? decodeURIComponent(m[1]) : null;
        var f = id ? state.flats.find(function (x) { return x.id === id; }) : null;
        if (f) renderDetail(f);
        else renderMain();
    }

    window.addEventListener('hashchange', route);
    route();
})();
