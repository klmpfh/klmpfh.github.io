/**
 * Kwidt – Service Worker: Sorgt dafür, dass die App auch ohne Netz startet, und meldet
 * fällige wiederkehrende Ausgaben.
 *
 * Die Gruppen selbst liegen im localStorage und sind beim Speichern sofort sicher.
 * Ein Service Worker kommt nicht an den localStorage heran. Für die Benachrichtigungen
 * legt die Seite deshalb eine Übersicht der Serien in IndexedDB ab (kv.js).
 *
 * Ein Service Worker läuft nicht von selbst, der Browser weckt ihn nur zu bestimmten
 * Anlässen. Ohne Server bleibt dafür nur `periodicsync`: Chrome und Edge wecken eine
 * installierte App ab und zu (meist höchstens einmal am Tag), andere Browser gar nicht.
 * Außerdem fragt die Seite nach, wenn sie im Hintergrund offen ist und ein neuer Tag beginnt.
 *
 * Eigene Dateien: Erst das Netz, damit neue Versionen sofort ankommen; der Cache
 * springt ein, wenn es zu lange dauert oder nicht klappt.
 */
'use strict';

importScripts('core.js', 'kv.js');

const C = self.QuittCore;
const CACHE = 'kwidt-v3';
const NETWORK_TIMEOUT = 3000;
const DUE_TAG = 'kwidt-due';
const MAX_LINES = 5;
const SHELL = [
    './',
    'app.js',
    'core.js',
    'kv.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
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
            .then(function (cache) {
                return cache.addAll(SHELL.map(function (url) { return new Request(url, { cache: 'reload' }); }));
            })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (names) {
                return Promise.all(names
                    .filter(function (name) { return name.indexOf('kwidt-') === 0 && name !== CACHE; })
                    .map(function (name) { return caches.delete(name); }));
            })
            .then(function () { return self.clients.claim(); })
    );
});

function remember(cache, request, response) {
    if (response.ok) {
        // Pro Datei nur ein Eintrag, egal mit welchem ?v= sie angefragt wurde.
        const copy = response.clone();
        cache.delete(request, { ignoreSearch: true }).then(function () { cache.put(request, copy); });
    }
    return response;
}

async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true })
        || (request.mode === 'navigate' ? await cache.match('./') : undefined);
    // no-cache: Auch der HTTP-Cache des Browsers muss beim Server nachfragen.
    const network = fetch(request.url, { cache: 'no-cache' }).then(function (response) { return remember(cache, request, response); });
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
    event.respondWith(networkFirst(event.request));
});

/* ---------- Fällige wiederkehrende Ausgaben ---------- */

function dayBefore(today) {
    const p = today.split('-').map(Number);
    return C.todayStr(new Date(p[0], p[1] - 1, p[2] - 1));
}

function shortDate(date) {
    const p = date.split('-');
    return p[2] + '.' + p[1] + '.';
}

/**
 * Meldet pro Gruppe, welche Termine seit der letzten Meldung fällig wurden und noch nicht
 * gebucht sind. Gebucht wird erst, wenn jemand die Gruppe öffnet. Was dieses Gerät schon
 * gebucht hat, hat die Person also gesehen. Wie weit gemeldet wurde, steht unter
 * `notified`; fehlt eine Gruppe dort, zählt nur, was heute fällig ist.
 */
async function checkDue() {
    if (!self.Notification || Notification.permission !== 'granted') return;
    // Wer die App gerade vor sich hat, sieht die Buchungen dort.
    const windows = await self.clients.matchAll({ type: 'window' });
    if (windows.some(function (w) { return w.visibilityState === 'visible'; })) return;

    const groups = (await KwidtKV.get('schedule')) || [];
    const notified = (await KwidtKV.get('notified')) || {};
    const today = C.todayStr();
    const next = {};
    for (const g of groups) {
        const after = notified[g.gid] || dayBefore(today);
        next[g.gid] = after > today ? after : today;
        const due = [];
        g.series.forEach(function (s) {
            C.dueDates(s, after, today).forEach(function (date) { due.push({ series: s, date: date }); });
        });
        if (!due.length) continue;
        due.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        const lines = due.slice(0, MAX_LINES).map(function (d) {
            return (d.series.desc || 'Ohne Beschreibung') + ' · ' + C.formatMoney(d.series.amount, d.series.currency)
                + (d.series.refund ? ' Rückzahlung' : '') + (d.date !== today ? ' · ' + shortDate(d.date) : '');
        });
        if (due.length > MAX_LINES) lines.push('und ' + (due.length - MAX_LINES) + ' weitere');
        await self.registration.showNotification(
            (g.name || 'Kwidt') + ': ' + (due.length === 1 ? 'Wiederkehrende Ausgabe fällig' : due.length + ' wiederkehrende Ausgaben fällig'),
            {
                body: lines.join('\n'),
                tag: DUE_TAG + '-' + g.gid,
                icon: 'icons/icon-192.png',
                data: { hash: '#/g/' + g.gid }
            });
    }
    await KwidtKV.set('notified', next);
}

// Hintereinander statt gleichzeitig, sonst meldet ein zweiter Lauf dasselbe noch einmal.
let dueRun = Promise.resolve();
function checkDueOnce() {
    dueRun = dueRun.then(checkDue).catch(function (e) { console.warn('Kwidt: Prüfung fehlgeschlagen.', e); });
    return dueRun;
}

self.addEventListener('periodicsync', function (event) {
    if (event.tag === DUE_TAG) event.waitUntil(checkDueOnce());
});

self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'check-due') event.waitUntil(checkDueOnce());
});

/* ---------- Tippen auf eine Benachrichtigung ---------- */

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    const hash = (event.notification.data && event.notification.data.hash) || '';
    event.waitUntil((async function () {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const win = windows[0];
        if (!win) {
            await self.clients.openWindow(new URL('./' + hash, self.registration.scope).href);
            return;
        }
        await win.focus();
        win.postMessage({ app: 'quitt', type: 'open', hash: hash });
    })());
});
