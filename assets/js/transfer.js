/* Übertragung per Einmal-Link (PeerJS/WebRTC, ohne Oberfläche), für Wohnung und
   Zeitfresser: createTransfer(Kennung der Seite, Name). Beide Geräte brauchen dieselbe Seite.
   Das sendende Gerät meldet sich unter einer zufälligen Sitzungs-ID bei PeerJS an.
   Der Link enthält Sitzung und Schlüssel hinter dem #, beides geht nie an einen
   Webserver. Wer ihn öffnet, beweist mit dem Schlüssel, dass er den Link hat; erst
   dann kommen die Daten, zusätzlich zu WebRTC mit AES-GCM verschlüsselt. Sobald sie
   unterwegs sind, ist die Sitzung bei PeerJS abgemeldet: Der Link ist verbraucht.

   Ablauf:  Empfänger → hello → Sender → data → Empfänger → received
            nur bei mode 'sync':  Empfänger → result → Sender → done
            (oder declined, wenn der Empfänger nichts übernimmt) */
function createTransfer(APP, NAME) {
    'use strict';

    var VERSION = 1;
    var PREFIX = APP + '-transfer-';
    var LINK_MS = 30 * 60 * 1000;      // so lange wartet ein Link
    var CONFIRM_MS = 10 * 60 * 1000;   // so lange darf der Empfänger überlegen
    var CONNECT_MS = 25 * 1000;
    var DATA_MS = 60 * 1000;
    var ACK_MS = 20 * 1000;
    var RETRY_MS = 2500;
    var MAX_TRIES = 4;                 // erste Anmeldung bei PeerJS
    var FATAL = ['browser-incompatible', 'invalid-id', 'invalid-key', 'ssl-unavailable'];

    /* ---------- Bibliotheken erst bei Bedarf laden ---------- */

    var scripts = {};

    function loadScript(src) {
        return scripts[src] || (scripts[src] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { delete scripts[src]; s.remove(); reject(new Error('Nicht ladbar: ' + src)); };
            document.head.appendChild(s);
        }));
    }

    function loadPeer() { return loadScript('../fileshare/vendor/peerjs.min.js'); }
    function loadQr() { return loadScript('../fileshare/vendor/qrcode.min.js'); }

    function supported() {
        return !!(window.RTCPeerConnection && window.crypto && crypto.subtle);
    }

    /* ---------- Verschlüsselung ---------- */

    function randomBytes(count) { return crypto.getRandomValues(new Uint8Array(count)); }

    function toBase64(bytes) {
        var s = '';
        for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }

    function fromBase64(text) {
        return Uint8Array.from(atob(text), function (c) { return c.charCodeAt(0); });
    }

    function toBase64Url(bytes) { return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function fromBase64Url(text) { return fromBase64(text.replace(/-/g, '+').replace(/_/g, '/')); }

    function importKey(text) {
        return crypto.subtle.importKey('raw', fromBase64Url(text), 'AES-GCM', false, ['encrypt', 'decrypt']);
    }

    /** Nachricht passt nur zu dieser Sitzung und Art – nichts lässt sich umdeuten. */
    function context(session, type) { return new TextEncoder().encode(APP + ':' + session + ':' + type); }

    function seal(s, type, value) {
        var iv = randomBytes(12);
        return s.key.then(function (key) {
            return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: context(s.session, type) }, key, new TextEncoder().encode(JSON.stringify(value)));
        }).then(function (data) {
            return { app: APP, v: VERSION, type: type, iv: toBase64(iv), box: toBase64(new Uint8Array(data)) };
        });
    }

    function unseal(s, msg) {
        return s.key.then(function (key) {
            return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(msg.iv), additionalData: context(s.session, msg.type) }, key, fromBase64(msg.box));
        }).then(function (data) { return JSON.parse(new TextDecoder().decode(data)); });
    }

    function post(conn, type) {
        try { conn.send({ app: APP, v: VERSION, type: type }); } catch (e) { /* schon zu */ }
    }

    function closeLater(x, how) {
        // Kurz warten, damit die letzte Nachricht noch rausgeht.
        setTimeout(function () { try { x[how](); } catch (e) { /* schon zu */ } }, 1000);
    }

    /* ---------- Senden ---------- */

    /** o: { mode: 'sync' | 'send', payload: () => Daten, onResult: (Daten) => void
     *  (darf werfen), onChange: () => void }.
     *  status: connecting, waiting, offline, sending, confirm – oder am Ende (ended):
     *  sent, synced, declined, noReply, broken, badResult, expired, cancelled, error, unsupported. */
    function send(o) {
        var t = { mode: o.mode, status: 'connecting', ended: false, used: false, until: Date.now() + LINK_MS, link: '' };
        var peer = null, timer = null, retryTimer = null, tries = 0, hiddenAt = 0;

        function set(status) {
            if (t.ended || t.status === status) return;
            t.status = status;
            o.onChange();
        }

        function finish(status) {
            if (t.ended) return;
            t.status = status;
            t.ended = true;
            clearTimeout(timer);
            clearTimeout(retryTimer);
            document.removeEventListener('visibilitychange', onVisible);
            if (peer) closeLater(peer, 'destroy');
            o.onChange();
        }
        t.cancel = function () { finish('cancelled'); };

        function later(ms, status) {
            clearTimeout(timer);
            timer = setTimeout(function () { finish(status); }, ms);
        }

        /** Verbindung zu PeerJS weg (z. B. Handy im Hintergrund): wieder anmelden. */
        function retry(soon) {
            if (t.ended || t.used || retryTimer) return;
            if (t.status === 'connecting' && ++tries >= MAX_TRIES) { finish('error'); return; }
            if (t.status !== 'connecting') set('offline');
            retryTimer = setTimeout(function () {
                retryTimer = null;
                if (t.ended || t.used) return;
                if (peer.destroyed) open();
                else if (peer.disconnected) {
                    peer.reconnect();
                    // Kennt PeerJS die Sitzung noch, kommt kein „open“.
                    setTimeout(function () { if (!t.used && t.status === 'offline' && !peer.disconnected && !peer.destroyed) set('waiting'); }, 4000);
                }
            }, soon ? 300 : RETRY_MS);
        }

        function onVisible() {
            if (document.hidden) { hiddenAt = Date.now(); return; }
            if (!peer || t.used || t.status === 'connecting') return;
            // Nach längerer Pause ist die Verbindung oft tot, ohne dass der Browser es merkt.
            if (Date.now() - hiddenAt > 20000 && !peer.disconnected && !peer.destroyed) peer.disconnect();
            else if (peer.disconnected || peer.destroyed) retry(true);
        }

        function open() {
            peer = new Peer(PREFIX + t.session, { debug: 0 });
            var mine = peer;
            peer.on('open', function () { if (!t.used) set('waiting'); });
            peer.on('connection', onConnection);
            peer.on('disconnected', function () { if (mine === peer) retry(true); });
            peer.on('error', function (err) {
                if (t.used || t.ended || mine !== peer) return;
                if (FATAL.indexOf(err.type) !== -1) finish('error');
                else if (mine.destroyed || mine.disconnected) retry();
            });
        }

        function onConnection(conn) {
            var active = false;
            function refuse(type) { post(conn, type); closeLater(conn, 'close'); }
            conn.on('open', function () { if (t.used || t.ended) refuse('gone'); });
            conn.on('close', function () {
                if (!active || t.ended) return;
                finish(t.status === 'confirm' ? 'noReply' : 'broken');
            });
            conn.on('data', function (msg) {
                if (!msg || msg.app !== APP || t.ended) return;
                if (msg.type === 'hello' && !t.used) hello(conn, msg);
                else if (!active) return;
                else if (msg.type === 'received') {
                    if (t.mode === 'send') finish('sent');
                    else { set('confirm'); later(CONFIRM_MS, 'noReply'); }
                } else if (msg.type === 'declined') finish('declined');
                else if (msg.type === 'result' && t.mode === 'sync' && !t.result) result(msg);
            });

            function hello(conn, msg) {
                if (msg.v !== VERSION) { refuse('version'); return; }
                unseal(t, msg).then(function () {
                    // Zwei gleichzeitig: nur wer zuerst kommt, bekommt die Daten.
                    if (t.used || t.ended) { refuse('gone'); return; }
                    t.used = active = true;
                    clearTimeout(retryTimer);
                    peer.disconnect();   // bei PeerJS abgemeldet, die offene Verbindung bleibt
                    set('sending');
                    later(DATA_MS, 'broken');
                    return seal(t, 'data', { mode: t.mode, data: o.payload() }).then(function (out) { conn.send(out); });
                }, function () {
                    refuse('denied');    // meist ein unvollständig kopierter Link, er gilt weiter
                }).catch(function () { finish('broken'); });
            }

            function result(msg) {
                t.result = true;
                unseal(t, msg).then(o.onResult).then(function () {
                    post(conn, 'done');
                    finish('synced');
                }).catch(function (e) {
                    console.warn(NAME + ': Antwort nicht lesbar.', e);
                    finish('badResult');
                });
            }
        }

        if (!supported()) { finish('unsupported'); return t; }
        t.session = Array.from(randomBytes(16), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        var keyText = toBase64Url(randomBytes(32));
        t.key = importKey(keyText);
        t.link = location.href.split('#')[0] + '#transfer=' + t.session + '.' + keyText;
        later(LINK_MS, 'expired');
        document.addEventListener('visibilitychange', onVisible);
        loadPeer().then(function () { if (!t.ended) open(); }).catch(function () { finish('error'); });
        return t;
    }

    /* ---------- Empfangen ---------- */

    /** value: Teil des Links hinter "transfer=". Verbunden wird erst mit start(), damit
     *  eine Linkvorschau den Link nicht verbraucht.
     *  status: ready, connecting, received (mode, data, online), replying – oder am Ende:
     *  done, noAck, invalid, denied, version, gone, offline, unsupported. */
    function receive(value, onChange) {
        var m = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
        var r = { value: value, status: !m ? 'invalid' : supported() ? 'ready' : 'unsupported', online: false };
        if (r.status !== 'ready') return r;
        var peer = null, conn = null, timer = null;
        r.session = m[1];
        r.key = importKey(m[2]);

        function set(status) {
            r.status = status;
            onChange();
        }

        function finish(status) {
            clearTimeout(timer);
            if (peer) closeLater(peer, 'destroy');
            peer = conn = null;
            r.online = false;
            set(status);
        }

        function wait(ms, status) {
            clearTimeout(timer);
            timer = setTimeout(function () { finish(status); }, ms);
        }

        /** Noch einmal versuchen geht, solange keine Daten kamen. */
        r.start = function () {
            if (['ready', 'gone', 'offline'].indexOf(r.status) === -1) return;
            set('connecting');
            wait(CONNECT_MS, 'gone');
            loadPeer().then(function () {
                if (r.status !== 'connecting') return;
                var mine = peer = new Peer({ debug: 0 });
                peer.on('open', function () { if (mine === peer) dial(); });
                peer.on('error', function (err) {
                    if (mine !== peer || r.status !== 'connecting') return;
                    // Vielleicht ist das andere Gerät nur kurz weg, z. B. eine andere App im Vordergrund.
                    if (err.type === 'peer-unavailable') setTimeout(function () { if (mine === peer && r.status === 'connecting') dial(); }, RETRY_MS);
                    else finish(err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed' ? 'offline' : 'gone');
                });
            }).catch(function () { finish('offline'); });
        };

        function dial() {
            var c = conn = peer.connect(PREFIX + r.session, { reliable: true });
            c.on('open', function () {
                wait(DATA_MS, 'gone');
                seal(r, 'hello', {}).then(function (msg) { c.send(msg); });
            });
            c.on('data', function (msg) {
                if (c !== conn || !msg || msg.app !== APP) return;
                if (r.status === 'connecting' && ['denied', 'version', 'gone'].indexOf(msg.type) !== -1) finish(msg.type);
                else if (r.status === 'connecting' && msg.type === 'data') {
                    unseal(r, msg).then(function (x) {
                        if (c !== conn || r.status !== 'connecting') return;
                        clearTimeout(timer);
                        r.mode = x.mode === 'sync' ? 'sync' : 'send';
                        r.data = x.data;
                        r.online = true;
                        post(c, 'received');
                        if (r.mode === 'send') { closeLater(peer, 'destroy'); peer = conn = null; }
                        set('received');
                    }).catch(function () { finish('denied'); });
                } else if (r.status === 'replying' && msg.type === 'done') finish('done');
            });
            c.on('close', function () {
                if (c !== conn) return;
                if (r.status === 'connecting') finish('gone');
                else if (r.status === 'replying') finish('noAck');
                else if (r.status === 'received' && r.online) { r.online = false; onChange(); }
            });
        }

        /** Ergebnis des Abgleichs zurückschicken (mode 'sync'). */
        r.reply = function (data) {
            if (!conn || !r.online) { finish('noAck'); return; }
            var c = conn;
            set('replying');
            wait(ACK_MS, 'noAck');
            seal(r, 'result', data).then(function (msg) { c.send(msg); }).catch(function () { finish('noAck'); });
        };

        /** Seite verlassen oder nicht übernehmen. */
        r.close = function () {
            clearTimeout(timer);
            if (conn && r.status === 'received' && r.mode === 'sync') post(conn, 'declined');
            if (peer) closeLater(peer, 'destroy');
            peer = conn = null;
        };
        return r;
    }

    return { supported: supported, send: send, receive: receive, loadQr: loadQr };
}
