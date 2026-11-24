/* Zeitfresser – Abgleich zweier Datenstände (ohne Oberfläche und ohne Netz).
 *
 * Zeitstempel je Feld und das Zusammenführen stehen in assets/js/sync-core.js.
 * Abgeglichen wird eine flache Form der Szenarien (plain):
 *   { scenarios: [{ id, name, hoursPerDay, pos,
 *                   nodes: [{ id, name, value: [amount, per], days, colorSlot, parent, pos }] }] }
 *  - value: Wert und Einheit gehören zusammen, es gewinnt immer das ganze Paar.
 *  - parent ('' = Thema) und pos: So bleibt ein Punkt derselbe, wenn er in ein anderes
 *    Thema wandert, und beim Umsortieren ändert sich nur, was bewegt wurde (assignPositions).
 * Auf- und Zugeklapptes und das gewählte Szenario bleiben auf jedem Gerät, wie sie sind.
 */
'use strict';

const SYNC = (() => {
    const CORE = SYNC_CORE;

    /* ── Reihenfolge ── */

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
        assignPositions(st.scenarios);
        st.scenarios.forEach(sc => {
            assignPositions(sc.nodes);
            sc.nodes.forEach(n => assignPositions(n.children));
        });
        return st;
    }

    function byPos(a, b) { return a.pos - b.pos || (a.id < b.id ? -1 : 1); }

    /* ── Umwandeln ── */

    function plain(st) {
        return {
            scenarios: st.scenarios.map(sc => {
                const nodes = [];
                walk(sc.nodes, (n, depth, parent) => nodes.push({
                    id: n.id, name: n.name, value: [n.amount, n.per], days: n.days.slice(), colorSlot: n.colorSlot,
                    parent: parent ? parent.id : '', pos: n.pos
                }));
                return { id: sc.id, name: sc.name, hoursPerDay: sc.hoursPerDay, pos: sc.pos, nodes: nodes };
            })
        };
    }

    /** Flache Daten (auch von außen) → Speicher. old: woher Ansicht und gewähltes Szenario kommen. */
    function toStore(data, old) {
        const collapsed = {};
        if (old) old.scenarios.forEach(sc => sc.nodes.forEach(n => { if (n.collapsed) collapsed[n.id] = true; }));

        function nested(sc) {
            const raw = (Array.isArray(sc.nodes) ? sc.nodes : []).filter(CORE.isObj);
            const nodes = raw.map(n => sanitizeNode({
                id: n.id, name: n.name, amount: Array.isArray(n.value) ? n.value[0] : 0, per: Array.isArray(n.value) ? n.value[1] : 'week',
                days: n.days, colorSlot: n.colorSlot, pos: n.pos, collapsed: collapsed[n.id]
            }));
            const known = CORE.byId(nodes), tops = [];
            const parentOf = {};
            raw.forEach((n, i) => { parentOf[nodes[i].id] = n.parent; });
            const isTop = id => !Object.prototype.hasOwnProperty.call(known, parentOf[id]);
            nodes.forEach(n => {
                // Höchstens zwei Ebenen; wessen Thema es nicht mehr gibt, wird selbst eines.
                const p = isTop(n.id) ? null : known[parentOf[n.id]];
                if (p && p !== n && isTop(p.id)) p.children.push(n); else tops.push(n);
            });
            tops.sort(byPos).forEach(t => t.children.sort(byPos).forEach(c => {
                c.days = c.days.map((d, i) => d && t.days[i]);
            }));
            return Object.assign(sanitizeScenario({ id: sc.id, name: sc.name, hoursPerDay: sc.hoursPerDay, pos: sc.pos }), { nodes: tops });
        }

        const scenarios = data.scenarios.filter(CORE.isObj).map(nested).sort(byPos);
        if (!scenarios.length) scenarios.push(createScenario('Neues Szenario'));
        const activeId = old && scenarios.some(s => s.id === old.activeId) ? old.activeId : scenarios[0].id;
        return assignAll({ version: 1, activeId: activeId, scenarios: scenarios });
    }

    /* ── Gleiches mit verschiedenen Kennungen ── */

    function ordered(sc) {
        const kids = id => sc.nodes.filter(n => n.parent === id).sort(byPos);
        return kids('').reduce((out, t) => out.concat(t, kids(t.id)), []);
    }

    /** Inhalt eines Szenarios ohne Kennungen. */
    function signature(sc) {
        return JSON.stringify([sc.name, sc.hoursPerDay].concat(ordered(sc).map(n => [n.parent ? 1 : 0, n.name, n.value, n.days, n.parent ? 0 : n.colorSlot])));
    }

    function exampleSignature() {
        return signature(plain(assignAll({ scenarios: [createExampleScenario()] })).scenarios[0]);
    }

    /** Noch nichts Eigenes: nur das unveränderte Beispiel oder leere neue Szenarien? */
    function pristine(d) {
        const example = exampleSignature();
        return d.scenarios.every(sc => signature(sc) === example || (!sc.nodes.length && /^Neues Szenario( \d+)?$/.test(sc.name)));
    }

    /** { Kennung in b: Kennung in a } für Szenarien, die beide mit genau gleichem Inhalt haben. */
    function alias(a, b) {
        const map = {}, knownA = CORE.byId(a.scenarios), knownB = CORE.byId(b.scenarios);
        const free = a.scenarios.filter(s => !knownB[s.id]);
        b.scenarios.forEach(y => {
            if (knownA[y.id]) return;
            const sig = signature(y), i = free.findIndex(x => signature(x) === sig);
            if (i < 0) return;
            const x = free.splice(i, 1)[0], nodes = ordered(x);
            map[y.id] = x.id;
            ordered(y).forEach((n, k) => { map[n.id] = nodes[k].id; });
        });
        return map;
    }

    /** Das unveränderte Beispiel fällt weg, wenn die andere Seite es nicht (mehr) hat. */
    function trimExample(d, other) {
        const known = CORE.byId(other.scenarios), example = exampleSignature();
        d.scenarios = d.scenarios.filter(sc => known[sc.id] || signature(sc) !== example);
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
        const fullA = { scenarios: a.scenarios };
        trimExample(a, b);
        trimExample(b, fullA);
        const out = CORE.mergeFields(a, A.stamps, b, sb);
        return { data: plain(toStore(out.data)), stamps: out.stamps };
    }

    /** Was sich ändert, zum Anzeigen: { added, changed, removed } mit Namen, oder null. */
    function diff(before, after) {
        const d = CORE.diffList('Szenarien', before.scenarios, after.scenarios, sc => sc.name.trim() || 'Ohne Namen');
        return d.added.length || d.changed.length || d.removed.length ? d : null;
    }

    return { assignAll, plain, toStore, stamp: CORE.stamp, cleanStamps: CORE.cleanStamps, pristine, merge, diff };
})();
