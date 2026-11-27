/* Geldkugel – Datenmodell, Speicherung (localStorage) und Rechenhilfen.
 *
 * Aufbau im localStorage (Schlüssel STORE_KEY):
 *   { version: 1, activeId, compare: { a, b }, categories: [Kategorie, ...], scenarios: [Szenario, ...], stamps }
 * Kategorie (gilt für alle Szenarien, Reihenfolge = Reihenfolge der Liste):
 *   { id, name, colorSlot, kind: 'expense' | 'income' }
 * Szenario:
 *   { id, name, payments: [Zahlung, ...] }
 * Zahlung:
 *   { id, categoryId, name, amount, interval }
 *
 * interval ist einer der Schlüssel aus INTERVALS. Gerechnet wird immer auf den
 * Monat herunter: Betrag × Zahlungen pro Jahr ÷ 12. Eine wöchentliche Zahlung
 * zählt also 52 ÷ 12 ≈ 4,33-mal im Monat, nicht 4-mal.
 *
 * kind legt fest, ob die Zahlungen einer Kategorie Ausgaben oder Einnahmen sind.
 * Bilanz eines Szenarios = Einnahmen − Ausgaben: positiv bleibt etwas offen,
 * negativ fehlt etwas.
 *
 * pos (Reihenfolge, an Kategorien, Szenarien und Zahlungen) und stamps (wann
 * welches Feld zuletzt geändert wurde) sind nur für den Abgleich mit anderen
 * Geräten da, siehe sync.js.
 */
'use strict';

const STORE_KEY = 'klmpfh-geldkugel';
const SLOT_COUNT = 12;
const EPS = 0.005;   // halber Cent

const INTERVALS = [
    { key: 'week',     label: 'wöchentlich',     short: 'pro Woche',     perYear: 52 },
    { key: 'biweek',   label: 'zweiwöchentlich', short: 'alle 2 Wochen', perYear: 26 },
    { key: 'month',    label: 'monatlich',       short: 'pro Monat',     perYear: 12 },
    { key: 'quarter',  label: 'vierteljährlich', short: 'pro Quartal',   perYear: 4 },
    { key: 'halfyear', label: 'halbjährlich',    short: 'pro Halbjahr',  perYear: 2 },
    { key: 'year',     label: 'jährlich',        short: 'pro Jahr',      perYear: 1 }
];
const INTERVAL = {};
INTERVALS.forEach(i => { INTERVAL[i.key] = i; });

let store = null;
let stamps = {};        // Zeitstempel je Feld (sync.js) …
let stampBase = null;   // … und der Stand, für den sie gelten

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

/* ── Anlegen ── */

function createCategory(name, colorSlot, kind) {
    return { id: uid(), name: name || '', colorSlot: colorSlot || 0, kind: kind === 'income' ? 'income' : 'expense' };
}

function createPayment(categoryId, name, amount, interval) {
    return { id: uid(), categoryId: categoryId, name: name || '', amount: amount || 0, interval: interval || 'month' };
}

function createScenario(name) {
    return { id: uid(), name: name, payments: [] };
}

