/* Wohnung – Karte der Übersicht: Wohnungen und wichtige Orte der Personen.
   Adressen findet geo.js, das Kartenbild kommt vom deutschen OpenStreetMap-Server,
   Leaflet liegt in vendor/. Ohne Zustimmung und bei eingeklappter Kachel geht nichts ins
   Netz. Zustimmung und gefundene Orte bleiben in diesem Browser (KEY, kein Abgleich). */
var FLATMAP = (function () {
    'use strict';

    var KEY = 'klmpfh-wohnung-karte';   // { on: true, found: { Adresse: Treffer aus GEO.find oder { none, at } } }
    var TILES = 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
    var CREDIT = 'Karte: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a> · Suche: <a href="https://photon.komoot.io/" target="_blank" rel="noopener">Photon</a>';
    var RETRY = 24 * 3600 * 1000;       // nicht Gefundenes frühestens nach einem Tag wieder suchen
    var NEAR_KM = 40;                   // Orte, die weiter weg sind, bestimmen den ersten Ausschnitt nicht mit
    var ACC = { street: 'ohne Hausnummer, nur ungefähr', area: 'nur ungefähr' };

    var store = read();
    var view = null;                    // zuletzt gesehener Ausschnitt, { spots, center, zoom }

    function read() {
        var s = null;
        try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* unlesbar = leer */ }
        s = s && typeof s === 'object' ? s : {};
        return { on: s.on === true, found: s.found && typeof s.found === 'object' ? s.found : {} };
    }

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* gilt dann bis zum Neuladen */ }
    }

    function hit(address) {
        var h = store.found[GEO.key(address)];
        return h && isFinite(h.lat) && isFinite(h.lon) ? h : null;
    }

    /** Schon gesucht (gefunden oder erst kürzlich nicht gefunden)? */
    function known(address) {
        var h = store.found[GEO.key(address)];
        return !!h && (!h.none || Date.now() - h.at < RETRY);
    }

    var leaflet = null;

    function loadLeaflet() {
        return leaflet || (leaflet = new Promise(function (resolve, reject) {
            var css = document.createElement('link'), s = document.createElement('script');
            css.rel = 'stylesheet';
            css.href = 'vendor/leaflet.css';
            document.head.insertBefore(css, document.head.querySelector('link[rel="stylesheet"]'));   // style.css gilt vor
            s.src = 'vendor/leaflet.js';
            s.onload = resolve;
            s.onerror = function () { leaflet = null; s.remove(); css.remove(); reject(new Error('Leaflet nicht ladbar')); };
            document.head.appendChild(s);
        }));
    }

    /** Baut die Karte in box. ui: { el, btn } aus app.js. update(items) mit
     *  { id, kind: 'flat'|'place', mark, title, sub, address, out, href, popup(near) }.
     *  popup bekommt die Entfernungen [{ item, km, rough }] der jeweils anderen Art. */
    function create(box, ui) {
        var el = ui.el, btn = ui.btn;
        var items = [], shown = '', map = null, layer = null, markers = {}, alive = true;
        var searching = null, failed = false, noTiles = false, timer = null, fitted = null;

        var status = el('p', { class: 'small muted map-status', role: 'status' });
        var canvas = el('div', { class: 'flat-map', role: 'region', 'aria-label': 'Karte der Wohnungen und wichtigen Orte' });
        var lists = el('div', { class: 'map-lists' });
        var retryBtn = btn('Erneut suchen', 'btn-ghost btn-small', retry);
        var flatsBtn = btn('Wohnungen zeigen', 'btn-ghost btn-small', function () { fit(false); });
        var allBtn = btn('Alles zeigen', 'btn-ghost btn-small', function () { fit(true); });
        var main = el('div', null, [canvas, status, el('div', { class: 'actions map-actions' }, [flatsBtn, allBtn, retryBtn,
            btn('Karte ausschalten', 'btn-ghost btn-small', function () {
                store = { on: false, found: {} };
                save();
                stop();
                show();
            }, 'Es geht nichts mehr ins Netz, und die gefundenen Orte werden vergessen')]), lists]);
        var ask = el('div', { class: 'map-ask' }, [
            el('p', { class: 'small muted', text: 'Die Karte braucht zwei Dienste im Internet: Um die Wohnungen und die wichtigen Orte der Personen zu finden, gehen deren Adressen an den Suchdienst Photon (komoot), ohne Namen, Bezeichnungen und Beträge. ' +
                'Das Kartenbild kommt von OpenStreetMap, der Server sieht, welchen Ausschnitt du anschaust. Gefundene Orte merkt sich nur dieser Browser.' }),
            el('div', { class: 'actions' }, [btn('Karte anzeigen', 'btn-primary', function () { store.on = true; save(); show(); })])
        ]);
        box.appendChild(ask);
        box.appendChild(main);

        // Auch beim Ausklappen der Kachel
        var sizes = new ResizeObserver(function () { if (map) map.invalidateSize(); run(); });
        sizes.observe(canvas);
        // Orte werden auf derselben Seite bearbeitet: erst suchen, wenn die Adresse fertig ist
        document.addEventListener('focusout', run);

        function typing() { return !!document.activeElement && !!document.activeElement.closest('.place'); }

        function visible() { return alive && store.on && canvas.offsetWidth > 0; }

        function show() {
            ask.hidden = store.on;
            main.hidden = !store.on;
            if (store.on) run();
        }

        function update(next) {
            items = next;
            run();
        }

        function run() {
            clearTimeout(timer);
            if (visible()) timer = setTimeout(work, 300);
        }

        function work() {
            if (!visible()) return;
            draw();
            if (!map && !failed) startMap();
            if (!typing()) search();
        }

        function stop() {
            clearTimeout(timer);
            if (map) {
                view = { spots: fitted, center: map.getCenter(), zoom: map.getZoom() };
                map.remove();
            }
            map = layer = null;
            markers = {};
            shown = '';
            fitted = null;
        }

        function destroy() {
            stop();
            alive = false;
            sizes.disconnect();
            document.removeEventListener('focusout', run);
        }

        /* ---------- Suche ---------- */

        function open() {
            return items.filter(function (x) { return x.address && !known(x.address); });
        }

        /** Sucht eine Adresse nach der anderen, die mit Postleitzahl zuerst. */
        function search() {
            if (searching || failed || !visible() || typing()) return;
            var next = open().sort(function (a, b) { return /\d{5}/.test(b.address) - /\d{5}/.test(a.address); })[0];
            if (!next) { forget(); draw(); return; }
            var key = GEO.key(next.address);
            var near = items.map(function (x) { return x.kind === 'flat' && hit(x.address); }).find(Boolean);
            searching = key;
            draw();
            GEO.find(key, near ? { lat: near.lat, lon: near.lon } : null).then(function (res) {
                if (store.on) store.found[key] = res || { none: true, at: Date.now() };
                save();
            }, function () { failed = true; }).then(function () {
                searching = null;
                if (!alive) return;
                draw();
                search();
            });
        }

        /** Adressen, die es nicht mehr gibt, nicht länger merken. */
        function forget() {
            var used = {}, before = Object.keys(store.found).length;
            items.forEach(function (x) { if (x.address) used[GEO.key(x.address)] = true; });
            Object.keys(store.found).forEach(function (k) { if (!used[k]) delete store.found[k]; });
            if (Object.keys(store.found).length !== before) save();
        }

        function retry() {
            failed = false;
            Object.keys(store.found).forEach(function (k) { if (store.found[k].none) delete store.found[k]; });
            work();
        }

        /* ---------- Karte ---------- */

        function startMap() {
            loadLeaflet().then(function () {
                if (map || !visible()) return;
                map = L.map(canvas, { scrollWheelZoom: false, zoomControl: false }).setView([51.2, 10.4], 5);
                map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
                L.control.zoom({ zoomInTitle: 'Näher heran', zoomOutTitle: 'Weiter weg' }).addTo(map);
                var tiles = L.tileLayer(TILES, { maxZoom: 18, attribution: CREDIT }).addTo(map);
                tiles.on('tileerror', function () { noTiles = true; draw(); });
                tiles.on('tileload', function () { if (noTiles) { noTiles = false; draw(); } });
                // Mausrad erst nach einem Klick in die Karte, sonst bleibt man beim Scrollen hängen
                map.on('click popupopen', function () { map.scrollWheelZoom.enable(); });
                map.on('mouseout', function () { map.scrollWheelZoom.disable(); });
                layer = L.layerGroup().addTo(map);
                shown = '';
                draw();
            }).catch(function () { failed = true; draw(); });
        }

        function located(kind) {
            return items.filter(function (x) { return x.address && hit(x.address) && (!kind || x.kind === kind); });
        }

        function point(x) { var h = hit(x.address); return L.latLng(h.lat, h.lon); }

        /** Ausschnitt: Wohnungen und nahe Orte, mit all alles. */
        function scope(all) {
            var list = located(), flats = located('flat');
            var active = flats.filter(function (x) { return !x.out; });
            if (active.length) flats = active;
            if (all || !flats.length) return list;
            return flats.concat(located('place').filter(function (x) {
                return flats.some(function (f) { return GEO.km(hit(f.address), hit(x.address)) <= NEAR_KM; });
            }));
        }

        function fit(all) {
            var list = map ? scope(all) : [];
            if (list.length) map.fitBounds(L.latLngBounds(list.map(point)), { padding: [40, 40], maxZoom: 15 });
        }

        function badge(x, attrs) {
            return el('span', Object.assign({ class: 'map-mark map-' + x.kind + (x.out ? ' is-out' : '') }, attrs), [el('span', { text: x.mark })]);
        }

        function distances(x) {
            var h = hit(x.address);
            return items.filter(function (y) { return y.kind !== x.kind && !y.out && hit(y.address); }).map(function (y) {
                var g = hit(y.address);
                return { item: y, km: GEO.km(h, g), rough: h.acc === 'area' || g.acc === 'area' };
            }).sort(function (a, b) { return a.km - b.km; });
        }

        function popup(x) {
            var h = hit(x.address);
            return el('div', { class: 'map-popup' }, [x.popup(distances(x)),
                el('p', { class: 'small muted', text: 'Gefunden: ' + h.label + (ACC[h.acc] ? ' (' + ACC[h.acc] + ')' : '') })]);
        }

        function drawMarkers() {
            var openId = Object.keys(markers).find(function (id) { return markers[id].isPopupOpen(); });
            layer.clearLayers();
            markers = {};
            var spots = {};
            located().forEach(function (x) {
                var p = point(x), k = p.lat.toFixed(4) + ',' + p.lng.toFixed(4);
                (spots[k] = spots[k] || []).push(x);
            });
            Object.keys(spots).forEach(function (k) {
                spots[k].forEach(function (x, i) {
                    // Gleicher Ort: nebeneinander statt übereinander
                    var shift = (i - (spots[k].length - 1) / 2) * 28, pin = x.kind === 'flat';
                    var name = x.title + (x.sub ? ', ' + x.sub : '');
                    var m = L.marker(point(x), {
                        icon: L.divIcon({ className: 'map-icon', html: badge(x).outerHTML, iconSize: [30, 30], iconAnchor: [15 - shift, pin ? 36 : 15], popupAnchor: [shift, pin ? -34 : -14], tooltipAnchor: [shift, pin ? -34 : -14] }),
                        zIndexOffset: pin ? (x.out ? 0 : 1000) : 500
                    });
                    m.on('add', function () { m.getElement().setAttribute('aria-label', name); });
                    m.bindTooltip(el('span', { text: x.title }), { direction: 'top' });
                    m.bindPopup(function () { return popup(x); }, {
                        maxWidth: Math.min(260, canvas.clientWidth - 110), autoPanPaddingTopLeft: [52, 10], autoPanPaddingBottomRight: [10, 10]   // neben den Zoomknöpfen
                    });
                    m.addTo(layer);
                    markers[x.kind + x.id] = m;
                });
            });
            if (openId && markers[openId]) markers[openId].openPopup();
        }

        function note(x) {
            if (!x.address) return 'Adresse fehlt';
            var h = hit(x.address);
            if (h) return ACC[h.acc] || '';
            return searching === GEO.key(x.address) || (!known(x.address) && !failed) ? 'wird gesucht …' : failed && !known(x.address) ? 'noch nicht gesucht' : 'Adresse nicht gefunden';
        }

        function drawLists() {
            lists.innerHTML = '';
            [['flat', 'Wohnungen'], ['place', 'Wichtige Orte']].forEach(function (g) {
                var list = items.filter(function (x) { return x.kind === g[0]; });
                lists.appendChild(el('div', null, [el('h3', { class: 'group-title', text: g[1] }),
                    list.length ? el('ul', { class: 'map-list' }, list.map(function (x) {
                        var text = note(x), there = !!(x.address && hit(x.address));
                        var inner = [badge(x, { 'aria-hidden': 'true' }), el('span', null, [
                            el('b', { text: x.title }), x.sub ? el('span', { class: 'muted', text: ' ' + x.sub }) : null,
                            text ? el('span', { class: 'map-note' + (there ? ' muted' : ' warn-text'), text: text }) : null])];
                        return el('li', null, [there
                            ? el('button', { type: 'button', class: 'map-item', title: 'Auf der Karte zeigen', onclick: function () { focusOn(x); } }, inner)
                            : x.href ? el('a', { class: 'map-item', href: x.href }, inner) : el('span', { class: 'map-item' }, inner)]);
                    })) : el('p', { class: 'small muted', text: g[0] === 'flat' ? 'Noch keine Wohnung angelegt.' : 'Noch keine. Trag sie oben unter „Personen“ mit Adresse ein.' })]));
            });
        }

        function focusOn(x) {
            var m = markers[x.kind + x.id];
            if (!m) return;
            canvas.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            map.setView(m.getLatLng(), Math.max(map.getZoom(), 13));
            m.openPopup();
        }

        function draw() {
            if (!visible()) return;
            var key = JSON.stringify([!!map, failed, searching, items.map(function (x) { return [x, x.address ? store.found[GEO.key(x.address)] : 0]; })]);
            var todo = open().length;
            status.textContent = failed ? 'Die Adresssuche oder die Karte ist gerade nicht erreichbar.'
                : todo && !typing() ? (todo === 1 ? 'Eine Adresse wird gesucht …' : todo + ' Adressen werden gesucht …')
                : noTiles ? 'Das Kartenbild lässt sich gerade nicht laden.' : '';
            status.hidden = !status.textContent;
            retryBtn.hidden = !failed && !items.some(function (x) { return x.address && known(x.address) && !hit(x.address); });
            flatsBtn.hidden = !located('flat').length;
            allBtn.hidden = located().length < 2 || scope(false).length === located().length;
            if (key === shown) return;
            shown = key;
            drawLists();
            if (!map) return;
            drawMarkers();
            // Neu ausrichten, sobald sich etwas an den Punkten ändert, sonst so lassen wie zuletzt
            var spots = JSON.stringify(scope(false).map(function (x) { var h = hit(x.address); return [h.lat, h.lon]; }));
            if (spots === fitted) return;
            if (fitted === null && view && view.spots === spots) map.setView(view.center, view.zoom, { animate: false });
            else fit(false);
            fitted = spots;
        }

        show();
        return { update: update, destroy: destroy };
    }

    return { create: create };
})();
