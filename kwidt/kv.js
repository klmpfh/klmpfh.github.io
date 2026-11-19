/**
 * Kwidt – Kleiner Schlüssel-Wert-Speicher in IndexedDB, den Seite und Service Worker
 * gemeinsam nutzen. Der Service Worker kommt nicht an den localStorage heran; hier
 * legt die Seite ab, was er für Benachrichtigungen braucht.
 */
(function (root) {
    'use strict';

    var DB = 'kwidt';
    var STORE = 'kv';
    var opening = null;

    function open() {
        if (!opening) {
            opening = new Promise(function (resolve, reject) {
                var req = indexedDB.open(DB, 1);
                req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
            opening.catch(function () { opening = null; });
        }
        return opening;
    }

    function run(mode, action) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, mode);
                var req = action(tx.objectStore(STORE));
                tx.oncomplete = function () { resolve(req.result); };
                tx.onerror = tx.onabort = function () { reject(tx.error); };
            });
        });
    }

    root.KwidtKV = {
        get: function (key) { return run('readonly', function (s) { return s.get(key); }); },
        set: function (key, value) { return run('readwrite', function (s) { return s.put(value, key); }); }
    };
})(self);