function createExampleStore() {
    const names = ['Wohnen', 'Lebensmittel', 'Mobilität', 'Versicherungen', 'Abos & Verträge', 'Freizeit'];
    const cats = names.map((n, i) => createCategory(n, i));
    const c = {};
    names.forEach((n, i) => { c[n] = cats[i].id; });
    const job = createCategory('Einkommen', 6, 'income');
    cats.unshift(job);

    const now = createScenario('Jetzt');
    now.payments = [
        createPayment(job.id, 'Gehalt (netto)', 1950, 'month'),
        createPayment(job.id, 'Weihnachtsgeld', 1200, 'year'),
        createPayment(job.id, 'Nebenjob', 200, 'month'),
        createPayment(c.Wohnen, 'Miete (warm)', 720, 'month'),
        createPayment(c.Wohnen, 'Strom', 45, 'month'),
        createPayment(c.Wohnen, 'Internet', 35, 'month'),
        createPayment(c.Lebensmittel, 'Wocheneinkauf', 75, 'week'),
        createPayment(c.Lebensmittel, 'Kaffee unterwegs', 12, 'week'),
        createPayment(c['Mobilität'], 'Deutschlandticket', 63, 'month'),
        createPayment(c['Mobilität'], 'Fahrrad-Inspektion', 120, 'year'),
        createPayment(c.Versicherungen, 'Haftpflicht', 60, 'year'),
        createPayment(c.Versicherungen, 'Hausrat', 90, 'year'),
        createPayment(c['Abos & Verträge'], 'Handy', 15, 'month'),
        createPayment(c['Abos & Verträge'], 'Streaming', 13, 'month'),
        createPayment(c['Abos & Verträge'], 'Rundfunkbeitrag', 55.08, 'quarter'),
        createPayment(c.Freizeit, 'Sportverein', 30, 'month'),
        createPayment(c.Freizeit, 'Ausgehen', 40, 'biweek')
    ];

    const next = createScenario('Nach dem Umzug');
    next.payments = [
        createPayment(job.id, 'Gehalt (netto)', 1950, 'month'),
        createPayment(job.id, 'Weihnachtsgeld', 1200, 'year'),
        createPayment(c.Wohnen, 'Miete (warm)', 950, 'month'),
        createPayment(c.Wohnen, 'Strom', 55, 'month'),
        createPayment(c.Wohnen, 'Internet', 35, 'month'),
        createPayment(c.Lebensmittel, 'Wocheneinkauf', 75, 'week'),
        createPayment(c.Lebensmittel, 'Kaffee unterwegs', 6, 'week'),
        createPayment(c['Mobilität'], 'Carsharing', 60, 'month'),
        createPayment(c['Mobilität'], 'Fahrrad-Inspektion', 120, 'year'),
        createPayment(c.Versicherungen, 'Haftpflicht', 60, 'year'),
        createPayment(c.Versicherungen, 'Hausrat', 120, 'year'),
        createPayment(c['Abos & Verträge'], 'Handy', 15, 'month'),
        createPayment(c['Abos & Verträge'], 'Streaming', 13, 'month'),
        createPayment(c['Abos & Verträge'], 'Rundfunkbeitrag', 55.08, 'quarter'),
        createPayment(c.Freizeit, 'Sportverein', 30, 'month'),
        createPayment(c.Freizeit, 'Ausgehen', 30, 'biweek')
    ];

    return {
        version: 1,
        activeId: now.id,
        compare: { a: now.id, b: next.id },
        categories: cats,
        scenarios: [now, next]
    };
}

/* ── Bereinigen (Laden, Import) ──
 * Bewusst nachsichtig, weil auch Antworten einer KI hier landen (siehe ai.js):
 * Kennungen als Zahl, Beträge als Text oder mit Minus, Intervalle auf Englisch
 * oder Deutsch werden verstanden. */

function idOf(v) {
    return (typeof v === 'string' && v) || (typeof v === 'number' && isFinite(v)) ? String(v) : null;
}

const INTERVAL_ALIASES = {
    week: 'week', weekly: 'week', 'wöchentlich': 'week',
    biweek: 'biweek', biweekly: 'biweek', fortnightly: 'biweek', 'zweiwöchentlich': 'biweek', 'alle 2 wochen': 'biweek', '14-tägig': 'biweek',
    month: 'month', monthly: 'month', monatlich: 'month',
    quarter: 'quarter', quarterly: 'quarter', 'vierteljährlich': 'quarter', quartal: 'quarter', 'quartalsweise': 'quarter',
    halfyear: 'halfyear', halfyearly: 'halfyear', semiannual: 'halfyear', semiannually: 'halfyear', 'halbjährlich': 'halfyear',
    year: 'year', yearly: 'year', annual: 'year', annually: 'year', 'jährlich': 'year'
};

function intervalOf(v) {
    return INTERVAL_ALIASES[String(v == null ? '' : v).trim().toLowerCase()] || 'month';
}

function kindOf(v) {
    return /^(income|einnahme|einnahmen)$/i.test(String(v == null ? '' : v).trim()) ? 'income' : 'expense';
}

function amountOf(v) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseAmount(v.replace(/^[-−]/, '')) : NaN;
    return n != null && isFinite(n) ? Math.abs(n) : 0;
}

