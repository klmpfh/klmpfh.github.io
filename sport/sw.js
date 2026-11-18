'use strict';

/* =============================================================================
 * Service Worker - Offline-Unterstützung für /sport/
 * -----------------------------------------------------------------------------
 * WICHTIG: Bei jeder inhaltlichen Änderung an index.html, style.css, js/*.js
 * oder den unten gelisteten Assets ASSET_VERSION erhöhen - und dieselbe Zahl
 * in index.html bei allen "?v=..."-Verweisen (style.css + js/*.js) eintragen.
 *
 * Warum beides: CSS/JS kommen unten "cache-first" aus dem Cache, die Seite
 * selbst aber "network-first". Ohne neue ?v=-Nummer bekäme eine frisch
 * geladene index.html sonst noch einmal die alten JS-Dateien aus dem Cache
 * (neue Seite + altes Skript = kaputt). Mit neuer Nummer sind es neue URLs,
 * die nicht im Cache liegen und daher frisch aus dem Netz geholt werden.
 * install() legt unter dem neuen Namen einen frischen Cache an, activate()
 * räumt danach alle älteren Versionen weg.
 * ========================================================================== */
var ASSET_VERSION = '26';
var CACHE_VERSION = 'sport-v' + ASSET_VERSION;
var V = '?v=' + ASSET_VERSION;

// Alle Pfade relativ zu diesem Skript (liegt in /sport/), damit sie sowohl auf
// GitHub Pages als auch bei einem lokalen Server unter jedem Basis-Pfad
// funktionieren.
var APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './style.css' + V,
    './js/exercises.js' + V,
    './js/state.js' + V,
    './js/helpers.js' + V,
    './js/storage.js' + V,
    './js/workout.js' + V,
    './js/library.js' + V,
    './js/audio.js' + V,
    './js/sport-mode.js' + V,
    './js/main.js' + V,
    '../assets/css/reset.css',
    '../assets/css/theme.css',
    '../assets/js/nav.js',
    '../assets/img/favicon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(function (cache) { return cache.addAll(APP_SHELL); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (keys) {
                return Promise.all(keys
                    .filter(function (key) { return key !== CACHE_VERSION; })
                    .map(function (key) { return caches.delete(key); }));
            })
            .then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') return;

    // Navigation (die Seite selbst): zuerst das Netz versuchen, damit online
    // immer die aktuelle Fassung ankommt. Erst wenn das fehlschlägt (offline),
    // auf den gecachten App-Shell zurückfallen.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(function () {
                return caches.match(event.request).then(function (cached) {
                    return cached || caches.match('./index.html');
                });
            })
        );
        return;
    }

    // Alles andere (CSS/JS/Icons): zuerst aus dem Cache liefern, damit es
    // offline sofort ohne Netzwerk-Wartezeit lädt. Im Hintergrund trotzdem
    // neu laden und den Cache aktualisieren, für den nächsten Aufruf.
    event.respondWith(
        caches.match(event.request).then(function (cached) {
            var networkFetch = fetch(event.request).then(function (response) {
                if (response && response.ok) {
                    var copy = response.clone();
                    caches.open(CACHE_VERSION).then(function (cache) { cache.put(event.request, copy); });
                }
                return response;
            }).catch(function () { return cached; });
            return cached || networkFetch;
        })
    );
});
