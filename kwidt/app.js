/**
 * Kwidt – Oberfläche, Speicherung und Abgleich zwischen Geräten.
 *
 * Es gibt keinen Server: Jede Gruppe liegt als Dokument im localStorage des
 * jeweiligen Browsers. Geräte gleichen sich auf zwei Wegen ab, beide nutzen
 * dasselbe verlustfreie Zusammenführen aus core.js (mergeGroups):
 *  - Link: Der Einladungslink trägt den kompletten Stand im #-Teil der URL, der
 *    nie an einen Server geschickt wird.
 *  - Live: Wer eine Gruppe geöffnet hat, verbindet sich per WebRTC (PeerJS wie in
 *    /fileshare/) mit den anderen Geräten, die sie gerade auch geöffnet haben.
 *
 * Alle Texte werden über h()/Textknoten eingefügt, nie als HTML: Namen und
 * Beschreibungen stammen von anderen Personen.
 */
(function () {
    'use strict';

    const C = window.QuittCore;
    // Die App hieß früher Quitt. Interne Kennungen bleiben so: Speicher, Sync und
    // Backups hängen daran, ein neuer Name würde bestehende Gruppen unerreichbar machen.
    const STORE_KEY = 'quitt-v1';
    const PEER_PREFIX = 'klmpfh-quitt-';
    const MAX_DECOMPRESSED = 8 * 1024 * 1024;
    const LINK_ACTIVITY_LIMIT = 60;
    const HEARTBEAT = 10000;
    const PEER_TIMEOUT = 30000;

    const app = document.getElementById('app');
    const toastEl = document.getElementById('toast');

    let store = { groups: {}, me: {}, last: null, seen: {} };
    const state = { formActive: false, pendingRender: false, unsaved: false, search: '', filter: emptyFilter(), filterOpen: false, statsCur: null, lastPath: null };

    function emptyFilter() {
        return { payer: '', member: '', category: '', min: '', max: '' };
    }

    /* ---------- Helfer ---------- */

    function h(tag, attrs) {
        const el = document.createElement(tag);
        const kids = Array.prototype.slice.call(arguments, 2);
        let value;
        if (attrs) {
            Object.keys(attrs).forEach(function (key) {
                const v = attrs[key];
                if (v === null || v === undefined || v === false) return;
                if (key.slice(0, 2) === 'on') el.addEventListener(key.slice(2), v);
                else if (key === 'class') el.className = v;
                else if (key === 'value') value = v;
                else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'required') el[key] = !!v;
                else el.setAttribute(key, v === true ? '' : v);
            });
        }
        (function add(list) {
            list.forEach(function (kid) {
                if (kid === null || kid === undefined || kid === false) return;
                if (Array.isArray(kid)) add(kid);
                else el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
            });
        })(kids);
        if (value !== undefined) el.value = value; // erst nach den <option>-Kindern
        return el;
    }

    function money(minor, cur) { return C.formatMoney(minor, cur); }

    function formatDate(dateStr, withYear) {
        const p = dateStr.split('-').map(Number);
        const opts = { day: 'numeric', month: 'short' };
        if (withYear) opts.year = 'numeric';
        return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('de-DE', opts);
    }

    function monthLabel(dateStr) {
        const p = dateStr.split('-').map(Number);
        return new Date(p[0], p[1] - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    }

    function timeAgo(t) {
        const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
        const seconds = Math.round((t - Date.now()) / 1000);
        const steps = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [2592000, 'day'], [31536000, 'month']];
        let divisor = 1;
        for (let i = 0; i < steps.length; i++) {
            if (Math.abs(seconds) < steps[i][0]) return rtf.format(Math.round(seconds / divisor), steps[i][1]);
            divisor = steps[i][0];
        }
        return rtf.format(Math.round(seconds / divisor), 'year');
    }

    function categoryLabel(c) {
        return c.emoji ? c.emoji + ' ' + c.label : c.label;
    }

    function categoryText(doc, id) {
        return categoryLabel(C.findCategory(doc, id));
    }

    /** Ohne gewählte Kategorie gibt es kein Symbol. */
    function categoryIcon(doc, id) {
        const emoji = C.findCategory(doc, id).emoji;
        return emoji ? h('span', { class: 'icon', 'aria-hidden': 'true' }, emoji) : null;
    }

    let toastTimer = null;
    function toast(text, actionLabel, action) {
        clearTimeout(toastTimer);
        toastEl.textContent = '';
        toastEl.appendChild(document.createTextNode(text));
        if (actionLabel) {
            toastEl.appendChild(h('button', {
                type: 'button',
                onclick: function () { toastEl.hidden = true; action(); }
            }, actionLabel));
        }
        toastEl.hidden = false;
        toastTimer = setTimeout(function () { toastEl.hidden = true; }, actionLabel ? 7000 : 3000);
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            // Fallback ohne Clipboard-API (http, file://, ältere Browser)
            const area = h('textarea', { style: 'position:fixed;opacity:0' });
            area.value = text;
            document.body.appendChild(area);
            area.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (err) { /* Rückmeldung per Rückgabewert */ }
            area.remove();
            return ok;
        }
    }

    /** Text teilen: Über das System-Menü, sonst in die Zwischenablage. */
    async function shareText(title, text) {
        if (navigator.share) {
            try {
                await navigator.share({ title: title, text: text });
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return;
            }
        }
        toast(await copyText(text) ? 'In die Zwischenablage kopiert.' : 'Kopieren hat nicht geklappt.');
    }

    function download(filename, mime, text) {
        const url = URL.createObjectURL(new Blob([text], { type: mime }));
        const a = h('a', { href: url, download: filename });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    function fileSafe(name) {
        return (name || 'gruppe').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'gruppe';
    }

    /* ---------- Speicher ---------- */

    function readStored() {
        const out = { groups: {}, me: {}, last: null, seen: {} };
        try {
            const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
            if (raw && raw.groups) {
                Object.keys(raw.groups).forEach(function (gid) {
                    const doc = C.sanitizeGroup(raw.groups[gid]);
                    if (doc) out.groups[gid] = doc;
                });
                Object.keys(raw.me || {}).forEach(function (gid) {
                    if (typeof raw.me[gid] === 'string') out.me[gid] = raw.me[gid];
                });
                if (typeof raw.last === 'string') out.last = raw.last;
                Object.keys(raw.seen || {}).forEach(function (gid) {
                    if (typeof raw.seen[gid] === 'number') out.seen[gid] = raw.seen[gid];
                });
            }
        } catch (e) {
            console.warn('Kwidt: Gespeicherte Daten nicht lesbar.', e);
        }
        return out;
    }

    function persist() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(store));
            state.unsaved = false;
        } catch (e) {
            state.unsaved = true;
            console.error('Kwidt: Speichern fehlgeschlagen.', e);
            toast('Speichern fehlgeschlagen. Bitte ein Backup sichern.');
        }
        askToKeepData();
    }

    /** Ohne diese Bitte darf der Browser die Daten löschen, sobald der Speicher knapp wird. */
    let keepAsked = false;
    function askToKeepData() {
        if (keepAsked || !Object.keys(store.groups).length) return;
        keepAsked = true;
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().catch(function () { /* bleibt normaler Speicher */ });
        }
    }

    /** Fremde Stände einmischen, statt zu ersetzen: Offene Formulare halten Referenzen auf die Dokumente. */
    function adoptStored() {
        const loaded = readStored();
        let changed = false;
        Object.keys(loaded.groups).forEach(function (gid) {
            if (!store.groups[gid]) {
                store.groups[gid] = loaded.groups[gid];
                changed = true;
            } else if (C.mergeGroups(store.groups[gid], loaded.groups[gid])) {
                changed = true;
            }
        });
        Object.keys(store.groups).forEach(function (gid) {
            if (!loaded.groups[gid]) {
                delete store.groups[gid];
                changed = true;
            }
        });
        store.me = loaded.me;
        store.last = loaded.last;
        store.seen = loaded.seen;
        return changed;
    }

    /**
     * Wann war zuletzt ein anderes Gerät da? Das gilt nur für dieses Gerät und bleibt
     * deshalb außerhalb des Gruppen-Dokuments. Gespeichert wird höchstens einmal pro Minute.
     */
    let seenSaved = 0;
    function markSeen(gid, saveNow) {
        store.seen[gid] = Date.now();
        if (saveNow || Date.now() - seenSaved > 60000) {
            seenSaved = Date.now();
            persist();
        }
    }

    function meId(gid) {
        const id = store.me[gid];
        const doc = store.groups[gid];
        return id && doc && doc.members[id] && !doc.members[id].left ? id : null;
    }

    function logActivity(doc, kind, ref, label, amount, currency) {
        const id = C.newId();
        const entry = { id: id, t: C.nextT(doc), by: meId(doc.id) || '', kind: kind, ref: ref || '', label: label || '' };
        if (amount) {
            entry.amount = amount;
            entry.currency = currency;
        }
        doc.activity[id] = entry;
    }

    function commit(doc) {
        persist();
        Sync.broadcast(doc);
    }

    /* ---------- Link-Kodierung ---------- */

    function toBase64Url(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function fromBase64Url(text) {
        const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    async function readAll(stream) {
        const reader = stream.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > MAX_DECOMPRESSED) {
                await reader.cancel();
                throw new Error('Link-Inhalt zu groß');
            }
            chunks.push(part.value);
        }
        const out = new Uint8Array(size);
        let offset = 0;
        chunks.forEach(function (c) { out.set(c, offset); offset += c.length; });
        return out;
    }

    async function encodeSnapshot(doc) {
        const json = new TextEncoder().encode(JSON.stringify(C.snapshotForLink(doc, LINK_ACTIVITY_LIMIT)));
        if (typeof CompressionStream === 'undefined') return 'j' + toBase64Url(json);
        const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        return 'z' + toBase64Url(await readAll(stream));
    }

    async function decodeSnapshot(text) {
        let bytes = fromBase64Url(text.slice(1));
        if (text.charAt(0) === 'z') {
            bytes = await readAll(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
        }
        return JSON.parse(new TextDecoder().decode(bytes));
    }

    function baseUrl() { return location.href.split('#')[0]; }

    async function inviteLink(doc, expenseId) {
        return baseUrl() + '#join=' + doc.id + '&d=' + await encodeSnapshot(doc) + (expenseId ? '&e=' + expenseId : '');
    }

    /** Nur die Adresse: kurz, aber die Daten kommen erst, wenn jemand die Gruppe offen hat. */
    function shortLink(doc, expenseId) {
        return baseUrl() + '#join=' + doc.id + (expenseId ? '&e=' + expenseId : '');
    }

    async function shareInvite(doc, expenseId, short) {
        const link = short ? shortLink(doc, expenseId) : await inviteLink(doc, expenseId);
        if (navigator.share) {
            try {
                await navigator.share({ title: 'Kwidt – ' + doc.meta.name, url: link });
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return;
            }
        }
        toast(await copyText(link) ? 'Link kopiert.' : 'Kopieren hat nicht geklappt.');
    }

    /* ---------- Live-Abgleich ---------- */

    /**
     * Sternförmig: Wer die Gruppe zuerst öffnet, belegt die feste Peer-ID der Gruppe
     * (Host), alle anderen verbinden sich mit ihm. Geht der Host, übernimmt das
     * nächste Gerät beim erneuten Verbinden automatisch.
     */
    const Sync = {
        gid: null,
        peer: null,
        conns: new Map(),
        heard: new Map(),
        run: 0,
        timer: null,
        status: 'off',
        deviceCount: 0,

        start: function (gid) {
            if (this.gid === gid) return;
            this.stop();
            this.gid = gid;
            this.connect();
        },

        stop: function () {
            this.run++;
            clearTimeout(this.timer);
            this.teardown();
            this.gid = null;
            this.setStatus('off');
        },

        teardown: function () {
            if (this.gid && this.conns.size) markSeen(this.gid, true);
            this.conns.forEach(function (conn) { try { conn.close(); } catch (e) { /* schon zu */ } });
            this.conns.clear();
            this.heard.clear();
            if (this.peer) {
                try { this.peer.destroy(); } catch (e) { /* schon zerstört */ }
            }
            this.peer = null;
        },

        retry: function (delay) {
            const self = this;
            this.run++;
            clearTimeout(this.timer);
            this.teardown();
            this.setStatus(navigator.onLine === false ? 'offline' : 'connecting');
            this.timer = setTimeout(function () { self.connect(); }, delay);
        },

        connect: function () {
            if (!this.gid) return;
            if (typeof Peer === 'undefined') {
                this.setStatus('offline');
                return;
            }
            const self = this;
            const run = ++this.run;
            const stale = function () { return run !== self.run; };
            this.setStatus('connecting');

            const peer = new Peer(PEER_PREFIX + this.gid, { debug: 0 });
            this.peer = peer;
            peer.on('open', function () {
                if (stale()) return;
                self.setStatus('waiting');
            });
            peer.on('connection', function (conn) {
                if (stale()) { conn.close(); return; }
                self.attach(conn, run);
            });
            peer.on('error', function (err) {
                if (stale()) return;
                // Eigener Lauf für den Client: PeerJS meldet für die abgelehnte ID direkt
                // danach noch "disconnected", das darf den neuen Versuch nicht abbrechen.
                if (err.type === 'unavailable-id') self.joinHost(++self.run);
                else self.retry(8000 + Math.random() * 8000);
            });
            peer.on('disconnected', function () {
                if (stale()) return;
                // Bestehende Datenverbindungen laufen ohne Signaling-Server weiter.
                if (self.conns.size) { try { peer.reconnect(); } catch (e) { /* Neustart beim nächsten Fehler */ } }
                else self.retry(5000);
            });
        },

        joinHost: function (run) {
            const self = this;
            const stale = function () { return run !== self.run; };
            const peer = new Peer({ debug: 0 });
            this.peer = peer;
            let giveUp = null;
            peer.on('open', function () {
                if (stale()) return;
                const conn = peer.connect(PEER_PREFIX + self.gid, { reliable: true });
                giveUp = setTimeout(function () {
                    if (!stale() && !conn.open) self.retry(1000 + Math.random() * 3000);
                }, 12000);
                conn.on('open', function () { clearTimeout(giveUp); });
                self.attach(conn, run);
            });
            peer.on('error', function () {
                clearTimeout(giveUp);
                if (!stale()) self.retry(1000 + Math.random() * 3000);
            });
        },

        attach: function (conn, run) {
            const self = this;
            const stale = function () { return run !== self.run; };

            function greet() {
                if (stale()) return;
                self.conns.set(conn.peer, conn);
                self.heard.set(conn.peer, { at: Date.now(), lost: lost });
                markSeen(self.gid);
                self.send(conn);
                self.announce();
                self.refreshStatus();
            }
            if (conn.open) greet();
            else conn.on('open', greet);

            conn.on('data', function (msg) {
                if (!stale()) self.receive(conn, msg);
            });

            let gone = false;
            function lost() {
                if (stale() || gone) return;
                gone = true;
                markSeen(self.gid, true);
                self.conns.delete(conn.peer);
                self.heard.delete(conn.peer);
                if (self.isHost()) {
                    self.announce();
                    self.refreshStatus();
                } else {
                    self.retry(500 + Math.random() * 2500);
                }
            }
            conn.on('close', lost);
            conn.on('error', lost);
        },

        isHost: function () {
            return !!this.peer && this.peer.id === PEER_PREFIX + this.gid;
        },

        send: function (conn) {
            const doc = store.groups[this.gid];
            if (doc && conn.open) conn.send({ app: 'quitt', type: 'state', doc: doc });
        },

        /** Host teilt allen mit, wie viele Geräte gerade dabei sind. */
        announce: function () {
            if (!this.isHost()) return;
            const count = this.conns.size + 1;
            this.deviceCount = count;
            this.conns.forEach(function (conn) {
                if (conn.open) conn.send({ app: 'quitt', type: 'count', count: count });
            });
        },

        receive: function (from, msg) {
            if (!msg || msg.app !== 'quitt') return;
            const known = this.heard.get(from.peer);
            if (known) known.at = Date.now();
            if (msg.type === 'count') {
                if (Number.isInteger(msg.count)) this.deviceCount = msg.count;
                this.refreshStatus();
                return;
            }
            if (msg.type !== 'state') return;
            const incoming = C.sanitizeGroup(msg.doc);
            const doc = store.groups[this.gid];
            if (!incoming || !doc || incoming.id !== this.gid) return;
            if (C.mergeGroups(doc, incoming)) {
                persist();
                softRender();
                const self = this;
                this.conns.forEach(function (conn) {
                    if (conn !== from) self.send(conn);
                });
            }
        },

        /**
         * Der Browser meldet nicht jede Trennung, etwa bei leerem Akku oder Funkloch. Darum
         * schicken sich die Geräte Lebenszeichen: Bleiben sie aus, gilt die Verbindung als weg.
         */
        heartbeat: function () {
            const self = this;
            this.conns.forEach(function (conn, id) {
                const known = self.heard.get(id);
                if (known && Date.now() - known.at > PEER_TIMEOUT) {
                    try { conn.close(); } catch (e) { /* schon zu */ }
                    known.lost();
                } else if (conn.open) {
                    conn.send({ app: 'quitt', type: 'ping' });
                }
            });
        },

        broadcast: function (doc) {
            if (doc.id !== this.gid) return;
            const self = this;
            this.conns.forEach(function (conn) { self.send(conn); });
        },

        refreshStatus: function () {
            if (this.conns.size) this.setStatus('live');
            else this.setStatus('waiting');
        },

        setStatus: function (status) {
            this.status = status;
            updateSyncPill();
        },

        wake: function () {
            if (this.gid && !this.conns.size && this.status !== 'waiting') this.retry(0);
        }
    };

    function syncLabel() {
        switch (Sync.status) {
            case 'live':
                return Sync.deviceCount > 2
                    ? 'Live mit ' + (Sync.deviceCount - 1) + ' anderen Geräten'
                    : 'Live mit einem anderen Gerät';
            case 'waiting': return 'Kein anderes Gerät online' + lastSeenText();
            case 'connecting': return 'Verbinde …';
            default: return 'Offline' + lastSeenText();
        }
    }

    function lastSeenText() {
        const seen = store.seen[Sync.gid];
        return seen ? ', zuletzt ' + timeAgo(seen) : ', noch keins gesehen';
    }

    function syncPillClass() {
        return 'pill' + (Sync.status === 'live' ? ' live' : Sync.status === 'waiting' ? ' waiting' : '');
    }

    function updateSyncPill() {
        const pill = document.getElementById('syncPill');
        if (!pill) return;
        pill.textContent = syncLabel();
        pill.className = syncPillClass();
    }

    /* ---------- Routing ---------- */

    function go(path) { location.hash = path; }

    function parseRoute() {
        const raw = location.hash.replace(/^#/, '');
        const qIndex = raw.indexOf('?');
        const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
        const params = new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1));
        const parts = path.split('/').filter(Boolean);
        if (parts[0] === 'new') return { name: 'new' };
        if (parts[0] !== 'g' || !C.RE_GROUP_ID.test(parts[1] || '')) return { name: 'home' };
        return {
            name: 'group',
            gid: parts[1],
            section: parts[2] || 'expenses',
            id: parts[3] || null,
            mode: parts[4] || null,
            params: params
        };
    }

    function isEditing() {
        if (state.formActive) return true;
        const el = document.activeElement;
        return !!el && app.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    }

    /** Neu zeichnen nach Daten von außen, ohne jemandem das Formular unter den Fingern wegzuziehen. */
    function softRender() {
        if (isEditing()) {
            state.pendingRender = true;
            return;
        }
        const y = window.scrollY;
        render();
        window.scrollTo(0, y);
    }

    function render() {
        state.formActive = false;
        state.pendingRender = false;
        const route = parseRoute();
        const pathNow = location.hash;
        if (pathNow !== state.lastPath) {
            state.lastPath = pathNow;
            window.scrollTo(0, 0);
        }

        app.textContent = '';
        if (route.name === 'group') {
            const doc = store.groups[route.gid];
            if (!doc) {
                go('/');
                return;
            }
            if (Sync.gid !== route.gid) {
                state.search = '';
                state.filter = emptyFilter();
                state.filterOpen = false;
            }
            if (store.last !== route.gid) {
                store.last = route.gid;
                persist();
            }
            Sync.start(route.gid);
            if (C.expandRecurring(doc, C.todayStr())) commit(doc);
            app.appendChild(viewGroupRoute(doc, route));
            return;
        }

        Sync.stop();
        app.appendChild(route.name === 'new' ? viewNewGroup() : viewHome());
    }

    async function handleJoin() {
        if (location.hash.indexOf('#join=') !== 0) return false;
        const params = new URLSearchParams(location.hash.slice(1));
        const gid = params.get('join') || '';
        if (!C.RE_GROUP_ID.test(gid)) {
            toast('Dieser Einladungslink ist ungültig.');
            history.replaceState(null, '', '#/');
            return false;
        }

        let incoming = null;
        const data = params.get('d');
        if (data) {
            try {
                incoming = C.sanitizeGroup(await decodeSnapshot(data));
            } catch (e) {
                console.warn('Kwidt: Link nicht lesbar.', e);
            }
            if (!incoming || incoming.id !== gid) {
                incoming = null;
                toast('Der Link enthält keine lesbaren Daten, es wird online gesucht.');
            }
        }

        if (!store.groups[gid]) store.groups[gid] = C.emptyGroup(gid);
        if (incoming && C.mergeGroups(store.groups[gid], incoming)) toast('Gruppe aktualisiert.');
        persist();
        const expenseId = params.get('e') || '';
        history.replaceState(null, '', '#/g/' + gid + (C.RE_EXPENSE_ID.test(expenseId) ? '/expense/' + expenseId : ''));
        return true;
    }

    /* ---------- Startseite ---------- */

    function myBalances(doc, balances) {
        const me = meId(doc.id);
        const out = [];
        if (!me) return out;
        Object.keys(balances).forEach(function (cur) {
            const amount = balances[cur][me] || 0;
            if (amount) out.push({ cur: cur, amount: amount });
        });
        return out;
    }

    function balanceSpan(amount, cur) {
        return h('span', { class: amount > 0 ? 'pos' : 'neg' }, money(Math.abs(amount), cur));
    }

    /** Das Symbol ergibt sich aus dem Namen, siehe C.groupSymbol. */
    function groupAvatar(name, large) {
        const symbol = C.groupSymbol(name);
        return h('span', {
            class: 'avatar' + (large ? ' large' : '') + (symbol.emoji ? ' has-emoji' : ''),
            'aria-hidden': 'true'
        }, symbol.text);
    }

    function viewHome() {
        const docs = Object.keys(store.groups).map(function (gid) { return store.groups[gid]; });
        docs.sort(function (a, b) { return C.lastT(b) - C.lastT(a); });

        const totals = {};
        const rows = docs.map(function (doc) {
            const balances = C.computeBalances(doc);
            const mine = myBalances(doc, balances);
            mine.forEach(function (b) { totals[b.cur] = (totals[b.cur] || 0) + b.amount; });
            const memberCount = Object.keys(doc.members).filter(function (id) { return !doc.members[id].left; }).length;
            return h('a', { class: 'item', href: '#/g/' + doc.id },
                groupAvatar(doc.meta.name),
                h('span', { class: 'body' },
                    h('div', { class: 'title' }, doc.meta.name || 'Einladung'),
                    h('div', { class: 'sub' }, doc.meta.t ? memberCount + (memberCount === 1 ? ' Person' : ' Personen') : 'Wartet auf Daten')),
                h('span', { class: 'side' }, mine.length
                    ? mine.map(function (b) {
                        return h('div', null, h('span', { class: 'muted' }, b.amount > 0 ? 'du bekommst ' : 'du schuldest '), balanceSpan(b.amount, b.cur));
                    })
                    : doc.meta.t ? h('span', { class: 'muted' }, 'kwidt') : null));
        });

        const totalKeys = Object.keys(totals).filter(function (cur) { return totals[cur]; });

        return h('div', null,
            h('header', { class: 'page-head' },
                h('h1', null, 'Kwidt'),
                h('p', null, 'Gemeinsame Ausgaben aufteilen, bis alle kwidt sind.')),
            totalKeys.length ? h('section', { class: 'panel' },
                h('h2', null, 'Über alle Gruppen'),
                h('div', { class: 'my-balance' }, totalKeys.map(function (cur) {
                    return h('div', null, totals[cur] > 0 ? 'Du bekommst ' : 'Du schuldest ', balanceSpan(totals[cur], cur));
                }))) : null,
            h('section', { class: 'panel' },
                h('h2', null, 'Deine Gruppen'),
                rows.length ? h('div', { class: 'list' }, rows) : h('div', { class: 'empty' },
                    h('span', { class: 'big', 'aria-hidden': 'true' }, '🧾'),
                    'Noch keine Gruppe. Leg eine an, zum Beispiel für den nächsten Urlaub, die WG oder den Grillabend. Ein Paar ist einfach eine Gruppe mit zwei Personen.'),
                h('div', { class: 'actions' },
                    h('a', { class: 'btn', href: '#/new' }, '+ Neue Gruppe'))),
            h('section', { class: 'panel' },
                h('h2', null, 'So funktioniert es'),
                h('p', { class: 'small muted' }, 'Es gibt keine Anmeldung. Deine Gruppen liegen nur in diesem Browser, nicht auf einem Server. Jede Person hat ihre eigene Kopie.'),
                h('p', { class: 'small muted' }, 'Haben zwei Geräte dieselbe Gruppe gleichzeitig offen, gleichen sie sich live ab. Sonst reicht es, den Link der Gruppe neu zu schicken: Beim Öffnen wird der Stand zusammengeführt, ohne dass etwas verloren geht.'),
                h('div', { class: 'actions' },
                    docs.length ? h('button', { class: 'btn btn-small', type: 'button', onclick: exportAll }, 'Backup sichern') : null,
                    h('label', { class: 'btn btn-small' }, 'Backup laden',
                        h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importBackup })))));
    }

    function exportAll() {
        const me = {};
        const groups = Object.keys(store.groups).map(function (gid) {
            if (store.me[gid]) me[gid] = store.me[gid];
            return store.groups[gid];
        });
        download('kwidt-backup-' + C.todayStr() + '.json', 'application/json',
            JSON.stringify({ app: 'quitt', version: 1, groups: groups, me: me }, null, 1));
    }

    async function importBackup(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            if (!data || data.app !== 'quitt' || !Array.isArray(data.groups)) throw new Error('Kein Kwidt-Backup');
            let count = 0;
            data.groups.forEach(function (raw) {
                const doc = C.sanitizeGroup(raw);
                if (!doc) return;
                if (store.groups[doc.id]) C.mergeGroups(store.groups[doc.id], doc);
                else store.groups[doc.id] = doc;
                const me = data.me && data.me[doc.id];
                if (typeof me === 'string' && !store.me[doc.id]) store.me[doc.id] = me;
                count++;
            });
            persist();
            render();
            toast(count + (count === 1 ? ' Gruppe' : ' Gruppen') + ' geladen.');
        } catch (err) {
            console.warn('Kwidt: Backup nicht lesbar.', err);
            toast('Diese Datei ist kein Kwidt-Backup.');
        }
    }

    /* ---------- Neue Gruppe ---------- */

    function currencySelect(value, onChange, extra) {
        const list = C.CURRENCIES.indexOf(value) === -1 ? [value].concat(C.CURRENCIES) : C.CURRENCIES;
        return h('select', Object.assign({ value: value, onchange: onChange }, extra),
            list.map(function (cur) { return h('option', { value: cur }, cur); }));
    }

    function viewNewGroup() {
        state.formActive = true;
        const form = { currency: 'EUR' };
        let imported = null;
        const friends = h('div', null);
        const error = h('div', { class: 'form-error', hidden: true });

        /** Es bleibt immer ein freies Feld: Wird das letzte beschrieben, kommt das nächste dazu. */
        let lastFriend = null;
        function addFriendField() {
            const input = h('input', {
                type: 'text', maxlength: 40, placeholder: 'Name', 'aria-label': 'Name',
                autocomplete: 'off',
                oninput: function () {
                    if (input === lastFriend && input.value.trim()) addFriendField();
                },
                onkeydown: function (e) {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const inputs = Array.from(friends.querySelectorAll('input'));
                    const next = inputs[inputs.indexOf(input) + 1];
                    if (next) next.focus();
                }
            });
            lastFriend = input;
            friends.appendChild(h('div', { class: 'field' }, input));
        }
        addFriendField();
        addFriendField();

        const avatarSlot = h('span', null, groupAvatar(''));
        const nameInput = h('input', {
            id: 'groupName', type: 'text', maxlength: 60, placeholder: 'Sommer in Lissabon', autocomplete: 'off',
            oninput: function (e) {
                avatarSlot.textContent = '';
                avatarSlot.appendChild(groupAvatar(e.target.value));
            }
        });
        const meInput = h('input', { id: 'myName', type: 'text', maxlength: 40, placeholder: 'Dein Name', autocomplete: 'name' });

        const currencyEl = currencySelect(form.currency, function (e) { form.currency = e.target.value; }, { id: 'groupCurrency' });
        const manualPeople = h('div', null);
        const importSummary = h('div', { class: 'import-box', hidden: true });

        function clearImport() {
            imported = null;
            importSummary.hidden = true;
            importSummary.textContent = '';
            manualPeople.hidden = false;
        }

        function importCounts(data) {
            const parts = [];
            if (data.expenses.length) parts.push(data.expenses.length + (data.expenses.length === 1 ? ' Ausgabe' : ' Ausgaben'));
            if (data.payments.length) parts.push(data.payments.length + (data.payments.length === 1 ? ' Zahlung' : ' Zahlungen'));
            return parts.join(' · ');
        }

        function showImport() {
            const totals = {};
            imported.expenses.forEach(function (x) { totals[x.currency] = (totals[x.currency] || 0) + x.amount; });
            importSummary.textContent = '';
            importSummary.hidden = false;
            importSummary.appendChild(h('div', { class: 'link-title' }, 'Aus Splid'));
            const parts = [imported.members.length + ' Personen', importCounts(imported)];
            if (Object.keys(totals).length) parts.push(Object.keys(totals).map(function (cur) { return money(totals[cur], cur); }).join(' + '));
            importSummary.appendChild(h('p', { class: 'small muted' }, parts.join(' · ')));
            if (imported.skipped) {
                importSummary.appendChild(h('div', { class: 'notice', style: 'margin:8px 0 0' },
                    imported.skipped + (imported.skipped === 1 ? ' Zeile konnte' : ' Zeilen konnten') + ' nicht gelesen werden und fehlt in der Gruppe.'));
            }
            importSummary.appendChild(h('div', { class: 'field', style: 'margin:10px 0 8px' },
                h('label', { for: 'importMe' }, 'Wer bist du?'),
                h('select', {
                    id: 'importMe', value: '',
                    onchange: function (e) { imported.me = e.target.value; }
                },
                    h('option', { value: '' }, 'Bitte wählen'),
                    imported.members.map(function (m) { return h('option', { value: m }, m); }))));
            importSummary.appendChild(importCategoriesField());
            importSummary.appendChild(h('button', { class: 'link-btn small', type: 'button', onclick: clearImport }, 'Import verwerfen'));
        }

        /**
         * Welche Kategorien soll es geben? Zur Wahl stehen die Vorgaben und Titel, die
         * mehrmals vorkommen. Ausgaben, die genauso heißen, bekommen die Kategorie.
         */
        function importCategoriesField() {
            const options = C.groupCategories(C.emptyGroup(C.newGroupId()))
                .filter(function (c) { return c.id !== 'general'; })
                .map(function (c) { return { label: c.label, count: 0 }; })
                .concat(C.splidCategorySuggestions(imported));
            imported.categories = options.map(function (o) { return o.label; });

            function countFor(label) {
                const key = label.toLocaleLowerCase('de');
                return imported.expenses.filter(function (x) { return C.tidyText(x.desc, 120).toLocaleLowerCase('de') === key; }).length;
            }
            function chip(label, on) {
                const count = countFor(label);
                return h('button', {
                    class: 'chip', type: 'button', 'aria-pressed': String(on),
                    title: count ? count + (count === 1 ? ' Ausgabe heißt so' : ' Ausgaben heißen so') : null,
                    onclick: function (e) {
                        const nowOn = e.currentTarget.getAttribute('aria-pressed') !== 'true';
                        e.currentTarget.setAttribute('aria-pressed', String(nowOn));
                        imported.categories = imported.categories.filter(function (l) { return l !== label; });
                        if (nowOn) imported.categories.push(label);
                    }
                }, label, count ? h('span', { class: 'chip-count' }, String(count)) : null);
            }

            const chips = h('div', { class: 'chips' }, options.map(function (o) { return chip(o.label, true); }));
            const addInput = h('input', {
                type: 'text', maxlength: 40, placeholder: 'Weitere Kategorie', 'aria-label': 'Weitere Kategorie', autocomplete: 'off',
                onkeydown: function (e) {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    add();
                }
            });
            function add() {
                const label = C.tidyText(addInput.value, 40);
                if (!label) return;
                addInput.value = '';
                const key = label.toLocaleLowerCase('de');
                const known = Array.from(chips.children).filter(function (el) {
                    return el.firstChild.textContent.toLocaleLowerCase('de') === key;
                })[0];
                if (known) {
                    if (known.getAttribute('aria-pressed') !== 'true') known.click();
                    return;
                }
                imported.categories.push(label);
                chips.appendChild(chip(label, true));
            }

            return h('div', { class: 'field', style: 'margin:0 0 8px' },
                h('span', { class: 'field-label' }, 'Welche Kategorien soll es geben?'),
                h('div', { class: 'field-hint', style: 'margin:0 0 8px' }, 'Ausgaben, die genauso heißen wie eine Kategorie, bekommen sie. Die Zahl zeigt, wie viele das sind.'),
                chips,
                h('div', { class: 'add-row' }, addInput, h('button', { class: 'btn btn-small', type: 'button', onclick: add }, 'Hinzufügen')));
        }

        async function onImport(e) {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            error.hidden = true;
            let data = null;
            try {
                const sheets = C.readXls(await file.arrayBuffer());
                data = sheets && C.parseSplid(sheets, C.todayStr());
            } catch (err) {
                console.warn('Kwidt: Datei nicht lesbar.', err);
            }
            if (!data || !data.members.length || !(data.expenses.length + data.payments.length)) {
                error.textContent = 'Das sieht nicht nach einer Excel-Datei aus Splid aus (.xls).';
                error.hidden = false;
                return;
            }
            imported = data;
            nameInput.value = data.name || nameInput.value;
            nameInput.dispatchEvent(new Event('input'));
            form.currency = data.currency;
            if (!Array.from(currencyEl.options).some(function (o) { return o.value === data.currency; })) {
                currencyEl.appendChild(h('option', { value: data.currency }, data.currency));
            }
            currencyEl.value = data.currency;
            manualPeople.hidden = true;
            showImport();
        }

        function submitImport(name) {
            const gid = C.newGroupId();
            const doc = C.emptyGroup(gid);
            doc.meta = { t: Date.now(), name: name, currency: form.currency, simplify: true };
            store.groups[gid] = doc;
            const ids = {};
            imported.members.forEach(function (member) {
                const id = C.newId();
                ids[member] = id;
                doc.members[id] = { id: id, t: C.nextT(doc), name: member, left: false };
            });
            store.me[gid] = ids[imported.me];
            C.importSplid(doc, imported, ids, ids[imported.me]);
            logActivity(doc, 'group-create', '', name);
            logActivity(doc, 'import', '', importCounts(imported).replace(' · ', ' und '));
            persist();
            go('/g/' + gid);
        }

        function submit(e) {
            e.preventDefault();
            const name = nameInput.value.trim();
            if (imported) {
                if (!name || !imported.me) {
                    error.textContent = !name ? 'Bitte gib einen Gruppennamen ein.' : 'Bitte wähle aus, wer du bist.';
                    error.hidden = false;
                    return;
                }
                submitImport(name);
                return;
            }
            const myName = meInput.value.trim();
            if (!name || !myName) {
                error.textContent = 'Bitte gib einen Gruppennamen und deinen eigenen Namen ein.';
                error.hidden = false;
                return;
            }
            const gid = C.newGroupId();
            const doc = C.emptyGroup(gid);
            doc.meta = { t: Date.now(), name: name, currency: form.currency, simplify: true };
            store.groups[gid] = doc;

            const myId = C.newId();
            doc.members[myId] = { id: myId, t: C.nextT(doc), name: myName, left: false };
            store.me[gid] = myId;
            friends.querySelectorAll('input').forEach(function (input) {
                const friend = input.value.trim();
                if (!friend) return;
                const id = C.newId();
                doc.members[id] = { id: id, t: C.nextT(doc), name: friend, left: false };
            });
            logActivity(doc, 'group-create', '', name);
            persist();
            go('/g/' + gid);
        }

        manualPeople.appendChild(h('div', { class: 'field' }, h('label', { for: 'myName' }, 'Dein Name'), meInput));
        manualPeople.appendChild(h('span', { class: 'field-label' }, 'Wer ist noch dabei?'));
        manualPeople.appendChild(friends);

        return h('div', null,
            h('a', { class: 'back', href: '#/' }, '‹ Gruppen'),
            h('form', { class: 'panel', onsubmit: submit },
                h('h2', null, 'Neue Gruppe'),
                error,
                h('div', { class: 'field' },
                    h('label', { class: 'btn btn-small btn-block' }, 'Aus Splid importieren',
                        h('input', { type: 'file', accept: '.xls,application/vnd.ms-excel', hidden: true, onchange: onImport })),
                    h('div', { class: 'field-hint' }, 'Excel-Datei aus Splid (.xls). Sie wird nur in deinem Browser gelesen.')),
                h('div', { class: 'field' },
                    h('label', { for: 'groupName' }, 'Name der Gruppe'),
                    h('div', { class: 'name-row' }, avatarSlot, nameInput),
                    h('div', { class: 'field-hint' }, 'Ein Emoji im Namen wird zum Symbol, sonst die Anfangsbuchstaben.')),
                h('div', { class: 'field' },
                    h('label', { for: 'groupCurrency' }, 'Währung'),
                    currencyEl),
                importSummary,
                manualPeople,
                h('div', { class: 'actions' },
                    h('button', { class: 'btn btn-block', type: 'submit' }, 'Gruppe anlegen'))));
    }

    /* ---------- Gruppenansichten ---------- */

    function memberName(doc, id) {
        return doc.members[id] ? doc.members[id].name : 'Unbekannt';
    }

    function activeMembers(doc) {
        return Object.keys(doc.members)
            .map(function (id) { return doc.members[id]; })
            .filter(function (m) { return !m.left; })
            .sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    }

    function viewGroupRoute(doc, route) {
        if (!doc.meta.t) return viewWaiting(doc);
        if (!meId(doc.id)) return viewWhoAmI(doc);

        if (route.section === 'expense') {
            const existing = route.id ? doc.expenses[route.id] : null;
            if (route.id && !existing) return viewNotFound(doc);
            if (route.id && route.mode !== 'edit') return viewExpenseDetail(doc, existing);
            return viewExpenseForm(doc, existing);
        }
        if (route.section === 'pay') {
            const payment = route.id ? doc.payments[route.id] : null;
            if (route.id && !payment) return viewNotFound(doc);
            return viewPaymentForm(doc, payment, route.params);
        }
        return viewGroup(doc, route.section);
    }

    function viewNotFound(doc) {
        return h('div', null,
            backLink(doc),
            h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'Dieser Eintrag ist auf diesem Gerät noch nicht vorhanden.')));
    }

    function backLink(doc, section, label) {
        return h('a', { class: 'back', href: '#/g/' + doc.id + (section ? '/' + section : '') }, '‹ ' + (label || doc.meta.name));
    }

    function viewWaiting(doc) {
        return h('div', null,
            h('a', { class: 'back', href: '#/' }, '‹ Gruppen'),
            h('section', { class: 'panel' },
                h('div', { class: 'empty' },
                    h('span', { class: 'big', 'aria-hidden': 'true' }, '📡'),
                    'Warte auf die Daten der Gruppe. Das klappt, sobald die Person, die dich eingeladen hat, die Gruppe auf ihrem Gerät geöffnet hat.',
                    h('div', null, h('span', { id: 'syncPill', class: syncPillClass() }, syncLabel()))),
                h('div', { class: 'actions' },
                    h('button', {
                        class: 'btn btn-danger btn-small', type: 'button',
                        onclick: function () { removeGroup(doc); }
                    }, 'Einladung verwerfen'))));
    }

    function removeGroup(doc) {
        delete store.groups[doc.id];
        delete store.me[doc.id];
        if (store.last === doc.id) store.last = null;
        delete store.seen[doc.id];
        persist();
        go('/');
    }

    function viewWhoAmI(doc) {
        const members = activeMembers(doc);
        const input = h('input', { type: 'text', maxlength: 40, placeholder: 'Dein Name', 'aria-label': 'Dein Name', autocomplete: 'name' });

        function join(e) {
            e.preventDefault();
            const name = input.value.trim();
            if (!name) return;
            const id = C.newId();
            doc.members[id] = { id: id, t: C.nextT(doc), name: name, left: false };
            store.me[doc.id] = id;
            logActivity(doc, 'member-add', id, name);
            commit(doc);
            render();
        }

        return h('div', null,
            h('a', { class: 'back', href: '#/' }, '‹ Gruppen'),
            h('header', { class: 'group-head' },
                groupAvatar(doc.meta.name, true),
                h('h1', null, doc.meta.name)),
            h('section', { class: 'panel' },
                h('h2', null, 'Wer bist du?'),
                h('div', { class: 'list' }, members.map(function (m) {
                    return h('button', {
                        class: 'btn btn-block', type: 'button', style: 'margin-bottom:8px',
                        onclick: function () {
                            store.me[doc.id] = m.id;
                            persist();
                            render();
                        }
                    }, m.name);
                })),
                h('h2', null, 'Nicht dabei?'),
                h('form', { class: 'add-row', onsubmit: join },
                    input,
                    h('button', { class: 'btn', type: 'submit' }, 'Hinzufügen'))));
    }

    function viewGroup(doc, tab) {
        const known = ['expenses', 'balances', 'stats', 'activity', 'settings'];
        if (known.indexOf(tab) === -1) tab = 'expenses';
        const balances = C.computeBalances(doc);
        const me = meId(doc.id);
        const hasEntries = C.liveExpenses(doc).length + C.livePayments(doc).length > 0;
        const settled = hasEntries && C.isSettled(balances);
        const mine = myBalances(doc, balances);

        let summary;
        if (settled) summary = h('div', { class: 'kwidt-banner' }, 'Ihr seid kwidt! 🎉');
        else if (mine.length) {
            summary = h('div', { class: 'my-balance' }, mine.map(function (b) {
                return h('div', null, b.amount > 0 ? 'Du bekommst ' : 'Du schuldest ', balanceSpan(b.amount, b.cur));
            }));
        } else if (hasEntries) summary = h('div', { class: 'my-balance muted' }, 'Für dich ist alles ausgeglichen.');

        const tabs = [['expenses', 'Ausgaben'], ['balances', 'Salden'], ['stats', 'Statistik'], ['activity', 'Verlauf'], ['settings', 'Gruppe']];
        const content = {
            expenses: viewExpensesTab,
            balances: viewBalancesTab,
            stats: viewStatsTab,
            activity: viewActivityTab,
            settings: viewSettingsTab
        }[tab](doc, balances, me);

        return h('div', null,
            h('a', { class: 'back', href: '#/' }, '‹ Gruppen'),
            h('header', { class: 'group-head' },
                groupAvatar(doc.meta.name, true),
                h('h1', null, doc.meta.name),
                h('a', { id: 'syncPill', class: syncPillClass(), href: '#/g/' + doc.id + '/settings' }, syncLabel()),
                h('div', { class: 'data-state', title: 'Gleiches Emoji auf zwei Geräten heißt: gleicher Stand.' },
                    h('span', null, 'Stand'), C.dataFingerprint(doc),
                    h('div', { class: 'data-state-hint' }, 'Ändert sich, wenn Daten geändert werden'))),
            summary ? h('section', { class: 'panel' }, summary) : null,
            h('div', { class: 'group-actions' },
                h('a', { class: 'btn', href: '#/g/' + doc.id + '/expense' }, '+ Ausgabe'),
                h('a', { class: 'btn', href: '#/g/' + doc.id + '/pay' }, '+ Zahlung')),
            h('nav', { class: 'tabs', 'aria-label': 'Gruppenbereiche' }, tabs.map(function (t) {
                return h('a', {
                    href: '#/g/' + doc.id + (t[0] === 'expenses' ? '' : '/' + t[0]),
                    'aria-current': t[0] === tab ? 'page' : null
                }, t[1]);
            })),
            content);
    }

    /* Ausgaben */

    /** Ohne Betrag: Der steht in der Liste in einer eigenen Spalte. */
    function payerText(doc, e, me) {
        const payers = Object.keys(e.payers).filter(function (id) { return e.payers[id] > 0; });
        const verb = e.refund ? ' es bekommen' : ' bezahlt';
        if (payers.length > 1) return payers.length + ' Personen haben' + verb;
        if (payers[0] === me) return 'Du hast' + verb;
        return memberName(doc, payers[0]) + ' hat' + verb;
    }

    function paymentText(doc, p, me) {
        if (p.from === me) return 'Du hast ' + memberName(doc, p.to) + ' gezahlt';
        if (p.to === me) return memberName(doc, p.from) + ' hat dir gezahlt';
        return memberName(doc, p.from) + ' hat ' + memberName(doc, p.to) + ' gezahlt';
    }

    /** Spalte mit dem ganzen Betrag, vor dem, was davon auf dich entfällt. */
    function amountColumn(label, minor, cur) {
        return h('span', { class: 'total' }, h('span', { class: 'muted' }, label), h('strong', null, money(minor, cur)));
    }

    function expenseEffect(e, me) {
        const owed = C.computeOwed(e) || {};
        const net = C.expenseSign(e) * ((e.payers[me] || 0) - (owed[me] || 0));
        if (net > 0) return h('span', { class: 'side' }, h('span', { class: 'muted' }, 'du bekommst'), h('strong', { class: 'pos' }, money(net, e.currency)));
        if (net < 0) return h('span', { class: 'side' }, h('span', { class: 'muted' }, 'du schuldest'), h('strong', { class: 'neg' }, money(-net, e.currency)));
        return h('span', { class: 'side muted' }, e.payers[me] || owed[me] ? 'ausgeglichen' : 'nicht beteiligt');
    }

    /** Der Suchbegriff gilt für Name, Notiz, Positionen und Kommentare. */
    function matchesSearch(entry, term, commentTexts) {
        if (!term) return true;
        const parts = entry.kind === 'expense'
            ? [entry.e.desc, entry.e.note]
                .concat((entry.e.items || []).map(function (item) { return item.name; }))
                .concat(commentTexts[entry.e.id] || [])
            : [entry.p.note, 'zahlung'];
        return parts.join('\n').toLocaleLowerCase('de').indexOf(term) !== -1;
    }

    /** Betragsgrenze aus dem Filter als Zahl in ganzen Einheiten (12,50 → 12.5), sonst null. */
    function filterBound(text) {
        if (!String(text).trim()) return null;
        const minor = C.parseAmount(text, 'EUR');
        return minor === null ? null : minor / 100;
    }

    function activeFilterCount() {
        const f = state.filter;
        return (state.search.trim() ? 1 : 0)
            + ['payer', 'member', 'category'].filter(function (k) { return f[k]; }).length
            + (filterBound(f.min) !== null || filterBound(f.max) !== null ? 1 : 0);
    }

    /** Zahlungen zählen mit: Wer überweist, hat gezahlt, beide sind beteiligt. Eine Kategorie haben sie nicht. */
    function matchesFilter(doc, entry) {
        const f = state.filter;
        const min = filterBound(f.min);
        const max = filterBound(f.max);
        const x = entry.kind === 'expense' ? entry.e : entry.p;
        const value = x.amount / Math.pow(10, C.currencyDecimals(x.currency));
        if (min !== null && value < min) return false;
        if (max !== null && value > max) return false;
        if (entry.kind === 'payment') {
            if (f.category) return false;
            if (f.payer && x.from !== f.payer) return false;
            if (f.member && x.from !== f.member && x.to !== f.member) return false;
            return true;
        }
        if (f.category && C.findCategory(doc, x.category).id !== f.category) return false;
        if (f.payer && !(x.payers[f.payer] > 0)) return false;
        if (f.member && !((C.computeOwed(x) || {})[f.member] > 0)) return false;
        return true;
    }

    function renderEntries(container, doc, me, summary) {
        const term = state.search.trim().toLocaleLowerCase('de');
        const filtering = !!term || activeFilterCount() > 0;
        const commentCounts = {};
        const commentTexts = {};
        Object.keys(doc.comments).forEach(function (id) {
            const c = doc.comments[id];
            if (c.del) return;
            commentCounts[c.expense] = (commentCounts[c.expense] || 0) + 1;
            (commentTexts[c.expense] = commentTexts[c.expense] || []).push(c.text);
        });

        const entries = C.liveExpenses(doc).map(function (e) { return { kind: 'expense', date: e.date, t: e.t, e: e }; })
            .concat(C.livePayments(doc).map(function (p) { return { kind: 'payment', date: p.date, t: p.t, p: p }; }))
            .filter(function (entry) { return matchesSearch(entry, term, commentTexts) && matchesFilter(doc, entry); })
            .sort(function (a, b) {
                if (a.date !== b.date) return a.date < b.date ? 1 : -1;
                return b.t - a.t;
            });

        if (summary) {
            summary.textContent = '';
            summary.hidden = !filtering || !entries.length;
            if (filtering && entries.length) {
                const expenses = entries.filter(function (entry) { return entry.kind === 'expense'; });
                const totals = {};
                expenses.forEach(function (entry) {
                    totals[entry.e.currency] = (totals[entry.e.currency] || 0) + C.expenseSign(entry.e) * entry.e.amount;
                });
                const parts = [];
                if (expenses.length) {
                    parts.push(expenses.length + (expenses.length === 1 ? ' Ausgabe' : ' Ausgaben') + ': '
                        + Object.keys(totals).map(function (cur) { return money(totals[cur], cur); }).join(' + '));
                }
                const payments = entries.length - expenses.length;
                if (payments) parts.push(payments + (payments === 1 ? ' Zahlung' : ' Zahlungen'));
                summary.textContent = parts.join(' · ');
            }
        }

        container.textContent = '';
        if (!entries.length) {
            container.appendChild(h('div', { class: 'empty' }, filtering ? 'Nichts gefunden.' : [
                h('span', { class: 'big', 'aria-hidden': 'true' }, '🧾'),
                'Noch keine Ausgaben. Trag die erste ein.'
            ]));
            return;
        }

        let month = null;
        entries.forEach(function (entry) {
            const label = monthLabel(entry.date);
            if (label !== month) {
                month = label;
                container.appendChild(h('div', { class: 'month' }, label));
            }
            if (entry.kind === 'expense') {
                const e = entry.e;
                const isRecurring = e.parent || (e.repeat && e.repeat !== 'none');
                const comments = commentCounts[e.id];
                container.appendChild(h('a', { class: 'item', href: '#/g/' + doc.id + '/expense/' + e.id },
                    categoryIcon(doc, e.category),
                    h('span', { class: 'body' },
                        h('div', { class: 'title' }, e.desc, isRecurring ? ' 🔁' : ''),
                        h('div', { class: 'sub' }, formatDate(e.date) + ' · ' + payerText(doc, e, me) + (comments ? ' · 💬 ' + comments : ''))),
                    amountColumn(e.refund ? 'Rückzahlung' : 'Ausgabe', e.amount, e.currency),
                    expenseEffect(e, me)));
            } else {
                const p = entry.p;
                container.appendChild(h('a', { class: 'item', href: '#/g/' + doc.id + '/pay/' + p.id },
                    h('span', { class: 'icon', 'aria-hidden': 'true' }, '🤝'),
                    h('span', { class: 'body' },
                        h('div', { class: 'title' }, paymentText(doc, p, me)),
                        h('div', { class: 'sub' }, formatDate(p.date) + (p.note ? ' · ' + p.note : ''))),
                    amountColumn('Zahlung', p.amount, p.currency),
                    h('span', { class: 'side' })));
            }
        });
    }

    function daysUntil(dateStr) {
        const p = dateStr.split('-').map(Number);
        const now = new Date();
        const days = Math.round((new Date(p[0], p[1] - 1, p[2]) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
        return new Intl.RelativeTimeFormat('de', { numeric: 'auto' }).format(days, 'day');
    }

    function nextBookingText(doc, series) {
        const date = C.nextOccurrence(doc, series, C.todayStr());
        return date ? 'nächste am ' + formatDate(date, true) + ' (' + daysUntil(date) + ')' : 'keine weitere geplant';
    }

    function viewSeriesPanel(doc) {
        const today = C.todayStr();
        const series = C.liveSeries(doc).sort(function (a, b) {
            return (C.nextOccurrence(doc, a, today) || '') < (C.nextOccurrence(doc, b, today) || '') ? -1 : 1;
        });
        if (!series.length) return null;
        return h('section', { class: 'panel' },
            h('h2', null, 'Wiederkehrend'),
            h('div', { class: 'list' }, series.map(function (e) {
                return h('a', { class: 'item', href: '#/g/' + doc.id + '/expense/' + e.id },
                    categoryIcon(doc, e.category),
                    h('span', { class: 'body' },
                        h('div', { class: 'title' }, e.desc),
                        h('div', { class: 'sub' }, (e.refund ? 'Rückzahlung · ' : '') + REPEAT_LABELS[e.repeat] + ' · ' + nextBookingText(doc, e))),
                    h('span', { class: 'side' }, h('strong', null, money(C.expenseSign(e) * e.amount, e.currency))));
            })));
    }

    function viewExpensesTab(doc, balances, me) {
        const list = h('div', { class: 'list' });
        const summary = h('div', { class: 'filter-summary', hidden: true });
        const members = activeMembers(doc);
        const filterButton = h('button', {
            class: 'btn btn-small filter-toggle', type: 'button', 'aria-expanded': String(state.filterOpen),
            onclick: function () {
                state.filterOpen = !state.filterOpen;
                filterButton.setAttribute('aria-expanded', String(state.filterOpen));
                filterBox.hidden = !state.filterOpen;
                if (state.filterOpen) filterBox.querySelector('#filterSearch').focus();
            }
        });
        const filterBox = viewFilterBox(doc, me, update);
        filterBox.hidden = !state.filterOpen;

        function update() {
            const count = activeFilterCount();
            filterButton.textContent = count ? 'Filter (' + count + ')' : 'Filter';
            filterButton.classList.toggle('on', count > 0);
            renderEntries(list, doc, me, summary);
        }
        update();

        return h('div', null, viewSeriesPanel(doc), h('section', { class: 'panel' },
            members.length < 2 ? h('div', { class: 'notice' },
                'Du bist noch allein hier. ',
                h('a', { href: '#/g/' + doc.id + '/settings' }, 'Lade deine Freunde ein.')) : null,
            h('div', { class: 'filter-bar' }, filterButton),
            filterBox,
            summary,
            list));
    }

    /** Suche und Filter nach Betrag, Person und Kategorie. Personen, die gegangen sind, bleiben wählbar. */
    function viewFilterBox(doc, me, onChange) {
        const f = state.filter;
        const search = h('input', {
            id: 'filterSearch', type: 'search', placeholder: 'Name, Notiz oder Kommentar', autocomplete: 'off',
            value: state.search,
            oninput: function (e) {
                state.search = e.target.value;
                onChange();
            }
        });
        const people = Object.keys(doc.members)
            .map(function (id) { return doc.members[id]; })
            .sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });

        function personSelect(id, key) {
            return h('select', {
                id: id, value: f[key],
                onchange: function (e) { f[key] = e.target.value; onChange(); }
            },
                h('option', { value: '' }, 'Alle'),
                people.map(function (m) { return h('option', { value: m.id }, m.id === me ? m.name + ' (du)' : m.name); }));
        }
        function amountInput(id, key, placeholder) {
            return h('input', {
                id: id, type: 'text', inputmode: 'decimal', placeholder: placeholder, autocomplete: 'off', value: f[key],
                oninput: function (e) {
                    f[key] = e.target.value;
                    e.target.classList.toggle('bad', !!e.target.value.trim() && filterBound(e.target.value) === null);
                    onChange();
                }
            });
        }

        const payer = personSelect('filterPayer', 'payer');
        const member = personSelect('filterMember', 'member');
        const category = h('select', {
            id: 'filterCategory', value: f.category,
            onchange: function (e) { f.category = e.target.value; onChange(); }
        },
            h('option', { value: '' }, 'Alle'),
            C.groupCategories(doc).map(function (c) { return h('option', { value: c.id }, categoryLabel(c)); }));
        const min = amountInput('filterMin', 'min', 'von');
        const max = amountInput('filterMax', 'max', 'bis');

        return h('div', { class: 'filter-box' },
            h('div', { class: 'field' }, h('label', { for: 'filterSearch' }, 'Suchen'), search),
            h('div', { class: 'field-row' },
                h('div', { class: 'field' }, h('label', { for: 'filterPayer' }, 'Bezahlt von'), payer),
                h('div', { class: 'field' }, h('label', { for: 'filterMember' }, 'Beteiligt'), member)),
            h('div', { class: 'field-row' },
                h('div', { class: 'field' }, h('label', { for: 'filterCategory' }, 'Kategorie'), category),
                h('div', { class: 'field' },
                    h('label', { for: 'filterMin' }, 'Betrag'),
                    h('div', { class: 'range-row' }, min, h('span', { 'aria-hidden': 'true' }, '–'), max))),
            h('button', {
                class: 'link-btn small', type: 'button',
                onclick: function () {
                    Object.assign(f, emptyFilter());
                    state.search = '';
                    search.value = payer.value = member.value = category.value = min.value = max.value = '';
                    min.classList.remove('bad');
                    max.classList.remove('bad');
                    onChange();
                }
            }, 'Filter zurücksetzen'));
    }

    /* Salden */

    function summaryText(doc, balances) {
        const lines = ['Kwidt – ' + doc.meta.name, ''];
        const currencies = Object.keys(balances);
        currencies.forEach(function (cur) {
            if (currencies.length > 1) lines.push(cur);
            Object.keys(balances[cur]).forEach(function (id) {
                const amount = balances[cur][id];
                if (amount > 0) lines.push(memberName(doc, id) + ' bekommt ' + money(amount, cur));
                else if (amount < 0) lines.push(memberName(doc, id) + ' schuldet ' + money(-amount, cur));
            });
            const transfers = C.settlements(doc, cur, balances);
            if (transfers.length) {
                lines.push('', 'So werdet ihr kwidt:');
                transfers.forEach(function (t) {
                    lines.push(memberName(doc, t.from) + ' zahlt ' + memberName(doc, t.to) + ' ' + money(t.amount, cur));
                });
            }
            lines.push('');
        });
        return lines.join('\n').trim();
    }

    function viewBalancesTab(doc, balances, me) {
        const currencies = C.currenciesUsed(doc).filter(function (cur) {
            return balances[cur] && Object.keys(balances[cur]).some(function (id) { return balances[cur][id] !== 0; });
        });

        const sections = currencies.map(function (cur) {
            const rows = Object.keys(balances[cur])
                .sort(function (a, b) { return balances[cur][b] - balances[cur][a]; })
                .map(function (id) {
                    const amount = balances[cur][id];
                    const isMe = id === me;
                    let text;
                    if (amount > 0) text = isMe ? 'Du bekommst' : memberName(doc, id) + ' bekommt';
                    else if (amount < 0) text = isMe ? 'Du schuldest' : memberName(doc, id) + ' schuldet';
                    else text = isMe ? 'Du bist kwidt' : memberName(doc, id) + ' ist kwidt';
                    return h('div', { class: 'kv' }, h('span', null, text),
                        amount ? h('span', null, balanceSpan(amount, cur)) : h('span', { class: 'muted' }, '–'));
                });

            const transfers = C.settlements(doc, cur, balances).map(function (t) {
                const href = '#/g/' + doc.id + '/pay?' + new URLSearchParams({
                    from: t.from, to: t.to, amount: t.amount, cur: cur
                }).toString();
                const fromText = t.from === me ? 'Du zahlst' : memberName(doc, t.from) + ' zahlt';
                const toText = t.to === me ? 'dir' : memberName(doc, t.to);
                return h('div', { class: 'item' },
                    h('span', { class: 'body' },
                        h('div', { class: 'title' }, fromText + ' ' + toText),
                        h('div', { class: 'sub' }, money(t.amount, cur))),
                    h('a', { class: 'btn btn-small', href: href }, 'Begleichen'));
            });

            return h('section', { class: 'panel' },
                h('h2', null, currencies.length > 1 ? 'Salden in ' + cur : 'Salden'),
                rows,
                h('h2', null, 'So werdet ihr kwidt'),
                h('div', { class: 'list' }, transfers));
        });

        return h('div', null,
            sections.length ? sections : h('section', { class: 'panel' },
                h('div', { class: 'empty' }, h('span', { class: 'big', 'aria-hidden': 'true' }, '🤝'), 'Niemand schuldet jemandem etwas.')),
            h('section', { class: 'panel' },
                h('label', { class: 'switch-row' },
                    h('input', {
                        type: 'checkbox', checked: doc.meta.simplify,
                        onchange: function (e) {
                            doc.meta = Object.assign({}, doc.meta, { simplify: e.target.checked, t: C.nextT(doc) });
                            commit(doc);
                            e.target.blur();
                            render();
                        }
                    }),
                    h('span', null,
                        h('strong', null, 'Schulden vereinfachen'),
                        h('div', { class: 'small muted' }, 'Fasst Schulden zusammen, damit möglichst wenige Überweisungen nötig sind. Dann zahlst du eventuell jemandem, dem du nicht direkt etwas schuldest. Die Beträge unterm Strich bleiben gleich.'))),
                h('div', { class: 'actions' },
                    sections.length ? h('button', {
                        class: 'btn', type: 'button',
                        onclick: function () { shareText('Kwidt – ' + doc.meta.name, summaryText(doc, balances)); }
                    }, 'Stand teilen') : null)));
    }

    /* Statistik */

    function barRow(label, value, max, cur) {
        return h('div', { class: 'bar-row' },
            h('span', { class: 'label' }, label),
            h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: 'width:' + (max > 0 ? Math.max(0, value) / max * 100 : 0).toFixed(1) + '%' })),
            h('span', { class: 'value' }, money(value, cur)));
    }

    function viewStatsTab(doc) {
        const currencies = C.currenciesUsed(doc);
        const cur = currencies.indexOf(state.statsCur) !== -1 ? state.statsCur : currencies[0];
        const stats = C.statistics(doc, cur);
        const picker = currencies.length > 1 ? h('div', { class: 'field' },
            h('label', { for: 'statsCur' }, 'Währung'),
            h('select', {
                id: 'statsCur', value: cur,
                onchange: function (e) {
                    state.statsCur = e.target.value;
                    e.target.blur();
                    render();
                }
            }, currencies.map(function (c) { return h('option', { value: c }, c); }))) : null;

        if (!stats.count) {
            return h('section', { class: 'panel' }, picker, h('div', { class: 'empty' }, 'Noch nichts auszuwerten.'));
        }

        const maxCategory = stats.byCategory[0].amount;
        return h('div', null,
            h('section', { class: 'panel' },
                picker,
                h('h2', null, 'Gesamtausgaben'),
                h('div', { class: 'stat-total' }, money(stats.total, cur)),
                h('div', { class: 'small muted' }, stats.count + (stats.count === 1 ? ' Ausgabe' : ' Ausgaben'))),
            h('section', { class: 'panel' },
                h('h2', null, 'Nach Kategorie'),
                stats.byCategory.map(function (row) {
                    return barRow(categoryText(doc, row.id), row.amount, maxCategory, cur);
                })),
            h('section', { class: 'panel' },
                h('h2', null, 'Nach Person'),
                h('div', { class: 'table-wrap' },
                    h('table', { class: 'stat' },
                        h('thead', null, h('tr', null,
                            h('th', { scope: 'col' }, 'Person'),
                            h('th', { scope: 'col' }, 'Bezahlt'),
                            h('th', { scope: 'col' }, 'Anteil'))),
                        h('tbody', null, stats.byMember.map(function (m) {
                            return h('tr', null,
                                h('td', null, memberName(doc, m.id)),
                                h('td', null, money(m.paid, cur)),
                                h('td', null, money(m.share, cur)));
                        }))))));
    }

    /* Verlauf */

    function activityText(doc, a) {
        const who = a.by === meId(doc.id) ? 'Du hast' : (a.by && doc.members[a.by] ? doc.members[a.by].name + ' hat' : 'Jemand hat');
        const label = '„' + a.label + '“';
        switch (a.kind) {
            case 'group-create': return who + ' die Gruppe angelegt';
            case 'group-edit': return who + ' die Gruppe bearbeitet';
            case 'expense-add': return who + ' ' + label + ' hinzugefügt';
            case 'expense-edit': return who + ' ' + label + ' geändert';
            case 'expense-del': return who + ' ' + label + ' gelöscht';
            case 'expense-restore': return who + ' ' + label + ' wiederhergestellt';
            case 'comment': return who + ' ' + label + ' kommentiert';
            case 'claim': return who + ' bei ' + label + ' Positionen zugeordnet';
            case 'import': return who + ' ' + a.label + ' aus Splid importiert';
            case 'category-add': return who + ' die Kategorie ' + label + ' hinzugefügt';
            case 'category-del': return who + ' die Kategorie ' + label + ' entfernt';
            case 'pay-add': return who + ' eine Zahlung eingetragen: ' + a.label;
            case 'pay-edit': return who + ' eine Zahlung geändert: ' + a.label;
            case 'pay-del': return who + ' eine Zahlung gelöscht: ' + a.label;
            case 'member-add': return who + ' ' + a.label + ' hinzugefügt';
            case 'member-left': return who + ' ' + a.label + ' aus der Gruppe genommen';
            case 'member-back': return who + ' ' + a.label + ' wieder aufgenommen';
            default: return who + ' etwas geändert';
        }
    }

    function viewActivityTab(doc) {
        const entries = Object.keys(doc.activity).map(function (id) { return doc.activity[id]; })
            .sort(function (a, b) { return b.t - a.t; })
            .slice(0, 150);
        if (!entries.length) return h('section', { class: 'panel' }, h('div', { class: 'empty' }, 'Noch nichts passiert.'));

        return h('section', { class: 'panel' }, h('div', { class: 'list' }, entries.map(function (a) {
            const body = [
                h('span', { class: 'body' },
                    h('div', { class: 'title' }, activityText(doc, a)),
                    h('div', { class: 'sub' }, timeAgo(a.t) + (a.amount ? ' · ' + money(a.amount, a.currency) : '')))
            ];
            const target = /^expense|^comment|^claim/.test(a.kind) && doc.expenses[a.ref]
                ? '#/g/' + doc.id + '/expense/' + a.ref
                : /^pay/.test(a.kind) && doc.payments[a.ref] && !doc.payments[a.ref].del
                    ? '#/g/' + doc.id + '/pay/' + a.ref : null;
            return target ? h('a', { class: 'item', href: target }, body) : h('div', { class: 'item' }, body);
        })));
    }

    /* Gruppe / Einstellungen */

    function saveMeta(doc, patch, withLog) {
        doc.meta = Object.assign({}, doc.meta, patch, { t: C.nextT(doc) });
        if (withLog) logActivity(doc, 'group-edit', '', doc.meta.name);
        commit(doc);
        softRender();
    }

    function viewInvitePanel(doc) {
        const qrBox = h('div', { class: 'qr-card' });
        if (typeof QRCode !== 'undefined') {
            const box = h('div');
            qrBox.appendChild(box);
            new QRCode(box, {
                text: shortLink(doc),
                width: 200, height: 200,
                colorDark: '#14121a', colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        }

        function linkOption(title, text, short) {
            return h('div', { class: 'link-option' },
                h('div', { class: 'link-title' }, title),
                h('p', { class: 'small muted' }, text),
                h('div', { class: 'actions' },
                    h('button', {
                        class: 'btn', type: 'button',
                        onclick: async function () {
                            const link = short ? shortLink(doc) : await inviteLink(doc);
                            toast(await copyText(link) ? 'Link kopiert.' : 'Kopieren hat nicht geklappt.');
                        }
                    }, 'Kopieren'),
                    h('button', {
                        class: 'btn', type: 'button',
                        onclick: function () { shareInvite(doc, null, short); }
                    }, 'Teilen')));
        }

        return h('section', { class: 'panel' },
            h('h2', null, 'Einladen & abgleichen'),
            linkOption('Kurzer Link', 'Enthält nur die Adresse der Gruppe. Die Daten kommen per Live-Abgleich, also nur, solange jemand die Gruppe gerade offen hat.', true),
            linkOption('Link mit Daten', 'Enthält den aktuellen Stand und funktioniert immer. Beim Öffnen wird er mit dem vorhandenen Stand zusammengeführt, das klappt auch später zum Abgleichen.', false),
            h('div', { class: 'link-option' },
                h('div', { class: 'link-title' }, 'QR-Code'),
                h('p', { class: 'small muted' }, 'Wie der kurze Link: Er enthält nur die Adresse der Gruppe.'),
                qrBox),
            h('p', { class: 'small muted', style: 'margin-top:14px' }, 'Wer einen Link hat, kann die Gruppe lesen und bearbeiten. Für den Live-Abgleich wird der öffentliche Dienst PeerJS genutzt, die Daten selbst gehen verschlüsselt von Gerät zu Gerät.'),
            h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Das Emoji neben „Stand“ oben ist ein Fingerabdruck eurer Eingaben: Sieht es auf zwei Geräten gleich aus, seid ihr auf demselben Stand.'));
    }

    function viewMembersPanel(doc, balances, me) {
        const allMembers = Object.keys(doc.members).map(function (id) { return doc.members[id]; })
            .sort(function (a, b) { return (a.left - b.left) || a.name.localeCompare(b.name, 'de'); });

        function hasOpenBalance(id) {
            return Object.keys(balances).some(function (cur) { return balances[cur][id]; });
        }
        function saveMember(member, patch, kind) {
            const next = Object.assign({}, member, patch, { t: C.nextT(doc) });
            doc.members[member.id] = next;
            if (kind) logActivity(doc, kind, member.id, next.name);
            commit(doc);
            render();
        }

        const rows = allMembers.map(function (m) {
            let action;
            if (m.left) {
                action = h('button', {
                    class: 'btn btn-small', type: 'button',
                    onclick: function () { saveMember(m, { left: false }, 'member-back'); }
                }, 'Zurückholen');
            } else if (m.id !== me) {
                action = h('button', {
                    class: 'btn btn-small', type: 'button',
                    onclick: function () {
                        if (hasOpenBalance(m.id)) {
                            toast(m.name + ' hat noch einen offenen Saldo und kann erst danach raus.');
                            return;
                        }
                        saveMember(m, { left: true }, 'member-left');
                    }
                }, 'Entfernen');
            }
            return h('div', { class: 'member-row' },
                h('input', {
                    type: 'text', maxlength: 40, value: m.name, 'aria-label': 'Name von ' + m.name,
                    onchange: function (e) {
                        const name = e.target.value.trim();
                        if (name && name !== m.name) saveMember(m, { name: name });
                        else e.target.value = m.name;
                    }
                }),
                h('span', { class: 'state' }, m.id === me ? 'Du' : m.left ? 'Raus' : ''),
                action || h('span'));
        });

        const addInput = h('input', { type: 'text', maxlength: 40, placeholder: 'Name', 'aria-label': 'Neue Person' });
        return h('section', { class: 'panel' },
            h('h2', null, 'Personen'),
            rows,
            h('form', {
                class: 'add-row',
                onsubmit: function (e) {
                    e.preventDefault();
                    const name = addInput.value.trim();
                    if (!name) return;
                    const id = C.newId();
                    doc.members[id] = { id: id, t: C.nextT(doc), name: name, left: false };
                    logActivity(doc, 'member-add', id, name);
                    commit(doc);
                    addInput.value = '';
                    addInput.blur();
                    render();
                }
            }, addInput, h('button', { class: 'btn', type: 'submit' }, 'Hinzufügen')),
            h('div', { class: 'field', style: 'margin:16px 0 0' },
                h('label', { for: 'whoAmI' }, 'Das bin ich auf diesem Gerät'),
                h('select', {
                    id: 'whoAmI', value: me,
                    onchange: function (e) {
                        store.me[doc.id] = e.target.value;
                        persist();
                        e.target.blur();
                        render();
                    }
                }, activeMembers(doc).map(function (m) { return h('option', { value: m.id }, m.name); }))));
    }

    function viewCategoriesPanel(doc) {
        const list = C.groupCategories(doc).filter(function (c) { return c.id !== 'general'; });
        const addInput = h('input', { type: 'text', maxlength: 40, placeholder: 'Neue Kategorie', 'aria-label': 'Neue Kategorie', autocomplete: 'off' });

        function save(kind, label) {
            logActivity(doc, kind, '', label);
            commit(doc);
            render();
        }

        function remove(c) {
            C.removeCategory(doc, c.id);
            save('category-del', c.label);
            toast('„' + c.label + '“ entfernt.', 'Rückgängig', function () {
                C.addCategory(doc, c.label);
                save('category-add', c.label);
            });
        }

        const body = [
            h('p', { class: 'small muted', style: 'margin-bottom:6px' }, 'Gelten für die ganze Gruppe. Heißt eine Ausgabe genauso wie eine Kategorie, wird sie ausgewählt. Entfernst du eine Kategorie, zeigen ihre Ausgaben keine Kategorie mehr, bis du sie wieder ergänzt.'),
            list.map(function (c) {
                return h('div', { class: 'category-row' },
                    h('span', null, categoryLabel(c)),
                    h('button', {
                        class: 'btn btn-small', type: 'button',
                        onclick: function () { remove(c); }
                    }, 'Entfernen'));
            }),
            h('form', {
                class: 'add-row',
                onsubmit: function (e) {
                    e.preventDefault();
                    const result = C.addCategory(doc, addInput.value);
                    if (!result) return;
                    if (result.exists) {
                        toast('Diese Kategorie gibt es schon.');
                        return;
                    }
                    addInput.value = '';
                    addInput.blur();
                    save('category-add', result.category.label);
                }
            }, addInput, h('button', { class: 'btn', type: 'submit' }, 'Hinzufügen'))
        ];

        const section = fold('Kategorien', h('span', { class: 'fold-value' }, String(list.length)), body, state.categoriesOpen);
        section.addEventListener('toggle', function () { state.categoriesOpen = section.open; });
        return h('section', { class: 'panel panel-fold' }, section);
    }

    function viewSettingsTab(doc, balances, me) {
        return h('div', null,
            viewInvitePanel(doc),
            viewMembersPanel(doc, balances, me),
            viewCategoriesPanel(doc),
            h('section', { class: 'panel' },
                h('h2', null, 'Einstellungen'),
                h('div', { class: 'field' },
                    h('label', { for: 'editName' }, 'Name der Gruppe'),
                    h('input', {
                        id: 'editName', type: 'text', maxlength: 60, value: doc.meta.name,
                        onchange: function (e) {
                            const name = e.target.value.trim();
                            if (name && name !== doc.meta.name) saveMeta(doc, { name: name }, true);
                            e.target.value = doc.meta.name;
                        }
                    })),
                h('div', { class: 'field' },
                    h('label', { for: 'editCurrency' }, 'Standardwährung'),
                    currencySelect(doc.meta.currency, function (e) { saveMeta(doc, { currency: e.target.value }, true); }, { id: 'editCurrency' }))),
            h('section', { class: 'panel' },
                h('h2', null, 'Daten'),
                h('div', { class: 'actions', style: 'margin-top:0' },
                    h('button', {
                        class: 'btn', type: 'button',
                        onclick: function () { download('kwidt-' + fileSafe(doc.meta.name) + '.csv', 'text/csv;charset=utf-8', C.toCsv(doc)); }
                    }, 'Als CSV exportieren'),
                    h('button', {
                        class: 'btn btn-danger', type: 'button',
                        onclick: function () {
                            if (confirm('„' + doc.meta.name + '“ von diesem Gerät entfernen? Die anderen behalten ihre Kopie. Über deren Link kommst du zurück.')) {
                                removeGroup(doc);
                            }
                        }
                    }, 'Von diesem Gerät entfernen'))));
    }

    /* ---------- Ausgabe anlegen/bearbeiten ---------- */

    const SPLIT_LABELS = { equal: 'Gleich', exact: 'Beträge', percent: 'Prozent', shares: 'Anteile', adjust: 'Korrektur', items: 'Positionen' };
    const SPLIT_HINTS = {
        equal: 'Alle Angehakten zahlen gleich viel.',
        exact: 'Trag ein, wie viel jede Person genau trägt.',
        percent: 'Trag den Prozentsatz pro Person ein, zusammen 100 %.',
        shares: 'Zum Beispiel 2 für ein Paar und 1 für eine einzelne Person. 0 heißt: nicht beteiligt.',
        adjust: 'Erst kommt die Korrektur (z. B. +5 für ein extra Getränk, -5 für einen Rabatt), der Rest wird gleich geteilt.',
        items: 'Tipp an, wer was hatte. Mehrere Namen teilen sich eine Position. Was niemand antippt, zählt als allgemeine Kosten.'
    };
    const REPEAT_LABELS = { none: 'Nicht wiederholen', weekly: 'Jede Woche', biweekly: 'Alle zwei Wochen', monthly: 'Jeden Monat', yearly: 'Jedes Jahr' };

    /** Einklappbarer Abschnitt. `value` zeigt auch im zugeklappten Zustand den aktuellen Stand. */
    function fold(title, value, body, open) {
        return h('details', { class: 'fold', open: open },
            h('summary', null, h('span', { class: 'fold-title' }, title), value),
            h('div', { class: 'fold-body' }, body));
    }

    /** Ein Knopf pro Person. Mehrere dürfen an sein, dann teilen sie sich die Position. */
    function personChips(doc, ids, me, isOn, onToggle) {
        return h('div', { class: 'chips', role: 'group', 'aria-label': 'Wer hatte das?' }, ids.map(function (id) {
            return h('button', {
                class: 'chip', type: 'button', 'aria-pressed': String(isOn(id)),
                onclick: function (e) {
                    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
                    e.currentTarget.setAttribute('aria-pressed', String(on));
                    onToggle(id, on);
                }
            }, id === me ? 'Du' : memberName(doc, id));
        }));
    }

    function viewExpenseForm(doc, existing) {
        state.formActive = true;
        const me = meId(doc.id);
        const eid = existing ? existing.id : C.newId();

        // Personen aus einer alten Ausgabe bleiben auswählbar, auch wenn sie die Gruppe verlassen haben.
        const memberIds = activeMembers(doc).map(function (m) { return m.id; });
        if (existing) {
            Object.keys(existing.payers).concat(Object.keys(existing.split.values), claimedMembers(existing)).forEach(function (id) {
                if (memberIds.indexOf(id) === -1) memberIds.push(id);
            });
        }

        const existingItems = existing && existing.items ? existing.items : [];
        const form = {
            desc: existing ? existing.desc : '',
            // Rückzahlung: Jemand hat Geld bekommen (z. B. vom Stromversorger), das allen zusteht.
            refund: existing ? !!existing.refund : false,
            amountText: existing ? C.amountToInput(existing.amount, existing.currency) : '',
            currency: existing ? existing.currency : doc.meta.currency,
            date: existing ? existing.date : C.todayStr(),
            category: existing ? C.findCategory(doc, existing.category).id : 'general',
            note: existing ? existing.note : '',
            repeat: existing ? existing.repeat : 'none',
            payMode: 'single',
            payer: me,
            paid: {},
            type: existing ? existing.split.type : 'equal',
            included: {},
            values: { exact: {}, percent: {}, shares: {}, adjust: {} },
            items: existingItems.map(function (item) {
                return { id: item.id, name: item.name, amountText: C.amountToInput(item.amount, existing.currency) };
            }),
            picked: {},
            // Solange niemand einen Betrag vorgibt, ist er die Summe der Positionen.
            amountFollowsItems: !existing
        };
        let nextItemId = existingItems.reduce(function (max, item) { return Math.max(max, item.id); }, 0) + 1;

        existingItems.forEach(function (item) {
            form.picked[item.id] = {};
            C.claimantsOf(existing, item.id).forEach(function (id) { form.picked[item.id][id] = true; });
        });
        const pickedBefore = JSON.parse(JSON.stringify(form.picked));

        memberIds.forEach(function (id) {
            form.included[id] = !existing || existing.split.type === 'exact' || existing.split.type === 'percent'
                || existing.split.type === 'shares' || id in existing.split.values;
            form.values.shares[id] = '1';
        });

        if (existing) {
            const payers = Object.keys(existing.payers).filter(function (id) { return existing.payers[id] > 0; });
            if (payers.length === 1) {
                form.payer = payers[0];
            } else {
                form.payMode = 'multi';
                payers.forEach(function (id) { form.paid[id] = C.amountToInput(existing.payers[id], existing.currency); });
            }
            const values = existing.split.values;
            if (existing.split.type === 'shares') {
                memberIds.forEach(function (id) { form.values.shares[id] = id in values ? String(values[id]).replace('.', ',') : '0'; });
            } else if (existing.split.type === 'percent') {
                Object.keys(values).forEach(function (id) { form.values.percent[id] = String(values[id]).replace('.', ','); });
            } else if (existing.split.type === 'exact' || existing.split.type === 'adjust') {
                Object.keys(values).forEach(function (id) {
                    form.values[existing.split.type][id] = values[id] ? C.amountToInput(values[id], existing.currency) : '';
                });
            }
        }

        const error = h('div', { class: 'form-error', hidden: true });
        const payArea = h('div', null);
        const itemsArea = h('div', null);
        const generalLabel = h('span', { class: 'field-label', style: 'margin-top:12px' }, 'Allgemeine Kosten teilen sich');
        const splitRows = h('div', null);
        const splitHint = h('div', { class: 'split-hint' });
        const splitSum = h('div', { class: 'sum-line' });
        const paySum = h('div', { class: 'sum-line' });
        const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Art der Aufteilung' });
        const payValue = h('span', { class: 'fold-value' });
        const splitValue = h('span', { class: 'fold-value' });
        const moreValue = h('span', { class: 'fold-value' });
        const adoptSum = h('button', {
            class: 'link-btn small', type: 'button', hidden: true,
            onclick: function () { form.amountFollowsItems = true; refresh(); }
        }, 'Betrag auf die Summe setzen');
        const previews = {};

        // Heißt die Ausgabe wie eine Kategorie, wird diese gewählt. Passt der Name nicht
        // mehr, gilt wieder, was zuletzt von Hand gewählt war.
        let manualCategory = form.category;
        const categorySelect = h('select', {
            id: 'expCategory', value: form.category,
            onchange: function (e) {
                form.category = e.target.value;
                manualCategory = form.category;
                refresh();
            }
        }, C.groupCategories(doc).map(function (c) { return h('option', { value: c.id }, categoryLabel(c)); }));
        const descInput = h('input', {
            id: 'expDesc', type: 'text', maxlength: 120, value: form.desc, placeholder: 'Pizza, Tanken, Miete …', autocomplete: 'off',
            oninput: function (e) {
                form.desc = e.target.value;
                const match = C.categoryByName(doc, form.desc);
                const category = match ? match.id : manualCategory;
                if (category !== form.category) {
                    form.category = category;
                    categorySelect.value = category;
                    refresh();
                }
            },
            onchange: function (e) {
                form.desc = C.tidyText(e.target.value, 120);
                e.target.value = form.desc;
            }
        });
        const amountInput = h('input', {
            id: 'expAmount', type: 'text', inputmode: 'decimal', value: form.amountText, placeholder: '0,00', autocomplete: 'off',
            oninput: function (e) {
                form.amountText = e.target.value;
                form.amountFollowsItems = !e.target.value.trim();
                refresh();
            }
        });
        const dateInput = h('input', {
            id: 'expDate', type: 'date', value: form.date,
            onchange: function (e) { form.date = e.target.value; refresh(); }
        });

        function amount() {
            const value = C.parseAmount(form.amountText, form.currency);
            return value && value > 0 ? value : 0;
        }

        function itemSum() {
            return form.items.reduce(function (acc, item) { return acc + (C.parseAmount(item.amountText, form.currency) || 0); }, 0);
        }

        /** Liest die Positionen. Leere Zeilen zählen nicht. Liefert {items} oder {error}. */
        function readItems() {
            const items = [];
            for (let i = 0; i < form.items.length; i++) {
                const item = form.items[i];
                const name = item.name.trim();
                if (!name && !item.amountText.trim()) continue;
                const value = C.parseAmount(item.amountText, form.currency);
                if (!value) return { error: 'Bitte prüf die Preise der Positionen.' };
                items.push({ id: item.id, name: name || 'Position', amount: value });
            }
            return items.length ? { items: items } : { error: 'Trag mindestens eine Position ein.' };
        }

        /** Liest die Aufteilung aus dem Formular. Liefert {values} oder {error}, bei Positionen auch {items}. */
        function readSplit() {
            const values = {};
            let bad = null;
            memberIds.forEach(function (id) {
                if (bad) return;
                const text = (form.values[form.type] && form.values[form.type][id]) || '';
                if (form.type === 'equal' || form.type === 'items') {
                    if (form.included[id]) values[id] = 1;
                } else if (form.type === 'exact') {
                    if (!text.trim()) return;
                    const v = C.parseAmount(text, form.currency);
                    if (v === null) bad = 'Bitte prüf die Beträge.';
                    else if (v > 0) values[id] = v;
                } else if (form.type === 'adjust') {
                    if (!form.included[id]) return;
                    const v = text.trim() ? C.parseAmount(text, form.currency, true) : 0;
                    if (v === null) bad = 'Bitte prüf die Korrekturen.';
                    else values[id] = v;
                } else {
                    if (!text.trim()) return;
                    const v = C.parseQuantity(text);
                    if (v === null || v < 0) bad = form.type === 'percent' ? 'Bitte prüf die Prozente.' : 'Bitte prüf die Anteile.';
                    else if (v > 0) values[id] = v;
                }
            });
            if (bad) return { error: bad };
            if (!Object.keys(values).length) return { error: 'Wähle mindestens eine Person aus.' };
            if (form.type !== 'items') return { values: values };
            const read = readItems();
            return read.error ? read : { values: values, items: read.items };
        }

        function readPayers(total) {
            if (form.payMode === 'single') {
                const single = {};
                single[form.payer] = total;
                return { payers: single };
            }
            const payers = {};
            let sum = 0;
            for (let i = 0; i < memberIds.length; i++) {
                const id = memberIds[i];
                const text = form.paid[id] || '';
                if (!text.trim()) continue;
                const v = C.parseAmount(text, form.currency);
                if (v === null) return { error: 'Bitte prüf, wer wie viel bezahlt hat.' };
                if (v > 0) {
                    payers[id] = v;
                    sum += v;
                }
            }
            if (sum !== total) return { error: 'Die bezahlten Beträge ergeben nicht die Gesamtsumme.' };
            return { payers: payers };
        }

        function formClaims() {
            const claims = {};
            Object.keys(form.picked).forEach(function (itemId) {
                Object.keys(form.picked[itemId]).forEach(function (id) {
                    if (form.picked[itemId][id]) claims[itemId + '|' + id] = { t: 0, on: true };
                });
            });
            return claims;
        }

        /**
         * Nur was in diesem Formular geändert wurde, bekommt einen neuen Zeitstempel.
         * So bleibt erhalten, was andere währenddessen auf ihrem Gerät angetippt haben.
         */
        function savedClaims(items) {
            const current = doc.expenses[eid];
            const target = { claims: Object.assign({}, current && current.claims) };
            items.forEach(function (item) {
                memberIds.forEach(function (id) {
                    const before = !!(pickedBefore[item.id] && pickedBefore[item.id][id]);
                    const now = !!(form.picked[item.id] && form.picked[item.id][id]);
                    if (before !== now) C.setClaim(target, item.id, id, now);
                });
            });
            return target.claims;
        }

        function setSum(el, text, status) {
            el.textContent = text;
            el.className = 'sum-line' + (status ? ' ' + status : '');
        }

        function setFoldValue(el, text, source) {
            el.textContent = text;
            el.className = 'fold-value' + (source && source.classList.contains('bad') ? ' bad' : '');
        }

        function detailsText() {
            const parts = [form.date ? (form.date === C.todayStr() ? 'Heute' : formatDate(form.date)) : 'Kein Datum'];
            if (form.category !== 'general') parts.push(categoryText(doc, form.category));
            if (form.repeat !== 'none' && form.type !== 'items') parts.push('🔁');
            if (form.note.trim()) parts.push('📝');
            return parts.join(' · ');
        }

        function refresh() {
            if (form.type === 'items' && form.amountFollowsItems) {
                const sum = itemSum();
                form.amountText = sum ? C.amountToInput(sum, form.currency) : '';
                amountInput.value = form.amountText;
            }
            const total = amount();
            const cur = form.currency;
            const read = readSplit();
            const draft = { id: eid, amount: total, split: { type: form.type, values: read.values }, items: read.items, claims: formClaims() };
            const owed = total && read.values ? C.computeOwed(draft) : null;

            memberIds.forEach(function (id) {
                if (previews[id]) previews[id].textContent = owed && owed[id] ? money(owed[id], cur) : '';
            });
            adoptSum.hidden = true;

            if (form.type === 'exact' && read.values) {
                const sum = Object.keys(read.values).reduce(function (acc, id) { return acc + read.values[id]; }, 0);
                const rest = total - sum;
                if (!total) setSum(splitSum, 'Summe: ' + money(sum, cur));
                else if (rest > 0) setSum(splitSum, 'Noch ' + money(rest, cur) + ' offen', 'bad');
                else if (rest < 0) setSum(splitSum, money(-rest, cur) + ' zu viel', 'bad');
                else setSum(splitSum, 'Passt', 'ok');
            } else if (form.type === 'percent' && read.values) {
                const sum = Object.keys(read.values).reduce(function (acc, id) { return acc + read.values[id]; }, 0);
                const rest = Math.round((100 - sum) * 1000) / 1000;
                const restText = String(Math.abs(rest)).replace('.', ',');
                if (Math.abs(rest) <= 0.005) setSum(splitSum, 'Passt', 'ok');
                else if (rest > 0) setSum(splitSum, 'Noch ' + restText + ' % offen', 'bad');
                else setSum(splitSum, restText + ' % zu viel', 'bad');
            } else if (form.type === 'adjust' && read.values && total && !owed) {
                setSum(splitSum, 'Die Korrekturen passen nicht zum Betrag', 'bad');
            } else if (form.type === 'items' && read.values) {
                const sum = read.items.reduce(function (acc, item) { return acc + item.amount; }, 0);
                if (sum > total) {
                    setSum(splitSum, 'Positionen: ' + money(sum, cur) + ', das sind ' + money(sum - total, cur) + ' zu viel', 'bad');
                    adoptSum.hidden = false;
                } else {
                    setSum(splitSum, 'Allgemein: ' + money(C.itemShares(draft).general, cur));
                }
            } else if (form.type === 'equal' && read.values) {
                const count = Object.keys(read.values).length;
                setSum(splitSum, count + (count === 1 ? ' Person' : ' Personen'));
            } else {
                setSum(splitSum, read.error && read.values === undefined && total ? read.error : '', read.error ? 'bad' : '');
            }

            if (form.payMode === 'multi') {
                let sum = 0;
                memberIds.forEach(function (id) { sum += C.parseAmount(form.paid[id] || '', cur) || 0; });
                const rest = total - sum;
                if (rest > 0) setSum(paySum, 'Noch ' + money(rest, cur) + ' offen', 'bad');
                else if (rest < 0) setSum(paySum, money(-rest, cur) + ' zu viel', 'bad');
                else setSum(paySum, total ? 'Passt' : '', total ? 'ok' : '');
            } else {
                setSum(paySum, '');
            }

            setFoldValue(payValue, form.payMode === 'single'
                ? (form.payer === me ? 'Du' : memberName(doc, form.payer))
                : 'Mehrere' + (paySum.textContent ? ' · ' + paySum.textContent : ''), paySum);
            setFoldValue(splitValue, SPLIT_LABELS[form.type] + (splitSum.textContent ? ' · ' + splitSum.textContent : ''), splitSum);
            setFoldValue(moreValue, detailsText());
        }

        function drawPayers() {
            payArea.textContent = '';
            if (form.payMode === 'single') {
                payArea.appendChild(h('select', {
                    id: 'payer', value: form.payer, 'aria-label': form.refund ? 'Bekommen hat' : 'Bezahlt von',
                    onchange: function (e) {
                        if (e.target.value === '__multi') {
                            form.payMode = 'multi';
                            drawPayers();
                            refresh();
                            return;
                        }
                        form.payer = e.target.value;
                        refresh();
                    }
                },
                    memberIds.map(function (id) { return h('option', { value: id }, id === me ? memberName(doc, id) + ' (du)' : memberName(doc, id)); }),
                    h('option', { value: '__multi' }, 'Mehrere Personen …')));
                return;
            }
            payArea.appendChild(h('div', null,
                memberIds.map(function (id) {
                    return h('div', { class: 'split-row compact' },
                        h('span', { class: 'name' }, memberName(doc, id)),
                        h('input', {
                            type: 'text', inputmode: 'decimal', value: form.paid[id] || '', placeholder: '0,00',
                            'aria-label': (form.refund ? 'Bekommen hat ' : 'Bezahlt von ') + memberName(doc, id),
                            oninput: function (e) { form.paid[id] = e.target.value; refresh(); }
                        }));
                }),
                paySum,
                h('button', {
                    class: 'link-btn small', type: 'button',
                    onclick: function () { form.payMode = 'single'; drawPayers(); refresh(); }
                }, form.refund ? 'Nur eine Person hat es bekommen' : 'Nur eine Person hat bezahlt')));
        }

        function addItem(name, amountText) {
            const item = { id: nextItemId++, name: name, amountText: amountText };
            form.items.push(item);
            return item;
        }

        function drawItems() {
            itemsArea.textContent = '';
            if (form.type !== 'items') return;
            form.items.forEach(function (item) {
                if (!form.picked[item.id]) form.picked[item.id] = {};
                itemsArea.appendChild(h('div', { class: 'bill-item' },
                    h('div', { class: 'bill-row' },
                        h('input', {
                            type: 'text', maxlength: 60, value: item.name, placeholder: 'Position', 'aria-label': 'Bezeichnung',
                            oninput: function (e) { item.name = e.target.value; refresh(); }
                        }),
                        h('input', {
                            type: 'text', inputmode: 'decimal', value: item.amountText, placeholder: '0,00', 'aria-label': 'Preis',
                            oninput: function (e) { item.amountText = e.target.value; refresh(); }
                        }),
                        h('button', {
                            class: 'icon-btn', type: 'button', 'aria-label': 'Position entfernen',
                            onclick: function () {
                                form.items = form.items.filter(function (other) { return other !== item; });
                                drawItems();
                                refresh();
                            }
                        }, '✕')),
                    personChips(doc, memberIds, me,
                        function (id) { return !!form.picked[item.id][id]; },
                        function (id, on) { form.picked[item.id][id] = on; refresh(); })));
            });
            itemsArea.appendChild(h('button', {
                class: 'btn btn-small', type: 'button',
                onclick: function () {
                    addItem('', '');
                    drawItems();
                    refresh();
                    const inputs = itemsArea.querySelectorAll('.bill-row input[type="text"]:first-child');
                    if (inputs.length) inputs[inputs.length - 1].focus();
                }
            }, '+ Position'));
        }

        function drawSplit() {
            seg.textContent = '';
            C.SPLIT_TYPES.forEach(function (type) {
                if (type === 'items' && existing && existing.series) return;
                seg.appendChild(h('button', {
                    type: 'button',
                    'aria-pressed': String(type === form.type),
                    onclick: function () {
                        form.type = type;
                        if (type === 'items' && !form.items.length) addItem('', '');
                        drawSplit();
                        refresh();
                    }
                }, SPLIT_LABELS[type]));
            });
            splitHint.textContent = form.refund && form.type === 'equal' ? 'Alle Angehakten bekommen gleich viel.' : SPLIT_HINTS[form.type];
            generalLabel.hidden = form.type !== 'items';
            repeatField.hidden = form.type === 'items' || !!(existing && existing.parent);
            drawItems();

            splitRows.textContent = '';
            memberIds.forEach(function (id) {
                const name = memberName(doc, id);
                previews[id] = h('span', { class: 'preview' });
                const useCheck = form.type === 'equal' || form.type === 'adjust' || form.type === 'items';
                const labelEl = useCheck
                    ? h('label', null,
                        h('input', {
                            type: 'checkbox', checked: form.included[id],
                            onchange: function (e) { form.included[id] = e.target.checked; refresh(); }
                        }),
                        h('span', { class: 'name' }, name))
                    : h('span', { class: 'name' }, name);

                let input = h('span');
                if (form.type !== 'equal' && form.type !== 'items') {
                    const placeholder = { exact: '0,00', percent: '0 %', shares: '0', adjust: '+/-' }[form.type];
                    input = h('input', {
                        type: 'text',
                        inputmode: form.type === 'adjust' ? 'text' : 'decimal',
                        placeholder: placeholder,
                        value: form.values[form.type][id] || '',
                        'aria-label': SPLIT_LABELS[form.type] + ' für ' + name,
                        oninput: function (e) { form.values[form.type][id] = e.target.value; refresh(); }
                    });
                }
                splitRows.appendChild(h('div', { class: 'split-row' }, labelEl, input, previews[id]));
            });
        }

        function submit(e) {
            e.preventDefault();
            function fail(message, section) {
                error.textContent = message;
                error.hidden = false;
                if (section) section.open = true;
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
            const desc = C.tidyText(form.desc, 120);
            const total = amount();
            if (!desc) return fail('Bitte gib eine Beschreibung ein.');
            if (!total) return fail('Bitte gib einen gültigen Betrag ein.');
            if (!form.date) return fail('Bitte wähle ein Datum.', moreFold);
            const paid = readPayers(total);
            if (paid.error) return fail(paid.error, payFold);
            const read = readSplit();
            if (read.error) return fail(read.error, splitFold);

            const record = {
                id: eid,
                t: C.nextT(doc),
                by: me,
                desc: desc,
                amount: total,
                currency: form.currency,
                date: form.date,
                category: form.category,
                note: form.note.trim(),
                payers: paid.payers,
                split: { type: form.type, values: read.values },
                repeat: form.type === 'items' || (existing && existing.parent) ? 'none' : form.repeat,
                del: false
            };
            if (existing && existing.parent) record.parent = existing.parent;
            if (existing && existing.series) record.series = true;
            if (form.refund) record.refund = true;
            if (form.type === 'items') {
                record.items = read.items;
                record.claims = savedClaims(read.items);
            }
            if (!C.computeOwed(record)) {
                return fail(form.type === 'percent' ? 'Die Prozente müssen zusammen 100 ergeben.'
                    : form.type === 'exact' ? 'Die Beträge müssen zusammen die Gesamtsumme ergeben.'
                        : form.type === 'items' ? 'Die Positionen ergeben mehr als den Betrag.'
                            : 'Diese Aufteilung geht nicht auf.', splitFold);
            }

            doc.expenses[eid] = record;
            logActivity(doc, existing ? 'expense-edit' : 'expense-add', eid, desc, total, form.currency);
            commit(doc);
            state.formActive = false;
            go('/g/' + doc.id + (form.type === 'items' || (existing && existing.series) ? '/expense/' + eid : ''));
        }

        const repeatField = h('div', { class: 'field' },
            h('label', { for: 'expRepeat' }, 'Wiederholen'),
            h('select', {
                id: 'expRepeat', value: form.repeat,
                onchange: function (e) { form.repeat = e.target.value; refresh(); }
            }, C.REPEATS.filter(function (r) { return r !== 'none' || !(existing && existing.series); })
                .map(function (r) { return h('option', { value: r }, REPEAT_LABELS[r]); })));

        const payFold = fold('Bezahlt von', payValue, payArea);
        const payFoldTitle = payFold.querySelector('.fold-title');
        const formTitle = h('h2');
        const submitButton = h('button', { class: 'btn btn-block', type: 'submit' });
        const kindButtons = {};
        const kindSeg = h('div', { class: 'seg kind-seg', role: 'group', 'aria-label': 'Art' },
            [['expense', 'Ausgabe'], ['refund', 'Rückzahlung']].map(function (kind) {
                kindButtons[kind[0]] = h('button', {
                    type: 'button',
                    onclick: function () {
                        form.refund = kind[0] === 'refund';
                        applyKind();
                        drawPayers();
                        drawSplit();
                        refresh();
                    }
                }, kind[1]);
                return kindButtons[kind[0]];
            }));
        const kindHint = h('p', { class: 'small muted', style: 'margin:-6px 0 12px' },
            'Zum Beispiel Geld vom Stromversorger: Wer es bekommen hat, gibt den anderen ihren Teil ab.');

        /** Ausgabe oder Rückzahlung: Nur die Texte unterscheiden sich, die Felder sind dieselben. */
        function applyKind() {
            const noun = form.refund ? 'Rückzahlung' : 'Ausgabe';
            kindButtons.expense.setAttribute('aria-pressed', String(!form.refund));
            kindButtons.refund.setAttribute('aria-pressed', String(form.refund));
            kindHint.hidden = !form.refund;
            payFoldTitle.textContent = form.refund ? 'Bekommen hat' : 'Bezahlt von';
            formTitle.textContent = !existing ? (form.refund ? 'Neue Rückzahlung' : 'Neue Ausgabe')
                : existing.series ? 'Serie bearbeiten' : noun + ' bearbeiten';
            submitButton.textContent = existing ? 'Änderungen speichern' : noun + ' speichern';
        }
        applyKind();
        const splitFold = fold('Aufteilung', splitValue, [seg, splitHint, itemsArea, generalLabel, splitRows, splitSum, adoptSum]);
        const moreFold = fold('Mehr', moreValue, [
            h('div', { class: 'field-row' },
                h('div', { class: 'field' }, h('label', { for: 'expDate' }, existing && existing.series ? 'Beginn' : 'Datum'), dateInput),
                h('div', { class: 'field' },
                    h('label', { for: 'expCategory' }, 'Kategorie'),
                    categorySelect)),
            repeatField,
            h('div', { class: 'field', style: 'margin-bottom:0' },
                h('label', { for: 'expNote' }, 'Notiz'),
                h('textarea', {
                    id: 'expNote', maxlength: 1000, value: form.note,
                    oninput: function (e) { form.note = e.target.value; refresh(); }
                }))
        ]);

        drawPayers();
        drawSplit();

        const view = h('div', null,
            existing ? backLink(doc, 'expense/' + existing.id, 'Zurück') : backLink(doc),
            h('form', { class: 'panel', onsubmit: submit, novalidate: true },
                formTitle,
                kindSeg,
                kindHint,
                existing && existing.series ? h('p', { class: 'small muted', style: 'margin-bottom:12px' }, 'Das gilt für alle künftigen Buchungen. Bisherige Einträge bleiben und lassen sich einzeln bearbeiten.') : null,
                existing && existing.parent ? h('p', { class: 'small muted', style: 'margin-bottom:12px' }, 'Das ändert nur diesen einen Eintrag, nicht die Serie.') : null,
                error,
                h('div', { class: 'field' }, h('label', { for: 'expDesc' }, 'Beschreibung'), descInput),
                h('div', { class: 'field' },
                    h('label', { for: 'expAmount' }, 'Betrag'),
                    h('div', { class: 'amount-row' },
                        amountInput,
                        currencySelect(form.currency, function (e) { form.currency = e.target.value; refresh(); }, { 'aria-label': 'Währung' }))),
                h('div', { class: 'folds' }, payFold, splitFold, moreFold),
                submitButton));

        refresh();
        return view;
    }

    function claimedMembers(e) {
        const ids = [];
        Object.keys(e.claims || {}).forEach(function (key) {
            const id = key.split('|')[1];
            if (e.claims[key].on && ids.indexOf(id) === -1) ids.push(id);
        });
        return ids;
    }

    /** Viele Antipper hintereinander sind ein Eintrag im Verlauf, nicht zehn. */
    function logClaim(doc, e) {
        const me = meId(doc.id);
        const recent = Object.keys(doc.activity)
            .map(function (id) { return doc.activity[id]; })
            .filter(function (a) { return a.kind === 'claim' && a.ref === e.id && a.by === me && Date.now() - a.t < 600000; })[0];
        if (recent) doc.activity[recent.id] = Object.assign({}, recent, { t: C.nextT(doc) });
        else logActivity(doc, 'claim', e.id, e.desc);
    }

    /** Hier wählt jede Person selbst aus, auch auf dem eigenen Gerät. */
    function viewItemsPanel(doc, e, me) {
        const ids = activeMembers(doc).map(function (m) { return m.id; });
        claimedMembers(e).forEach(function (id) {
            if (ids.indexOf(id) === -1) ids.push(id);
        });
        const shares = C.itemShares(e);
        const openCount = e.items.filter(function (item) { return !C.claimantsOf(e, item.id).length; }).length;

        function toggle(item, id, on) {
            const current = doc.expenses[e.id];
            C.setClaim(current, item.id, id, on);
            logClaim(doc, current);
            commit(doc);
            softRender();
        }

        return h('section', { class: 'panel' },
            h('h2', null, 'Wer hatte was?'),
            e.del ? null : h('p', { class: 'small muted', style: 'margin-bottom:6px' }, 'Tippt bei jeder Position an, wer sie hatte. Mehrere Namen teilen sie sich. Was niemand antippt, teilen sich alle als allgemeine Kosten.'),
            e.items.map(function (item) {
                const claimants = C.claimantsOf(e, item.id);
                return h('div', { class: 'bill-item' },
                    h('div', { class: 'kv' }, h('span', null, item.name), h('span', null, money(item.amount, e.currency))),
                    e.del ? null : personChips(doc, ids, me,
                        function (id) { return claimants.indexOf(id) !== -1; },
                        function (id, on) { toggle(item, id, on); }));
            }),
            h('div', { class: 'kv bill-general' },
                h('span', null, 'Allgemeine Kosten' + (openCount ? ' (' + openCount + ' offen)' : '')),
                h('span', null, money(shares ? shares.general : 0, e.currency))),
            e.del ? null : h('div', { class: 'actions' },
                h('button', {
                    class: 'btn', type: 'button',
                    onclick: function () { shareInvite(doc, e.id, true); }
                }, 'Kurzer Link'),
                h('button', {
                    class: 'btn', type: 'button',
                    onclick: function () { shareInvite(doc, e.id); }
                }, 'Link mit Daten')));
    }

    /* ---------- Ausgabe-Detail ---------- */

    /** Vergangene Einträge einer Serie. Jeder lässt sich für sich öffnen und bearbeiten. */
    function viewOccurrencesPanel(doc, series) {
        const entries = C.occurrencesOf(doc, series.id);
        return h('section', { class: 'panel' },
            h('h2', null, 'Bisherige Einträge'),
            entries.length ? h('div', { class: 'list' }, entries.map(function (e) {
                return h('a', { class: 'item', href: '#/g/' + doc.id + '/expense/' + e.id },
                    h('span', { class: 'body' },
                        h('div', { class: 'title' }, formatDate(e.date, true)),
                        e.del ? h('div', { class: 'sub' }, 'Gelöscht') : null),
                    h('span', { class: 'side' }, h('strong', null, money(e.amount, e.currency))));
            })) : h('div', { class: 'small muted' }, 'Noch nichts gebucht.'));
    }

    function setExpenseDeleted(doc, e, deleted) {
        const current = doc.expenses[e.id];
        doc.expenses[e.id] = Object.assign({}, current, { del: deleted, t: C.nextT(doc) });
        logActivity(doc, deleted ? 'expense-del' : 'expense-restore', e.id, current.desc, current.amount, current.currency);
        commit(doc);
    }

    function viewExpenseDetail(doc, e) {
        const me = meId(doc.id);
        const owed = C.computeOwed(e) || {};
        const c = C.findCategory(doc, e.category);
        const cur = e.currency;

        const payers = Object.keys(e.payers).filter(function (id) { return e.payers[id] > 0; });
        const shareIds = Object.keys(owed).filter(function (id) { return owed[id] > 0; })
            .sort(function (a, b) { return memberName(doc, a).localeCompare(memberName(doc, b), 'de'); });

        const comments = Object.keys(doc.comments).map(function (id) { return doc.comments[id]; })
            .filter(function (x) { return x.expense === e.id && !x.del; })
            .sort(function (a, b) { return a.t - b.t; });

        const commentInput = h('input', { type: 'text', maxlength: 1000, placeholder: 'Kommentar schreiben', 'aria-label': 'Kommentar' });

        function addComment(ev) {
            ev.preventDefault();
            const text = commentInput.value.trim();
            if (!text) return;
            const id = C.newId();
            doc.comments[id] = { id: id, t: C.nextT(doc), by: me, expense: e.id, text: text, del: false };
            logActivity(doc, 'comment', e.id, e.desc);
            commit(doc);
            commentInput.value = '';
            commentInput.blur();
            render();
        }

        function removeComment(comment) {
            doc.comments[comment.id] = Object.assign({}, comment, { del: true, t: C.nextT(doc) });
            commit(doc);
            render();
        }

        const series = e.parent ? doc.expenses[e.parent] : null;
        const repeatInfo = !e.series ? null
            : e.del ? REPEAT_LABELS[e.repeat] : REPEAT_LABELS[e.repeat] + ' · ' + nextBookingText(doc, e);

        return h('div', null,
            backLink(doc),
            e.del ? h('div', { class: 'notice' }, e.series ? 'Diese Serie ist beendet. Die bisherigen Einträge bleiben. ' : 'Diese Ausgabe wurde gelöscht und zählt nicht mehr. ',
                h('button', {
                    class: 'link-btn', type: 'button',
                    onclick: function () {
                        setExpenseDeleted(doc, e, false);
                        render();
                    }
                }, e.series ? 'Wieder aufnehmen' : 'Wiederherstellen')) : null,
            h('section', { class: 'panel' },
                h('div', { class: 'detail-head' },
                    c.emoji ? h('div', { class: 'emoji', 'aria-hidden': 'true' }, c.emoji) : null,
                    h('h1', null, e.desc),
                    h('div', { class: 'amount' }, money(e.amount, cur)),
                    h('div', { class: 'small muted' }, (e.refund ? 'Rückzahlung · ' : '') + (e.series ? 'Seit ' : '') + formatDate(e.date, true) + (c.id !== 'general' ? ' · ' + c.label : '')),
                    repeatInfo ? h('div', { class: 'small muted' }, '🔁 ' + repeatInfo) : null,
                    series ? h('div', { class: 'small' }, h('a', { href: '#/g/' + doc.id + '/expense/' + series.id }, '🔁 Zur Serie')) : null),
                h('h2', null, e.refund ? (payers.length > 1 ? 'Bekommen haben' : 'Bekommen hat') : (payers.length > 1 ? 'Bezahlt haben' : 'Bezahlt hat')),
                payers.map(function (id) {
                    return h('div', { class: 'kv' }, h('span', null, memberName(doc, id)), h('span', null, money(e.payers[id], cur)));
                }),
                h('h2', null, e.refund ? 'Steht zu' : 'Anteile'),
                shareIds.map(function (id) {
                    return h('div', { class: 'kv' }, h('span', null, memberName(doc, id)), h('span', null, money(owed[id], cur)));
                }),
                e.note ? [h('h2', null, 'Notiz'), h('div', { class: 'note-box' }, e.note)] : null,
                e.del ? null : h('div', { class: 'actions' },
                    h('a', { class: 'btn', href: '#/g/' + doc.id + '/expense/' + e.id + '/edit' }, e.series ? 'Serie bearbeiten' : 'Bearbeiten'),
                    h('button', {
                        class: 'btn btn-danger', type: 'button',
                        onclick: function () {
                            setExpenseDeleted(doc, e, true);
                            go('/g/' + doc.id);
                            toast('„' + e.desc + '“ ' + (e.series ? 'beendet.' : 'gelöscht.'), 'Rückgängig', function () {
                                setExpenseDeleted(doc, e, false);
                                softRender();
                            });
                        }
                    }, e.series ? 'Serie beenden' : 'Löschen'))),
            e.items ? viewItemsPanel(doc, e, me) : null,
            e.series ? viewOccurrencesPanel(doc, e) : null,
            h('section', { class: 'panel' },
                h('h2', null, 'Kommentare'),
                comments.length ? null : h('div', { class: 'small muted' }, 'Noch keine Kommentare.'),
                comments.map(function (comment) {
                    return h('div', { class: 'comment' },
                        h('div', { class: 'meta' }, (comment.by === me ? 'Du' : memberName(doc, comment.by)) + ' · ' + timeAgo(comment.t),
                            comment.by === me ? [' · ', h('button', {
                                class: 'link-btn', type: 'button',
                                onclick: function () { removeComment(comment); }
                            }, 'Löschen')] : null),
                        h('div', { class: 'text' }, comment.text));
                }),
                h('form', { class: 'comment-form', onsubmit: addComment },
                    commentInput,
                    h('button', { class: 'btn', type: 'submit' }, 'Senden'))));
    }

    /* ---------- Zahlung ---------- */

    function viewPaymentForm(doc, payment, params) {
        state.formActive = true;
        const me = meId(doc.id);
        const members = activeMembers(doc);
        const ids = members.map(function (m) { return m.id; });
        if (payment) {
            [payment.from, payment.to].forEach(function (id) {
                if (ids.indexOf(id) === -1) ids.push(id);
            });
        }

        const prefill = {
            from: params.get('from'),
            to: params.get('to'),
            amount: parseInt(params.get('amount'), 10),
            cur: params.get('cur')
        };
        const currency = payment ? payment.currency
            : /^[A-Z]{3}$/.test(prefill.cur || '') ? prefill.cur : doc.meta.currency;

        const form = {
            from: payment ? payment.from : ids.indexOf(prefill.from) !== -1 ? prefill.from : me,
            to: payment ? payment.to : ids.indexOf(prefill.to) !== -1 ? prefill.to : (ids.filter(function (id) { return id !== me; })[0] || me),
            currency: currency,
            amountText: payment ? C.amountToInput(payment.amount, currency)
                : prefill.amount > 0 ? C.amountToInput(prefill.amount, currency) : '',
            date: payment ? payment.date : C.todayStr(),
            note: payment ? payment.note : ''
        };

        const error = h('div', { class: 'form-error', hidden: true });
        const moreValue = h('span', { class: 'fold-value' });

        function refreshMore() {
            moreValue.textContent = (form.date ? formatDate(form.date, true) : 'Kein Datum') + (form.note.trim() ? ' · 📝' : '');
        }
        refreshMore();

        function personSelect(id, key, labelText) {
            return h('div', { class: 'field' },
                h('label', { for: id }, labelText),
                h('select', {
                    id: id, value: form[key],
                    onchange: function (e) { form[key] = e.target.value; }
                }, ids.map(function (memberId) {
                    return h('option', { value: memberId }, memberId === me ? memberName(doc, memberId) + ' (du)' : memberName(doc, memberId));
                })));
        }

        function label() {
            return memberName(doc, form.from) + ' an ' + memberName(doc, form.to);
        }

        const moreFold = fold('Mehr', moreValue, [
            h('div', { class: 'field' },
                h('label', { for: 'payDate' }, 'Datum'),
                h('input', {
                    id: 'payDate', type: 'date', value: form.date,
                    onchange: function (e) { form.date = e.target.value; refreshMore(); }
                })),
            h('div', { class: 'field', style: 'margin-bottom:0' },
                h('label', { for: 'payNote' }, 'Notiz'),
                h('input', {
                    id: 'payNote', type: 'text', maxlength: 300, value: form.note,
                    oninput: function (e) { form.note = e.target.value; refreshMore(); }
                }))
        ]);

        function submit(e) {
            e.preventDefault();
            function fail(message) {
                error.textContent = message;
                error.hidden = false;
            }
            const amount = C.parseAmount(form.amountText, form.currency);
            if (!amount) return fail('Bitte gib einen gültigen Betrag ein.');
            if (form.from === form.to) return fail('Wähle zwei verschiedene Personen.');
            if (!form.date) {
                moreFold.open = true;
                return fail('Bitte wähle ein Datum.');
            }
            const id = payment ? payment.id : C.newId();
            doc.payments[id] = {
                id: id, t: C.nextT(doc), by: me, from: form.from, to: form.to, amount: amount,
                currency: form.currency, date: form.date, note: form.note.trim(), del: false
            };
            logActivity(doc, payment ? 'pay-edit' : 'pay-add', id, label(), amount, form.currency);
            commit(doc);
            state.formActive = false;
            go('/g/' + doc.id + '/balances');
        }

        function removePayment() {
            const before = doc.payments[payment.id];
            doc.payments[payment.id] = Object.assign({}, before, { del: true, t: C.nextT(doc) });
            logActivity(doc, 'pay-del', payment.id, label(), before.amount, before.currency);
            commit(doc);
            state.formActive = false;
            go('/g/' + doc.id + '/balances');
            toast('Zahlung gelöscht.', 'Rückgängig', function () {
                doc.payments[payment.id] = Object.assign({}, doc.payments[payment.id], { del: false, t: C.nextT(doc) });
                commit(doc);
                softRender();
            });
        }

        return h('div', null,
            backLink(doc, 'balances', 'Salden'),
            payment && payment.del ? h('div', { class: 'notice' }, 'Diese Zahlung wurde gelöscht.') : null,
            h('form', { class: 'panel', onsubmit: submit, novalidate: true },
                h('h2', null, payment ? 'Zahlung bearbeiten' : 'Zahlung eintragen'),
                h('p', { class: 'small muted', style: 'margin-bottom:12px' }, 'Kwidt überweist selbst nichts. Trag hier ein, was eine Person einer anderen gegeben hat, egal ob alles, nur einen Teil oder einfach so.'),
                error,
                h('div', { class: 'field-row' },
                    personSelect('payFrom', 'from', 'Wer hat gezahlt?'),
                    personSelect('payTo', 'to', 'An wen?')),
                h('div', { class: 'field' },
                    h('label', { for: 'payAmount' }, 'Betrag'),
                    h('div', { class: 'amount-row' },
                        h('input', {
                            id: 'payAmount', type: 'text', inputmode: 'decimal', value: form.amountText, placeholder: '0,00', autocomplete: 'off',
                            oninput: function (e) { form.amountText = e.target.value; }
                        }),
                        currencySelect(form.currency, function (e) { form.currency = e.target.value; }, { 'aria-label': 'Währung' }))),
                h('div', { class: 'folds' }, moreFold),
                h('button', { class: 'btn btn-block', type: 'submit' }, payment ? 'Änderungen speichern' : 'Zahlung speichern'),
                payment && !payment.del ? h('div', { class: 'actions' },
                    h('button', { class: 'btn btn-danger', type: 'button', onclick: removePayment }, 'Zahlung löschen')) : null));
    }

    /* ---------- Start ---------- */

    async function onHashChange() {
        await handleJoin();
        render();
    }

    window.addEventListener('hashchange', onHashChange);

    window.addEventListener('storage', function (e) {
        if (e.key === STORE_KEY && adoptStored()) softRender();
    });

    // Eine Aktualisierung, die während der Eingabe kam, nachholen. Mit Verzögerung,
    // damit ein Klick auf "Senden" nicht auf ein bereits ersetztes Element trifft.
    document.addEventListener('focusout', function () {
        setTimeout(function () {
            if (state.pendingRender && !isEditing()) softRender();
        }, 300);
    });

    // Ein Tab im Hintergrund bekommt auf dem Handy keine storage-Events. Ohne das hier
    // würde er beim nächsten Speichern überschreiben, was ein anderer Tab angelegt hat.
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        if (!state.unsaved && adoptStored()) softRender();
        Sync.wake();
    });
    window.addEventListener('online', function () { Sync.wake(); });
    window.addEventListener('offline', function () { updateSyncPill(); });

    // Hält „zuletzt online“ aktuell, solange die Seite offen ist.
    setInterval(function () {
        Sync.heartbeat();
        if (Sync.conns.size) markSeen(Sync.gid);
        updateSyncPill();
    }, HEARTBEAT);

    store = readStored();
    askToKeepData();
    if (!location.hash && store.groups[store.last]) history.replaceState(null, '', '#/g/' + store.last);
    handleJoin().then(render);

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(function (e) {
            // Normal bei file://, die App läuft dann ohne Offline-Modus.
            console.info('Kwidt: Kein Service Worker.', e);
        });
    }
})();