function sanitizeCategory(raw, index) {
    if (!isObj(raw)) return null;
    return {
        id: idOf(raw.id) || uid(),
        name: typeof raw.name === 'string' ? raw.name : '',
        colorSlot: Number.isInteger(raw.colorSlot) ? ((raw.colorSlot % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT : index % SLOT_COUNT,
        kind: kindOf(raw.kind),
        pos: Number.isFinite(raw.pos) ? raw.pos : null
    };
}

function sanitizePayment(raw, catIds) {
    if (!isObj(raw) || !catIds.has(idOf(raw.categoryId))) return null;
    return {
        id: idOf(raw.id) || uid(),
        categoryId: idOf(raw.categoryId),
        name: typeof raw.name === 'string' ? raw.name : '',
        amount: amountOf(raw.amount),
        interval: intervalOf(raw.interval),
        pos: Number.isFinite(raw.pos) ? raw.pos : null
    };
}

function sanitizeScenario(raw, catIds) {
    if (!isObj(raw)) return null;
    return {
        id: idOf(raw.id) || uid(),
        name: typeof raw.name === 'string' ? raw.name : 'Szenario',
        pos: Number.isFinite(raw.pos) ? raw.pos : null,
        payments: Array.isArray(raw.payments) ? raw.payments.map(p => sanitizePayment(p, catIds)).filter(Boolean) : []
    };
}

/** Kategorien und Szenarien aus beliebigen Daten; Doppelte Kennungen werden ersetzt. */
function sanitizeData(data) {
    const seen = new Set();
    const fresh = x => { if (seen.has(x.id)) x.id = uid(); seen.add(x.id); return x; };
    const categories = (Array.isArray(data.categories) ? data.categories : []).map(sanitizeCategory).filter(Boolean).map(fresh);
    const catIds = new Set(categories.map(c => c.id));
    const scenarios = (Array.isArray(data.scenarios) ? data.scenarios : []).map(s => sanitizeScenario(s, catIds)).filter(Boolean).map(fresh);
    scenarios.forEach(s => s.payments.forEach(fresh));
    // Zahlungen ohne gültige Kategorie fallen weg – zum Melden beim Import mitzählen.
    const raw = (Array.isArray(data.scenarios) ? data.scenarios : [])
        .reduce((n, s) => n + (isObj(s) && Array.isArray(s.payments) ? s.payments.length : 0), 0);
    const kept = scenarios.reduce((n, s) => n + s.payments.length, 0);
    return { categories: categories, scenarios: scenarios, skipped: raw - kept };
}

function loadStore() {
    let data = null;
    try {
        data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (e) { data = null; }

    if (!isObj(data) || !Array.isArray(data.scenarios) || !data.scenarios.length) {
        store = SYNC.assignAll(createExampleStore());
        stamps = {};
        stampBase = SYNC.plain(store);
        return;
    }
    const clean = sanitizeData(data);
    if (!clean.scenarios.length) clean.scenarios.push(createScenario('Neues Szenario'));
    // Gespeicherte Reihenfolge der Liste ist maßgeblich, pos dient nur dem Abgleich.
    store = {
        version: 1,
        activeId: data.activeId,
        compare: isObj(data.compare) ? { a: data.compare.a, b: data.compare.b } : {},
        categories: clean.categories,
        scenarios: clean.scenarios
    };
    if (!scenarioById(store.activeId)) store.activeId = store.scenarios[0].id;
    ensureCompare();
    store = SYNC.assignAll(store);
    stamps = SYNC.cleanStamps(data.stamps);
    stampBase = SYNC.plain(store);
}

/** Ersetzt den ganzen Stand, z. B. nach einem Abgleich. */
function replaceStore(next, nextStamps) {
    store = next;
    stamps = nextStamps;
    stampBase = SYNC.plain(SYNC.assignAll(store));
    saveStore();
}

function saveStore() {
    const now = SYNC.plain(SYNC.assignAll(store));
    SYNC.stamp(stampBase, now, stamps, Date.now());
    stampBase = now;
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign({}, store, { stamps: stamps })));
    } catch (e) { /* localStorage evtl. nicht verfügbar (privater Modus) – Seite funktioniert trotzdem */ }
}

/* ── Zugriff ── */

function scenarioById(id) { return store.scenarios.find(s => s.id === id) || null; }
function categoryById(id) { return store.categories.find(c => c.id === id) || null; }

function activeScenario() {
    return scenarioById(store.activeId) || store.scenarios[0];
}

