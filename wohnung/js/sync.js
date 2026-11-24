/* Wohnung – Abgleich zweier Datenstände (ohne Oberfläche und ohne Netz).
   Jede Änderung bekommt beim Speichern einen Zeitstempel je Feld:
   stamps = { 'flats/<id>/coldRent': ms, … }. Eine Liste mit Kennungen zählt als
   Sammlung; ein Stempel auf etwas, das es nicht mehr gibt, heißt „damals gelöscht“.
   Beim Abgleich gewinnt je Feld der neuere Stand, deshalb können beide Seiten
   verschiedene Felder derselben Wohnung geändert haben. */
var SYNC = (function () {
    'use strict';

    // Wird in app.js (syncPersons) immer aus den Personen abgeleitet.
    var DERIVED = ['persons', 'personRents', 'personIncludes', 'personNames', 'ownMax'];
    var MAX_AHEAD = 24 * 60 * 60 * 1000;

    function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
    function isEmpty(x) { return x === null || x === undefined || x === ''; }
    function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    function copy(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
    function keys(o) { return Object.keys(o).filter(function (k) { return k !== '__proto__'; }); }

    /** Reine Daten: ohne alles, was sich ohnehin aus dem Rest ergibt. */
    function plain(data) {
        var d = copy({ profile: data.profile, people: data.people, wishes: data.wishes, flats: data.flats });
        DERIVED.forEach(function (k) { delete d.profile[k]; });
        d.flats.forEach(function (f) { f.wg.rooms.forEach(function (r) { delete r.self; }); });
        return d;
    }

    function kind(x) {
        if (Array.isArray(x)) return x.every(function (i) { return isObj(i) && i.id !== undefined; }) ? 'list' : 'leaf';
        return isObj(x) ? 'map' : 'leaf';
    }

    function byId(list) {
        var out = {};
        list.forEach(function (x) { out[x.id] = x; });
        return out;
    }

    function join(path, key) { return (path ? path + '/' : '') + encodeURIComponent(key); }

    /** Liegt p an oder unter path? */
    function within(p, path) { return p === path || p.indexOf(path + '/') === 0; }

    /** Gleich, unabhängig von der Reihenfolge der Felder; fehlend = undefined. */
    function same(a, b) {
        if (a === b) return true;
        if (Array.isArray(a) && Array.isArray(b)) {
            return a.length === b.length && a.every(function (x, i) { return same(x, b[i]); });
        }
        if (!isObj(a) || !isObj(b)) return false;
        return keys(a).concat(keys(b)).every(function (k) { return same(a[k], b[k]); });
    }

    function drop(stamps, path) {
        Object.keys(stamps).forEach(function (p) { if (within(p, path)) delete stamps[p]; });
    }

    /** Trägt in stamps ein, was sich von before zu after geändert hat. */
    function stamp(before, after, stamps, now) {
        function mark(path, old) { stamps[path] = Math.max(now, (old || 0) + 1); }
        function walk(a, b, path) {
            if (same(a, b)) return;
            var old = stamps[path];
            if (a === undefined) { mark(path, old); return; }
            var k = kind(a);
            if (b === undefined || k === 'leaf' || k !== kind(b)) {
                drop(stamps, path);
                mark(path, old);
                return;
            }
            var x = k === 'list' ? byId(a) : a, y = k === 'list' ? byId(b) : b;
            keys(Object.assign({}, x, y)).forEach(function (id) { walk(x[id], y[id], join(path, id)); });
        }
        walk(before, after, '');
        return stamps;
    }

    /** Stempel von außen: nur Zahlen, keine aus der fernen Zukunft. */
    function cleanStamps(raw, now) {
        var out = {}, max = (now || Date.now()) + MAX_AHEAD;
        if (isObj(raw)) keys(raw).forEach(function (p) {
            var t = raw[p];
            if (typeof t === 'number' && isFinite(t) && t > 0) out[p] = Math.min(t, max);
        });
        return out;
    }

    /** Neuester Stempel an oder unter path. */
    function latest(stamps, path, inherited) {
        return Object.keys(stamps).reduce(function (m, p) {
            return within(p, path) ? Math.max(m, stamps[p]) : m;
        }, inherited || 0);
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

    function rename(map, id) {
        if (has(map, id)) return map[id];
        // Zusammengesetzte Kennung "<Wunsch>-<Person>" (taskId in app.js)
        return String(id).split('-').map(function (x) { return has(map, x) ? map[x] : x; }).join('-');
    }

    /** Feldnamen und Kennungen umbenennen; freie Texte bleiben unberührt. */
    function remap(x, map) {
        if (Array.isArray(x)) return x.map(function (i) { return remap(i, map); });
        if (isObj(x)) {
            var out = {};
            keys(x).forEach(function (k) { out[rename(map, k)] = remap(x[k], map); });
            return out;
        }
        return typeof x === 'string' && has(map, x) ? map[x] : x;
    }

    function remapStamps(stamps, map) {
        var out = {};
        Object.keys(stamps).forEach(function (p) {
            var q = p.split('/').map(function (s) { return encodeURIComponent(rename(map, decodeURIComponent(s))); }).join('/');
            out[q] = Math.max(out[q] || 0, stamps[p]);
        });
        return out;
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
        b = remap(b, map);
        sb = remapStamps(sb, map);
        trimPeople(b, a);
        trimLists(b, a);
        if (a.people.every(blankPerson)) trimPeople(a, b);

        var stamps = Object.assign({}, sa);
        Object.keys(sb).forEach(function (p) { stamps[p] = Math.max(stamps[p] || 0, sb[p]); });

        function oneSided(value, own, other, path, inherited) {
            if (!other[path] || other[path] < latest(own, path, inherited)) return value;
            var t = stamps[path];
            drop(stamps, path);
            stamps[path] = t;
            return undefined;
        }

        function walk(x, y, path, ix, iy) {
            if (y === undefined) return x === undefined ? undefined : oneSided(x, sa, sb, path, ix);
            if (x === undefined) return oneSided(y, sb, sa, path, iy);
            // Ein Stempel auf der ganzen Wohnung (angelegt) gilt auch für ihre Felder.
            ix = Math.max(ix, sa[path] || 0);
            iy = Math.max(iy, sb[path] || 0);
            var k = kind(x);
            if (k === 'leaf' || k !== kind(y)) {
                if (same(x, y)) return x;
                var tx = latest(sa, path, ix), ty = latest(sb, path, iy);
                return ty > tx || (ty === tx && isEmpty(x)) ? y : x;
            }
            var mx = k === 'list' ? byId(x) : x, my = k === 'list' ? byId(y) : y, out = k === 'list' ? [] : {};
            keys(mx).concat(keys(my).filter(function (id) { return !has(mx, id); })).forEach(function (id) {
                var v = walk(mx[id], my[id], join(path, id), ix, iy);
                if (v === undefined) return;
                if (k === 'list') out.push(v); else out[id] = v;
            });
            return out;
        }

        return { data: walk(a, b, '', 0, 0), stamps: stamps };
    }

    /** Was sich ändert, zum Anzeigen: [{ label, added, changed, removed }] mit Namen;
     *  Finanzierung und Nebenkosten nur als Ganzes. */
    function diff(before, after) {
        function list(label, key, name) {
            var x = byId(before[key]), y = byId(after[key]), out = { label: label, added: [], changed: [], removed: [] };
            after[key].forEach(function (e, i) {
                if (!has(x, e.id)) out.added.push(name(e, i));
                else if (!same(x[e.id], e)) out.changed.push(name(e, i));
            });
            before[key].forEach(function (e, i) { if (!has(y, e.id)) out.removed.push(name(e, i)); });
            return out;
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

    return { plain: plain, stamp: stamp, cleanStamps: cleanStamps, pristine: pristine, merge: merge, diff: diff };
})();
