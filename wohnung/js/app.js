/* Wohnung (Kauf oder Miete) – Oberfläche, Speicherung, Export/Import.
   Zwei Ansichten über den URL-Hash: Übersicht ("" / "#") mit den persönlichen
   Finanzen und dem Vergleich aller Wohnungen, und "#w=<id>" mit allem, was zu
   einer einzelnen Wohnung gehört. Rechenlogik liegt in calc.js (WK). */
(function () {
    'use strict';

    var KEY = 'klmpfh-wohnung';
    var n = WK.n, eur = WK.eur, eurRange = WK.eurRange, pct = WK.pct;

    var PROFILE_DEFAULTS = {
        cash: null, equity: null, reserve: null,
        netIncome: null, livingCosts: null, otherDebt: null, currentRent: null,
        bankMaxLoan: null, bankMaxRate: null,
        altReturn: 2, appreciation: 1.5,
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

    /** person: wer darin wohnt (null = jemand anderes), self folgt daraus
     *  (linkRooms/syncPersons). rent leer = faire Miete (rentPlan in calc.js).
     *  features/extra: Zu- und Abschläge für Lage und Ausstattung. */
    function newRoom(person) {
        return { id: uid(), name: 'Zimmer', size: null, rent: null, self: false, person: person, features: {}, extra: null };
    }

    /** every: Zeitraum des Betrags in Monaten, split: Aufteilung (siehe calc.js). */
    function newPrivateCost(name, every) {
        return { id: uid(), name: name || '', amount: null, every: every || 1, split: 'equal', sharePct: null };
    }

    /** Vorschlag für die privaten Nebenkosten in "Meine Finanzen". */
    function defaultPrivateCosts() {
        return [newPrivateCost('Strom'), newPrivateCost('Internet'), newPrivateCost('Rundfunkbeitrag', 3)];
    }

    /** Ältere Posten kennen nur einen Monatsbetrag, der voll zählte – das bleibt
     *  so ("zahle ich komplett"), damit sich keine Zahlen still ändern. */
    function normalizeCost(c) {
        var out = newPrivateCost(String(c.name || ''));
        if (c.id) out.id = String(c.id);
        out.amount = WK.isSet(c.amount) ? Number(c.amount) : null;
        if (WK.COST_EVERY.some(function (e) { return e[0] === Number(c.every); })) out.every = Number(c.every);
        if (WK.COST_SPLIT.some(function (s) { return s[0] === c.split; })) out.split = c.split;
        else if (out.amount !== null) out.split = 'all';
        out.sharePct = WK.isSet(c.sharePct) ? Number(c.sharePct) : null;
        return out;
    }

    function newStep() {
        return { id: uid(), year: null, rent: null };
    }

    /** kind: 'buy' (Kauf) oder 'rent' (Miete). Beide Feldsätze sind immer da,
     *  damit beim Umschalten der Art nichts verloren geht. */
    function newFlat(p, kind) {
        return {
            id: uid(), kind: kind === 'rent' ? 'rent' : 'buy', name: 'Neue Wohnung', address: '', link: '', notes: '',
            area: null, year: null, price: null, inventory: null,
            state: p.state, transferTaxPct: WK.transferTaxFor(p.state),
            notaryPct: p.notaryPct, brokerPct: p.brokerPct,
            renovation: null, otherOneOff: null,
            hoa: null, hoaApport: null, refRent: null, propertyTax: null, maintenance: null, utilities: null,
            equity: null, appreciation: null,
            loans: [newLoan(p, true)],
            wg: { rooms: [], vacancyPct: 5 },   // Zimmer der Personen ergänzt linkRooms
            // Miete
            coldRent: null, serviceCharges: null, heatingCosts: null, deposit: null,
            rentType: 'fixed',   // 'fixed' | 'staffel' | 'index'
            indexPct: 2,         // angenommene Inflation pro Jahr bei Indexmiete
            steps: [],           // Staffelmiete: [{ year: ab Mietjahr, rent: Kaltmiete }]
            coveredCosts: {},    // { privateCostId: true } – schon in Warmmiete/Hausgeld enthalten
            persons: null,       // Personen, die sich die privaten Nebenkosten teilen; leer = automatisch (personCount in calc.js)
            ratings: {}   // { wishId: { personId: 0–100 } } – wie gut die Wohnung den Wunsch erfüllt
        };
    }

    /** self: das bin ich (genau eine Person), rent: Maximum, das die Person im Monat
     *  für alles zahlen kann, includes: { Posten: false } = zahlt sie nicht über
     *  mich (running = Nebenkosten & Heizung bzw. Hausgeld, sonst privateCostId). */
    function newPerson() {
        return { id: uid(), name: '', self: false, rent: null, includes: {} };
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
        out.kind = out.kind === 'rent' ? 'rent' : 'buy';
        if (['fixed', 'staffel', 'index'].indexOf(out.rentType) === -1) out.rentType = 'fixed';
        out.steps = Array.isArray(out.steps) ? out.steps.filter(isObj).map(function (s) {
            return Object.assign(newStep(), s, { id: s.id ? String(s.id) : uid() });
        }) : [];
        out.coveredCosts = isObj(out.coveredCosts) ? Object.assign({}, out.coveredCosts) : {};
        out.loans = Array.isArray(out.loans) && out.loans.length ? out.loans.map(function (l, i) {
            return Object.assign(newLoan(p, i === 0), l, { id: l && l.id ? String(l.id) : uid() });
        }) : base.loans;
        out.wg = Object.assign({}, base.wg, out.wg || {});
        out.wg.rooms = Array.isArray(out.wg.rooms) ? out.wg.rooms.map(function (r) {
            return Object.assign(newRoom(), r, { id: r && r.id ? String(r.id) : uid(), features: Object.assign({}, r && isObj(r.features) ? r.features : null) });
        }) : base.wg.rooms;
        out.ratings = {};
        if (isObj(f && f.ratings)) Object.keys(f.ratings).forEach(function (wid) {
            if (isObj(f.ratings[wid])) out.ratings[wid] = Object.assign({}, f.ratings[wid]);
        });
        return out;
    }

    function normalizeState(data) {
        var profile = Object.assign({}, PROFILE_DEFAULTS, (data && data.profile) || {});
        profile.privateCosts = Array.isArray(profile.privateCosts)
            ? profile.privateCosts.filter(isObj).map(normalizeCost)
            : defaultPrivateCosts();
        var flats = (data && Array.isArray(data.flats) ? data.flats : []).map(function (f) { return normalizeFlat(f, profile); });
        // Ältere Daten ohne Personen: mit zwei leeren Personen starten.
        var people = data && Array.isArray(data.people)
            ? data.people.filter(isObj).map(function (p) {
                return { id: p.id ? String(p.id) : uid(), name: String(p.name || ''), self: p.self === true, rent: WK.isSet(p.rent) ? Number(p.rent) : null,
                    includes: isObj(p.includes) ? Object.assign({}, p.includes) : {} };
            })
            : [newPerson(), newPerson()];
        if (!people.length) people = [newPerson()];
        flats.forEach(function (f) { linkRooms(f, people); });
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
        return syncPersons({ profile: profile, flats: flats, people: people, wishes: wishes });
    }

    /** Ich – ohne Markierung die erste Person. */
    function mePerson(people) {
        return people.find(function (p) { return p.self; }) || people[0];
    }

    /** Was calc.js über die Personen braucht, immer aus der Liste abgeleitet:
     *  Anzahl (profile.persons), Namen, Maximum (profile.personRents), was sie
     *  über mich zahlen (profile.personIncludes) und welche Zimmer meine sind
     *  (room.self). */
    function syncPersons(s) {
        var me = mePerson(s.people);
        s.profile.persons = s.people.length;
        s.profile.personRents = {};
        s.profile.personIncludes = {};
        s.profile.personNames = {};
        s.people.forEach(function (p, i) {
            s.profile.personNames[p.id] = (p.name || '').trim() || 'Person ' + (i + 1);
            p.self = p === me;
            if (p.self) return;
            if (WK.isSet(p.rent)) s.profile.personRents[p.id] = Number(p.rent);
            s.profile.personIncludes[p.id] = p.includes;
        });
        s.flats.forEach(function (f) { markOwnRooms(f, me); });
        return s;
    }

    function markOwnRooms(f, me) {
        f.wg.rooms.forEach(function (r) { r.self = r.person === me.id; });
    }

    /** Ordnet die Zimmer einer Wohnung den Personen zu. Ältere Daten kennen nur
     *  "Ich" und freie Namen: erst nach Namen, dann der Reihe nach. Wer dann
     *  noch kein Zimmer hat, bekommt beim ersten Mal eines (später kann es
     *  bewusst entfernt worden sein). Die Mieten bleiben dabei unverändert. */
    function linkRooms(f, people) {
        var me = mePerson(people), wg = f.wg, rooms = wg.rooms;
        var known = function (r) { return people.some(function (p) { return p.id === r.person; }); };
        var open = rooms.filter(function (r) {
            if (r.person === null || known(r)) return false;
            if (r.self) { r.person = me.id; return false; }
            r.person = null;
            return true;
        });
        var free = people.filter(function (p) {
            return p !== me && !rooms.some(function (r) { return r.person === p.id; });
        });
        var assign = function (r, p) { r.person = p.id; free.splice(free.indexOf(p), 1); };
        open.forEach(function (r) {
            var name = String(r.name || '').trim().toLowerCase();
            var match = name && free.find(function (p) { return p.name.trim().toLowerCase() === name; });
            if (match) assign(r, match);
        });
        open.forEach(function (r) { if (r.person === null && free.length) assign(r, free[0]); });
        if (!wg.linked) {
            if (!rooms.length) rooms.push(newRoom(me.id));
            free.forEach(function (p) { rooms.push(newRoom(p.id)); });
            wg.linked = true;
        }
        markOwnRooms(f, me);
        return f;
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
        syncPersons(state);
        scheduleSave();
        updateHints();
        if (currentUpdate) currentUpdate();
    }

    /** Liest deutsche und englische Schreibweisen: "350.000", "350000",
     *  "3,5", "3.5", "1.234,56 €". */
    function parseNum(s) {
        s = String(s).replace(/−/g, '-').replace(/m²|[\s€%]/g, '');
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

    /** hint: Text oder Funktion, die den Text liefert (z. B. mit dem Ergebnis
     *  einer Faustregel) – die wird bei jeder Änderung neu ausgewertet. */
    function fieldWrap(label, control, hint, cls) {
        var live = typeof hint === 'function';
        var small = hint ? el('small', { class: 'field-hint', text: live ? hint() : hint }) : null;
        if (live) small._hint = hint;
        return el('label', { class: 'field' + (cls ? ' ' + cls : '') }, [
            el('span', { class: 'field-label', text: label }),
            control,
            small
        ]);
    }

    function updateHints() {
        app.querySelectorAll('.field-hint').forEach(function (e) { if (e._hint) e.textContent = e._hint(); });
    }

    /** Ergebnis einer Faustregel in Klammern – nur, wenn die Angabe, aus der
     *  es sich ergibt (base), schon eingetragen ist. */
    function result(base, text) {
        return n(base) > 0 ? ' (' + text + ')' : '';
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

    function selectBox(options, value, label, onchange) {
        var sel = el('select', { 'aria-label': label }, options.map(function (o) {
            return el('option', { value: String(o[0]), text: o[1] });
        }));
        sel.value = String(value);
        sel.addEventListener('change', function () { onchange(sel.value); });
        return sel;
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

    /** Aufklappbare Erklärung: Einleitung und [Begriff, Text]-Paare. */
    function explain(title, intro, items) {
        return el('details', { class: 'explain' }, [
            el('summary', { text: title }),
            el('p', { text: intro }),
            el('dl', null, items.reduce(function (out, x) {
                return out.concat([el('dt', { text: x[0] }), el('dd', { text: x[1] })]);
            }, []))
        ]);
    }

    /** Erklärung der Felder rund um die faire Miete. */
    function explainFair(rent) {
        return explain('Was bedeuten die Felder, und wie entsteht die faire Miete?',
            'Die Seite teilt die Miete so auf, dass jede Person für das zahlt, was sie bekommt: Ein großes oder schönes Zimmer kostet mehr, Küche, Bad und Flur zählen für alle gleich. ' +
            'Dazu kommt der Anteil an den laufenden Kosten. Das ist ein Vorschlag – ihr könnt jederzeit einen anderen Betrag eintragen.',
            [
                ['Größe', 'Fläche des Zimmers in m², steht im Grundriss oder Exposé – sonst Länge × Breite messen. Alle Zimmer eintragen, auch dein eigenes: Was von der Wohnfläche übrig bleibt, zählt als Gemeinschaftsfläche. Teilen sich zwei ein Zimmer, bei beiden die halbe Größe eintragen.']
            ].concat(rent ? [
                ['Kaltmiete', 'Die Miete ohne Nebenkosten, steht im Mietvertrag oder Inserat. Sie wird komplett auf alle Zimmer verteilt, du verdienst also nichts daran.']
            ] : [
                ['Vergleichsmiete kalt', 'Was eine ähnliche Wohnung in der Gegend pro m² und Monat kostet, ohne Nebenkosten. Du findest sie im Mietspiegel: im Netz nach „Mietspiegel“ und deiner Stadt suchen, dort Lage, Baujahr, Größe und Ausstattung auswählen. Gibt es keinen, helfen Inserate ähnlicher Wohnungen – die sind meist etwas teurer als der Mietspiegel.'],
                ['Davon auf Mitbewohner umlegbar', 'Das Hausgeld zahlst du als Eigentümer:in an die Gemeinschaft. Ein Teil ist Verbrauch, den alle nutzen (Heizung, Wasser, Müll, Hausmeister) und der fair geteilt werden kann. Rücklage, Verwaltung und Reparaturen bleiben bei dir. In der Hausgeldabrechnung oder im Wirtschaftsplan steht dieser Teil als „umlagefähig“. Das Feld steht unter „Laufende Kosten“; leer rechnet die Seite mit 65 %.']
            ]).concat([
                ['Lage & Ausstattung', 'Macht ein Zimmer teurer oder günstiger als die anderen. Beispiel: 15 m² mit Balkon (+5 %) zählen wie 15,75 m². Die Prozentwerte sind grobe Orientierung. Mit „Weiterer Zu-/Abschlag“ kannst du selbst nachregeln, z. B. −5 für eine Dachschräge oder +5 für einen Keller.'],
                ['Miete an mich', 'Leer lassen, dann gilt die faire Miete (grau im Feld). Wer etwas anderes vereinbart, trägt hier den Betrag ein; darunter steht, wie weit er von der fairen Miete entfernt ist.'],
                ['Maximum', 'Was die Person laut „Personen“ auf der Übersicht höchstens für alles zahlen kann. Ist die faire Miete höher, rechnet die Seite mit dem Maximum, und der Rest bleibt bei dir. Fehlen Angaben für die faire Miete, wird vorläufig mit dem Maximum gerechnet.'],
                ['Leerstand / Mietausfall', 'Puffer für Monate, in denen ein Zimmer leer steht oder die Miete ausbleibt. Bei einer festen Person (z. B. Partner:in) kannst du 0 % eintragen.']
            ]));
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
                var f = linkRooms(normalizeFlat(data.flat, state.profile), state.people);
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

    var RENT_TYPE = { fixed: 'feste Miete', staffel: 'Staffelmiete', index: 'Indexmiete' };

    function isRent(a) { return a.kind === 'rent'; }
    /** Wurde die Wohnung schon so weit eingetragen, dass sich rechnen lässt? */
    function started(a) { return isRent(a) ? a.coldRent > 0 : a.price > 0; }
    // Zeilen nur für eine Art: get liefert für die andere null, Anzeige „–“.
    function buyOnly(get) { var fn = function (a) { return isRent(a) ? null : get(a); }; fn.only = 'buy'; return fn; }
    function rentOnly(get) { var fn = function (a) { return isRent(a) ? get(a) : null; }; fn.only = 'rent'; return fn; }

    function kindLabel(a) {
        return isRent(a) ? 'Miete' + (a.flat.rentType !== 'fixed' ? ' (' + RENT_TYPE[a.flat.rentType] + ')' : '') : 'Kauf';
    }

    // Zeilen, die für keine der Wohnungen einen Wert haben (z. B. Kauf-Zeilen
    // bei lauter Mietwohnungen), blendet renderFlatList aus.
    var COMPARE = [
        { label: 'Art', get: function () { return null; }, f: function (v, a) { return kindLabel(a); }, always: true },
        { label: 'Kaufpreis', get: buyOnly(function (a) { return a.price; }), f: eur },
        { label: 'Kaltmiete', get: rentOnly(function (a) { return a.coldRent; }), f: eur, best: 'min' },
        { label: 'Warmmiete', get: rentOnly(function (a) { return a.warmRent; }), f: eur, best: 'min' },
        { label: 'Wohnfläche', get: function (a) { return a.area || null; }, f: function (v) { return v === null ? '–' : fmtInput(v, 1) + ' m²'; } },
        { label: 'Preis pro m²', get: buyOnly(function (a) { return a.pricePerSqm; }), f: eur, best: 'min' },
        { label: 'Kaltmiete pro m²', get: rentOnly(function (a) { return a.coldPerSqm; }), f: perSqm, best: 'min' },
        { label: 'Kaufnebenkosten', get: buyOnly(function (a) { return a.closing; }), f: eur, best: 'min' },
        { label: 'Gesamtkosten', get: buyOnly(function (a) { return a.total; }), f: eur, best: 'min' },
        { label: 'Eigenkapital-Einsatz', get: buyOnly(function (a) { return a.equity; }), f: eur },
        { label: 'Darlehen', get: buyOnly(function (a) { return a.loanTotal; }), f: eur, best: 'min' },
        { label: 'Beleihung', get: buyOnly(function (a) { return a.ltv; }), f: pct, best: 'min' },
        { label: 'Kaution & Einzug', get: rentOnly(function (a) { return a.moveIn; }), f: eur, best: 'min' },
        { label: 'Kreditrate / Monat', get: buyOnly(function (a) { return a.payment; }), f: eur, best: 'min', sep: true },
        { label: 'Nebenkosten / Monat', get: function (a) { return a.runningCosts; }, f: eur, best: 'min', sep: true },
        { label: 'davon private Nebenkosten (mein Anteil)', get: function (a) { return a.private; }, f: eur, best: 'min' },
        { label: 'Hausgeld pro m²', get: buyOnly(function (a) { return a.hoaPerSqm; }), f: perSqm, best: 'min' },
        { label: 'WG-Einnahmen', get: function (a) { return a.rentEff; }, f: eur, best: 'max' },
        { label: 'Netto-Wohnkosten', get: function (a) { return a.netHousing; }, f: eur, best: 'min', strong: true },
        { label: 'ggü. heute', get: function (a) { return a.vsRent; }, f: signed, best: 'min' },
        { label: 'Echte Kosten', get: function (a) { return a.trueCost; }, f: eur, best: 'min', strong: true },
        { label: 'Kaltmiete in 5 Jahren', get: rentOnly(function (a) { return a.coldIn5; }), f: eur, best: 'min' },
        { label: 'Netto-Wohnkosten Ø 10 Jahre', get: rentOnly(function (a) { return a.avgNet10; }), f: eur, best: 'min' },
        { label: 'Vermögensaufbau (Tilgung)', get: function (a) { return a.wealthBuild; }, f: eur, best: 'max' },
        { label: 'Frei verfügbar', get: function (a) { return a.netIncome > 0 ? a.available : null; }, f: eur, best: 'max', strong: true },
        { label: 'Kreditrate / Netto-Einkommen', get: buyOnly(function (a) { return a.burden; }), f: pct, best: 'min' },
        { label: 'Warmmiete / Netto-Einkommen', get: rentOnly(function (a) { return a.rentRatio; }), f: pct, best: 'min' },
        { label: 'Restschuld nach Zinsbindung', get: buyOnly(function (a) { return a.balanceAtFixed; }), f: eur, best: 'min', sep: true },
        { label: 'Schuldenfrei nach', get: buyOnly(function (a) { return a.payoffYears; }), f: WK.years, best: 'min' },
        { label: 'Zinsen gesamt', get: buyOnly(function (a) { return a.totalInterest; }), f: eur, best: 'min' },
        { label: 'Cash nach Kauf / Einzug', get: function (a) { return a.cashAfter; }, f: eur, best: 'max', sep: true },
        { label: 'Auffälligkeiten am Objekt', get: function (a) { return started(a) ? a.review.filter(function (r) { return r.level === 'warn' || r.level === 'bad'; }).length : null; }, f: function (v) { return v === null ? '–' : String(v); }, best: 'min' }
    ];

    /** Wie eur(), aber mit Cent – für kleine Beträge. */
    function euro2(v) {
        return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €';
    }

    function perSqm(v) {
        if (v === null || v === undefined || !isFinite(v)) return '–';
        return fmtInput(v, 2) + ' €/m²';
    }

    function signedPct(v) {
        return (v > 0 ? '+' : '−') + fmtInput(Math.abs(v), 1) + ' %';
    }

    function signed(v) {
        if (v === null || v === undefined || !isFinite(v)) return '–';
        if (Math.round(v) === 0) return '± 0 €';
        return (v > 0 ? '+ ' : '− ') + eur(Math.abs(v));
    }

    function renderMain() {
        var p = state.profile;
        document.title = 'Wohnung';
        app.innerHTML = '';

        var budgetBox = el('div', { class: 'tiles' });
        var listBox = el('div');
        var costsBox = el('div', { class: 'costs' });

        app.appendChild(el('header', { class: 'page-head' }, [
            el('h1', { text: 'Wohnung' }),
            el('p', { text: 'Rechnet durch, ob und welche Wohnung sich ausgeht – kaufen oder mieten, mit WG-Untermiete, Kredit und allem drumherum.' })
        ]));

        var peopleBox = el('div', { class: 'people' });
        var peopleSum = el('p', { class: 'small people-sum' });
        var wishBox = el('div');
        app.appendChild(panel('Personen', [peopleBox, peopleSum, explain('Was bedeuten die Felder?',
            'Hier steht, wer mit einzieht und wie viel jede Person beitragen kann. Das gilt für alle Wohnungen.', [
                ['Ich', 'Die Person, die kauft bzw. den Mietvertrag unterschreibt und deren Finanzen unten stehen. Alle anderen zahlen an sie.'],
                ['Max. im Monat', 'Die Obergrenze, die sich die Person leisten kann – für alles zusammen: Miete, Nebenkosten, Strom, Internet usw. Leer = keine Grenze. Zahlt jemand nichts, 0 eintragen.'],
                ['Zahlt über mich', 'Mit Haken: Du bezahlst die Rechnung, und die Person gibt dir ihren Anteil mit der Miete. Der Anteil ist deshalb kein Geld für Kredit oder Kaltmiete. Ohne Haken: Die Person zahlt ihren Anteil selbst, z. B. direkt an den Anbieter. Bei Nebenkosten & Heizung heißt ohne Haken: Sie zahlt dir den Anteil zusätzlich zur Miete.'],
                ['Was davon im Budget zählt', '„Was ist drin?“ rechnet mit dem, was vom Maximum nach den privaten Nebenkosten übrig ist. Für die Kreditrate zählen davon nur 70 %, weil Banken Mieteinnahmen meist nicht voll anrechnen. Was eine Person wirklich zahlt, steht in jeder Wohnung.']
            ])], {
            hint: 'Wer zusammen wohnen will. Alle hier teilen sich die privaten Nebenkosten und geben ihre Wünsche an. ' +
                '„Max. im Monat“: was die Person höchstens für alles zusammen zahlen kann. ' +
                'Was sie tatsächlich zahlt, ist die faire Miete der jeweiligen Wohnung (dort unter „WG & Untermieter“), höchstens dieses Maximum. Trägst du dort selbst mehr ein, gibt es eine Warnung.'
        }));
        renderPeople(peopleBox, function () { renderWishEditor(wishBox); });

        var costPeople = el('p', { class: 'small group-hint' });
        app.appendChild(panel('Meine Finanzen', [
            group('Vermögen', [
                numField(p, 'cash', 'Cash (liquide Ersparnisse)', { unit: '€', dec: 0 }),
                numField(p, 'equity', 'Davon als Eigenkapital einsetzen', { unit: '€', dec: 0, hint: 'Standard für jede Wohnung, dort überschreibbar.' }),
                numField(p, 'reserve', 'Notreserve, die bleiben soll', { unit: '€', dec: 0, hint: function () {
                    return 'Faustregel: 3–6 Netto-Monatsgehälter' + result(p.netIncome, eurRange(3 * n(p.netIncome), 6 * n(p.netIncome))) + '.';
                } })
            ]),
            group('Einkommen & Ausgaben (monatlich)', [
                numField(p, 'netIncome', 'Nettoeinkommen', { unit: '€' }),
                numField(p, 'livingCosts', 'Lebenshaltung ohne Wohnen', { unit: '€', hint: 'Essen, Mobilität, Versicherungen, Freizeit, Sparpläne …' }),
                numField(p, 'otherDebt', 'Andere Kreditraten', { unit: '€', hint: 'Auto, Studienkredit, Ratenkäufe.' }),
                numField(p, 'currentRent', 'Aktuelle Warmmiete', { unit: '€', hint: 'Vergleichswert: Was kostet Wohnen heute? Die privaten Nebenkosten unten kommen dazu.' })
            ]),
            el('div', { class: 'group' }, [
                el('h3', { class: 'group-title', text: 'Private Nebenkosten' }),
                el('p', { class: 'muted small group-hint', text: 'Was zusätzlich zu Miete bzw. Hausgeld anfällt – z. B. Strom, Internet, Rundfunkbeitrag (derzeit 55,08 € pro Quartal), Hausratversicherung. ' +
                    'Betrag so eintragen, wie er auf der Rechnung steht; umgerechnet auf den Monat zählt nur dein Anteil. Geht einzeln oder als eine Summe („Versorgungskosten“) mit eigenem Prozentsatz. ' +
                    'Gilt für jede Wohnung; dort lässt sich ein Posten abwählen, wenn er schon in der Warmmiete oder im Hausgeld steckt. Nicht zusätzlich in der Lebenshaltung zählen.' }),
                el('p', { class: 'muted small group-hint', text: 'Wer seinen Teil über dich zahlt und wer selbst, steht oben unter „Personen“. Was du ganz übernimmst, auf „zahle ich komplett“ stellen.' }),
                costPeople,
                costsBox
            ]),
            group('Kreditwürdigkeit (laut Bank)', [
                numField(p, 'bankMaxLoan', 'Max. Darlehen', { unit: '€', dec: 0, hint: 'Was die Bank dir maximal leihen würde.' }),
                numField(p, 'bankMaxRate', 'Max. Monatsrate', { unit: '€', hint: function () {
                    return 'Leer = Faustregel 35 % vom Netto' + rentsText(WK.budget(p)) + ' minus andere Kredite' + result(p.netIncome, eur(WK.budget(p).ruleRate)) + '.';
                } })
            ]),
            group('Annahmen', [
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

        var wishStatus = el('div', { class: 'wish-status' });
        app.appendChild(panel('Wünsche & Bedingungen', [wishBox, wishStatus], {
            hint: 'Jede Person ergänzt eigene Wünsche, frei formuliert – z. B. „Balkon“, „max. 30 Minuten zur Arbeit“, „kein Erdgeschoss“. ' +
                'Danach gibt jede Person bei jedem Wunsch an, wie wichtig er ihr ist (0 % = egal). ' +
                '100 % heißt Muss: Erfüllt eine Wohnung das nicht voll, kommt sie nicht in Frage. ' +
                'In jeder Wohnung bewerten dann alle, wie gut sie die Wünsche erfüllt.'
        }));
        renderWishEditor(wishBox);

        function addFlat(kind) {
            var f = linkRooms(newFlat(state.profile, kind), state.people);
            f.name = (kind === 'rent' ? 'Mietwohnung ' : 'Wohnung ') + (state.flats.length + 1);
            state.flats.push(f);
            saveNow();
            location.hash = 'w=' + f.id;
        }
        app.appendChild(panel('Wohnungen', [listBox], {
            actions: [el('div', { class: 'actions' }, [
                btn('+ Kaufwohnung', 'btn-primary', function () { addFlat('buy'); }),
                btn('+ Mietwohnung', 'btn-primary', function () { addFlat('rent'); })
            ])]
        }));
        renderCostsEditor(costsBox);

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
        ], { hint: 'Link und Export enthalten „Meine Finanzen“, Personen & Wünsche und alle Wohnungen (Kauf und Miete). Link öffnen oder Gesamt-Datei importieren ersetzt alles auf dem Zielgerät; eine einzeln exportierte Wohnung wird nur hinzugefügt.' }));

        currentUpdate = function () {
            updateIncludes(peopleBox);
            var b = WK.budget(p), off = b.rentsGross - b.rents;
            peopleSum.textContent = b.rentsGross > 0 ? 'Zusammen höchstens ' + eur(b.rentsGross) + ' im Monat' +
                (off > 0.5 ? ', nach privaten Nebenkosten ' + eur(b.rents) : '') : '';
            costPeople.textContent = costPeopleText();
            updateCostsEditor(costsBox);
            renderBudget(budgetBox);
            renderWishStatus(wishStatus);
            renderFlatList(listBox);
            linkBox.innerHTML = '';   // ein schon erzeugter Link wäre nach Änderungen veraltet
        };
        currentUpdate();
    }

    /** Private Nebenkosten bearbeiten (Übersicht). Neu gezeichnet wird nur bei
     *  Hinzufügen/Entfernen, nicht bei jeder Eingabe (sonst Fokusverlust). */
    function renderCostsEditor(box, focusLast) {
        var list = state.profile.privateCosts;
        box.innerHTML = '';
        if (list.length) {
            box.appendChild(el('div', { class: 'cost-row room-head' }, [
                el('span', { text: 'Posten' }), el('span', { text: 'Betrag' }), el('span', { text: 'Zeitraum' }),
                el('span', { text: 'Aufteilung' }), el('span', { class: 'cost-mine', text: 'Anteil / Monat' }), el('span')
            ]));
        }
        list.forEach(function (c, idx) {
            var name = el('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Name des Postens', placeholder: 'z. B. Strom' });
            name.value = c.name || '';
            name.addEventListener('input', function () { c.name = name.value; changed(); });
            var amount = numField(c, 'amount', '', { unit: '€' });
            amount._input.setAttribute('aria-label', 'Betrag');
            var every = selectBox(WK.COST_EVERY, c.every, 'Zeitraum', function (v) { c.every = Number(v); changed(); });
            var share = numField(c, 'sharePct', '', { unit: '%', dec: 1 });
            share._input.setAttribute('aria-label', 'Mein Anteil in Prozent');
            share._input.setAttribute('data-cost-share', '');
            var shareWrap = share.querySelector('.input-wrap');
            shareWrap.hidden = c.split !== 'percent';
            var split = selectBox(WK.COST_SPLIT, c.split, 'Aufteilung', function (v) {
                c.split = v;
                shareWrap.hidden = v !== 'percent';
                changed();
                if (v === 'percent') share._input.focus();
            });
            var del = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Posten entfernen', text: '×', onclick: function () {
                list.splice(idx, 1);
                state.flats.forEach(function (f) { delete f.coveredCosts[c.id]; });
                state.people.forEach(function (q) { delete q.includes[c.id]; });
                renderCostsEditor(box);
                changed();
            } });
            box.appendChild(el('div', { class: 'cost-row' }, [
                name, amount.querySelector('.input-wrap'), every,
                el('div', { class: 'cost-split' }, [split, shareWrap]),
                el('span', { class: 'cost-mine', 'data-cost-mine': c.id }), del
            ]));
            if (focusLast && idx === list.length - 1) setTimeout(function () { name.focus(); }, 0);
        });
        box.appendChild(el('div', { class: 'cost-foot' }, [
            btn('+ Posten', 'btn-ghost btn-add', function () {
                list.push(newPrivateCost(''));
                renderCostsEditor(box, true);
                changed();
            }),
            el('span', { class: 'small cost-total', 'data-cost-total': '' })
        ]));
        updateCostsEditor(box);
    }

    /** Wer sich die Kosten teilt, z. B. "Geteilt durch 2 Personen: Anna und Ben". */
    function costPeopleText() {
        var count = state.people.length;
        var where = ' (änderbar oben unter „Personen“).';
        if (count === 1) return 'Eine Person: ' + peopleNames() + where;
        return 'Geteilt durch ' + count + ' Personen: ' + peopleNames() + where;
    }

    /** Summe der privaten Nebenkosten: ganze Wohnung und mein Anteil. */
    function costSumText(info) {
        if (!(info.gross > 0)) return '';
        return 'Zusammen ' + euro2(info.gross) + ' im Monat · mein Anteil ' + euro2(info.total) + ' (' + pct(info.total / info.gross) + ')';
    }

    function updateCostsEditor(box) {
        var info = WK.privateCosts(state.profile, null);
        var cells = box.querySelectorAll('[data-cost-mine]');
        info.items.forEach(function (c, i) {
            if (!cells[i]) return;
            cells[i].textContent = c.gross > 0 ? euro2(c.mine) : '–';
            cells[i].title = c.gross > 0 ? 'Ganze Wohnung: ' + euro2(c.gross) + ' pro Monat, ' + euro2(c.gross * 12) + ' pro Jahr' : '';
        });
        box.querySelectorAll('[data-cost-share]').forEach(function (i) { i.placeholder = fmtInput(100 / info.persons, 1); });
        var total = box.querySelector('[data-cost-total]');
        if (total) total.textContent = costSumText(info);
    }

    function tile(label, value, sub, cls) {
        return '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="tile-label">' + esc(label) + '</div>' +
            '<div class="tile-value">' + esc(value) + '</div>' + (sub ? '<div class="tile-sub">' + esc(sub) + '</div>' : '') + '</div>';
    }

    /** Wie viel Eigenkapital drin ist, ohne die Notreserve anzutasten – mit
     *  Rechenweg und Vergleich zum geplanten Eigenkapital. */
    function equityTile(p) {
        if (!WK.isSet(p.cash)) return tile('Max. Eigenkapital', '–', 'Cash fehlt');
        var free = n(p.cash) - n(p.reserve);
        var max = Math.max(0, free);
        var sub = ['Cash ' + eur(n(p.cash)) + ' − Notreserve ' + eur(n(p.reserve))];
        if (free < 0) sub.push('für die Notreserve fehlen ' + eur(-free));
        var diff = Math.round(max - n(p.equity));
        if (n(p.equity) > 0) sub.push(diff === 0 ? 'genau wie geplant' : eur(Math.abs(diff)) + (diff > 0 ? ' mehr' : ' weniger') + ' als geplant');
        return tile('Max. Eigenkapital', eur(max), sub.join(' · '), free < 0 || diff < 0 ? 'tile-warn' : '');
    }

    /** Zusatz zur Faustregel für die Monatsrate. */
    function rentsText(b) {
        return b.rents > 0 ? ' + 70 % von max. ' + eur(b.rents) + ' der anderen' : '';
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
            tile('Max. Monatsrate', eur(b.maxRate), n(p.bankMaxRate) > 0 ? 'laut Bank' : 'Faustregel 35 % vom Netto' + rentsText(b) + (n(p.otherDebt) > 0 ? ' minus andere Kredite' : '')) +
            tile('Kaufpreis-Budget', eur(b.maxPrice), 'Eigenkapital + Darlehen, abzgl. ~' + fmtInput(b.closingPct, 1) + ' % Nebenkosten') +
            (n(p.netIncome) > 0 ? tile('Max. Warmmiete', eur(b.maxWarmRent), 'Faustregel 30 % vom Netto' + (b.rents > 0 ? ' + max. ' + eur(b.rents) + ' der anderen' : '')) : '') +
            equityTile(p);
    }

    /* ---------- Wünsche & Bedingungen ---------- */

    function personName(p) {
        var name = (p.name || '').trim();
        return name || 'Person ' + (state.people.indexOf(p) + 1);
    }

    /** Alle Namen, z. B. "Anna, Ben und Person 3". */
    function peopleNames() {
        var names = state.people.map(personName);
        return names.length > 1 ? names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1] : names.join('');
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
            // Zimmer mit Angaben bleiben stehen, dort wohnt dann jemand anderes.
            f.wg.rooms = f.wg.rooms.filter(function (r) {
                if (r.person !== p.id) return true;
                r.person = null;
                return WK.isSet(r.rent) || WK.isSet(r.size);
            });
        });
        state.people.splice(state.people.indexOf(p), 1);
    }

    /** Neue Person samt Zimmer in jeder Wohnung; ein leeres, noch niemandem
     *  zugeordnetes Zimmer wird dabei übernommen. */
    function addPerson() {
        var p = newPerson();
        state.people.push(p);
        state.flats.forEach(function (f) {
            var empty = f.wg.rooms.find(function (r) { return !r.person && !WK.isSet(r.rent) && !WK.isSet(r.size); });
            if (empty) empty.person = p.id;
            else f.wg.rooms.push(newRoom(p.id));
        });
    }

    /** Personen bearbeiten (Übersicht). onList: wenn jemand dazukommt oder geht. */
    function renderPeople(box, onList, focusLast) {
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'person room-head' }, [
            el('span', { text: 'Name' }), el('span', { class: 'person-me', text: 'Ich' }), el('span', { text: 'Max. im Monat' }), el('span')
        ]));
        state.people.forEach(function (p, idx) {
            var input = el('input', { type: 'text', autocomplete: 'off', placeholder: 'Person ' + (idx + 1), 'aria-label': 'Name von Person ' + (idx + 1) });
            input.value = p.name || '';
            input.addEventListener('input', function () {
                p.name = input.value;
                app.querySelectorAll('[data-person="' + p.id + '"]').forEach(function (e) { e.textContent = personName(p); });
                changed();
            });
            var me = el('input', { type: 'radio', name: 'me', 'aria-label': 'Das bin ich' });
            me.checked = p.self;
            me.addEventListener('change', function () {
                state.people.forEach(function (q) { q.self = q === p; });
                renderPeople(box, onList);
                changed();
            });
            var rent = numField(p, 'rent', '', { unit: '€' });
            rent._input.setAttribute('aria-label', 'Kann höchstens zahlen pro Monat');
            if (p.self) { rent._input.disabled = true; rent._input.placeholder = 'ich'; rent._input.value = ''; }
            // Ich bleibe immer in der Liste.
            var del = p.self ? null : el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Person entfernen', title: 'Person entfernen', text: '×', onclick: function () {
                var own = state.wishes.filter(function (w) { return w.by === p.id; }).length;
                if (!confirm(personName(p) + ' entfernen?\n\nDabei gehen ' + (own ? 'ihre ' + own + ' Wünsche sowie ' : '') + 'alle Gewichtungen, Bewertungen und das Maximum dieser Person verloren. Ein Zimmer mit Angaben bleibt in der Wohnung als „jemand anderes“ stehen. Die privaten Nebenkosten werden neu aufgeteilt.')) return;
                removePerson(p);
                renderPeople(box, onList);
                onList();
                changed();
            } });
            box.appendChild(el('div', { class: 'person' }, [input, el('span', { class: 'person-me' }, [me]), rent.querySelector('.input-wrap'), del]));
            box.appendChild(el('div', { class: 'person-incl', 'data-incl': p.id, hidden: true }));
            if (focusLast && idx === state.people.length - 1) setTimeout(function () { input.focus(); }, 0);
        });
        box.appendChild(btn('+ Person', 'btn-ghost', function () {
            addPerson();
            renderPeople(box, onList, true);
            onList();
            changed();
        }));
    }

    /** Häkchen je zahlender Person: was sie über mich zahlt. Neu gebaut
     *  wird nur, wenn sich die Posten ändern (sonst verliert das Häkchen den Fokus). */
    function updateIncludes(box) {
        var info = WK.privateCosts(state.profile, null);
        box.querySelectorAll('[data-incl]').forEach(function (line) {
            var p = state.people.find(function (q) { return q.id === line.getAttribute('data-incl'); });
            line.hidden = !p || p.self;
            if (line.hidden) return;

            var sig = info.items.map(function (c) { return c.id; }).join();
            if (line._sig !== sig) {
                line._sig = sig;
                line.innerHTML = '';
                line.appendChild(el('span', { class: 'muted', text: 'Zahlt über mich:' }));
                [{ id: 'running' }].concat(info.items).forEach(function (c) {
                    var cb = el('input', { type: 'checkbox', 'data-key': c.id });
                    cb.checked = p.includes[c.id] !== false;
                    cb.addEventListener('change', function () {
                        if (cb.checked) delete p.includes[c.id]; else p.includes[c.id] = false;
                        changed();
                    });
                    line.appendChild(el('label', null, [cb, el('span')]));
                });
                line.appendChild(el('span', { class: 'muted incl-left' }));
            }

            line.querySelectorAll('label').forEach(function (label, i) {
                var cb = label.firstChild, text = label.lastChild;
                if (!i) { text.textContent = 'Nebenkosten & Heizung (beim Kauf: Hausgeld & Grundsteuer)'; return; }
                var c = info.items[i - 1];
                var all = state.profile.privateCosts[i - 1].split === 'all';
                cb.disabled = all;
                text.textContent = c.name + (all ? ' (zahlst du komplett)' : c.other > 0 ? ' (' + euro2(c.other) + ')' : '');
            });
            var off = WK.sumOther(info.items);
            line.lastChild.textContent = (n(p.rent) > 0
                ? 'Nach privaten Nebenkosten bleiben höchstens ' + eur(Math.max(0, n(p.rent) - off)) + ', davon geht in jeder Wohnung noch der Anteil an Hausgeld bzw. Nebenkosten ab. '
                : '') + 'Ohne Haken zahlt die Person ihren Anteil selbst – auch das zählt zum Maximum.';
        });
    }

    /** Wünsche bearbeiten (Übersicht). Wird nur bei Struktur-
     *  änderungen neu gezeichnet, nicht bei jeder Eingabe (sonst Fokusverlust). */
    function renderWishEditor(box, focusId) {
        box.innerHTML = '';
        var people = state.people;

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
                renderWishEditor(box, w.id);
                changed();
            } }, ['+ Wunsch von ', nameTag(author)]));
            box.appendChild(g);
        });

        if (focusId) {
            var target = box.querySelector('[data-wish="' + focusId + '"]');
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
            box.innerHTML = '<p class="muted">Noch keine Wohnung angelegt. Mit „+ Kaufwohnung“ (Kaufpreis, Hausgeld, Finanzierung) oder „+ Mietwohnung“ (Kalt- und Warmmiete, Staffel- oder Indexmiete) geht’s los – beide lassen sich hier vergleichen.</p>';
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
                '<div class="card-head"><span class="card-name"><span class="kind-tag kind-' + a.kind + '">' + (isRent(a) ? 'Miete' : 'Kauf') + '</span> ' + esc(f.name || 'Ohne Namen') + '</span>' +
                '<span class="badge badge-' + w + '" title="' + TIER_LABEL[w] + '">' + ICON[w] + ' ' + TIER_LABEL[w] + '</span></div>' +
                (f.address ? '<div class="card-sub">' + esc(f.address) + '</div>' : '') +
                '<dl class="card-facts">' +
                (isRent(a)
                    ? '<dt>Warmmiete</dt><dd>' + eur(a.warmRent) + (a.area ? ' · ' + fmtInput(a.area, 1) + ' m²' : '') + '</dd>' +
                        (f.rentType !== 'fixed' ? '<dt>' + RENT_TYPE[f.rentType] + '</dt><dd>in 5 J. ' + eur(a.coldIn5) + ' kalt</dd>' : '')
                    : '<dt>Kaufpreis</dt><dd>' + eur(a.price) + (a.area ? ' · ' + fmtInput(a.area, 1) + ' m²' : '') + '</dd>' +
                        (a.hoaPerSqm ? '<dt>Hausgeld</dt><dd>' + perSqm(a.hoaPerSqm) + '</dd>' : '')) +
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
                    if (!row.always && !vals.some(function (v) { return v !== null && v !== undefined; })) return '';
                    var best = null;
                    if (row.best && valid.length >= 2) {
                        best = row.best === 'min' ? Math.min.apply(null, valid) : Math.max.apply(null, valid);
                        if (Math.min.apply(null, valid) === Math.max.apply(null, valid)) best = null;
                    }
                    return '<tr class="' + (row.sep ? 'sep ' : '') + (row.strong ? 'strong' : '') + '"><th>' + esc(row.label) + '</th>' +
                        vals.map(function (v, i) {
                            var isBest = best !== null && v === best;
                            var text = row.get.only && row.get.only !== results[i].kind ? '–' : row.f(v, results[i]);
                            return '<td' + (isBest ? ' class="best" title="bester Wert"' : '') + '>' + esc(text) + '</td>';
                        }).join('') + '</tr>';
                }).join('') +
                '<tr class="sep"><th>Status</th>' + results.map(function (a) {
                    var w = worst(a);
                    return '<td><span class="badge badge-' + w + '">' + ICON[w] + ' ' + TIER_LABEL[w] + '</span></td>';
                }).join('') + '</tr>' +
                '</tbody></table></div>' +
                (results.length >= 2 ? '<p class="muted small">Markiert = bester Wert der Zeile. „Echte Kosten“ = beim Kauf Zinsen + Nebenkosten + entgangene Rendite aufs Eigenkapital − WG-Einnahmen (Tilgung zählt als Sparen), bei Miete Netto-Wohnkosten + entgangene Rendite auf die Kaution. „ggü. heute“ vergleicht mit deiner aktuellen Warmmiete plus privaten Nebenkosten.' +
                    (hasWishes ? ' „Passt zu …“ = wie gut die Wohnung die Wünsche erfüllt, gewichtet nach Wichtigkeit; gemeinsam = Durchschnitt aller Personen.' : '') + '</p>' : '');
        }
        box.innerHTML = cards + table;
    }

    /* ---------- Detailansicht einer Wohnung ---------- */

    function renderDetail(f) {
        var p = state.profile;
        app.innerHTML = '';
        window.scrollTo(0, 0);
        var rent = f.kind === 'rent';
        document.title = (f.name || 'Wohnung') + ' – Wohnung';

        var nameInput = el('input', { type: 'text', class: 'name-input', 'aria-label': 'Name der Wohnung', autocomplete: 'off' });
        nameInput.value = f.name || '';
        nameInput.addEventListener('input', function () {
            f.name = nameInput.value;
            document.title = (f.name || 'Wohnung') + ' – Wohnung';
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
                    copy.steps.forEach(function (s) { s.id = uid(); });
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

        var wishPanel = wishRatingPanel(f);

        var kindSel = el('select', null, [
            el('option', { value: 'buy', text: 'Kauf' }),
            el('option', { value: 'rent', text: 'Miete' })
        ]);
        kindSel.value = f.kind;
        kindSel.addEventListener('change', function () {
            f.kind = kindSel.value;
            saveNow();
            renderDetail(f);
        });

        var costsPanel = privateCostsPanel(f);
        var runningPanel = rent
            ? panel('Laufende Kosten (monatlich)', [
                costsPanel,
                group(null, [
                    numField(f, 'utilities', 'Weitere laufende Kosten', { unit: '€', hint: 'Nur für diese Wohnung, z. B. Stellplatz oder Garten.' })
                ])
            ])
            : panel('Laufende Kosten (monatlich)', [
                group(null, [
                    numField(f, 'hoa', 'Hausgeld', { unit: '€', hint: 'Gesamt laut Wirtschaftsplan, inkl. Heizung & Erhaltungsrücklage.' }),
                    numField(f, 'hoaApport', 'Davon auf Mitbewohner umlegbar', { unit: '€', hint: function () {
                        return 'Betriebskosten und Heizung, ohne Rücklage und Verwaltung. Leer = 65 %' + result(f.hoa, eur(0.65 * n(f.hoa))) + '.';
                    } }),
                    numField(f, 'propertyTax', 'Grundsteuer pro Jahr', { unit: '€' }),
                    numField(f, 'maintenance', 'Eigene Rücklage für die Wohnung', { unit: '€', hint: function () {
                        return 'Reparaturen im Sondereigentum (Bad, Böden, Geräte). Faustregel ~0,5–1 €/m²' + result(f.area, eurRange(0.5 * n(f.area), n(f.area))) + '.';
                    } }),
                    numField(f, 'utilities', 'Weitere laufende Kosten', { unit: '€', hint: 'Nur für diese Wohnung, z. B. Stellplatz-Miete. Strom, Internet & Co. stehen unter „Meine Finanzen“.' })
                ]),
                costsPanel
            ]);

        var wgAssumptions = [
            numField(f.wg, 'vacancyPct', 'Leerstand / Mietausfall', { unit: '%', hint: function () {
                var gross = WK.rentPlan(f, p).gross;
                return 'Wechsel, Suche, Ausfälle – 5 % ≈ 2–3 Wochen pro Jahr' + result(gross, eur(0.05 * gross) + ' im Monat') + '.';
            } })
        ];
        var openFeatures = {};   // aufgeklappte Zimmer überstehen das Neuzeichnen
        var fairMissing = el('p', { class: 'small fair-missing' });
        if (!rent) wgAssumptions.unshift(numField(f, 'refRent', 'Vergleichsmiete kalt', { unit: '€/m²', hint: function () {
            return 'Was ähnliche Wohnungen dort kosten, siehe Mietspiegel deiner Stadt' + result(n(f.refRent) * n(f.area), eur(n(f.refRent) * n(f.area)) + ' für die ganze Wohnung') + '.';
        } }));
        var wgPanel = panel('WG & Untermieter', [explainFair(rent), fairMissing, roomsBox, group('Annahmen', wgAssumptions)],
            { hint: 'Leere Miete = faire Miete nach Größe, Lage und Ausstattung, höchstens das Maximum aus „Personen“. ' +
                'Für weitere Untermieter „jemand anderes“ wählen und die Warmmiete eintragen.' +
                (rent ? ' Als Hauptmieter brauchst du die Erlaubnis des Vermieters zur Untervermietung.' : '') });

        var objectPanel = panel('Objekt', [
                group(null, [
                    fieldWrap('Art', kindSel, rent ? 'Mietwohnung – zum Vergleich mit Kaufwohnungen.' : 'Kaufwohnung mit Finanzierung.'),
                    textField(f, 'address', 'Adresse / Lage', { cls: 'span-2' }),
                    textField(f, 'link', 'Link zum Exposé', { placeholder: 'https://…', cls: 'span-2' }),
                    numField(f, 'area', 'Wohnfläche', { unit: 'm²', dec: 1 }),
                    numField(f, 'year', 'Baujahr', { dec: 0, noGroup: true }),
                    textField(f, 'notes', 'Notizen', { multiline: true, cls: 'span-2' })
                ])
            ]);

        var rentTypeBox = el('div');
        var rentInputs = rent ? [
            objectPanel,
            wishPanel.el,
            panel('Miete (monatlich)', [
                group(null, [
                    numField(f, 'coldRent', 'Kaltmiete', { unit: '€', hint: 'Nettokaltmiete zu Beginn.' }),
                    numField(f, 'serviceCharges', 'Nebenkosten-Vorauszahlung', { unit: '€', hint: 'Kalte Betriebskosten: Wasser, Müll, Hausmeister …' }),
                    numField(f, 'heatingCosts', 'Heizkosten-Vorauszahlung', { unit: '€', hint: 'Leer lassen, wenn schon in den Nebenkosten enthalten.' })
                ]),
                rentTypeBox
            ]),
            panel('Einzug', [
                group(null, [
                    numField(f, 'deposit', 'Kaution', { unit: '€', dec: 0, hint: function () {
                        return 'Höchstens 3 Nettokaltmieten' + result(f.coldRent, eur(3 * n(f.coldRent))) + ', zahlbar in 3 Raten.';
                    } }),
                    numField(f, 'otherOneOff', 'Umzug & Einrichtung', { unit: '€', dec: 0, hint: 'Umzug, Möbel, Küche, Renovierung beim Einzug …' })
                ])
            ]),
            runningPanel,
            wgPanel
        ] : null;

        var inputs = el('div', { class: 'detail-inputs' }, rentInputs || [
            objectPanel,
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
                    numField(f, 'notaryPct', 'Notar & Grundbuch', { unit: '%', hint: function () {
                        return 'Üblich ca. 1,5–2 %' + result(f.price, eurRange(0.015 * n(f.price), 0.02 * n(f.price))) + '.';
                    } }),
                    numField(f, 'brokerPct', 'Makler (Käuferanteil)', { unit: '%', hint: function () {
                        return 'Meist 3,57 % inkl. MwSt.' + result(f.price, eur(0.0357 * n(f.price))) + ', 0 ohne Makler.';
                    } }),
                    numField(f, 'renovation', 'Renovierung / Modernisierung', { unit: '€', dec: 0 }),
                    numField(f, 'otherOneOff', 'Sonstiges einmalig', { unit: '€', dec: 0, hint: 'Umzug, Möbel, Gutachter, Bereitstellungszinsen …' })
                ])
            ]),
            runningPanel,
            wgPanel,
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
        if (!rent) app.appendChild(panel('Schulden & Vermögen über die Zeit', [chartPanel, planBox], { cls: 'panel-wide' }));

        /** Mietart (fest / Staffel / Index) mit den jeweils passenden Feldern. */
        function renderRentType() {
            rentTypeBox.innerHTML = '';
            var sel = el('select', null, [
                el('option', { value: 'fixed', text: 'Feste Miete' }),
                el('option', { value: 'staffel', text: 'Staffelmiete' }),
                el('option', { value: 'index', text: 'Indexmiete' })
            ]);
            sel.value = f.rentType;
            sel.addEventListener('change', function () {
                f.rentType = sel.value;
                if (f.rentType === 'staffel' && !f.steps.length) f.steps.push(newStep());
                renderRentType();
                changed();
            });
            var hint = { fixed: 'Erhöhungen nur bis zur ortsüblichen Vergleichsmiete – nicht eingerechnet.',
                staffel: 'Erhöhungen stehen fest im Vertrag, jede Stufe gilt mindestens ein Jahr.',
                index: 'Kaltmiete folgt der Inflation (Verbraucherpreisindex), höchstens einmal im Jahr.' }[f.rentType];
            var fields = [fieldWrap('Mietart', sel, hint)];
            if (f.rentType === 'index') fields.push(numField(f, 'indexPct', 'Angenommene Inflation pro Jahr', { unit: '%', hint: 'Zum Vergleich: Ziel der EZB sind 2 %, 2022 waren es knapp 7 %.' }));
            rentTypeBox.appendChild(group(null, fields));
            if (f.rentType !== 'staffel') return;

            var steps = el('div', { class: 'steps' });
            steps.appendChild(el('div', { class: 'step room-head' }, [el('span', { text: 'Ab Mietjahr' }), el('span', { text: 'Kaltmiete' }), el('span')]));
            f.steps.forEach(function (s, idx) {
                var yearF = numField(s, 'year', '', { dec: 0, noGroup: true, placeholder: String(idx + 2) });
                yearF._input.setAttribute('aria-label', 'Ab Mietjahr');
                var rentF = numField(s, 'rent', '', { unit: '€' });
                rentF._input.setAttribute('aria-label', 'Kaltmiete ab diesem Jahr');
                var del = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Staffel entfernen', text: '×', onclick: function () {
                    f.steps.splice(idx, 1); renderRentType(); changed();
                } });
                steps.appendChild(el('div', { class: 'step' }, [yearF.querySelector('.input-wrap'), rentF.querySelector('.input-wrap'), del]));
            });
            steps.appendChild(btn('+ Staffel', 'btn-ghost btn-add', function () {
                var last = f.steps[f.steps.length - 1];
                var s = newStep();
                s.year = last && WK.isSet(last.year) ? Number(last.year) + 1 : f.steps.length + 2;
                f.steps.push(s);
                renderRentType();
                changed();
            }));
            rentTypeBox.appendChild(el('p', { class: 'muted small group-hint steps-hint', text: 'Mietjahr 1 = Kaltmiete oben. Jede Stufe gilt ab dem genannten Mietjahr bis zur nächsten.' }));
            rentTypeBox.appendChild(steps);
        }
        if (rent) renderRentType();

        /** Faire Miete eines Zimmers und, aufklappbar, Lage & Ausstattung. */
        function roomFeatures(r) {
            var details = el('details', { class: 'room-features' }, [el('summary')]);
            var extra = numField(r, 'extra', 'Weiterer Zu-/Abschlag', { unit: '%', dec: 1, hint: 'z. B. −5 für Dachschräge, 5 für Keller.' });
            details.append(
                el('div', { class: 'room-checks' }, WK.FEATURES.map(function (x) {
                    var cb = el('input', { type: 'checkbox' });
                    cb.checked = !!r.features[x[0]];
                    cb.addEventListener('change', function () {
                        if (cb.checked) r.features[x[0]] = true; else delete r.features[x[0]];
                        changed();
                    });
                    return el('label', null, [cb, el('span', { text: x[1] + ' (' + signedPct(x[2]) + ')' })]);
                })),
                extra
            );
            details.open = !!openFeatures[r.id];
            details.addEventListener('toggle', function () { openFeatures[r.id] = details.open; });
            return el('div', { class: 'room-fair' }, [el('p', { class: 'small muted', 'data-fair': '' }), details]);
        }

        function renderRooms() {
            roomsBox.innerHTML = '';
            var head = el('div', { class: 'room room-head' }, [
                el('span', { text: 'Wer' }), el('span', { text: 'Zimmer' }), el('span', { text: 'Größe' }), el('span', { text: 'Miete an mich' }), el('span')
            ]);
            roomsBox.appendChild(head);
            f.wg.rooms.forEach(function (r, idx) {
                var who = selectBox(state.people.map(function (q) {
                    return [q.id, q.self ? 'Ich (' + personName(q) + ')' : personName(q)];
                }).concat([['', 'jemand anderes']]), r.person || '', 'Wer wohnt hier', function (v) {
                    r.person = v || null;
                    syncPersons(state);
                    renderRooms();
                    changed();
                });
                var name = el('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Zimmername' });
                name.value = r.name || '';
                name.addEventListener('input', function () { r.name = name.value; changed(); });
                var size = numField(r, 'size', '', { unit: 'm²', dec: 1 });
                var rent = numField(r, 'rent', '', { unit: '€' });
                rent._input.setAttribute('aria-label', 'Miete an mich pro Monat');
                rent._input.setAttribute('data-room-rent', '');
                if (r.self) { rent._input.disabled = true; rent._input.value = ''; }
                var del = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zimmer entfernen', text: '×', onclick: function () {
                    f.wg.rooms.splice(idx, 1); renderRooms(); changed();
                } });
                roomsBox.appendChild(el('div', { class: 'room' }, [who, name, size.querySelector('.input-wrap'), rent.querySelector('.input-wrap'), del]));
                roomsBox.appendChild(roomFeatures(r));
            });
            roomsBox.appendChild(btn('+ Zimmer', 'btn-ghost btn-add', function () {
                // Erst wer noch kein Zimmer hat, sonst jemand anderes
                var free = state.people.find(function (q) { return !f.wg.rooms.some(function (r) { return r.person === q.id; }); });
                f.wg.rooms.push(newRoom(free ? free.id : null));
                syncPersons(state);
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

        /** Faire Mieten, fehlende Angaben und was in leeren Mietfeldern gilt. */
        function updateRooms() {
            var plan = WK.rentPlan(f, p);
            fairMissing.textContent = plan.missing.length && f.wg.rooms.length ? 'Für die faire Miete fehlt noch: ' + plan.missing.join(', ') + '.' : '';
            var inputs = roomsBox.querySelectorAll('[data-room-rent]');
            var texts = roomsBox.querySelectorAll('[data-fair]');
            var heads = roomsBox.querySelectorAll('.room-features > summary');
            plan.groups.forEach(function (g) {
                g.rooms.forEach(function (i, k) {
                    inputs[i].placeholder = g.self ? 'ich' : !k && !g.entered && g.pay > 0 ? fmtInput(Math.round(g.pay), 0) : '';
                    texts[i].textContent = k ? 'Zählt oben bei ' + (g.name || 'diesem Zimmer') + ' mit.' : fairText(g);
                    var pctExtra = WK.roomExtra(f.wg.rooms[i]);
                    heads[i].textContent = 'Lage & Ausstattung' + (pctExtra ? ' (' + signedPct(pctExtra) + ')' : '');
                });
            });
        }

        function fairText(g) {
            if (g.self) return g.cold === null || !rent ? '' : 'Dein fairer Anteil an der Kaltmiete: ' + eur(g.cold);
            var max = g.max !== null ? 'Maximum ' + eur(g.max) : '';
            if (g.due === null) return g.source === 'max' ? 'Gerechnet mit ' + eur(g.pay) + ' (' + max + '), bis alle Angaben für die faire Miete da sind.' : '';
            var parts = [eur(g.cold) + ' kalt'];
            if (g.running > 0) parts.push(eur(g.running) + (rent ? ' Nebenkosten' : ' Hausgeld & Grundsteuer'));
            if (g.priv > 0) parts.push(eur(g.priv) + ' ' + g.items.map(function (c) { return c.name; }).join(', '));
            var text = 'Faire Miete: ' + eur(g.due) + (parts.length > 1 ? ' = ' + parts.join(' + ') : ' kalt');
            if (g.own > 0.5 && g.person) text += ' · dazu ' + eur(g.own) + ' selbst gezahlt';
            if (g.entered) {
                var diff = g.rent - g.due;
                text += ' · eingetragen ' + (Math.abs(diff) < 0.5 ? 'genau fair' : eur(Math.abs(diff)) + (diff > 0 ? ' mehr' : ' weniger'));
                if (g.over > 0.5) text += ', ' + eur(g.over) + ' über dem ' + max;
            } else if (g.short > 0.5) text += ' · gerechnet mit ' + eur(g.pay) + ' wegen ' + max + ', ' + eur(g.short) + ' trägst du';
            if (!g.person && !g.entered) text += ' · zählt erst, wenn du den Betrag einträgst';
            return text;
        }

        renderRooms();
        renderLoans();

        currentUpdate = function () {
            var a = WK.analyze(f, state.profile, state.flats);
            wishPanel.update();
            costsPanel._update();
            updateRooms();
            if (rent) { renderRentResults(results, a); return; }
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

    /** Beschriftung in der Monatsbilanz; nennt die Summe, wenn mein Anteil kleiner ist. */
    function privateLabel(a) {
        var info = a.privateInfo;
        return 'Private Nebenkosten' + (info.gross - info.total > 0.5 ? ' (mein Anteil von ' + eur(info.gross) + ')' : '');
    }

    /** Mieten in der Monatsbilanz. */
    function rentLines(a) {
        if (!(a.rentGross > 0)) return line('WG-Mieten', 'keine eingetragen', 'muted-row');
        return line('WG-Mieten (' + a.roomsRented + ' Zi., ' + fmtInput(n(a.flat.wg.vacancyPct), 1) + ' % Leerstand)', '− ' + eur(a.rentCash)) +
            (a.rentPrivate > 0 ? line('darin enthalten: ' + esc(a.rentPrivateNames.join(', ')) + ' der anderen', '+ ' + eur(a.rentPrivate)) : '') +
            (a.rentExtra > 0 ? line('zusätzlich zur Miete: ' + esc(runningLabel(a)), '− ' + eur(a.rentExtra)) : '');
    }

    function runningLabel(a) {
        return isRent(a) ? 'Nebenkosten & Heizung' : 'umlegbares Hausgeld & Grundsteuer';
    }

    /** Wie viel von den Mieten nach den enthaltenen Kosten übrig bleibt. */
    function rentLeftTable(a) {
        if (!(a.rentGross > 0) || !(a.rentPrivate + a.rentRunning > 0)) return '';
        return '<h3>Mieten an dich</h3><table class="calc">' +
            line('Mieten nach Leerstand', eur(a.rentCash)) +
            (a.rentRunning > 0 ? line('Anteil ' + esc(runningLabel(a)), '− ' + eur(a.rentRunning)) : '') +
            (a.rentPrivate > 0 ? line('Anteil ' + esc(a.rentPrivateNames.join(', ')), '− ' + eur(a.rentPrivate)) : '') +
            line(isRent(a) ? 'Bleibt für die Kaltmiete' : 'Bleibt für den Kredit', eur(a.rentLeft), 'sum strong') +
            '</table>';
    }

    function renderDetailResults(box, a) {
        var p = state.profile;
        if (a.price <= 0) {
            box.innerHTML = '<div class="panel results-panel"><p class="muted">Sobald ein Kaufpreis drin ist, steht hier die Auswertung: Monatsbilanz, Kaufkosten, Finanzierung und Checks.</p></div>';
            return;
        }
        var fixed = a.fixedYears;
        var html = '<div class="panel results-panel">';

        html += '<div class="tiles tiles-2">' +
            tile('Netto-Wohnkosten', eur(a.netHousing), a.vsRent !== null ? signed(a.vsRent) + ' ggü. heute' : 'pro Monat, nach WG-Einnahmen') +
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
            line(privateLabel(a), eur(a.private)) +
            (a.utilities > 0 ? line('Weitere laufende Kosten', eur(a.utilities)) : '') +
            line('Ausgaben', eur(a.outflow), 'sum') +
            rentLines(a) +
            line('Netto-Wohnkosten', eur(a.netHousing), 'sum strong') +
            (a.vsRent !== null ? line('ggü. heute (' + eur(a.currentHousing) + ' inkl. privater Nebenkosten)', signed(a.vsRent)) : '') +
            '</table>';

        html += '<table class="calc calc-split">' +
            line('davon Vermögensaufbau (Tilgung)', eur(a.wealthBuild)) +
            line('Entgangene Rendite aufs Eigenkapital', '+ ' + eur(a.opportunity)) +
            line('Echte Kosten', eur(a.trueCost), 'sum strong') +
            (a.trueVsRent !== null ? line('ggü. heute', signed(a.trueVsRent)) : '') +
            '</table><p class="muted small">Echte Kosten = Zinsen + laufende Kosten + entgangene Rendite − WG-Einnahmen. Die Tilgung ist kein Verlust, sondern landet in der Wohnung.</p>';

        html += rentLeftTable(a);

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

        html += '</div>';
        box.innerHTML = html;
    }

    /** Auswertung einer Mietwohnung. */
    function renderRentResults(box, a) {
        var p = state.profile;
        if (a.coldRent <= 0) {
            box.innerHTML = '<div class="panel results-panel"><p class="muted">Sobald eine Kaltmiete drin ist, steht hier die Auswertung: Monatsbilanz, Einzug, Mietentwicklung und Checks.</p></div>';
            return;
        }
        var f = a.flat;
        var html = '<div class="panel results-panel">';

        html += '<div class="tiles tiles-2">' +
            tile('Netto-Wohnkosten', eur(a.netHousing), a.vsRent !== null ? signed(a.vsRent) + ' ggü. heute' : 'pro Monat, nach WG-Einnahmen') +
            tile('Frei verfügbar', a.netIncome > 0 ? eur(a.available) : '–', a.netIncome > 0 ? 'pro Monat, nach allen Fixkosten' : 'Nettoeinkommen fehlt', a.netIncome > 0 && a.available < 0 ? 'tile-bad' : '') +
            tile('Kaltmiete in 5 Jahren', eur(a.coldIn5), f.rentType === 'fixed' ? 'feste Miete, ohne Erhöhungen' : (a.rentIncrease5 > 0 ? '+ ' + pct(a.rentIncrease5) + ' (' + RENT_TYPE[f.rentType] + ')' : RENT_TYPE[f.rentType])) +
            tile('Kaution & Einzug', eur(a.moveIn), 'Cash danach ' + eur(a.cashAfter), (n(p.cash) > 0 || n(p.reserve) > 0) && a.cashAfter < n(p.reserve) ? 'tile-warn' : '') +
            '</div>';

        html += '<h3>Checks</h3><ul class="checks">' + a.warnings.slice().sort(function (x, y) { return TIER[y.level] - TIER[x.level]; }).map(function (w) {
            return '<li class="check-' + w.level + '"><span class="check-icon" aria-label="' + TIER_LABEL[w.level] + '">' + ICON[w.level] + '</span><span>' + esc(w.text) + '</span></li>';
        }).join('') + '</ul>';

        html += renderReview(box, a);

        html += '<h3>Monatsbilanz</h3><table class="calc">' +
            line('Kaltmiete', eur(a.coldRent)) +
            line('Nebenkosten', eur(a.serviceCharges)) +
            (a.heating > 0 ? line('Heizkosten', eur(a.heating)) : '') +
            line('Warmmiete', eur(a.warmRent), 'sum') +
            line(privateLabel(a), eur(a.private)) +
            (a.utilities > 0 ? line('Weitere laufende Kosten', eur(a.utilities)) : '') +
            line('Ausgaben', eur(a.outflow), 'sum') +
            rentLines(a) +
            line('Netto-Wohnkosten', eur(a.netHousing), 'sum strong') +
            (a.vsRent !== null ? line('ggü. heute (' + eur(a.currentHousing) + ' inkl. privater Nebenkosten)', signed(a.vsRent)) : '') +
            (a.coldPerSqm ? line('Kaltmiete pro m²', perSqm(a.coldPerSqm)) : '') +
            (a.warmPerSqm ? line('Warmmiete pro m²', perSqm(a.warmPerSqm)) : '') +
            '</table>';

        html += rentLeftTable(a);

        if (a.netIncome > 0) {
            html += '<h3>Haushalt</h3><table class="calc">' +
                line('Nettoeinkommen', eur(a.netIncome)) +
                line('Lebenshaltung', '− ' + eur(n(p.livingCosts))) +
                (n(p.otherDebt) > 0 ? line('Andere Kreditraten', '− ' + eur(n(p.otherDebt))) : '') +
                line('Netto-Wohnkosten', '− ' + eur(a.netHousing)) +
                line('Frei verfügbar', eur(a.available), 'sum strong') +
                line('Warmmiete / Netto', pct(a.rentRatio)) +
                line('Wohnkosten / Netto (mit WG)', pct(a.burdenNet)) +
                '</table>';
        }

        html += '<h3>Einzug</h3><table class="calc">' +
            line('Kaution', eur(a.deposit) + (a.coldRent > 0 && a.deposit > 0 ? ' (' + fmtInput(a.deposit / a.coldRent, 1) + ' Kaltmieten)' : '')) +
            line('Umzug & Einrichtung', eur(a.oneOff)) +
            line('Zusammen', eur(a.moveIn), 'sum strong') +
            line('Cash danach', eur(a.cashAfter)) +
            (a.opportunity > 0 ? line('Entgangene Rendite auf die Kaution', eur(a.opportunity) + ' / Monat') : '') +
            '</table>';

        html += '<h3>Mietentwicklung <span class="muted small">(' + RENT_TYPE[f.rentType] + ')</span></h3><table class="calc rent-plan"><tr><th>Mietjahr</th><td>Kaltmiete</td><td>Warmmiete</td><td>Netto-Wohnkosten</td></tr>' +
            a.rentTimeline.map(function (r) {
                return '<tr><th>' + r.year + '</th><td>' + eur(r.cold) + '</td><td>' + eur(r.warm) + '</td><td>' + eur(r.net) + '</td></tr>';
            }).join('') +
            '<tr class="sum"><th>Ø 10 Jahre</th><td></td><td></td><td>' + eur(a.avgNet10) + '</td></tr>' +
            '</table><p class="muted small">Nebenkosten, private Kosten und WG-Mieten bleiben in dieser Vorschau gleich' +
            (f.rentType === 'fixed' ? '; Mieterhöhungen bis zur Vergleichsmiete sind nicht eingerechnet' : '') + '.</p>';

        html += '</div>';
        box.innerHTML = html;
    }

    /** Private Nebenkosten aus "Meine Finanzen" für eine Wohnung an- oder abwählen. */
    function privateCostsPanel(f) {
        var box = el('div', { class: 'group private-costs' });
        var list = el('div', { class: 'cost-checks' });
        var title = el('h3', { class: 'group-title', text: 'Private Nebenkosten' });
        var hint = el('p', { class: 'muted small group-hint' });
        /** Personenzahl ohne eigene Angabe für diese Wohnung. */
        function autoCount() { return WK.personCount(state.profile, Object.assign({}, f, { persons: null })); }
        var personsField = numField(f, 'persons', 'Personen in dieser Wohnung', { dec: 0, hint: function () {
            var count = autoCount(), extra = count - Math.max(1, state.people.length);
            return 'Teilen sich die Kosten. Leer = ' + (peopleNames() || 'du') + (extra > 0 ? ' + ' + extra + ' aus den WG-Zimmern' : '') + ' (' + count + ').';
        } });
        var personsRow = el('div', { class: 'grid cost-persons' }, [personsField]);
        box.append(title, hint, personsRow, list);

        function build() {
            list.innerHTML = '';
            var items = state.profile.privateCosts;
            personsRow.hidden = !items.length;
            if (!items.length) {
                hint.textContent = 'Strom, Internet, Rundfunkbeitrag & Co. trägst du einmal unter „Meine Finanzen“ ein.';
                list.appendChild(el('a', { href: '#', text: '→ Zu „Meine Finanzen“' }));
                return;
            }
            hint.textContent = 'Aus „Meine Finanzen“, gezählt wird dein Anteil pro Monat. Haken weg, wenn ein Posten hier schon in ' + (f.kind === 'rent' ? 'der Warmmiete' : 'Hausgeld oder Nebenkosten') + ' enthalten ist.';
            items.forEach(function (c) {
                var cb = el('input', { type: 'checkbox' });
                cb.checked = !f.coveredCosts[c.id];
                cb.addEventListener('change', function () {
                    if (cb.checked) delete f.coveredCosts[c.id]; else f.coveredCosts[c.id] = true;
                    changed();
                });
                list.appendChild(el('label', { class: 'cost-check' + (cb.checked ? '' : ' is-covered') }, [
                    cb,
                    el('span', { class: 'cost-name', text: (c.name || '').trim() || 'Ohne Namen' }),
                    el('span', { class: 'cost-amount' }),
                    el('span', { class: 'cost-state muted small' })
                ]));
                cb.addEventListener('change', function () {
                    cb.parentNode.classList.toggle('is-covered', !cb.checked);
                });
            });
            list.appendChild(el('div', { class: 'cost-sum muted small', 'data-cost-sum': '' }));
        }
        build();
        box._update = function () {
            var info = WK.privateCosts(state.profile, f);
            personsField._input.placeholder = String(autoCount());
            var rows = list.querySelectorAll('.cost-check');
            info.items.forEach(function (c, i) {
                if (!rows[i]) return;
                rows[i].querySelector('.cost-amount').textContent = c.gross > 0 ? euro2(c.mine) : '–';
                rows[i].querySelector('.cost-state').textContent = c.covered ? 'schon enthalten'
                    : c.gross > 0 ? costNote(state.profile.privateCosts[i], info.persons) : '';
            });
            var s = list.querySelector('[data-cost-sum]');
            if (s) {
                var covered = info.all - info.total;
                s.textContent = (costSumText(info) || 'Hier zählt kein Posten') + (covered > 0.005 ? ' · ' + euro2(covered) + ' schon enthalten' : '');
            }
        };
        return box;
    }

    /** Rechenweg eines Postens, z. B. "55,08 € pro Quartal, geteilt durch 2". */
    function costNote(c, count) {
        var every = WK.COST_EVERY.find(function (e) { return e[0] === c.every; });
        var text = euro2(n(c.amount)) + ' ' + every[1];
        if (c.split === 'person') return text + ' je Person';
        if (c.split === 'all') return c.every === 1 ? '' : text;
        if (c.split === 'percent' && WK.isSet(c.sharePct)) return text + ', davon ' + fmtInput(WK.costMonthly(c, count).share * 100, 1) + ' %';
        return text + (count > 1 ? ', geteilt durch ' + count : '');
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
        html += '<p class="muted small review-intro">Faustwerte für Deutschland – Lage und Ausstattung können Abweichungen erklären. Aufklappen für Erklärung und Fragen an ' + (a.kind === 'rent' ? 'Vermieter oder Hausverwaltung' : 'Makler oder Verwaltung') + '.</p>';
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
        html += '<details class="review-item check-info docs" data-review="__docs"' + (docsOpen ? ' open' : '') + '><summary><span class="check-icon">i</span><span class="review-title">Unterlagen-Checkliste vor ' + (a.kind === 'rent' ? 'dem Unterschreiben' : 'dem Kauf') + '</span></summary>' +
            '<div class="review-body"><ul>' + (a.documents || WK.DOCUMENTS).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div></details>';
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
        (a.documents || WK.DOCUMENTS).forEach(function (d) { lines.push('- ' + d); });
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