/** Vergleich braucht zwei gültige, verschiedene Szenarien (sofern es zwei gibt). */
function ensureCompare(st) {
    st = st || store;
    const c = st.compare || (st.compare = {});
    const ids = st.scenarios.map(s => s.id);
    if (ids.indexOf(c.a) < 0) c.a = ids[0];
    if (ids.indexOf(c.b) < 0 || (c.b === c.a && ids.length > 1)) c.b = ids.find(id => id !== c.a) || c.a;
}

function categoryName(cat) {
    return (cat && cat.name.trim()) || 'Ohne Namen';
}

function scenarioName(sc) {
    return (sc && sc.name.trim()) || 'Ohne Namen';
}

function paymentName(p) {
    return p.name.trim() || 'Ohne Bezeichnung';
}

function paymentsOf(sc, categoryId) {
    return sc.payments.filter(p => p.categoryId === categoryId);
}

/* ── Rechnen ── */

function monthly(p) {
    return p.amount * INTERVAL[p.interval].perYear / 12;
}

function categoryTotal(sc, categoryId) {
    return paymentsOf(sc, categoryId).reduce((s, p) => s + monthly(p), 0);
}

function isIncome(cat) { return !!cat && cat.kind === 'income'; }

function categoriesOf(kind) {
    return store.categories.filter(c => c.kind === kind);
}

function kindTotal(sc, kind) {
    const ids = new Set(categoriesOf(kind).map(c => c.id));
    return sc.payments.reduce((s, p) => s + (ids.has(p.categoryId) ? monthly(p) : 0), 0);
}

function expenseTotal(sc) { return kindTotal(sc, 'expense'); }
function incomeTotal(sc) { return kindTotal(sc, 'income'); }

/** Einnahmen − Ausgaben pro Monat: positiv = bleibt offen, negativ = fehlt. */
function balance(sc) { return incomeTotal(sc) - expenseTotal(sc); }

function hasIncome(sc) { return incomeTotal(sc) > EPS; }

/** Wie oft im Monat, lesbar: "52 × im Jahr ÷ 12". */
function intervalExplain(key) {
    const i = INTERVAL[key];
    if (i.perYear === 12) return 'einmal im Monat';
    return i.perYear + ' × im Jahr ÷ 12';
}

/* ── Vergleich zweier Szenarien ──
 * Zahlungen werden innerhalb einer Kategorie über ihren Namen (ohne Groß-/
 * Kleinschreibung) einander zugeordnet; gleiche Namen der Reihe nach. */

function matchKey(p) {
    return p.name.trim().toLowerCase();
}

/** Je Kategorie: { cat, a, b, delta, changes: [{ kind: 'new'|'gone'|'changed', pa, pb }] }. */
function compareScenarios(A, B) {
    return store.categories.map(cat => {
        const pa = paymentsOf(A, cat.id), pb = paymentsOf(B, cat.id).slice();
        const changes = [];
        pa.forEach(x => {
            const i = pb.findIndex(y => matchKey(y) === matchKey(x));
            if (i < 0) { changes.push({ kind: 'gone', pa: x, pb: null }); return; }
            const y = pb.splice(i, 1)[0];
            if (Math.abs(monthly(x) - monthly(y)) > EPS || x.interval !== y.interval) {
                changes.push({ kind: 'changed', pa: x, pb: y });
            }
        });
        pb.forEach(y => changes.push({ kind: 'new', pa: null, pb: y }));
        const a = categoryTotal(A, cat.id), b = categoryTotal(B, cat.id);
        return { cat: cat, a: a, b: b, delta: b - a, changes: changes };
    });
}

/* ── Export / Import (JSON) ── */

const EXPORT_APP = 'geldkugel';

function storeToExport() {
    return {
        app: EXPORT_APP,
        version: 1,
        exportedAt: new Date().toISOString(),
        categories: store.categories,
        scenarios: store.scenarios
    };
}

/** Liest eine Export-Datei; liefert { categories, scenarios } oder wirft einen Error mit verständlicher Meldung. */
/** Der JSON-Teil eines Textes: ein ```json-Block oder alles von der ersten { bis zur letzten }. */
function extractJson(text) {
    const s = String(text || '');
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1].trim().charAt(0) === '{') return fence[1];
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

