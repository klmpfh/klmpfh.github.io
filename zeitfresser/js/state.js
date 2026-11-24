/* Zeitfresser – Datenmodell, Speicherung (localStorage) und Rechenhilfen.
 *
 * Aufbau im localStorage (Schlüssel STORE_KEY):
 *   { version: 1, activeId, scenarios: [Szenario, ...] }
 * Szenario:
 *   { id, name, hoursPerDay, nodes: [Knoten, ...] }
 * Knoten (höchstens zwei Ebenen: Thema → Unterpunkte über children):
 *   { id, name, amount, per: 'week' | 'day', days: [Mo..So als bool],
 *     colorSlot (nur bei obersten Punkten relevant), collapsed, children }
 *
 * Alles bezieht sich auf eine Woche. "amount" ist entweder der Wochenwert
 * (per = 'week') oder der Wert pro gewähltem Wochentag (per = 'day'). Die
 * Bezugsgröße der Woche ist 7 × hoursPerDay.
 *
 * Hat ein Thema Unterpunkte und keinen eigenen Wert (amount = 0), gilt
 * automatisch die Summe der Unterpunkte (siehe isAutoSum). Ist ein Wert
 * eingetragen, gilt dieser: Decken die Unterpunkte weniger ab, bleibt ein
 * Rest "nicht zugeordnet"; ergeben sie mehr, wird das als Fehler markiert.
 */
'use strict';

const STORE_KEY = 'klmpfh-zeitfresser';
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const SLOT_COUNT = 12;
const EPS = 1e-6;

let store = null;

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function allDays() { return [true, true, true, true, true, true, true]; }
function workDays() { return [true, true, true, true, true, false, false]; }

function createNode(opts) {
    opts = opts || {};
    return {
        id: uid(),
        name: opts.name || '',
        amount: opts.amount || 0,
        per: opts.per === 'week' ? 'week' : 'day',
        days: (opts.days || allDays()).slice(),
        colorSlot: opts.colorSlot == null ? 0 : opts.colorSlot,
        collapsed: false,
        children: opts.children || []
    };
}

function createScenario(name) {
    return { id: uid(), name: name, hoursPerDay: 24, nodes: [] };
}

function createExampleScenario() {
    const sc = createScenario('Beispielwoche');
    sc.nodes = [
        createNode({ name: 'Schlaf', amount: 7.5, per: 'day', colorSlot: 0 }),
        createNode({
            name: 'Arbeit', amount: 38, per: 'week', days: workDays(), colorSlot: 1,
            children: [
                createNode({ name: 'Projekt A', amount: 16, per: 'week', days: workDays() }),
                createNode({ name: 'Projekt B', amount: 8, per: 'week', days: [true, true, false, false, false, false, false] }),
                createNode({ name: 'Meetings', amount: 1.5, per: 'day', days: workDays() }),
                createNode({ name: 'E-Mails', amount: 4, per: 'week', days: workDays() }),
                createNode({ name: 'Sonstiges', amount: 2.5, per: 'week', days: workDays() })
            ]
        }),
        createNode({ name: 'Pendeln', amount: 1, per: 'day', days: workDays(), colorSlot: 2 }),
        createNode({ name: 'Handy & Social Media', amount: 2, per: 'day', colorSlot: 3 }),
        createNode({
            name: 'Haushalt', amount: 8, per: 'week', colorSlot: 4,
            children: [
                createNode({ name: 'Kochen', amount: 0.5, per: 'day' }),
                createNode({ name: 'Putzen', amount: 2, per: 'week', days: [false, false, false, false, false, true, false] }),
                createNode({ name: 'Einkaufen', amount: 2.5, per: 'week', days: [false, false, false, false, true, true, false] })
            ]
        })
    ];
    return sc;
}

/* ── Laden / Speichern ── */

