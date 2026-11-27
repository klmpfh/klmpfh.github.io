/* Abgleich zweier Datenstände, gemeinsamer Kern für Wohnung, Zeitfresser und Geldkugel
   (ohne Oberfläche und ohne Netz).
   Jede Änderung bekommt beim Speichern einen Zeitstempel je Feld:
   stamps = { 'flats/<id>/coldRent': ms, … }. Eine Liste mit Kennungen zählt als
   Sammlung, jede andere Liste als ein Wert; ein Stempel auf etwas, das es nicht mehr
   gibt, heißt „damals gelöscht“. Beim Abgleich gewinnt je Feld der neuere Stand,
   deshalb können beide Seiten verschiedene Felder desselben Eintrags geändert haben. */
var SYNC_CORE = (function () {
    'use strict';

    var MAX_AHEAD = 24 * 60 * 60 * 1000;

    function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
    function isEmpty(x) { return x === null || x === undefined || x === ''; }
    function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    function copy(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
    function keys(o) { return Object.keys(o).filter(function (k) { return k !== '__proto__'; }); }

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

    /* ---------- Umbenennen: map = { alte Kennung: neue Kennung } ---------- */

    function rename(map, id) {
        if (has(map, id)) return map[id];
        // Zusammengesetzte Kennung "<Kennung>-<Kennung>" (z. B. taskId in wohnung/js/app.js)
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

    /** Führt zwei Stände (Daten a, b mit Stempeln sa, sb) zusammen. Je Feld gewinnt der
     *  neuere; bei gleichem Stempel der ausgefüllte, sonst a. Was gelöscht wurde, bleibt
     *  gelöscht, außer die andere Seite hat es danach noch geändert. */
    function mergeFields(a, sa, b, sb) {
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
            // Ein Stempel auf dem ganzen Eintrag (angelegt) gilt auch für seine Felder.
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

    /** Was sich an einer Liste mit Kennungen ändert: { label, added, changed, removed } mit Namen. */
    function diffList(label, before, after, name) {
        var x = byId(before), y = byId(after), out = { label: label, added: [], changed: [], removed: [] };
        after.forEach(function (e, i) {
            if (!has(x, e.id)) out.added.push(name(e, i));
            else if (!same(x[e.id], e)) out.changed.push(name(e, i));
        });
        before.forEach(function (e, i) { if (!has(y, e.id)) out.removed.push(name(e, i)); });
        return out;
    }

    return { isObj: isObj, isEmpty: isEmpty, has: has, copy: copy, keys: keys, byId: byId, same: same, stamp: stamp,
        cleanStamps: cleanStamps, remap: remap, remapStamps: remapStamps, mergeFields: mergeFields, diffList: diffList };
})();