function readImport(text) {
    let data;
    try { data = JSON.parse(extractJson(text)); } catch (e) { throw new Error('Darin steht kein gültiges JSON.'); }
    if (!isObj(data) || !Array.isArray(data.categories) || !Array.isArray(data.scenarios)) {
        throw new Error('In der Datei wurden keine Geldkugel-Daten gefunden.');
    }
    const clean = sanitizeData(data);
    if (!clean.scenarios.length) throw new Error('In der Datei wurde kein Szenario gefunden.');
    return clean;
}

/** Importierte Szenarien hinzufügen: Kategorien mit gleichem Namen werden zusammengelegt, der Rest kommt dazu. */
function addImported(imp) {
    const keyOf = c => c.kind + ':' + c.name.trim().toLowerCase();
    const byName = new Map(store.categories.map(c => [keyOf(c), c.id]));
    const map = {};
    imp.categories.forEach(c => {
        const key = keyOf(c);
        if (byName.has(key)) { map[c.id] = byName.get(key); return; }
        // Farbe behalten, außer eine vorhandene Kategorie hat sie schon.
        const slot = store.categories.some(x => x.colorSlot === c.colorSlot) ? nextFreeSlot() : c.colorSlot;
        const copy = createCategory(c.name, slot, c.kind);
        store.categories.push(copy);
        byName.set(key, copy.id);
        map[c.id] = copy.id;
    });
    const added = imp.scenarios.map(sc => ({
        id: uid(),
        name: uniqueScenarioName(sc.name.trim() || 'Importiert'),
        payments: sc.payments.map(p => Object.assign({}, p, { id: uid(), categoryId: map[p.categoryId] }))
    }));
    added.forEach(sc => store.scenarios.push(sc));
    return added;
}

function replaceWithImported(imp) {
    store.categories = imp.categories;
    store.scenarios = imp.scenarios;
    store.activeId = imp.scenarios[0].id;
    store.compare = {};
    ensureCompare();
}

function uniqueScenarioName(base) {
    const names = new Set(store.scenarios.map(s => s.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(base + ' ' + i)) i++;
    return base + ' ' + i;
}

/* ── Ein-/Ausgabe von Beträgen ── */

/** "12", "12,5", "1.234,56", "1,234.56", "12 €" → Zahl; leer → 0; ungültig → null. */
function parseAmount(str) {
    let s = String(str).replace(/[\s €]/g, '');
    if (s === '') return 0;
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
        // Das spätere Zeichen ist das Dezimalzeichen, das andere trennt Tausender.
        s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma >= 0) {
        s = /^\d{1,3}(,\d{3})+$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
        s = s.replace(/\./g, '');   // "1.234" = tausendzweihundertvierunddreißig
    }
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
    const v = Number(s);
    return isFinite(v) && v >= 0 ? v : null;
}

/** Betrag fürs Eingabefeld: "720", "12,50". */
function fmtInput(v) {
    if (!v) return '';
    const whole = Math.abs(v - Math.round(v)) < 1e-9;
    return v.toLocaleString('de-DE', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2, useGrouping: false });
}

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const EURO_SHORT = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 });

function fmtEuro(v) { return EURO.format(Math.abs(v) < EPS ? 0 : v); }
function fmtEuroShort(v) { return EURO_SHORT.format(Math.abs(v) < 0.5 ? 0 : v); }

/** Mit Vorzeichen, echtes Minus: "+12,00 €", "−8,50 €", "±0,00 €". */
function fmtSigned(v, short) {
    const f = short ? fmtEuroShort : fmtEuro;
    if (Math.abs(v) < (short ? 0.5 : EPS)) return '±' + f(0);
    return (v > 0 ? '+' : '−') + f(Math.abs(v));
}

function fmtPercent(share) {
    if (share > 0 && share < 0.005) return '< 1 %';
    return Math.round(share * 100) + ' %';
}

function fmtSignedPercent(share) {
    if (!isFinite(share)) return 'neu';
    const p = Math.round(share * 100);
    if (p === 0) return '±0 %';
    return (p > 0 ? '+' : '−') + Math.abs(p) + ' %';
}

/** "40,00 € alle 2 Wochen" */
function fmtPaymentOriginal(p) {
    return fmtEuro(p.amount) + ' ' + INTERVAL[p.interval].short;
}