function sanitizeNode(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const days = Array.isArray(raw.days) && raw.days.length === 7 ? raw.days.map(Boolean) : allDays();
    const amount = Number(raw.amount);
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
        name: typeof raw.name === 'string' ? raw.name : '',
        amount: isFinite(amount) && amount >= 0 ? amount : 0,
        per: raw.per === 'day' ? 'day' : 'week',
        days: days,
        colorSlot: Number.isInteger(raw.colorSlot) ? ((raw.colorSlot % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT : 0,
        collapsed: !!raw.collapsed,
        children: Array.isArray(raw.children) ? raw.children.map(sanitizeNode).filter(Boolean) : []
    };
}

/** Höchstens zwei Ebenen: tiefer verschachtelte Punkte (aus älteren Daten)
 *  rücken als Unterpunkte direkt hinter ihren bisherigen Elternpunkt. */
function limitDepth(nodes) {
    nodes.forEach(top => {
        const flat = [];
        (function collect(list) {
            list.forEach(n => {
                const kids = n.children;
                n.children = [];
                flat.push(n);
                collect(kids);
            });
        })(top.children);
        top.children = flat;
    });
    return nodes;
}

function sanitizeScenario(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const hpd = Number(raw.hoursPerDay);
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
        name: typeof raw.name === 'string' ? raw.name : 'Szenario',
        hoursPerDay: isFinite(hpd) && hpd > 0 && hpd <= 24 ? hpd : 24,
        nodes: limitDepth(Array.isArray(raw.nodes) ? raw.nodes.map(sanitizeNode).filter(Boolean) : [])
    };
}

function loadStore() {
    let data = null;
    try {
        data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (e) { data = null; }

    const scenarios = data && Array.isArray(data.scenarios)
        ? data.scenarios.map(sanitizeScenario).filter(Boolean)
        : [];
    if (!scenarios.length) scenarios.push(createExampleScenario());

    let activeId = data && data.activeId;
    if (!scenarios.some(s => s.id === activeId)) activeId = scenarios[0].id;

    store = { version: 1, activeId: activeId, scenarios: scenarios };
}

function saveStore() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* localStorage evtl. nicht verfügbar (privater Modus) – Seite funktioniert trotzdem */ }
}

function activeScenario() {
    return store.scenarios.find(s => s.id === store.activeId) || store.scenarios[0];
}

/* ── Baum-Hilfen ── */

/** Sucht einen Knoten samt Elternknoten (null = oberste Ebene) und der Liste, in der er steht. */
function findNode(nodes, id, parent) {
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.id === id) return { node: n, parent: parent || null, list: nodes, index: i };
        const hit = findNode(n.children, id, n);
        if (hit) return hit;
    }
    return null;
}

function walk(nodes, fn, depth, parent) {
    depth = depth || 0;
    nodes.forEach(n => {
        fn(n, depth, parent || null);
        walk(n.children, fn, depth + 1, n);
    });
}

/** Anzahl der Ringe, die das Kreisdiagramm braucht (1 = nur oberste Ebene). */
function treeDepth(nodes) {
    let max = 0;
    nodes.forEach(n => { max = Math.max(max, 1 + treeDepth(n.children)); });
    return max;
}

function cloneNodesWithNewIds(nodes) {
    return nodes.map(n => Object.assign({}, n, {
        id: uid(),
        days: n.days.slice(),
        children: cloneNodesWithNewIds(n.children)
    }));
}

/* ── Rechnen ── */

function dayCount(node) {
    return node.days.reduce((s, d) => s + (d ? 1 : 0), 0);
}

/** Kein eigener Wert, aber Unterpunkte → deren Summe zählt. */
function isAutoSum(node) {
    return !node.amount && node.children.length > 0;
}

function weeklyHours(node) {
    const n = dayCount(node);
    if (!n) return 0;
    if (isAutoSum(node)) return sumWeekly(node.children);
    return node.per === 'day' ? node.amount * n : node.amount;
}

function sumWeekly(nodes) {
    return nodes.reduce((s, n) => s + weeklyHours(n), 0);
}

