/* Wohnung – Abgleich zweier Datenstände (ohne Oberfläche und ohne Netz).
   Zeitstempel je Feld und das Zusammenführen stehen in assets/js/sync-core.js, hier
   steht, was an den Wohnungsdaten besonders ist. */
var SYNC = (function () {
    'use strict';

    // Wird in app.js (syncPersons) immer aus den Personen abgeleitet.
    var DERIVED = ['persons', 'personRents', 'personIncludes', 'personNames', 'ownMax', 'meName'];

    var CORE = SYNC_CORE;
    var isObj = CORE.isObj, isEmpty = CORE.isEmpty, has = CORE.has, copy = CORE.copy, keys = CORE.keys, byId = CORE.byId, same = CORE.same;

    /** Reine Daten: ohne alles, was sich ohnehin aus dem Rest ergibt. */
    function plain(data) {
        var d = copy({ profile: data.profile, people: data.people, wishes: data.wishes, flats: data.flats });
        DERIVED.forEach(function (k) { delete d.profile[k]; });
        d.flats.forEach(function (f) { f.wg.rooms.forEach(function (r) { delete r.self; }); });
        return d;
    }

    /* ---------- Gleiches mit verschiedenen Kennungen ----------
       Zwei Geräte, die unabhängig voneinander angefangen haben, kennen dieselbe
       Person oder denselben Posten unter verschiedenen Kennungen. */

    function norm(s) { return String(s || '').trim().toLowerCase(); }

    function blankPerson(p) { return !norm(p.name) && isEmpty(p.rent) && !p.places.length; }

    /** Noch nichts eingetragen, nur die Vorgaben der Seite? */
    function pristine(d) {
        return !d.flats.length && !d.wishes.some(function (w) { return norm(w.text); }) && d.people.every(blankPerson) &&
            d.profile.privateCosts.every(function (c) { return isEmpty(c.amount); }) &&
            ['equity', 'bankMaxLoan', 'bankMaxRate', 'state'].every(function (k) { return isEmpty(d.profile[k]); });
    }

    /** { Kennung in b: Kennung in a } für alles, was a unter anderer Kennung kennt. */
    function alias(a, b) {
        var map = {};
        function match(listA, listB, key) {
            var knownA = byId(listA), knownB = byId(listB), taken = {};
            Object.keys(map).forEach(function (id) { taken[map[id]] = true; });
            var free = listA.filter(function (x) { return !knownB[x.id] && !taken[x.id]; });
            listB.forEach(function (y) {
                if (knownA[y.id] || map[y.id]) return;
                var k = key(y), i = k === null ? -1 : free.findIndex(function (x) { return key(x) === k; });
                if (i !== -1) map[y.id] = free.splice(i, 1)[0].id;
            });
        }
        function text(field) { return function (x) { return norm(x[field]) || null; }; }
        match(a.people, b.people, text('name'));
        match(a.people, b.people, function (p) { return norm(p.name) ? null : 'ohne Namen'; });
        match(a.profile.privateCosts, b.profile.privateCosts, function (c) { return c.heat ? 'heat:' : norm(c.name) || null; });
        match(a.wishes, b.wishes, text('text'));
        b.people.forEach(function (q) {
            var p = a.people.find(function (x) { return x.id === (map[q.id] || q.id); });
            if (p) match(p.places, q.places, text('name'));
        });
        return map;
    }

    /** Leere Vorgaben aus d, die other nicht kennt, fallen weg (sonst gäbe es sie doppelt). */
    function trimPeople(d, other) {
        var known = byId(other.people);
        function used(p) {
            return d.wishes.some(function (w) { return !isEmpty(w.weights[p.id]); }) ||
                d.flats.some(function (f) { return keys(f.ratings).some(function (w) { return !isEmpty(f.ratings[w][p.id]); }); });
        }
        d.people = d.people.filter(function (p) { return known[p.id] || !blankPerson(p) || used(p); });
    }

    function trimLists(d, other) {
        var costs = byId(other.profile.privateCosts), wishes = byId(other.wishes);
        d.profile.privateCosts = d.profile.privateCosts.filter(function (c) { return costs[c.id] || !isEmpty(c.amount); });
        d.wishes = d.wishes.filter(function (w) { return wishes[w.id] || norm(w.text); });
    }

    /** Führt zwei Stände { data, stamps } zusammen. Je Feld gewinnt der neuere; bei
     *  gleichem Stempel der ausgefüllte, sonst A. Was gelöscht wurde, bleibt
     *  gelöscht, außer die andere Seite hat es danach noch geändert. */
    function merge(A, B) {
        var a = copy(A.data), b = copy(B.data), sa = A.stamps, sb = B.stamps;
        if (pristine(a) || pristine(b)) {
            var one = pristine(a) && !pristine(b) ? B : A;
            return { data: copy(one.data), stamps: Object.assign({}, one.stamps) };
        }
        var map = alias(a, b);
        b = CORE.remap(b, map);
        sb = CORE.remapStamps(sb, map);
        trimPeople(b, a);
        trimLists(b, a);
        if (a.people.every(blankPerson)) trimPeople(a, b);
        return CORE.mergeFields(a, sa, b, sb);
    }

    /** Koordinaten folgen aus der Adresse und sind für sich keine Änderung, die man sehen will. */
    function withoutGeo(data) {
        var d = copy(data);
        d.flats.forEach(function (f) { delete f.geo; });
        d.people.forEach(function (p) { p.places.forEach(function (x) { delete x.geo; }); });
        return d;
    }

    /** Was sich ändert, zum Anzeigen: [{ label, added, changed, removed }] mit Namen;
     *  Finanzierung und Nebenkosten nur als Ganzes. */
    function diff(before, after) {
        before = withoutGeo(before);
        after = withoutGeo(after);
        function list(label, key, name) {
            return CORE.diffList(label, before[key], after[key], name);
        }
        function whole(label, get) {
            return { label: label, whole: true, added: [], changed: same(get(before), get(after)) ? [] : [label], removed: [] };
        }
        return [
            list('Wohnungen', 'flats', function (f) { return f.name || 'Ohne Namen'; }),
            list('Personen', 'people', function (p, i) { return norm(p.name) ? p.name.trim() : 'Person ' + (i + 1); }),
            list('Wünsche', 'wishes', function (w) { return norm(w.text) ? w.text.trim() : 'ohne Text'; }),
            whole('Finanzierung', function (d) { return Object.assign({}, d.profile, { privateCosts: null }); }),
            whole('Private Nebenkosten', function (d) { return d.profile.privateCosts; })
        ].filter(function (d) { return d.added.length || d.changed.length || d.removed.length; });
    }

    return { plain: plain, stamp: CORE.stamp, cleanStamps: CORE.cleanStamps, pristine: pristine, merge: merge, diff: diff };
})();
