/* Wohnung – Adressen auf der Karte finden (ohne Oberfläche).
   Sucht bei Photon (photon.komoot.io, Daten von OpenStreetMap), höchstens eine Anfrage
   pro Sekunde. Photon verzeiht Tippfehler und liefert dafür auch Unpassendes – was davon
   zur Adresse passt, entscheidet judge(). Treffer: { lat, lon, acc, label } mit
   acc 'house' (genau), 'street' oder 'area' (nur Stadtteil, Ort oder Postleitzahl).
   Gespeichert wird ein Treffer als ein Wert [Adresse, lat, lon, acc, label] (pack), damit
   der Abgleich ihn nie mit einem anderen vermischt. Er gilt nur für genau diese Adresse. */
var GEO = (function () {
    'use strict';

    var SERVICE = 'https://photon.komoot.io/';
    var PAUSE = 1100;      // ms zwischen zwei Anfragen
    var TIMEOUT = 12000;

    /* ---------- Adresse zerlegen ---------- */

    function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

    var FLOOR = /^(\d+\.?\s*)?(og|eg|ug|dg|etage|stock|obergeschoss|erdgeschoss|dachgeschoss|whg\.?.*|wohnung.*)$/i;
    var STREET = /(stra(ß|ss)e|str\.?|weg|allee|platz|gasse|ring|ufer|damm|chaussee|pfad|steig|promenade)$/i;
    var WITH_NUMBER = /^(.*[^\d\s].*?)\s+(\d+\s?[a-z]?(?:\s?[-–+\/]\s?\d+\s?[a-z]?)?)$/i;

    /** 'Musterstraße 12, 12345 Musterstadt (Nordstadt)' →
     *  { street, number, plz, city, areas: ['Nordstadt'], text: ohne Klammern und Etage } */
    function parse(address) {
        var a = { street: '', number: '', plz: '', city: '', areas: [], text: '' }, inner = [];
        var main = clean(address).replace(/\(([^)]*)\)/g, function (m, x) {
            inner = inner.concat(x.split(',').map(clean).filter(Boolean));
            return ' ';
        });
        var parts = main.split(/[,;·|]/).map(clean).filter(function (x) { return x && !FLOOR.test(x); });
        a.text = parts.join(', ');
        var rest = [];
        parts.forEach(function (x) {
            var zip = a.plz ? null : x.match(/^(.*?)\b(?:D[- ])?(\d{5})\b\s*(.*)$/);
            if (!zip) { rest.push(x); return; }
            a.plz = zip[2];
            a.city = clean(zip[3]);
            if (clean(zip[1])) rest.push(clean(zip[1]));
        });
        rest = rest.filter(function (x) {
            var num = a.street ? null : x.match(WITH_NUMBER) || x.match(/^()(d+[a-z]?)s+(D.*)$/i);
            if (!num) return true;
            a.street = num[1] || num[3];
            a.number = num[2].replace(/\s/g, '').replace('–', '-');
            return false;
        });
        rest = rest.filter(function (x) {
            if (a.street || !STREET.test(x)) return true;
            a.street = x;
            return false;
        });
        if (!a.city && rest.length) a.city = rest.pop();
        a.areas = rest.concat(inner);
        return a;
    }

    /* ---------- Treffer beurteilen ---------- */

    function norm(s) {
        return clean(s).toLowerCase().replace(/stra(ß|ss)e/g, 'str').replace(/ß/g, 'ss')
            .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9]/g, '');
    }

    function alike(a, b) {
        a = norm(a); b = norm(b);
        return !!a && !!b && (a === b || (Math.min(a.length, b.length) > 4 && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)));
    }

    /** Dieselbe Hausnummer, auch in "8-14" oder "8;10". */
    function sameNumber(want, have) {
        var w = norm(want.split(/[-+\/]/)[0]), num = parseInt(w, 10);
        return clean(have).split(/[,;\/]/).some(function (h) {
            var range = h.match(/^\s*(\d+)\s*[a-z]?\s*[-–]\s*(\d+)/i);
            return norm(h) === w || (range && num >= Number(range[1]) && num <= Number(range[2]));
        });
    }

    /** Liegt der Treffer im richtigen Ort? 2 = gleiche Postleitzahl, 1 = gleicher Ort
     *  oder keiner angegeben, 0 = nein. */
    function inTown(a, p) {
        if (a.plz && p.postcode === a.plz) return 2;
        if (!a.city) return a.plz ? 0 : 1;
        var names = [p.city, p.type === 'city' ? p.name : '', p.district, p.locality, p.county, p.state];
        return names.some(function (x) { return alike(x, a.city) || (norm(x) && norm(a.city).indexOf(norm(x)) === 0); }) ? 1 : 0;
    }

    var AREA = ['district', 'city', 'locality', 'county', 'state'];

    /** [Punkte, acc] oder null, wenn der Treffer nicht zur Adresse passt. */
    function judge(a, p) {
        var town = inTown(a, p), isPlz = p.osm_value === 'postcode' && p.name === a.plz;
        if (a.street) {
            if (!town) return null;
            if (p.type === 'street') return alike(p.name, a.street) ? [20 + town, 'street'] : null;
            if (!alike(p.street, a.street)) return null;
            if (!a.number) return [10 + town, 'street'];
            if (!p.housenumber || !sameNumber(a.number, p.housenumber)) return [10 + town, 'street'];
            return [(norm(p.housenumber) === norm(a.number) ? 35 : 30) + town, 'house'];
        }
        var isArea = AREA.indexOf(p.type) !== -1;
        // "Südvorstadt, Leipzig" und "Leipzig Südvorstadt"
        if (isArea && town && a.areas.concat(a.city).some(function (x) { return norm(p.name) && norm(x).replace(norm(p.city), '') === norm(p.name); })) return [10 + town, 'area'];
        if (isPlz) return [9, 'area'];
        if (a.plz) return town === 2 || (town && isArea) ? [(isArea ? 5 : 0) + town, 'area'] : null;   // irgendetwas in dieser Postleitzahl
        if (a.areas.length) return town && isArea ? [3, 'area'] : null;
        // Nur ein Name, z. B. "Leipzig" oder "Hauptbahnhof Leipzig"
        if (isArea) return norm(p.name) === norm(a.city) ? [8, 'area'] : null;
        if (a.areaOnly) return null;
        if (p.name && norm(p.name) === norm(a.city)) return [7, 'house'];
        var words = a.city.split(/\s+/);
        return p.name && p.city && words.length > 1 && words.some(function (w) { return alike(w, p.city); }) &&
            words.some(function (w) { return norm(w).length > 3 && norm(w) !== norm(p.city) && norm(p.name).indexOf(norm(w)) !== -1; }) ? [6, 'house'] : null;
    }

    /** Was gefunden wurde, zum Anzeigen. named: auch der Name, z. B. vom Bahnhof. */
    function label(p, named) {
        var street = clean((p.street || (p.type === 'street' ? p.name : '') || '') + ' ' + (p.housenumber || ''));
        var city = p.city || (p.type === 'city' ? p.name : '') || '';
        var town = clean((p.postcode || (p.osm_value === 'postcode' ? p.name : '') || '') + ' ' + city);
        var name = p.type === 'street' || p.name === city || p.osm_value === 'postcode' ? '' : p.name || '';
        return [named || !street ? name : '', street, p.district !== name ? p.district : '', town].filter(Boolean).join(', ');
    }

    /** Bester Treffer der Antwort oder null. */
    function pick(a, features) {
        var best = null, score = 0;
        (features || []).forEach(function (f) {
            var c = f && f.geometry && f.geometry.coordinates, p = (f && f.properties) || {};
            var s = c && isFinite(c[0]) && isFinite(c[1]) ? judge(a, p) : null;
            if (!s || s[0] <= score) return;
            score = s[0];
            best = { lat: Number(c[1]), lon: Number(c[0]), acc: s[1], label: label(p, !a.street) };
        });
        return best;
    }

    /* ---------- Suche ---------- */

    /** Anfragen der Reihe nach, vom Genauen zum Ungefähren: [Pfad, Parameter, Adresse zum Beurteilen]. */
    function queries(address, near) {
        var a = parse(address), list = [], town = clean(a.plz + ' ' + a.city);
        var area = Object.assign({}, a, { street: '', number: '', areaOnly: true });
        function add(path, params, judged) {
            params = Object.assign({ limit: 10, lang: 'de' }, near && !a.plz ? near : null, params);
            Object.keys(params).forEach(function (k) { if (!params[k]) delete params[k]; });
            list.push([path, params, judged]);
        }
        if (a.street) {
            if (town) add('structured', { countrycode: 'DE', street: a.street, housenumber: a.number, postcode: a.plz, city: a.city.split(' - ')[0] }, a);
            add('api/', { q: clean(a.street + ' ' + a.number) + (town ? ', ' + town : ''), countrycode: 'DE' }, a);
            if (town) add('api/', { q: a.street + ' ' + (a.city || a.plz), countrycode: 'DE', layer: 'street' }, a);
        }
        if (a.street && !a.plz) add('api/', { q: a.text }, a);   // auch außerhalb Deutschlands
        if (town) {
            a.areas.forEach(function (x) { add('api/', { q: x + ', ' + (a.city || a.plz), countrycode: 'DE' }, Object.assign({}, area, { areas: [x] })); });
            add('api/', { q: town, countrycode: 'DE' }, Object.assign({}, area, { areas: [] }));
        }
        if (!a.street || a.plz) add('api/', { q: a.text || clean(address) }, a);
        return list;
    }

    var last = 0;

    function request(path, params) {
        return new Promise(function (done) { setTimeout(done, Math.max(0, last + PAUSE - Date.now())); }).then(function () {
            last = Date.now();
            var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
            return fetch(SERVICE + path + '?' + new URLSearchParams(params), { signal: ctrl.signal, credentials: 'omit' }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).finally(function () { clearTimeout(timer); });
        });
    }

    /** Sucht eine Adresse. near: { lat, lon } aus derselben Gegend, hilft bei Adressen
     *  ohne Postleitzahl. null = nicht gefunden, Fehler = Dienst nicht erreichbar. */
    function find(address, near) {
        var list = queries(address, near);
        return (function next(i) {
            if (i === list.length) return Promise.resolve(null);
            return request(list[i][0], list[i][1]).then(function (data) {
                return pick(list[i][2], data && data.features) || next(i + 1);
            });
        })(0);
    }

    var ACCS = ['house', 'street', 'area'];

    function pack(address, h) {
        function round(v) { return Math.round(v * 1e5) / 1e5; }   // auf etwa einen Meter
        return [clean(address), round(h.lat), round(h.lon), h.acc, h.label];
    }

    /** Treffer aus pack, wenn er zur Adresse passt, sonst null. */
    function unpack(geo, address) {
        geo = valid(geo);
        return geo && geo[0] === clean(address) ? { lat: geo[1], lon: geo[2], acc: geo[3], label: geo[4] } : null;
    }

    /** Gespeicherter Wert von außen: so, wie pack ihn schreibt, sonst null. */
    function valid(geo) {
        return Array.isArray(geo) && geo.length === 5 && typeof geo[0] === 'string' && geo[0] && Math.abs(geo[1]) <= 90 && Math.abs(geo[2]) <= 180 &&
            typeof geo[1] === 'number' && typeof geo[2] === 'number' && ACCS.indexOf(geo[3]) !== -1 && typeof geo[4] === 'string' ? geo : null;
    }

    /** Luftlinie in km. */
    function km(a, b) {
        var rad = Math.PI / 180, x = Math.sin((b.lat - a.lat) * rad / 2), y = Math.sin((b.lon - a.lon) * rad / 2);
        return 12742 * Math.asin(Math.sqrt(x * x + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * y * y));
    }

    return { parse: parse, pick: pick, queries: queries, find: find, pack: pack, unpack: unpack, valid: valid, km: km, key: clean };
})();
