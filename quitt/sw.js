/**
 * Quitt – Service Worker: Sorgt dafür, dass die App auch ohne Netz startet.
 *
 * Die Gruppen selbst liegen im localStorage und sind beim Speichern sofort sicher.
 * Ein Service Worker läuft nicht, solange die Seite zu ist, und kommt auch nicht an
 * den localStorage heran. Er hält nur die Dateien der App bereit.
 *
 * Eigene Dateien: Erst das Netz, damit neue Versionen sofort ankommen; der Cache
 * springt ein, wenn es zu lange dauert oder nicht klappt. Die Texterkennung ändert
 * sich nur mit ihrem Update und ist groß, sie kommt deshalb direkt aus dem Cache.
 */
'use strict';

const CACHE = 'quitt-v1';
const NETWORK_TIMEOUT = 3000;
const SHELL = [
    './',
    'app.js',
    'core.js',
    '../assets/css/reset.css',
    '../assets/css/theme.css',
    '../assets/js/nav.js',
    '../assets/img/favicon.svg',
    '../fileshare/vendor/peerjs.min.js',
    '../fileshare/vendor/qrcode.min.js'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE)
            .then(function (cache) { return cache.addAll(SHELL); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (names) {
                return Promise.all(names
                    .filter(function (name) { return name.indexOf('quitt-') === 0 && name !== CACHE; })
                    .map(function (name) { return caches.delete(name); }));
            })
            .then(function () { return self.clients.claim(); })
    );
});

function remember(cache, request, response) {
    if (response.ok) cache.put(request, response.clone());
    return response;
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE);
    return await cache.match(request) || remember(cache, request, await fetch(request));
}

async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true })
        || (request.mode === 'navigate' ? await cache.match('./') : undefined);
    const network = fetch(request).then(function (response) { return remember(cache, request, response); });
    if (!cached) return network;

    // Nach dem Timeout antwortet der Cache, die Antwort aus dem Netz landet trotzdem darin.
    return new Promise(function (resolve) {
        const timer = setTimeout(function () { resolve(cached); }, NETWORK_TIMEOUT);
        network.then(function (response) {
            clearTimeout(timer);
            resolve(response);
        }, function () {
            clearTimeout(timer);
            resolve(cached);
        });
    });
}

self.addEventListener('fetch', function (event) {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== location.origin) return;
    event.respondWith(url.pathname.indexOf('/vendor/tesseract/') !== -1
        ? cacheFirst(event.request)
        : networkFirst(event.request));
});