/** Summe der Unterpunkte in der Einheit des Themas (pro Tag: auf dessen Tage verteilt). */
function childrenAmount(node) {
    const n = dayCount(node);
    if (!n) return 0;
    const cs = sumWeekly(node.children);
    return node.per === 'day' ? cs / n : cs;
}

function weekRef(sc) {
    return sc.hoursPerDay * 7;
}

/* ── Export / Import (JSON) ── */

const EXPORT_APP = 'zeitfresser';

function scenarioToExport(sc) {
    return {
        app: EXPORT_APP,
        version: 1,
        exportedAt: new Date().toISOString(),
        scenario: { name: sc.name, hoursPerDay: sc.hoursPerDay, nodes: sc.nodes }
    };
}

/** Liest eine Export-Datei. Akzeptiert ein einzelnes Szenario (eigenes
 *  Exportformat oder nacktes Szenario-Objekt) sowie den kompletten Speicher
 *  ({ scenarios: [...] }). Liefert eine Liste bereinigter Szenarien mit neuen
 *  IDs oder wirft einen Error mit verständlicher Meldung. */
function scenariosFromImport(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Die Datei ist kein gültiges JSON.'); }
    let raw;
    if (data && data.scenario) raw = [data.scenario];
    else if (data && Array.isArray(data.scenarios)) raw = data.scenarios;
    else if (data && Array.isArray(data.nodes)) raw = [data];
    else throw new Error('In der Datei wurde kein Zeitfresser-Szenario gefunden.');
    const out = raw.map(sanitizeScenario).filter(Boolean);
    if (!out.length) throw new Error('In der Datei wurde kein Zeitfresser-Szenario gefunden.');
    out.forEach(sc => {
        sc.id = uid();
        sc.nodes = cloneNodesWithNewIds(sc.nodes);
    });
    return out;
}

/** Dateiname aus dem Szenario-Namen ("Meine Woche" → "zeitfresser-meine-woche"). */
function fileBaseName(sc) {
    const slug = (sc.name || '').toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return 'zeitfresser' + (slug ? '-' + slug : '');
}

/* ── Ein-/Ausgabe von Stunden ── */

/** "1,5" / "1.5" / "1:30" → 1.5; leer → 0; ungültig → null. */
function parseHours(str) {
    const s = String(str).trim().replace(/\s*h$/i, '');
    if (s === '') return 0;
    let v;
    const m = s.match(/^(\d+):([0-5]?\d)$/);
    if (m) {
        v = Number(m[1]) + Number(m[2]) / 60;
    } else if (/^\d*[.,]?\d+$|^\d+[.,]$/.test(s)) {
        v = Number(s.replace(',', '.'));
    } else {
        return null;
    }
    return isFinite(v) && v >= 0 ? v : null;
}

function fmtNumber(h) {
    return (Math.round(h * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

/** Kompakt mit höchstens einer Nachkommastelle – für Balkenbeschriftungen und Summen. */
function fmtShort(h) {
    return (Math.round(h * 10) / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

function fmtHours(h) {
    return fmtNumber(h) + ' h';
}

function fmtPercent(share) {
    if (share > 0 && share < 0.005) return '< 1 %';
    return Math.round(share * 100) + ' %';
}

/** Wochentage kompakt: "täglich", "Mo–Fr", "Mo, Mi, Fr", "Sa–So". */
function fmtDays(days) {
    const n = days.filter(Boolean).length;
    if (n === 7) return 'täglich';
    if (n === 0) return 'keine Tage';
    const runs = [];
    let start = -1;
    for (let d = 0; d <= 7; d++) {
        if (d < 7 && days[d]) {
            if (start < 0) start = d;
        } else if (start >= 0) {
            const end = d - 1;
            if (end - start >= 2) runs.push(DAY_SHORT[start] + '–' + DAY_SHORT[end]);
            else for (let i = start; i <= end; i++) runs.push(DAY_SHORT[i]);
            start = -1;
        }
    }
    return runs.join(', ');
}
