/* Geldkugel – Abgleich zweier Datenstände (ohne Oberfläche und ohne Netz).
 *
 * Zeitstempel je Feld und das Zusammenführen stehen in assets/js/sync-core.js.
 * Abgeglichen wird eine flache Form (plain):
 *   { categories: [{ id, name, colorSlot, kind, pos }],
 *     scenarios: [{ id, name, pos, payments: [{ id, categoryId, name, value: [amount, interval], pos }] }] }
 *  - value: Betrag und Intervall gehören zusammen, es gewinnt immer das ganze Paar.
 *  - pos: Beim Umsortieren ändert sich nur, was bewegt wurde (assignPositions).
 * Das gewählte Szenario und die Auswahl im Vergleich bleiben auf jedem Gerät, wie sie sind.
 * Zahlungen, deren Kategorie es nach dem Abgleich nicht mehr gibt, fallen weg.
 */
'use strict';

const SYNC = (() => {
    const CORE = SYNC_CORE;

    /* ── Reihenfolge (wie im Zeitfresser) ── */

    /** Längste schon aufsteigende Folge (Indizes) – diese Einträge behalten ihre Position. */
    function keepers(list) {
        const tails = [], prev = [];
        list.forEach((x, i) => {
            if (!Number.isFinite(x.pos)) return;
            let lo = 0, hi = tails.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (list[tails[mid]].pos < x.pos) lo = mid + 1; else hi = mid;
            }
            prev[i] = lo ? tails[lo - 1] : -1;
            tails[lo] = i;
        });
        const out = [];
        for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.push(i);
        return out.reverse();
    }

    /** Vergibt pos passend zur Reihenfolge der Liste und ändert dabei so wenige wie möglich. */
    function assignPositions(list) {
        const keep = keepers(list);
        let from = -1;
        keep.concat(list.length).forEach(to => {
            const lo = from >= 0 ? list[from].pos : null;
            const hi = to < list.length ? list[to].pos : null;
            const m = to - from - 1;
            for (let k = 0; k < m; k++) {
                list[from + 1 + k].pos = lo != null && hi != null ? lo + (hi - lo) * (k + 1) / (m + 1)
                    : lo != null ? lo + k + 1 : hi != null ? hi - m + k : k + 1;
            }
            from = to;
        });
        // Zwischen zwei Positionen ist irgendwann kein Platz mehr: neu durchzählen.
        if (list.some((x, i) => i && !(x.pos > list[i - 1].pos))) list.forEach((x, i) => { x.pos = i + 1; });
    }

    function assignAll(st) {
        assignPositions(st.categories);
        assignPositions(st.scenarios);
        st.scenarios.forEach(sc => assignPositions(sc.payments));
        return st;
    }

    function byPos(a, b) { return (a.pos || 0) - (b.pos || 0) || (a.id < b.id ? -1 : 1); }

    /* ── Umwandeln ── */

    function plain(st) {
        return {
            categories: st.categories.map(c => ({ id: c.id, name: c.name, colorSlot: c.colorSlot, kind: c.kind, pos: c.pos })),
            scenarios: st.scenarios.map(sc => ({
                id: sc.id, name: sc.name, pos: sc.pos,
                payments: sc.payments.map(p => ({ id: p.id, categoryId: p.categoryId, name: p.name, value: [p.amount, p.interval], pos: p.pos }))
            }))
        };
    }

    /** Flache Daten (auch von außen) → Speicher. old: woher gewähltes Szenario und Vergleich kommen. */
    function toStore(data, old) {
        const categories = (Array.isArray(data.categories) ? data.categories : []).filter(CORE.isObj)
            .map(sanitizeCategory).filter(Boolean).sort(byPos);
        const catIds = new Set(categories.map(c => c.id));
        const scenarios = (Array.isArray(data.scenarios) ? data.scenarios : []).filter(CORE.isObj).map(sc => {
            const payments = (Array.isArray(sc.payments) ? sc.payments : []).filter(CORE.isObj).map(p => ({
                id: p.id, categoryId: p.categoryId, name: p.name, pos: p.pos,
                amount: Array.isArray(p.value) ? p.value[0] : 0,
                interval: Array.isArray(p.value) ? p.value[1] : 'month'
            }));
            const out = sanitizeScenario({ id: sc.id, name: sc.name, pos: sc.pos, payments: payments }, catIds);
            out.payments.sort(byPos);
            return out;
        }).sort(byPos);
        if (!scenarios.length) scenarios.push(createScenario('Neues Szenario'));

        const st = {
            version: 1,
            activeId: old && scenarios.some(s => s.id === old.activeId) ? old.activeId : scenarios[0].id,
            compare: old && old.compare ? { a: old.compare.a, b: old.compare.b } : {},
            categories: categories,
            scenarios: scenarios
        };
        ensureCompare(st);
        return assignAll(st);
    }

    /* ── Gleiches mit verschiedenen Kennungen ── */

    function catKey(c) { return c.kind + ':' + String(c.name).trim().toLowerCase(); }

    /** Inhalt eines Szenarios ohne Kennungen (Kategorien über Name und Art). */
    function signature(sc, cats) {
        const byId = CORE.byId(cats);
        return JSON.stringify([sc.name].concat(sc.payments.slice().sort(byPos).map(p =>
            [byId[p.categoryId] ? catKey(byId[p.categoryId]) : '', p.name, p.value])));
    }

    function storeSignature(d) {
        return JSON.stringify([d.categories.slice().sort(byPos).map(c => [catKey(c), c.colorSlot]),
            d.scenarios.slice().sort(byPos).map(sc => signature(sc, d.categories))]);
    }

    function exampleSignature() {
        return storeSignature(plain(assignAll(createExampleStore())));
    }

    /** Noch nichts Eigenes: nur das unveränderte Beispiel oder gar nichts eingetragen? */
    function pristine(d) {
        if (storeSignature(d) === exampleSignature()) return true;
        return !d.categories.length && d.scenarios.every(sc => !sc.payments.length && /^Neues Szenario( \d+)?$/.test(sc.name));
    }

    /** { Kennung in b: Kennung in a } für Kategorien mit gleichem Namen und gleicher Art
     *  sowie Szenarien mit genau gleichem Inhalt (deren Zahlungen der Reihe nach). */
    function alias(a, b) {
        const map = {};
        const catsA = CORE.byId(a.categories), catsB = CORE.byId(b.categories);
        const freeCats = a.categories.filter(c => !catsB[c.id]);
        b.categories.forEach(y => {
            if (catsA[y.id]) return;
            const i = freeCats.findIndex(x => catKey(x) === catKey(y));
            if (i >= 0) map[y.id] = freeCats.splice(i, 1)[0].id;
        });

        const scA = CORE.byId(a.scenarios), scB = CORE.byId(b.scenarios);
        const free = a.scenarios.filter(s => !scB[s.id]);
        b.scenarios.forEach(y => {
            if (scA[y.id]) return;
            const sig = signature(y, b.categories), i = free.findIndex(x => signature(x, a.categories) === sig);
            if (i < 0) return;
            const x = free.splice(i, 1)[0];
            const px = x.payments.slice().sort(byPos), py = y.payments.slice().sort(byPos);
            map[y.id] = x.id;
            py.forEach((p, k) => { map[p.id] = px[k].id; });
        });
        return map;
    }

    /** Führt zwei Stände { data, stamps } zusammen, siehe mergeFields in sync-core.js. */
    function merge(A, B) {
        const a = CORE.copy(A.data);
        let b = CORE.copy(B.data);
        if (pristine(a) || pristine(b)) {
            const one = pristine(a) && !pristine(b) ? B : A;
            return { data: CORE.copy(one.data), stamps: Object.assign({}, one.stamps) };
        }
        const map = alias(a, b);
        b = CORE.remap(b, map);
        const sb = CORE.remapStamps(B.stamps, map);
        const out = CORE.mergeFields(a, A.stamps, b, sb);
        return { data: plain(toStore(out.data)), stamps: out.stamps };
    }

    /** Was sich ändert, zum Anzeigen: { added, changed, removed } mit Namen, oder null. */
    function diff(before, after) {
        // Gleichnamige Kategorien und gleiche Szenarien mit anderer Kennung sind dasselbe.
        after = CORE.remap(after, alias(before, after));
        const s = CORE.diffList('Szenarien', before.scenarios, after.scenarios, sc => 'Szenario „' + (sc.name.trim() || 'Ohne Namen') + '“');
        const c = CORE.diffList('Kategorien', before.categories, after.categories, cat => 'Kategorie „' + (cat.name.trim() || 'Ohne Namen') + '“');
        const d = { added: s.added.concat(c.added), changed: s.changed.concat(c.changed), removed: s.removed.concat(c.removed) };
        return d.added.length || d.changed.length || d.removed.length ? d : null;
    }

    return { assignAll, plain, toStore, stamp: CORE.stamp, cleanStamps: CORE.cleanStamps, pristine, merge, diff };
})();
