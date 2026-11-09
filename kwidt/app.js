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

    let store = { groups: {}, me: {}, last: null, seen: {}, contacts: {}, offsets: {} };
    const state = { formActive: false, pendingRender: false, unsaved: false, search: '', filter: emptyFilter(), filterOpen: false, statsCur: null, statsCategory: '', statsOpen: {}, lastPath: null };

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
        const out = { groups: {}, me: {}, last: null, seen: {}, contacts: {}, offsets: {} };
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
                out.contacts = cleanContacts(raw.contacts);
                out.offsets = cleanOffsets(raw.offsets);
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
        store.contacts = loaded.contacts;
        store.offsets = loaded.offsets;
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
        if (path.indexOf('transfer=') === 0) return { name: 'transfer', value: path.slice(9) };
        const parts = path.split('/').filter(Boolean);
        if (parts[0] === 'new') return { name: 'new' };
        if (parts[0] === 'p' && C.RE_ID.test(parts[1] || '')) return { name: 'contact', id: parts[1] };
        if (parts[0] === 'offsets') return { name: 'offsets' };
        if (HOME_TABS.some(function (t) { return t[0] === parts[0]; })) return { name: 'home', tab: parts[0] };
        if (parts[0] !== 'g' || !C.RE_GROUP_ID.test(parts[1] || '')) return { name: 'home', tab: null };
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
            state.statsOpen = {};
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
                state.seriesOpen = false;
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
        app.appendChild(route.name === 'new' ? viewNewGroup()
            : route.name === 'transfer' ? viewTransferIn(route.value)
            : route.name === 'contact' ? viewContact(route.id)
                : route.name === 'offsets' ? viewOffsetLog()
                    : viewHome(route.tab));
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

    const ICON_CHOICES = Array.from('🏠🏖✈🍕🍻🎉🚗⛺🎿🎸⚽🐶💼🎓🛒❤').map(function (c) {
        // Manche sind ohne Zusatz Textzeichen; U+FE0F macht sie bunt.
        return /[\u2600-\u27BF\u2700-\u27BF]|[\u{1F3D6}\u{2708}]/u.test(c) ? c + '\uFE0F' : c;
    });

    /**
     * Auswahl des Gruppensymbols: Vorschläge, ein eigenes Emoji oder keins (dann die
     * Anfangsbuchstaben). `onChange` bekommt das Emoji oder ''.
     */
    function iconPicker(current, onChange) {
        let value = current || '';
        const chips = h('div', { class: 'chips icon-chips', role: 'group', 'aria-label': 'Symbol' });
        const own = h('input', {
            type: 'text', maxlength: 16, placeholder: 'eigenes Emoji', 'aria-label': 'Eigenes Emoji', autocomplete: 'off',
            value: value && ICON_CHOICES.indexOf(value) === -1 ? value : '',
            oninput: function (e) {
                const emoji = C.firstEmoji(e.target.value);
                if (emoji) set(emoji);
                e.target.classList.toggle('bad', !!e.target.value.trim() && !emoji);
            }
        });
        function set(next) {
            value = next;
            draw();
            onChange(value);
        }
        function draw() {
            chips.textContent = '';
            chips.appendChild(h('button', {
                class: 'chip', type: 'button', 'aria-pressed': String(!value),
                onclick: function () { own.value = ''; set(''); }
            }, 'Keins'));
            ICON_CHOICES.concat(value && ICON_CHOICES.indexOf(value) === -1 ? [value] : []).forEach(function (icon) {
                chips.appendChild(h('button', {
                    class: 'chip icon-chip', type: 'button', 'aria-pressed': String(value === icon), 'aria-label': 'Symbol ' + icon,
                    onclick: function () { set(icon); }
                }, icon));
            });
        }
        draw();
        return h('div', null, chips, h('div', { class: 'icon-own' }, own));
    }

    /** Gewähltes Emoji oder Anfangsbuchstaben des Namens, siehe C.groupSymbol. */
    function groupAvatar(name, icon, large) {
        const symbol = C.groupSymbol(name, icon);
        return h('span', {
            class: 'avatar' + (large ? ' large' : '') + (symbol.emoji ? ' has-emoji' : ''),
            'aria-hidden': 'true'
        }, symbol.text);
    }

    /** „geändert vor 2 Stunden · abgeglichen gestern“. Abgeglichen zählt nur der Live-Abgleich mit einem anderen Gerät. */
    function groupTimesText(doc) {
        function ago(t) { return Date.now() - t < 60000 ? 'gerade eben' : timeAgo(t); }
        const seen = store.seen[doc.id];
        return 'geändert ' + ago(C.lastT(doc)) + ' · ' + (seen ? 'abgeglichen ' + ago(seen) : 'noch nie abgeglichen');
    }

    /** „Anna, Ben, Chris (du)“: alle aktiven Mitglieder, du zuletzt. */
    function memberNamesText(doc) {
        const me = meId(doc.id);
        const others = activeMembers(doc).filter(function (m) { return m.id !== me; }).map(function (m) { return m.name; });
        return others.concat(me ? [memberName(doc, me) + ' (du)'] : []).join(', ');
    }

    const HOME_TABS = [['info', 'Infos'], ['gruppen', 'Gruppen'], ['personen', 'Personen'], ['backup', 'Backup']];

    /**
     * Startseite mit Reitern. Ohne Reiter in der Adresse: Gruppen, oder Infos,
     * solange es noch keine Gruppe gibt.
     */
    function viewHome(tab) {
        const hasGroups = Object.keys(store.groups).length > 0;
        const current = tab || (hasGroups ? 'gruppen' : 'info');
        const content = {
            info: viewInfoTab,
            gruppen: viewGroupsTab,
            personen: viewPeopleTab,
            backup: viewBackupTab
        }[current]();

        return h('div', null,
            h('header', { class: 'page-head' },
                h('h1', null, 'Kwidt'),
                h('p', null, 'Gemeinsame Ausgaben aufteilen, bis alle kwidt sind.')),
            h('nav', { class: 'tabs', 'aria-label': 'Bereiche der Startseite' }, HOME_TABS.map(function (t) {
                return h('a', { href: '#/' + t[0], 'aria-current': t[0] === current ? 'page' : null }, t[1]);
            })),
            content);
    }

    function viewGroupsTab() {
        const docs = Object.keys(store.groups).map(function (gid) { return store.groups[gid]; });
        docs.sort(function (a, b) { return C.lastT(b) - C.lastT(a); });

        const totals = {};
        const rows = docs.map(function (doc) {
            const balances = C.computeBalances(doc);
            const mine = myBalances(doc, balances);
            mine.forEach(function (b) { totals[b.cur] = (totals[b.cur] || 0) + b.amount; });
            const memberCount = Object.keys(doc.members).filter(function (id) { return !doc.members[id].left; }).length;
            return h('a', { class: 'item', href: '#/g/' + doc.id },
                groupAvatar(doc.meta.name, doc.meta.icon),
                h('span', { class: 'body' },
                    h('div', { class: 'title' }, doc.meta.name || 'Einladung'),
                    h('div', { class: 'sub' }, doc.meta.t
                        ? [memberCount + (memberCount === 1 ? ' Person' : ' Personen') + ' · Datenstand ',
                            h('code', { class: 'state-code', title: 'Gleicher Code auf zwei Geräten heißt: gleicher Datenstand.' }, C.dataFingerprint(doc))]
                        : 'Wartet auf Daten'),
                    doc.meta.t ? h('div', { class: 'sub names' }, memberNamesText(doc)) : null,
                    doc.meta.t ? h('div', { class: 'sub' }, groupTimesText(doc)) : null),
                h('span', { class: 'side' }, mine.length
                    ? mine.map(function (b) {
                        return h('div', null, h('span', { class: 'muted' }, b.amount > 0 ? 'du bekommst ' : 'du schuldest '), balanceSpan(b.amount, b.cur));
                    })
                    : doc.meta.t ? h('span', { class: 'muted' }, 'kwidt') : null));
        });

        const totalKeys = Object.keys(totals).filter(function (cur) { return totals[cur]; });

        return h('div', null,
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
                    h('a', { class: 'btn', href: '#/new' }, '+ Neue Gruppe oder importieren')),
                h('div', { class: 'field-hint' }, 'Hier kommen auch einzelne Gruppen rein: die CSV einer Gruppe aus Kwidt oder eine Excel-Datei aus Splid.')));
    }

    function viewPeopleTab() {
        return viewPeoplePanel() || h('section', { class: 'panel' },
            h('h2', null, 'Personen über Gruppen hinweg'),
            h('div', { class: 'empty' }, 'Leg zuerst Gruppen an. Danach kannst du hier dieselbe Person aus verschiedenen Gruppen verknüpfen.'),
            h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/gruppen' }, 'Zu den Gruppen')));
    }

    function viewBackupTab() {
        const hasGroups = Object.keys(store.groups).length > 0;
        return h('div', null, viewTransferPanel(), h('section', { class: 'panel' },
            h('h2', null, 'Backup als Datei'),
            h('p', { class: 'small muted' }, 'Sichert alle Gruppen dieses Browsers in einer Datei, dazu die verknüpften Personen und die Verrechnungen. Beim Laden wird sie mit dem vorhandenen Stand zusammengeführt.'),
            h('div', { class: 'actions' },
                hasGroups ? h('button', { class: 'btn btn-small', type: 'button', onclick: exportAll }, 'Backup sichern') : null,
                h('label', { class: 'btn btn-small' }, 'Backup laden',
                    h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importBackup }))),
            h('p', { class: 'small muted', style: 'margin-top:10px' }, 'Deine Daten liegen nur in diesem Browser. Werden die Browserdaten gelöscht, sind sie weg, wenn es kein Backup und kein anderes Gerät mit der Gruppe gibt.')));
    }

    function viewInfoTab() {
        const hasGroups = Object.keys(store.groups).length > 0;
        return h('div', null,
            hasGroups ? null : h('section', { class: 'panel start-panel' },
                h('h2', null, 'Los geht’s'),
                h('p', { class: 'small muted', style: 'margin-bottom:10px' }, 'Leg eine Gruppe für eure gemeinsamen Ausgaben an oder importiere eine aus Splid oder einer Kwidt-CSV.'),
                h('a', { class: 'btn btn-block', href: '#/gruppen' }, 'Erste Gruppe anlegen')),
            h('section', { class: 'panel' },
                h('h2', null, 'So funktioniert es'),
                h('p', { class: 'small muted' }, 'Es gibt keine Anmeldung. Deine Gruppen liegen nur in diesem Browser, nicht auf einem Server. Jede Person hat ihre eigene Kopie.'),
                h('p', { class: 'small muted' },
                    'Haben zwei Geräte dieselbe Gruppe gleichzeitig offen, gleichen sie sich live ab. '
                    + 'Auf dieser Startseite und für Gruppen, die gerade niemand offen hat, wird nichts abgeglichen. '
                    + 'Sonst reicht es, den Link der Gruppe neu zu schicken: Beim Öffnen wird der Stand zusammengeführt, ohne dass etwas verloren geht.'),
                h('div', { class: 'facts' },
                    factList('Vorteile', 'pro', [
                        'Kein Konto, keine Anmeldung',
                        'Daten nur auf euren Geräten',
                        'Kostenlos, ohne Werbung',
                        'Läuft auch offline'
                    ]),
                    factList('Nachteile', 'con', [
                        'Abgleich nur bei gleichzeitig offener Gruppe oder per Link',
                        'Browserdaten gelöscht = Gruppe weg, Backup sichern',
                        'Wer den Link hat, kann alles sehen und ändern',
                        'Live-Abgleich läuft über den öffentlichen Dienst PeerJS. Er vermittelt nur die Verbindung, die Daten gehen verschlüsselt von Gerät zu Gerät'
                    ]))),
            h('section', { class: 'panel' },
                h('h2', null, 'Was Kwidt besonders macht'),
                factList(null, 'feature', [
                    'Rückzahlungen aufteilen, z. B. Guthaben vom Stromversorger',
                    'Rechnung nach Positionen: Jede Person tippt an, was sie hatte',
                    'Wiederholungen mit freiem Abstand, z. B. alle 3 Monate',
                    'Verpasste Termine werden nachgebucht',
                    'Monatsübersicht pro Kategorie',
                    'Filter nach Person, Kategorie, Betrag und Text',
                    'Mehrere Währungen in einer Gruppe',
                    'Import aus Splid und aus der eigenen CSV',
                    'Datenstand-Code: Zwei Geräte auf einen Blick vergleichen',
                    'Personen über Gruppen hinweg: Schulden verrechnen und in einer Gruppe zusammenführen, etwa WG gegen Urlaub. Die Verknüpfung liegt nur auf deinem Gerät (und im Backup), keine Gruppe erfährt etwas über die anderen'
                ])));
    }

    /** Kurze Liste mit Zeichen davor: + Vorteil, – Nachteil, ✓ Funktion. */
    function factList(title, kind, items) {
        return h('div', null,
            title ? h('div', { class: 'link-title' }, title) : null,
            h('ul', { class: 'fact-list ' + kind }, items.map(function (text) { return h('li', null, text); })));
    }

    /** Alles, was dieses Gerät hat: für die Backup-Datei und die Übertragung auf ein anderes Gerät. */
    function backupData() {
        const me = {};
        const groups = Object.keys(store.groups).map(function (gid) {
            if (store.me[gid]) me[gid] = store.me[gid];
            return store.groups[gid];
        });
        const appVersion = (document.getElementById('versionNumber') || {}).textContent || '';
        return { app: 'quitt', version: 1, appVersion: appVersion, groups: groups, me: me, contacts: store.contacts, offsets: store.offsets };
    }

    function exportAll() {
        download('kwidt-backup-' + C.todayStr() + '.json', 'application/json', JSON.stringify(backupData(), null, 1));
    }

    /** „3 Gruppen, 2 Personen und 1 Verrechnung“ */
    function countsText(groups, people, logs) {
        const parts = [groups + (groups === 1 ? ' Gruppe' : ' Gruppen')];
        if (people) parts.push(people + (people === 1 ? ' Person' : ' Personen'));
        if (logs) parts.push(logs + (logs === 1 ? ' Verrechnung' : ' Verrechnungen'));
        return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' und ' + parts[parts.length - 1] : parts[0];
    }

    function backupSummary(data) {
        return countsText(data.groups.length, Object.keys(cleanContacts(data.contacts)).length, Object.keys(cleanOffsets(data.offsets)).length);
    }

    /**
     * Führt ein Backup mit dem Stand hier zusammen: Gruppen wie beim Abgleich, wer du bist
     * nur, wo es hier noch fehlt. Personen: neue kommen dazu, bekannte bekommen fehlende
     * Verknüpfungen (pro Gruppe bleibt die vorhandene). Verrechnungs-Log: neue Einträge kommen dazu.
     */
    function applyBackup(data) {
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
        const contacts = cleanContacts(data.contacts);
        Object.keys(contacts).forEach(function (id) {
            const local = store.contacts[id];
            if (!local) {
                store.contacts[id] = contacts[id];
                return;
            }
            contacts[id].links.forEach(function (l) {
                if (!local.links.some(function (x) { return x.gid === l.gid; })) local.links.push(l);
            });
        });
        const offsets = cleanOffsets(data.offsets);
        Object.keys(offsets).forEach(function (id) { if (!store.offsets[id]) store.offsets[id] = offsets[id]; });
        persist();
        return {
            text: countsText(count, Object.keys(contacts).length, Object.keys(offsets).length),
            // Sicherungen aus Versionen vor den Personen haben das Feld gar nicht.
            noContacts: data.contacts === undefined
        };
    }

    async function importBackup(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            if (!data || data.app !== 'quitt' || !Array.isArray(data.groups)) throw new Error('Kein Kwidt-Backup');
            const result = applyBackup(data);
            render();
            toast(result.text + ' geladen.' + (result.noContacts ? ' Diese Sicherung enthält keine Personen, sie stammt aus einer älteren Kwidt-Version.' : ''),
                'OK', function () { /* nur schließen */ });
        } catch (err) {
            console.warn('Kwidt: Backup nicht lesbar.', err);
            toast('Diese Datei ist kein Kwidt-Backup.');
        }
    }

    /* ---------- Übertragung auf ein anderes Gerät ---------- */
    /*
     * Einmal-Übertragung aller Daten wie ein Backup. Das sendende Gerät meldet sich bei
     * PeerJS unter einer zufälligen Sitzungs-ID an und zeigt Link und QR-Code. Der Link
     * trägt nach dem # einen Schlüssel, der nie an einen Server geht. Das empfangende
     * Gerät beweist mit dem Schlüssel, dass es den Link hat; erst dann kommen die Daten,
     * zusätzlich zu WebRTC mit AES-GCM verschlüsselt. Nach einer Übertragung oder nach
     * zehn Minuten meldet sich das sendende Gerät ab: Die Sitzung ist verbrannt.
     */
    const TRANSFER_TTL = 10 * 60 * 1000;
    const TRANSFER_PREFIX = PEER_PREFIX + 'transfer-';
    let transferOut = null;
    let transferIn = null;

    function randomBytes(n) {
        const bytes = new Uint8Array(n);
        crypto.getRandomValues(bytes);
        return bytes;
    }

    function transferKey(keyText) {
        return crypto.subtle.importKey('raw', fromBase64Url(keyText), 'AES-GCM', false, ['encrypt', 'decrypt']);
    }

    async function sealText(key, text) {
        const iv = randomBytes(12);
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text));
        return { iv: toBase64Url(iv), data: toBase64Url(new Uint8Array(data)) };
    }

    async function openText(key, box) {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(box.iv) }, key, fromBase64Url(box.data));
        return new TextDecoder().decode(plain);
    }

    function transferPossible() {
        return typeof Peer !== 'undefined' && !!(window.crypto && crypto.subtle);
    }

    function showTransfer() {
        if (location.hash === '#/backup') softRender();
    }

    function endTransfer(t, status) {
        if (t.ended) return;
        t.ended = true;
        t.status = status;
        clearTimeout(t.timer);
        clearTimeout(t.ackTimer);
        // Kurz warten, damit die letzte Nachricht noch rausgeht.
        setTimeout(function () { try { t.peer.destroy(); } catch (e) { /* schon zu */ } }, 800);
        showTransfer();
    }

    function startTransfer() {
        if (transferOut && !transferOut.ended) endTransfer(transferOut, 'cancelled');
        if (!transferPossible()) {
            toast('Übertragen geht in diesem Browser nicht.');
            return;
        }
        const session = Array.from(randomBytes(16), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        const keyText = toBase64Url(randomBytes(32));
        const t = {
            session: session, keyText: keyText, status: 'connecting', until: Date.now() + TRANSFER_TTL, used: false, ended: false,
            link: location.origin + location.pathname + '#transfer=' + session + '.' + keyText
        };
        transferOut = t;
        t.timer = setTimeout(function () { endTransfer(t, 'expired'); }, TRANSFER_TTL);
        try {
            t.peer = new Peer(TRANSFER_PREFIX + session, { debug: 0 });
        } catch (e) {
            endTransfer(t, 'error');
            return;
        }
        t.peer.on('open', function () {
            if (!t.ended && t.status === 'connecting') {
                t.status = 'waiting';
                showTransfer();
            }
        });
        t.peer.on('connection', function (conn) {
            if (t.used || t.ended) {
                conn.on('open', function () { conn.close(); });
                return;
            }
            conn.on('data', async function (msg) {
                if (!msg || msg.app !== 'quitt' || t.ended) return;
                if (msg.type === 'transfer-received') {
                    endTransfer(t, 'sent');
                    return;
                }
                if (msg.type !== 'transfer-hello' || t.used) return;
                try {
                    const key = await transferKey(t.keyText);
                    // Nur wer den Schlüssel aus dem Link hat, kann das richtig verschlüsseln.
                    if (await openText(key, msg.proof) !== 'kwidt-transfer:' + t.session) throw new Error('Falscher Schlüssel');
                    t.used = true;
                    t.status = 'sending';
                    showTransfer();
                    conn.send({ app: 'quitt', type: 'transfer-data', box: await sealText(key, JSON.stringify(backupData())) });
                    // Bestätigt das andere Gerät nicht, ist die Sitzung trotzdem verbraucht.
                    t.ackTimer = setTimeout(function () { endTransfer(t, 'sent'); }, 30000);
                } catch (e) {
                    // Meist ein unvollständig kopierter Link. Die Sitzung bleibt gültig.
                    try { conn.send({ app: 'quitt', type: 'transfer-denied' }); } catch (x) { /* schon zu */ }
                    setTimeout(function () { try { conn.close(); } catch (x) { /* schon zu */ } }, 500);
                }
            });
        });
        t.peer.on('error', function () {
            if (!t.used) endTransfer(t, 'error');
        });
        showTransfer();
    }

    function transferStatusText(t) {
        const until = new Date(t.until).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        switch (t.status) {
            case 'connecting': return 'Verbinde mit PeerJS …';
            case 'waiting': return 'Wartet auf das andere Gerät. Gültig bis ' + until + ' Uhr, für genau eine Übertragung.';
            case 'sending': return 'Überträgt …';
            case 'sent': return 'Übertragen. Der Link ist jetzt verbraucht.';
            case 'expired': return 'Abgelaufen. Der Link gilt nicht mehr.';
            case 'cancelled': return 'Abgebrochen. Der Link gilt nicht mehr.';
            default: return 'PeerJS ist gerade nicht erreichbar. Bitte später noch einmal versuchen oder ein Backup als Datei nutzen.';
        }
    }

    function viewTransferPanel() {
        const t = transferOut;
        const active = t && !t.ended;
        const body = [];
        if (t) {
            body.push(h('div', { class: active ? 'small' : 'notice', style: active ? 'margin:8px 0' : 'margin:10px 0 0' }, transferStatusText(t)));
        }
        if (active && t.status !== 'connecting') {
            const qrBox = h('div', { class: 'qr-card' });
            if (typeof QRCode !== 'undefined') {
                const box = h('div');
                qrBox.appendChild(box);
                new QRCode(box, { text: t.link, width: 220, height: 220, colorDark: '#14121a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });
            }
            const input = h('input', { type: 'text', readonly: 'readonly', value: t.link, 'aria-label': 'Link zum Übertragen', onfocus: function (e) { e.target.select(); } });
            body.push(qrBox,
                h('div', { class: 'add-row' }, input,
                    h('button', {
                        class: 'btn', type: 'button',
                        onclick: async function () { toast(await copyText(t.link) ? 'Link kopiert.' : 'Kopieren hat nicht geklappt.'); }
                    }, 'Kopieren')),
                h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Öffne den Link auf dem anderen Gerät oder scanne den QR-Code. Lass diese Seite offen, bis „Übertragen“ erscheint. Wer den Link hat, bekommt alle Daten, also nur an dich selbst schicken.'));
        }
        return h('section', { class: 'panel' },
            h('h2', null, 'Auf ein anderes Gerät übertragen'),
            h('p', { class: 'small muted' }, 'Schickt alle Daten wie ein Backup direkt an ein anderes Gerät, zum Beispiel vom PC aufs Handy. Dort werden sie mit dem vorhandenen Stand zusammengeführt. Beide Geräte müssen dafür gleichzeitig online sein.'),
            body,
            h('div', { class: 'actions' },
                active
                    ? h('button', { class: 'btn btn-small', type: 'button', onclick: function () { endTransfer(t, 'cancelled'); } }, 'Abbrechen')
                    : h('button', { class: 'btn btn-small', type: 'button', disabled: !Object.keys(store.groups).length, onclick: startTransfer }, t ? 'Neuen Link erstellen' : 'Link und QR-Code erstellen')));
    }

    /* Empfangen */

    function viewTransferIn(value) {
        if (!transferIn || transferIn.value !== value) receiveTransfer(value);
        const t = transferIn;
        const back = h('a', { class: 'back', href: '#/gruppen' }, '‹ Startseite');

        function close(path) {
            try { t.peer.destroy(); } catch (e) { /* schon zu */ }
            transferIn = null;
            history.replaceState(null, '', '#/' + path);
            render();
        }

        let content;
        if (t.status === 'received') {
            content = [
                h('p', null, 'Vom anderen Gerät: ' + t.summary + '.'),
                h('p', { class: 'small muted' }, 'Beim Übernehmen wird das mit den Daten hier zusammengeführt. Es geht nichts verloren, was hier schon ist.'),
                h('div', { class: 'actions' },
                    h('button', {
                        class: 'btn', type: 'button',
                        onclick: function () {
                            const result = applyBackup(t.data);
                            close('gruppen');
                            toast(result.text + ' übernommen.', 'OK', function () { /* nur schließen */ });
                        }
                    }, 'Übernehmen'),
                    h('button', { class: 'btn btn-small', type: 'button', onclick: function () { close(''); } }, 'Verwerfen'))
            ];
        } else if (t.status === 'connecting') {
            content = h('p', { class: 'small muted' }, 'Verbinde mit dem anderen Gerät …');
        } else {
            content = [
                h('div', { class: 'notice' }, t.status === 'invalid' ? 'Dieser Link ist ungültig. Wurde er vollständig kopiert?'
                    : t.status === 'denied' ? 'Der Schlüssel im Link passt nicht. Wurde der Link vollständig kopiert? Der Link auf dem anderen Gerät gilt weiter.'
                    : t.status === 'unsupported' ? 'Übertragen geht in diesem Browser nicht.'
                        : 'Das andere Gerät ist nicht erreichbar. Der Link ist abgelaufen, schon benutzt, oder die Seite dort ist geschlossen.'),
                h('div', { class: 'actions' }, h('button', { class: 'btn btn-small', type: 'button', onclick: function () { close(''); } }, 'Zur Startseite'))
            ];
        }
        return h('div', null, back, h('section', { class: 'panel' }, h('h2', null, 'Daten empfangen'), content));
    }

    function receiveTransfer(value) {
        const t = { value: value, status: 'connecting' };
        transferIn = t;
        const m = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
        if (!m) {
            t.status = 'invalid';
            return;
        }
        if (!transferPossible()) {
            t.status = 'unsupported';
            return;
        }
        const session = m[1];
        const keyText = m[2];
        function fail() {
            if (transferIn !== t || t.status !== 'connecting') return;
            t.status = 'gone';
            try { t.peer.destroy(); } catch (e) { /* schon zu */ }
            render();
        }
        const timer = setTimeout(fail, 20000);
        t.peer = new Peer({ debug: 0 });
        t.peer.on('error', fail);
        t.peer.on('open', function () {
            const conn = t.peer.connect(TRANSFER_PREFIX + session, { reliable: true });
            conn.on('open', async function () {
                const key = await transferKey(keyText);
                conn.send({ app: 'quitt', type: 'transfer-hello', proof: await sealText(key, 'kwidt-transfer:' + session) });
            });
            conn.on('data', async function (msg) {
                if (!msg || msg.app !== 'quitt' || transferIn !== t) return;
                if (msg.type === 'transfer-denied') {
                    clearTimeout(timer);
                    t.status = 'denied';
                    try { t.peer.destroy(); } catch (e) { /* schon zu */ }
                    render();
                    return;
                }
                if (msg.type !== 'transfer-data') return;
                try {
                    const key = await transferKey(keyText);
                    const data = JSON.parse(await openText(key, msg.box));
                    if (!data || data.app !== 'quitt' || !Array.isArray(data.groups)) throw new Error('Keine Kwidt-Daten');
                    clearTimeout(timer);
                    t.data = data;
                    t.summary = backupSummary(data);
                    t.status = 'received';
                    conn.send({ app: 'quitt', type: 'transfer-received' });
                    setTimeout(function () { try { t.peer.destroy(); } catch (e) { /* schon zu */ } }, 800);
                } catch (e) {
                    clearTimeout(timer);
                    t.status = 'gone';
                }
                render();
            });
            conn.on('error', fail);
        });
    }

    /* ---------- Personen über Gruppen hinweg ---------- */
    /*
     * Kontakte verknüpfen dieselbe Person aus verschiedenen Gruppen. Sie liegen nur auf
     * diesem Gerät (und im Backup), nie in einer Gruppe: Keine Gruppe erfährt etwas über
     * die anderen. Eine Verrechnung trägt in jeder beteiligten Gruppe eine markierte
     * Zahlung ein. Das lokale Log hält fest, was wo eingetragen wurde, für die Erklärung
     * an die andere Person und zum Rückgängigmachen.
     */

    const OFFSET_NOTE = 'Über verschiedene Gruppen verrechnet';
    const DIFF_NOTE = 'Differenz nach Verrechnung über verschiedene Gruppen';

    // Laufende Verrechnung auf der Kontaktseite (nur im Speicher, nicht gespeichert).
    let offsetFlow = null;

    function cleanContacts(raw) {
        const out = {};
        if (!raw || typeof raw !== 'object') return out;
        Object.keys(raw).forEach(function (id) {
            const c = raw[id];
            if (!c || !C.RE_ID.test(id) || typeof c.name !== 'string') return;
            out[id] = {
                id: id,
                name: C.tidyText(c.name, 40) || 'Person',
                links: (Array.isArray(c.links) ? c.links : [])
                    .filter(function (l) { return l && C.RE_GROUP_ID.test(String(l.gid)) && C.RE_ID.test(String(l.member)); })
                    .map(function (l) { return { gid: l.gid, member: l.member }; })
            };
        });
        return out;
    }

    /** Das Log stammt nur von diesem Gerät bzw. aus dem eigenen Backup; Texte landen nur als Textknoten im DOM. */
    function cleanOffsets(raw) {
        const out = {};
        if (!raw || typeof raw !== 'object') return out;
        Object.keys(raw).forEach(function (id) {
            const o = raw[id];
            if (!o || !C.RE_ID.test(id) || typeof o.t !== 'number' || !Array.isArray(o.entries)) return;
            out[id] = JSON.parse(JSON.stringify(o));
            out[id].id = id;
        });
        return out;
    }

    /** „Du hast mit Anna über verschiedene Gruppen verrechnet“, aus Sicht des Geräts. */
    function offsetText(doc, p, me) {
        const by = p.offsetBy === p.to ? p.to : p.from;
        const other = by === p.from ? p.to : p.from;
        return (by === me ? 'Du hast' : memberName(doc, by) + ' hat') + ' mit ' + (other === me ? 'dir' : memberName(doc, other))
            + ' über verschiedene Gruppen verrechnet';
    }

    /** Wer die Verrechnung angestoßen hat, mit dem Namen aus dieser Gruppe. */
    function offsetStarter(doc, p, me) {
        return p.offsetBy === me ? 'dir' : memberName(doc, p.offsetBy);
    }

    function contactList() {
        return Object.keys(store.contacts).map(function (id) { return store.contacts[id]; })
            .sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    }

    /** Warum eine Verknüpfung gerade nicht zählt, oder null. */
    function linkProblem(l) {
        const doc = store.groups[l.gid];
        if (!doc) return 'Gruppe nicht mehr auf diesem Gerät';
        if (!meId(l.gid)) return 'Du hast in dieser Gruppe noch nicht gewählt, wer du bist';
        if (!doc.members[l.member]) return 'Person nicht mehr in der Gruppe';
        if (l.member === meId(l.gid)) return 'Das bist du selbst';
        return null;
    }

    /** Nutzbare Verknüpfungen: Gruppe da, ich bin drin, die Person auch. */
    function contactLinks(contact) {
        return contact.links.filter(function (l) { return !linkProblem(l); }).map(function (l) {
            return { gid: l.gid, member: l.member, doc: store.groups[l.gid], me: meId(l.gid) };
        });
    }

    /** „Anna · Urlaub · dabei: Ben, Chris“: genug, um Gleichnamige auseinanderzuhalten. */
    function linkLabel(doc, member) {
        const me = meId(doc.id);
        const others = Object.keys(doc.members).map(function (id) { return doc.members[id]; })
            .filter(function (m) { return !m.left && m.id !== member && m.id !== me; })
            .map(function (m) { return m.name; })
            .sort(function (a, b) { return a.localeCompare(b, 'de'); });
        const shown = others.length > 4 ? others.slice(0, 4).join(', ') + ' …' : others.join(', ');
        return memberName(doc, member) + (doc.members[member].left ? ' (ausgetreten)' : '') + ' · ' + doc.meta.name
            + ' · ' + (shown ? 'dabei: du, ' + shown : 'nur ihr zwei');
    }

    /** Pro Währung, was zwischen mir und dem Kontakt in jeder Gruppe offen ist, so wie die Gruppe rechnet. */
    function contactAmounts(contact) {
        const links = contactLinks(contact);
        const balances = {};
        const currencies = {};
        links.forEach(function (l) {
            balances[l.gid] = C.computeBalances(l.doc);
            Object.keys(balances[l.gid]).forEach(function (cur) { currencies[cur] = true; });
        });
        // Jede verknüpfte Gruppe in jeder Währung, auch ohne Beträge: Sie kann Zielgruppe sein.
        const out = {};
        Object.keys(currencies).forEach(function (cur) {
            out[cur] = links.map(function (l) {
                return Object.assign({ cur: cur, amount: C.pairAmount(l.doc, cur, l.me, l.member, balances[l.gid]) }, l);
            }).sort(function (a, b) { return a.doc.meta.name.localeCompare(b.doc.meta.name, 'de'); });
        });
        return out;
    }

    function owedText(amount, cur) {
        if (amount > 0) return 'du schuldest ' + money(amount, cur);
        if (amount < 0) return 'du bekommst ' + money(-amount, cur);
        return 'nichts offen';
    }

    function owedSpan(amount, cur) {
        if (!amount) return h('span', { class: 'muted' }, 'nichts offen');
        return h('span', null, h('span', { class: 'muted' }, amount > 0 ? 'du schuldest ' : 'du bekommst '),
            h('strong', { class: amount > 0 ? 'neg' : 'pos' }, money(Math.abs(amount), cur)));
    }

    function modeText(doc) {
        return doc.meta.simplify ? 'vereinfacht gerechnet' : 'direkt gerechnet';
    }

    /**
     * Gleicht eine Gruppe einmal mit den Geräten ab, die sie gerade offen haben: eigenen
     * Stand schicken, ihren übernehmen, Verbindung wieder trennen. Ist niemand da, gibt
     * es nach ein paar Sekunden auf. Liefert 'sent' oder 'offline'.
     */
    function exchangeOnce(gid) {
        return new Promise(function (resolve) {
            const doc = store.groups[gid];
            if (!doc || typeof Peer === 'undefined' || navigator.onLine === false) return resolve('offline');
            if (Sync.gid === gid) {
                Sync.broadcast(doc);
                return resolve(Sync.conns.size ? 'sent' : 'offline');
            }
            let done = false;
            let peer = null;
            const timer = setTimeout(function () { finish('offline'); }, 12000);
            function finish(result) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                if (result === 'sent') markSeen(gid, true);
                // Kurz warten, damit der eigene Stand noch rausgeht.
                setTimeout(function () { try { peer.destroy(); } catch (e) { /* schon zu */ } }, 400);
                resolve(result);
            }
            try {
                peer = new Peer({ debug: 0 });
            } catch (e) {
                return finish('offline');
            }
            peer.on('open', function () {
                const conn = peer.connect(PEER_PREFIX + gid, { reliable: true });
                conn.on('open', function () {
                    conn.send({ app: 'quitt', type: 'state', doc: store.groups[gid] });
                });
                conn.on('data', function (msg) {
                    if (!msg || msg.app !== 'quitt' || msg.type !== 'state') return;
                    const incoming = C.sanitizeGroup(msg.doc);
                    const current = store.groups[gid];
                    if (incoming && current && incoming.id === gid && C.mergeGroups(current, incoming)) persist();
                    setTimeout(function () { finish('sent'); }, 300);
                });
                conn.on('error', function () { finish('offline'); });
            });
            // Auch "niemand hat die Gruppe offen" kommt als Fehler (peer-unavailable).
            peer.on('error', function () { finish('offline'); });
        });
    }

    function syncStatusText(status) {
        return status === 'sent' ? 'abgeglichen' : status === 'offline' ? 'niemand online, kommt beim nächsten Abgleich an' : 'wird gesendet …';
    }

    /* Startseite */

    function viewPeoplePanel() {
        if (!Object.keys(store.groups).length) return null;
        const list = contactList();
        const input = h('input', { type: 'text', maxlength: 40, placeholder: 'Name, z. B. Anna', 'aria-label': 'Neue Person', autocomplete: 'off' });
        const logCount = Object.keys(store.offsets).length;

        return h('section', { class: 'panel' },
            h('h2', null, 'Personen über Gruppen hinweg'),
            h('p', { class: 'small muted', style: 'margin-bottom:8px' }, 'Verknüpfe dieselbe Person aus verschiedenen Gruppen. Dann siehst du, was zwischen euch insgesamt offen ist, und kannst alles in einer Gruppe zusammenführen. Die Verknüpfung bleibt auf diesem Gerät, keine Gruppe erfährt davon.'),
            list.length ? h('div', { class: 'list' }, list.map(function (contact) {
                const amounts = contactAmounts(contact);
                const totals = Object.keys(amounts).map(function (cur) {
                    return { cur: cur, amount: amounts[cur].reduce(function (sum, row) { return sum + row.amount; }, 0) };
                }).filter(function (t) { return t.amount; });
                const groups = contactLinks(contact).length;
                return h('a', { class: 'item', href: '#/p/' + contact.id },
                    h('span', { class: 'body' },
                        h('div', { class: 'title' }, contact.name),
                        h('div', { class: 'sub' }, groups + (groups === 1 ? ' Gruppe' : ' Gruppen')
                            + (groups ? ': ' + contactLinks(contact).map(function (l) {
                                return l.doc.meta.name + ' (' + memberName(l.doc, l.member) + ')';
                            }).join(', ') : ''))),
                    h('span', { class: 'side' }, totals.length
                        ? totals.map(function (t) { return h('div', null, owedSpan(t.amount, t.cur)); })
                        : h('span', { class: 'muted' }, 'kwidt')));
            })) : null,
            h('form', {
                class: 'add-row',
                onsubmit: function (e) {
                    e.preventDefault();
                    const name = C.tidyText(input.value, 40);
                    if (!name) return;
                    const id = C.newId();
                    store.contacts[id] = { id: id, name: name, links: [] };
                    persist();
                    go('/p/' + id);
                }
            }, input, h('button', { class: 'btn', type: 'submit' }, 'Anlegen')),
            logCount ? h('p', { class: 'small', style: 'margin-top:10px' },
                h('a', { href: '#/offsets' }, 'Alle Verrechnungen (' + logCount + ')')) : null);
    }

    /* Kontaktseite */

    function viewContact(cid) {
        const contact = store.contacts[cid];
        if (!contact) {
            setTimeout(function () { go('/personen'); }, 0);
            return h('div');
        }
        // Fällige Wiederholungen nachbuchen, sonst rechnet die Übersicht mit altem Stand.
        contactLinks(contact).forEach(function (l) {
            if (C.expandRecurring(l.doc, C.todayStr())) persist();
        });
        if (offsetFlow && offsetFlow.cid !== cid) offsetFlow = null;

        return h('div', null,
            h('a', { class: 'back', href: '#/personen' }, '‹ Personen'),
            h('header', { class: 'group-head' },
                h('h1', null, contact.name),
                h('p', { class: 'small muted' }, 'Nur auf diesem Gerät. Die Gruppen erfahren nichts von dieser Verknüpfung.')),
            viewContactAmounts(contact),
            viewContactLinks(contact),
            viewOffsetEntries(contactOffsets(contact.id), 'Verrechnungen mit ' + contact.name),
            viewContactSettings(contact));
    }

    /** Mitglieder einer Gruppe als Text, du zuerst markiert: hilft, die richtige Person zu finden. */
    function groupPeopleText(doc, exclude) {
        const me = meId(doc.id);
        const names = activeMembers(doc).filter(function (m) { return m.id !== me && exclude.indexOf(m.id) === -1; }).map(function (m) { return m.name; });
        return names.length ? names.join(', ') : 'niemand sonst';
    }

    function viewContactLinks(contact) {
        const usedElsewhere = {};
        Object.keys(store.contacts).forEach(function (id) {
            if (id === contact.id) return;
            store.contacts[id].links.forEach(function (l) { usedElsewhere[l.gid + '|' + l.member] = store.contacts[id].name; });
        });
        const linkedGroups = contact.links.map(function (l) { return l.gid; });
        const key = contact.name.toLocaleLowerCase('de');

        // Wählbar: Gruppen, in denen ich bin und die noch nicht verknüpft sind, mit ihren freien Personen.
        const groups = Object.keys(store.groups).map(function (gid) {
            const doc = store.groups[gid];
            const me = meId(gid);
            if (!me || !doc.meta.t || linkedGroups.indexOf(gid) !== -1) return null;
            const people = Object.keys(doc.members)
                .filter(function (id) { return id !== me && !usedElsewhere[gid + '|' + id]; })
                .map(function (id) { return { id: id, name: doc.members[id].name, left: doc.members[id].left, same: doc.members[id].name.toLocaleLowerCase('de') === key }; })
                // Gleicher Name zuerst, verknüpft wird aber nur von Hand.
                .sort(function (a, b) { return (b.same - a.same) || (a.left - b.left) || a.name.localeCompare(b.name, 'de'); });
            return people.length ? { gid: gid, doc: doc, me: me, people: people, same: people.some(function (p) { return p.same; }) } : null;
        }).filter(Boolean).sort(function (a, b) { return (b.same - a.same) || a.doc.meta.name.localeCompare(b.doc.meta.name, 'de'); });

        const groupSelect = h('select', {
            id: 'linkGroup',
            onchange: function () { fillPeople(); }
        },
            h('option', { value: '' }, 'Gruppe wählen …'),
            groups.map(function (g) { return h('option', { value: g.gid }, g.doc.meta.name); }));
        const personSelect = h('select', { id: 'linkPerson', disabled: true }, h('option', { value: '' }, 'Erst die Gruppe wählen'));
        const groupInfo = h('div', { class: 'field-hint', hidden: true });
        const submitButton = h('button', { class: 'btn', type: 'submit', disabled: true }, 'Verknüpfen');

        function current() {
            return groups.filter(function (g) { return g.gid === groupSelect.value; })[0] || null;
        }
        function fillPeople() {
            const g = current();
            personSelect.textContent = '';
            personSelect.disabled = !g;
            groupInfo.hidden = !g;
            if (!g) {
                personSelect.appendChild(h('option', { value: '' }, 'Erst die Gruppe wählen'));
                submitButton.disabled = true;
                return;
            }
            personSelect.appendChild(h('option', { value: '' }, 'Person wählen …'));
            g.people.forEach(function (p) {
                personSelect.appendChild(h('option', { value: p.id }, p.name + (p.left ? ' (ausgetreten)' : '')));
            });
            groupInfo.textContent = 'Du bist dort: ' + memberName(g.doc, g.me) + ' · außerdem dabei: ' + groupPeopleText(g.doc, []);
            submitButton.disabled = true;
        }
        personSelect.addEventListener('change', function () { submitButton.disabled = !personSelect.value; });

        return h('section', { class: 'panel' },
            h('h2', null, 'Verknüpft'),
            h('p', { class: 'small muted', style: 'margin-bottom:8px' }, 'Pro Gruppe eine Person. Prüf Gruppe und Mitglieder: Gleicher Name heißt nicht gleiche Person, und dieselbe Person kann anders heißen.'),
            contact.links.length ? contact.links.map(function (l) {
                const problem = linkProblem(l);
                const doc = store.groups[l.gid];
                const known = doc && doc.members[l.member];
                return h('div', { class: 'category-row' },
                    h('span', null,
                        h('strong', null, doc ? doc.meta.name : 'Unbekannte Gruppe'),
                        known ? h('div', { class: 'small' }, 'Person dort: ' + memberName(doc, l.member) + (doc.members[l.member].left ? ' (ausgetreten)' : '')) : null,
                        known && meId(l.gid) ? h('div', { class: 'small muted' }, 'Du bist dort: ' + memberName(doc, meId(l.gid)) + ' · außerdem dabei: ' + groupPeopleText(doc, [l.member])) : null,
                        problem ? h('div', { class: 'small neg' }, problem) : null),
                    h('button', {
                        class: 'btn btn-small', type: 'button',
                        onclick: function () {
                            contact.links = contact.links.filter(function (x) { return x !== l; });
                            offsetFlow = null;
                            persist();
                            render();
                        }
                    }, 'Lösen'));
            }) : h('div', { class: 'small muted' }, 'Noch keine Gruppe verknüpft.'),
            groups.length ? h('form', {
                class: 'link-form',
                onsubmit: function (e) {
                    e.preventDefault();
                    const g = current();
                    if (!g || !personSelect.value) return;
                    contact.links.push({ gid: g.gid, member: personSelect.value });
                    offsetFlow = null;
                    persist();
                    render();
                }
            },
                h('div', { class: 'field-row' },
                    h('div', { class: 'field' }, h('label', { for: 'linkGroup' }, 'Gruppe'), groupSelect),
                    h('div', { class: 'field' }, h('label', { for: 'linkPerson' }, 'Person dort'), personSelect)),
                groupInfo,
                h('div', { class: 'actions' }, submitButton))
                : h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Keine weitere Gruppe zum Verknüpfen.'));
    }

    function viewContactSettings(contact) {
        const nameInput = h('input', { type: 'text', maxlength: 40, value: contact.name, 'aria-label': 'Name', autocomplete: 'off' });
        return h('section', { class: 'panel' },
            h('h2', null, 'Person'),
            h('form', {
                class: 'add-row',
                onsubmit: function (e) {
                    e.preventDefault();
                    const name = C.tidyText(nameInput.value, 40);
                    if (!name) return;
                    contact.name = name;
                    persist();
                    render();
                    toast('Umbenannt.');
                }
            }, nameInput, h('button', { class: 'btn', type: 'submit' }, 'Umbenennen')),
            h('div', { class: 'actions' },
                h('button', {
                    class: 'btn btn-danger btn-small', type: 'button',
                    onclick: function () {
                        if (!confirm('„' + contact.name + '“ entfernen? Die Gruppen bleiben, wie sie sind. Bisherige Verrechnungen bleiben im Log.')) return;
                        delete store.contacts[contact.id];
                        offsetFlow = null;
                        persist();
                        go('/personen');
                    }
                }, 'Person entfernen')));
    }

    /* Übersicht und Verrechnen */

    function viewContactAmounts(contact) {
        const amounts = contactAmounts(contact);
        const currencies = Object.keys(amounts).sort();
        if (!currencies.length) {
            return h('section', { class: 'panel' }, h('h2', null, 'Offen zwischen euch'),
                h('div', { class: 'small muted' }, contactLinks(contact).length ? 'In den verknüpften Gruppen gibt es noch keine Beträge.' : 'Verknüpfe unten mindestens zwei Gruppen.'));
        }
        return h('section', { class: 'panel' },
            h('h2', null, 'Offen zwischen euch'),
            currencies.map(function (cur) {
                const rows = amounts[cur];
                const total = rows.reduce(function (sum, r) { return sum + r.amount; }, 0);
                const flow = offsetFlow && offsetFlow.cid === contact.id && offsetFlow.cur === cur ? offsetFlow : null;
                // Zusammenführen lohnt, sobald es mindestens zwei Gruppen gibt und irgendwo etwas offen ist.
                const canCollect = rows.length >= 2 && rows.some(function (r) { return r.amount; });
                return h('div', { class: 'offset-block' },
                    currencies.length > 1 ? h('div', { class: 'link-title' }, cur) : null,
                    rows.map(function (r) {
                        return h('div', { class: 'kv' },
                            h('span', null, r.doc.meta.name, h('div', { class: 'small muted' }, 'dort: ' + memberName(r.doc, r.member) + ' · ' + modeText(r.doc))),
                            owedSpan(r.amount, cur));
                    }),
                    h('div', { class: 'kv total-row' }, h('span', null, 'Zusammen'), total ? owedSpan(total, cur) : h('span', { class: 'pos' }, 'kwidt')),
                    rows.some(function (r) { return r.doc.meta.simplify; }) ? h('p', { class: 'small muted' },
                        'Vereinfacht rechnende Gruppen zeigen nur, was die Ausgleichsvorschläge zwischen euch beiden vorsehen. Das kann 0 sein, obwohl ihr dort Ausgaben miteinander habt.') : null,
                    flow ? viewOffsetFlow(contact, flow)
                        : canCollect ? h('div', { class: 'actions' },
                            h('button', {
                                class: 'btn', type: 'button',
                                onclick: function () { startOffset(contact, cur); }
                            }, 'In einer Gruppe zusammenführen …')) : null);
            }));
    }

    function stillOnContact(cid) {
        return location.hash === '#/p/' + cid;
    }

    /** Schritt 1: alle beteiligten Gruppen einmal abgleichen, damit mit dem aktuellen Stand gerechnet wird. */
    async function startOffset(contact, cur) {
        const links = contactLinks(contact);
        offsetFlow = { cid: contact.id, cur: cur, step: 'sync', pull: {}, target: '', mode: 'open', sure: false };
        links.forEach(function (l) { offsetFlow.pull[l.gid] = 'pending'; });
        render();
        const flow = offsetFlow;
        await Promise.all(links.map(function (l) {
            return exchangeOnce(l.gid).then(function (result) { flow.pull[l.gid] = result; });
        }));
        if (offsetFlow !== flow) return;
        flow.step = 'preview';
        if (stillOnContact(contact.id)) render();
    }

    /**
     * Vorschlag für die Zielgruppe: die mit dem größten offenen Betrag, direkt rechnende
     * zuerst. In vereinfacht rechnenden Gruppen können die Vorschläge den Betrag umleiten.
     */
    function defaultTarget(rows) {
        return rows.slice().sort(function (a, b) {
            return (a.doc.meta.simplify - b.doc.meta.simplify) || (Math.abs(b.amount) - Math.abs(a.amount))
                || a.doc.meta.name.localeCompare(b.doc.meta.name, 'de');
        })[0].gid;
    }

    /** Was das Zusammenführen mit der aktuellen Auswahl bewirken würde. */
    function offsetPreview(contact, flow) {
        const rows = contactAmounts(contact)[flow.cur] || [];
        const byGid = {};
        rows.forEach(function (r) { byGid[r.gid] = r; });
        if (!byGid[flow.target] && rows.length) flow.target = defaultTarget(rows);
        const plan = C.planCollect(rows.map(function (r) { return { gid: r.gid, amount: r.amount }; }), flow.target);
        return { rows: rows, plan: plan, byGid: byGid };
    }

    /** Dein Name für die Person, und wie sie in der Gruppe heißt, falls anders. */
    function contactWho(contact, row) {
        const there = memberName(row.doc, row.member);
        return contact.name + (there !== contact.name ? ' (in „' + row.doc.meta.name + '“: ' + there + ')' : '');
    }

    function viewOffsetFlow(contact, flow) {
        if (flow.step === 'sync') {
            return h('div', { class: 'offset-flow' },
                h('div', { class: 'link-title' }, 'Gleiche die Gruppen ab …'),
                Object.keys(flow.pull).map(function (gid) {
                    return h('div', { class: 'small muted' }, store.groups[gid].meta.name + ': ' + (flow.pull[gid] === 'pending' ? 'verbinde …' : syncStatusText(flow.pull[gid])));
                }));
        }
        if (flow.step === 'done') return viewOffsetDone(flow);

        const p = offsetPreview(contact, flow);
        const cur = flow.cur;
        const target = p.byGid[flow.target];
        const entryOf = {};
        p.plan.entries.forEach(function (e) { entryOf[e.gid] = e.amount; });
        const net = p.plan.net;
        const pay = flow.mode === 'pay' && net !== 0;
        const nothing = !p.plan.entries.length && !pay;

        function rerender() { render(); }

        const targetSelect = h('select', {
            id: 'offsetTarget', value: flow.target,
            onchange: function (e) { flow.target = e.target.value; rerender(); }
        }, p.rows.map(function (r) {
            return h('option', { value: r.gid }, r.doc.meta.name + ' · ' + owedText(r.amount, cur) + (r.doc.meta.simplify ? ' · vereinfacht, Vorschläge können umleiten' : ''));
        }));

        const result = h('div', { class: 'offset-rest' },
            h('div', { class: 'link-title' }, net
                ? 'Danach in „' + target.doc.meta.name + '“: ' + owedText(net, cur)
                : 'Danach seid ihr in allen Gruppen kwidt'),
            net ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Was passiert mit der Summe?' },
                [['open', 'Offen lassen'], ['pay', 'Differenz zahlen']].map(function (m) {
                    return h('button', {
                        type: 'button', 'aria-pressed': String(flow.mode === m[0]),
                        onclick: function () { flow.mode = m[0]; rerender(); }
                    }, m[1]);
                })) : null,
            pay ? h('div', { class: 'notice', style: 'margin:10px 0 0' },
                (net > 0 ? 'Du musst ' + contactWho(contact, target) + ' ' : contactWho(contact, target) + ' muss dir ')
                + money(Math.abs(net), cur) + ' wirklich zahlen. Das wird in „' + target.doc.meta.name + '“ als normale Zahlung eingetragen.') : null,
            target.doc.meta.simplify ? h('p', { class: 'small muted', style: 'margin-top:8px' },
                '„' + target.doc.meta.name + '“ rechnet vereinfacht: Der Betrag kommt dort an, die Ausgleichsvorschläge können ihn aber auf andere Personen umleiten. Unterm Strich stimmt es trotzdem.') : null);

        return h('div', { class: 'offset-flow' },
            h('div', { class: 'field' },
                h('label', { for: 'offsetTarget' }, 'Zielgruppe: Hier sammelt sich alles'),
                targetSelect),
            h('div', { class: 'link-title' }, 'Vorschau'),
            p.rows.map(function (r) {
                const entry = entryOf[r.gid] || 0;
                const paid = pay && r.gid === flow.target ? net : 0;
                const after = r.amount - entry - paid;
                return h('div', { class: 'offset-row' + (r.gid === flow.target ? ' is-target' : '') },
                    h('div', null, h('strong', null, r.doc.meta.name), r.gid === flow.target ? ' · Zielgruppe' : '', ' · Datenstand ', h('code', { class: 'state-code' }, C.dataFingerprint(r.doc))),
                    h('div', { class: 'small muted' }, 'Person dort: ' + linkLabel(r.doc, r.member)),
                    h('div', { class: 'small muted' }, 'Du heißt dort: ' + memberName(r.doc, r.me) + ' · ' + modeText(r.doc) + ' · ' + syncStatusText(flow.pull[r.gid] || 'offline')),
                    h('div', { class: 'small' }, 'jetzt: ' + owedText(r.amount, cur)
                        + (entry ? ' → Verrechnung: ' + (entry > 0 ? 'du an ' : 'an dich von ') + memberName(r.doc, r.member) + ' ' + money(Math.abs(entry), cur) : ' → kein Eintrag')
                        + (paid ? ' → Differenz gezahlt: ' + money(Math.abs(paid), cur) : '')
                        + ' → danach: ' + owedText(after, cur)));
            }),
            result,
            nothing ? h('p', { class: 'small muted' }, 'Mit dieser Zielgruppe gibt es nichts zu verschieben.') : [
                h('label', { class: 'check-row' },
                    h('input', {
                        type: 'checkbox', checked: flow.sure,
                        onchange: function (e) { flow.sure = e.target.checked; rerender(); }
                    }),
                    h('span', null, 'Ich habe geprüft: In allen Gruppen ist das dieselbe Person.')),
                h('div', { class: 'actions' },
                    h('button', { class: 'btn', type: 'button', disabled: !flow.sure, onclick: function () { runOffset(contact, flow); } }, 'Jetzt zusammenführen'),
                    h('button', { class: 'btn btn-small', type: 'button', onclick: function () { offsetFlow = null; render(); } }, 'Abbrechen'))],
            nothing ? h('div', { class: 'actions' },
                h('button', { class: 'btn btn-small', type: 'button', onclick: function () { offsetFlow = null; render(); } }, 'Schließen')) : null,
            h('p', { class: 'small muted' }, 'In jeder Gruppe mit Eintrag steht danach eine Zahlung „über verschiedene Gruppen verrechnet“. Über alle Gruppen heben sie sich auf, es fließt kein Geld. Danach versucht Kwidt einmal, die Gruppen an Geräte zu senden, die sie gerade offen haben. Ist niemand online, kommt es beim nächsten Abgleich an.'));
    }

    /** Schritt 3: Zahlungen eintragen, Log schreiben, einmal senden. */
    async function runOffset(contact, flow) {
        const p = offsetPreview(contact, flow);
        const net = p.plan.net;
        const pay = flow.mode === 'pay' && net !== 0;
        if (!flow.sure || (!p.plan.entries.length && !pay)) return;
        const cur = flow.cur;
        const target = p.byGid[flow.target];
        const oid = C.newId();
        const today = C.todayStr();
        const log = {
            id: oid, t: Date.now(), contact: contact.id, name: contact.name, currency: cur, total: p.plan.moved,
            target: flow.target, targetGroup: target.doc.meta.name, entries: [], rest: [], status: {}
        };
        const touched = {};

        function addPayment(row, signedAmount, offset) {
            const doc = row.doc;
            const id = C.newId();
            const from = signedAmount > 0 ? row.me : row.member;
            const to = signedAmount > 0 ? row.member : row.me;
            const amount = Math.abs(signedAmount);
            doc.payments[id] = {
                id: id, t: C.nextT(doc), by: row.me, from: from, to: to, amount: amount, currency: cur, date: today,
                note: offset ? OFFSET_NOTE : DIFF_NOTE + ', angestoßen von ' + memberName(doc, row.me), del: false
            };
            if (offset) {
                doc.payments[id].offset = oid;
                doc.payments[id].offsetBy = row.me;
                logActivity(doc, 'offset-add', id, 'mit ' + memberName(doc, row.member) + ' ' + money(amount, cur) + ' über verschiedene Gruppen verrechnet');
            } else {
                logActivity(doc, 'pay-add', id, memberName(doc, from) + ' an ' + memberName(doc, to) + ' (Differenz nach Verrechnung)', amount, cur);
            }
            touched[row.gid] = true;
            log.entries.push({
                gid: row.gid, group: doc.meta.name, payment: id, kind: offset ? 'offset' : 'difference',
                from: from, to: to, amount: amount, fromName: memberName(doc, from), toName: memberName(doc, to)
            });
        }

        p.plan.entries.forEach(function (e) { addPayment(p.byGid[e.gid], e.amount, true); });
        if (pay) {
            addPayment(target, net, false);
        } else if (net) {
            log.rest.push({
                gid: target.gid, group: target.doc.meta.name, amount: Math.abs(net),
                fromName: memberName(target.doc, net > 0 ? target.me : target.member),
                toName: memberName(target.doc, net > 0 ? target.member : target.me)
            });
        }

        Object.keys(touched).forEach(function (gid) { log.status[gid] = 'pending'; });
        store.offsets[oid] = log;
        persist();
        flow.step = 'done';
        flow.log = oid;
        render();

        await Promise.all(Object.keys(touched).map(function (gid) {
            return exchangeOnce(gid).then(function (result) {
                log.status[gid] = result;
                persist();
                if (stillOnContact(contact.id)) render();
            });
        }));
    }

    /** Überschrift eines Log-Eintrags; ältere Einträge ohne Zielgruppe heißen weiter „verrechnet“. */
    function offsetTitle(log) {
        return log.targetGroup
            ? 'In „' + log.targetGroup + '“ zusammengeführt, ' + money(log.total, log.currency) + ' verschoben'
            : money(log.total, log.currency) + ' verrechnet';
    }

    function viewOffsetDone(flow) {
        const log = store.offsets[flow.log];
        if (!log) return null;
        return h('div', { class: 'offset-flow' },
            h('div', { class: 'link-title' }, offsetTitle(log)),
            viewOffsetDetails(log),
            h('div', { class: 'actions' },
                h('button', { class: 'btn', type: 'button', onclick: function () { copyExplanation(log); } }, 'Erklärung kopieren'),
                h('button', { class: 'btn btn-small', type: 'button', onclick: function () { offsetFlow = null; render(); } }, 'Fertig')),
            h('p', { class: 'small muted' }, 'Schick die Erklärung an die andere Person, damit sie die Einträge in den Gruppen prüfen kann.'));
    }

    /* Log */

    function contactOffsets(cid) {
        return Object.keys(store.offsets).map(function (id) { return store.offsets[id]; })
            .filter(function (o) { return !cid || o.contact === cid; })
            .sort(function (a, b) { return b.t - a.t; });
    }

    function dateTime(t) {
        return new Date(t).toLocaleString('de-DE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function viewOffsetDetails(log) {
        return h('div', null,
            log.entries.map(function (e) {
                const status = log.status && log.status[e.gid];
                return h('div', { class: 'kv' },
                    h('span', null, e.group,
                        h('div', { class: 'small muted' }, e.fromName + ' → ' + e.toName + (e.kind === 'difference' ? ' · Differenz, echte Zahlung' : ' · verrechnet')
                            + (status ? ' · ' + syncStatusText(status) : ''))),
                    h('span', null, money(e.amount, log.currency)));
            }),
            (log.rest || []).map(function (r) {
                return h('div', { class: 'kv' },
                    h('span', null, r.group, h('div', { class: 'small muted' }, 'bleibt offen: ' + r.fromName + ' → ' + r.toName)),
                    h('span', { class: 'muted' }, money(r.amount, log.currency)));
            }));
    }

    function viewOffsetEntries(list, title) {
        if (!list.length) return null;
        return h('section', { class: 'panel' },
            h('h2', null, title),
            list.map(function (log) {
                return h('div', { class: 'offset-log' },
                    h('div', { class: 'link-title' }, 'Mit ' + log.name + ': ' + offsetTitle(log)),
                    h('div', { class: 'small muted' }, dateTime(log.t) + (log.undone ? ' · rückgängig gemacht am ' + dateTime(log.undone) : '')),
                    viewOffsetDetails(log),
                    log.undone && log.undoProblems && log.undoProblems.length ? h('div', { class: 'notice', style: 'margin:8px 0 0' },
                        'Nicht alles rückgängig gemacht: ' + log.undoProblems.join(' · ')) : null,
                    h('div', { class: 'actions' },
                        h('button', { class: 'btn btn-small', type: 'button', onclick: function () { copyExplanation(log); } }, 'Erklärung kopieren'),
                        log.undone ? null : h('button', { class: 'btn btn-small btn-danger', type: 'button', onclick: function () { undoOffset(log); } }, 'Rückgängig machen')));
            }));
    }

    function viewOffsetLog() {
        return h('div', null,
            h('a', { class: 'back', href: '#/personen' }, '‹ Personen'),
            viewOffsetEntries(contactOffsets(null), 'Alle Verrechnungen')
            || h('section', { class: 'panel' }, h('div', { class: 'empty' }, 'Noch keine Verrechnungen.')));
    }

    /** Text für die andere Person: alles drin, auch die Gruppennamen, denn sie ist in all diesen Gruppen. */
    function offsetExplanation(log) {
        const cur = log.currency;
        const lines = ['Verrechnung über verschiedene Gruppen (Kwidt)', dateTime(log.t), ''];
        if (log.targetGroup) {
            lines.push('Alles, was zwischen uns in den Gruppen unten offen war, ist jetzt in „' + log.targetGroup + '“ zusammengeführt. '
                + 'Dafür fließt kein Geld: Die Einträge heben sich über alle Gruppen gegenseitig auf.', '');
        } else {
            lines.push('Verrechnet: ' + money(log.total, cur) + '. Dafür fließt kein Geld, die Beträge heben sich gegenseitig auf.', '');
        }
        log.entries.filter(function (e) { return e.kind !== 'difference'; }).forEach(function (e) {
            lines.push('• ' + e.group + ': ' + e.fromName + ' an ' + e.toName + ' ' + money(e.amount, cur) + ' (als Verrechnung eingetragen)');
        });
        const diffs = log.entries.filter(function (e) { return e.kind === 'difference'; });
        if (diffs.length) {
            lines.push('', 'Die Differenz wird wirklich gezahlt:');
            diffs.forEach(function (e) {
                lines.push('• ' + e.group + ': ' + e.fromName + ' zahlt ' + e.toName + ' ' + money(e.amount, cur) + ' (als normale Zahlung eingetragen)');
            });
        }
        if (log.rest && log.rest.length) {
            lines.push('', log.targetGroup ? 'Offen in „' + log.targetGroup + '“:' : 'Bleibt offen:');
            log.rest.forEach(function (r) {
                lines.push('• ' + r.group + ': ' + r.fromName + ' an ' + r.toName + ' ' + money(r.amount, cur));
            });
        }
        if (log.undone) lines.push('', 'Diese Verrechnung wurde am ' + dateTime(log.undone) + ' rückgängig gemacht.');
        lines.push('', 'Du findest die Einträge in den genannten Gruppen unter „Ausgaben“. Stimmt etwas nicht, kann die Verrechnung rückgängig gemacht werden.');
        return lines.join('\n');
    }

    async function copyExplanation(log) {
        toast(await copyText(offsetExplanation(log)) ? 'Erklärung kopiert.' : 'Kopieren hat nicht geklappt.');
    }

    /** Was "Rückgängig" mit einem Eintrag des Logs machen würde. */
    function undoCheck(log, e) {
        const doc = store.groups[e.gid];
        if (!doc) return { ok: false, text: e.group + ': Gruppe nicht mehr auf diesem Gerät' };
        const p = doc.payments[e.payment];
        if (!p || p.del) return { ok: false, text: e.group + ': Zahlung fehlt, wurde schon gelöscht' };
        if (p.amount !== e.amount || p.from !== e.from || p.to !== e.to || p.currency !== log.currency) {
            return { ok: false, text: e.group + ': Zahlung wurde geändert und bleibt, bitte selbst prüfen' };
        }
        return { ok: true, doc: doc, payment: p, text: e.group + ': ' + (e.kind === 'difference' ? 'Differenz-Zahlung' : 'Verrechnung') + ' wird gelöscht' };
    }

    async function undoOffset(log) {
        const checks = log.entries.map(function (e) { return { entry: e, check: undoCheck(log, e) }; });
        if (!confirm('Verrechnung mit ' + log.name + ' vom ' + dateTime(log.t) + ' rückgängig machen?\n\n'
            + checks.map(function (c) { return '• ' + c.check.text; }).join('\n'))) return;

        const touched = {};
        checks.forEach(function (c) {
            if (!c.check.ok) return;
            const doc = c.check.doc;
            const before = c.check.payment;
            doc.payments[before.id] = Object.assign({}, before, { del: true, t: C.nextT(doc) });
            logActivity(doc, c.entry.kind === 'difference' ? 'pay-del' : 'offset-undo', before.id,
                memberName(doc, before.from) + ' an ' + memberName(doc, before.to) + ' ' + money(before.amount, before.currency));
            touched[c.entry.gid] = true;
        });
        log.undone = Date.now();
        log.undoProblems = checks.filter(function (c) { return !c.check.ok; }).map(function (c) { return c.check.text; });
        persist();
        render();
        if (log.undoProblems.length) {
            toast('Nicht alles rückgängig: ' + log.undoProblems.join(' · '), 'OK', function () { /* nur schließen */ });
        } else {
            toast('Verrechnung rückgängig gemacht.');
        }
        await Promise.all(Object.keys(touched).map(function (gid) { return exchangeOnce(gid); }));
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

        const avatarSlot = h('span', null, groupAvatar('', ''));
        function drawAvatar() {
            avatarSlot.textContent = '';
            avatarSlot.appendChild(groupAvatar(nameInput.value, form.icon));
        }
        const nameInput = h('input', {
            id: 'groupName', type: 'text', maxlength: 60, placeholder: 'Sommer in Lissabon', autocomplete: 'off',
            oninput: drawAvatar
        });
        form.icon = '';
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
            imported.expenses.forEach(function (x) { totals[x.currency] = (totals[x.currency] || 0) + (x.refund ? -1 : 1) * x.amount; });
            importSummary.textContent = '';
            importSummary.hidden = false;
            importSummary.appendChild(h('div', { class: 'link-title' }, imported.source === 'csv' ? 'Aus Kwidt-CSV' : 'Aus Splid'));
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
                return imported.expenses.filter(function (x) { return C.importMatchesCategory(x, label); }).length;
            }
            function chip(label, on) {
                const count = countFor(label);
                return h('button', {
                    class: 'chip', type: 'button', 'aria-pressed': String(on),
                    title: count ? count + (count === 1 ? ' Ausgabe gehört dazu' : ' Ausgaben gehören dazu') : null,
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
                h('div', { class: 'field-hint', style: 'margin:0 0 8px' }, imported.source === 'csv'
                    ? 'Ausgaben behalten ihre Kategorie aus der Datei. Die Zahl zeigt, wie viele zu einer Kategorie gehören.'
                    : 'Ausgaben, die genauso heißen wie eine Kategorie, bekommen sie. Die Zahl zeigt, wie viele das sind.'),
                chips,
                h('div', { class: 'add-row' }, addInput, h('button', { class: 'btn btn-small', type: 'button', onclick: add }, 'Hinzufügen')));
        }

        async function onImport(e) {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            error.hidden = true;
            let data = null;
            const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
            try {
                if (isCsv) {
                    data = C.parseKwidtCsv(await file.text());
                    // Der Gruppenname steckt nur im Dateinamen: kwidt-Urlaub.csv → Urlaub
                    if (data) data.name = file.name.replace(/\.csv$/i, '').replace(/^kwidt-/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 60);
                } else {
                    const sheets = C.readXls(await file.arrayBuffer());
                    data = sheets && C.parseSplid(sheets, C.todayStr());
                }
            } catch (err) {
                console.warn('Kwidt: Datei nicht lesbar.', err);
            }
            if (!data || !data.members.length || !(data.expenses.length + data.payments.length)) {
                error.textContent = isCsv
                    ? 'Das sieht nicht nach einer CSV-Datei aus Kwidt aus.'
                    : 'Das sieht nicht nach einer Excel-Datei aus Splid (.xls) oder einer CSV aus Kwidt aus.';
                error.hidden = false;
                return;
            }
            data.source = isCsv ? 'csv' : 'splid';
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
            doc.meta = { t: Date.now(), name: name, currency: form.currency, simplify: true, icon: form.icon };
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
            doc.meta = { t: Date.now(), name: name, currency: form.currency, simplify: true, icon: form.icon };
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
            h('a', { class: 'back', href: '#/gruppen' }, '‹ Gruppen'),
            h('form', { class: 'panel', onsubmit: submit },
                h('h2', null, 'Neue Gruppe'),
                error,
                h('div', { class: 'field' },
                    h('label', { class: 'btn btn-small btn-block' }, 'Importieren',
                        h('input', { type: 'file', accept: '.xls,.csv,application/vnd.ms-excel,text/csv', hidden: true, onchange: onImport })),
                    h('div', { class: 'field-hint' }, 'CSV-Datei aus Kwidt oder Excel-Datei aus Splid (.xls). Sie wird nur in deinem Browser gelesen.')),
                h('div', { class: 'field' },
                    h('label', { for: 'groupName' }, 'Name der Gruppe'),
                    h('div', { class: 'name-row' }, avatarSlot, nameInput)),
                h('div', { class: 'field' },
                    h('span', { class: 'field-label' }, 'Symbol'),
                    iconPicker('', function (icon) { form.icon = icon; drawAvatar(); }),
                    h('div', { class: 'field-hint' }, 'Ohne Symbol zeigt Kwidt die Anfangsbuchstaben des Namens.')),
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
            h('a', { class: 'back', href: '#/gruppen' }, '‹ Gruppen'),
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
            h('a', { class: 'back', href: '#/gruppen' }, '‹ Gruppen'),
            h('header', { class: 'group-head' },
                groupAvatar(doc.meta.name, doc.meta.icon, true),
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
            h('a', { class: 'back', href: '#/gruppen' }, '‹ Gruppen'),
            // Kompakt: Symbol, Name und Stand in einer Zeile, darunter der Abgleich.
            h('header', { class: 'group-head' },
                h('div', { class: 'group-title' },
                    groupAvatar(doc.meta.name, doc.meta.icon),
                    h('h1', null, doc.meta.name),
                    h('div', { class: 'data-state', title: 'Gleicher Code auf zwei Geräten heißt: gleicher Datenstand.' },
                        h('span', null, 'Datenstand'), h('code', null, C.dataFingerprint(doc)))),
                h('div', { class: 'group-status' },
                    h('a', { id: 'syncPill', class: syncPillClass(), href: '#/g/' + doc.id + '/settings' }, syncLabel()))),
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
        if (p.offset) return offsetText(doc, p, me);
        if (p.from === me) return 'Du hast ' + memberName(doc, p.to) + ' gezahlt';
        if (p.to === me) return memberName(doc, p.from) + ' hat dir gezahlt';
        return memberName(doc, p.from) + ' hat ' + memberName(doc, p.to) + ' gezahlt';
    }

    /**
     * Zwei Spalten für den ganzen Betrag, damit die Liste wie eine Tabelle lesbar ist:
     * Zahlungen zwischen Personen links, Ausgaben (rot) und Rückzahlungen (grün) rechts.
     * Die jeweils andere bleibt leer, hält aber ihren Platz.
     */
    function amountColumns(kind, minor, cur) {
        const labels = { payment: 'Zahlung', offset: 'Verrechnung', expense: 'Ausgabe', refund: 'Rückzahlung' };
        const cell = h('span', null, h('span', { class: 'muted' }, labels[kind]), h('strong', null, money(minor, cur)));
        const empty = h('span');
        return [
            h('span', { class: 'col col-pay' }, kind === 'payment' || kind === 'offset' ? cell : empty),
            h('span', { class: 'col col-amount ' + (kind === 'refund' ? 'is-refund' : 'is-expense') }, kind === 'payment' || kind === 'offset' ? empty : cell)
        ];
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
            : [entry.p.note, 'zahlung', entry.p.offset ? 'verrechnung verrechnet' : ''];
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
                    amountColumns(e.refund ? 'refund' : 'expense', e.amount, e.currency),
                    expenseEffect(e, me)));
            } else {
                const p = entry.p;
                container.appendChild(h('a', { class: 'item', href: '#/g/' + doc.id + '/pay/' + p.id },
                    h('span', { class: 'body' },
                        h('div', { class: 'title' }, paymentText(doc, p, me)),
                        h('div', { class: 'sub' }, formatDate(p.date) + (p.offset ? ' · angestoßen von ' + offsetStarter(doc, p, me) : '')
                            + (p.note && p.note !== OFFSET_NOTE ? ' · ' + p.note : ''))),
                    amountColumns(p.offset ? 'offset' : 'payment', p.amount, p.currency),
                    // Nur wenn das Geld an dich geht; sonst bleibt die Spalte leer.
                    p.to === me
                        ? h('span', { class: 'side' }, h('span', { class: 'muted' }, 'du bekommst'), h('strong', { class: 'pos' }, money(p.amount, p.currency)))
                        : h('span', { class: 'side' })));
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
        // Zugeklappt zeigt die Zeile, was als Nächstes dran ist.
        const first = series[0];
        const firstDate = C.nextOccurrence(doc, first, today);
        const preview = series.length + ' Stück · ' + (firstDate
            ? 'nächste: ' + first.desc + ' am ' + formatDate(firstDate) + ' (' + daysUntil(firstDate) + ')'
            : 'keine weitere geplant');
        const body = h('div', { class: 'list' }, series.map(function (e) {
                return h('a', { class: 'item', href: '#/g/' + doc.id + '/expense/' + e.id },
                    categoryIcon(doc, e.category),
                    h('span', { class: 'body' },
                        h('div', { class: 'title' }, e.desc),
                        h('div', { class: 'sub' }, (e.refund ? 'Rückzahlung · ' : '') + repeatLabel(e) + ' · ' + nextBookingText(doc, e))),
                    h('span', { class: 'side' }, h('strong', null, money(C.expenseSign(e) * e.amount, e.currency))));
            }));
        const section = fold('Wiederkehrend', h('span', { class: 'fold-value' }, preview), body, state.seriesOpen);
        section.addEventListener('toggle', function () { state.seriesOpen = section.open; });
        return h('section', { class: 'panel panel-fold' }, section);
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
                // Zuklappen heißt: Filter weg, damit die Liste nie unbemerkt gefiltert bleibt.
                if (state.filterOpen) filterBox.querySelector('#filterSearch').focus();
                else filterBox.reset();
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

        function reset() {
            Object.assign(f, emptyFilter());
            state.search = '';
            search.value = payer.value = member.value = category.value = min.value = max.value = '';
            min.classList.remove('bad');
            max.classList.remove('bad');
            onChange();
        }

        const box = h('div', { class: 'filter-box' },
            h('div', { class: 'field' }, h('label', { for: 'filterSearch' }, 'Suchen'), search),
            h('div', { class: 'field-row' },
                h('div', { class: 'field' }, h('label', { for: 'filterPayer' }, 'Bezahlt von'), payer),
                h('div', { class: 'field' }, h('label', { for: 'filterMember' }, 'Beteiligt'), member)),
            h('div', { class: 'field-row' },
                h('div', { class: 'field' }, h('label', { for: 'filterCategory' }, 'Kategorie'), category),
                h('div', { class: 'field' },
                    h('label', { for: 'filterMin' }, 'Betrag'),
                    h('div', { class: 'range-row' }, min, h('span', { 'aria-hidden': 'true' }, '–'), max))),
            h('button', { class: 'link-btn small', type: 'button', onclick: reset }, 'Filter zurücksetzen'));
        box.reset = reset;
        return box;
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

    /**
     * Pro Monat, für eine gewählte Kategorie oder alle zusammen. Monate ohne Eintrag
     * zeigen „–“, so fällt z. B. ein Monat ohne Internet-Rechnung sofort auf.
     */
    function viewMonthPanel(doc, table, cur) {
        if (!table.rows.length) return null;
        if (state.statsCategory && table.categories.indexOf(state.statsCategory) === -1) state.statsCategory = '';
        const rows = h('div', null);

        function draw() {
            const id = state.statsCategory;
            const values = table.rows.map(function (row) {
                return id ? (id in row.cells ? row.cells[id] : null) : (row.total || null);
            });
            const max = Math.max.apply(null, values.map(function (v) { return v || 0; }));
            rows.textContent = '';
            table.rows.forEach(function (row, i) {
                const p = row.month.split('-').map(Number);
                const label = new Date(p[0], p[1] - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
                rows.appendChild(values[i] === null
                    ? h('div', { class: 'bar-row' },
                        h('span', { class: 'label' }, label),
                        h('span', { class: 'bar', 'aria-hidden': 'true' }),
                        h('span', { class: 'value muted' }, '–'))
                    : barRow(label, values[i], max, cur));
            });
        }
        draw();

        return statFold('month', 'Nach Monat', table.rows.length + (table.rows.length === 1 ? ' Monat' : ' Monate'), [
            h('div', { class: 'field' },
                h('label', { for: 'statsCategory' }, 'Kategorie'),
                h('select', {
                    id: 'statsCategory', value: state.statsCategory || '',
                    onchange: function (e) {
                        state.statsCategory = e.target.value;
                        draw();
                    }
                },
                    h('option', { value: '' }, 'Alle Kategorien'),
                    table.categories.map(function (id) { return h('option', { value: id }, categoryText(doc, id)); }))),
            rows]);
    }

    /** Personen mit Beträgen in einer Liste: aktive Mitglieder und alle, die in `maps` vorkommen. */
    function statPeople(doc, maps) {
        const ids = activeMembers(doc).map(function (m) { return m.id; });
        maps.forEach(function (map) {
            Object.keys(map || {}).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
        });
        return ids;
    }

    /** Fixkosten: alle laufenden Wiederholungen auf einen Monat umgerechnet. */
    function viewFixedCosts(doc, cur) {
        const fixed = C.fixedCosts(doc, cur);
        if (!fixed.items.length) return null;
        const me = meId(doc.id);
        return statFold('fixed', 'Fixkosten', money(fixed.total, cur) + ' im Monat', [
            h('div', { class: 'stat-total' }, money(fixed.total, cur), h('span', { class: 'stat-unit' }, ' im Monat')),
            h('div', { class: 'small muted', style: 'margin-bottom:10px' }, 'Aus ' + fixed.items.length + (fixed.items.length === 1 ? ' Wiederholung' : ' Wiederholungen')
                + ', im Schnitt pro Monat. Was seltener als monatlich anfällt, zählt anteilig.'
                + (me && fixed.owed[me] ? ' Dein Anteil: ' + money(fixed.owed[me], cur) + '.' : '')),
            fixed.items.map(function (item) {
                return h('div', { class: 'kv' },
                    h('span', null, item.series.desc,
                        h('div', { class: 'small muted' }, repeatLabel(item.series) + ' · ' + money(C.expenseSign(item.series) * item.series.amount, cur))),
                    h('span', null, money(item.monthly, cur)));
            }),
            h('div', { class: 'link-title', style: 'margin-top:12px' }, 'Pro Person und Monat'),
            statPeople(doc, [fixed.owed]).map(function (id) {
                return h('div', { class: 'kv' },
                    h('span', null, memberName(doc, id) + (id === me ? ' (du)' : '')),
                    h('span', null, money(fixed.owed[id] || 0, cur)));
            })]);
    }

    /** Datum in n Monaten, als JJJJ-MM-TT. */
    function monthsAhead(n) {
        const d = new Date();
        d.setMonth(d.getMonth() + n);
        return C.todayStr(d);
    }

    /** Was die Wiederholungen bis zu einem Datum noch buchen, und wie die Salden dann stehen. */
    function viewForecast(doc, cur) {
        if (!C.liveSeries(doc).some(function (e) { return e.currency === cur; })) return null;
        const me = meId(doc.id);
        const today = C.todayStr();
        if (!state.forecastDate || state.forecastDate <= today) state.forecastDate = monthsAhead(3);
        const result = h('div', null);
        let summaryText = '';

        function draw() {
            result.textContent = '';
            const until = state.forecastDate;
            summaryText = until && until > today ? 'bis ' + formatDate(until, true) : '';
            if (result.parentNode) {
                const value = result.closest('.panel').querySelector('.fold-value');
                if (value) value.textContent = summaryText;
            }
            if (!until || until <= today) {
                result.appendChild(h('div', { class: 'small muted' }, 'Bitte ein Datum nach heute wählen.'));
                return;
            }
            const fc = C.forecast(doc, cur, today, until);
            if (!fc.count) {
                result.appendChild(h('div', { class: 'small muted' }, 'Bis dahin ist keine Buchung fällig.'));
                return;
            }
            const balances = C.computeBalances(doc)[cur] || {};
            result.appendChild(h('div', { class: 'stat-total' }, money(fc.total, cur)));
            result.appendChild(h('div', { class: 'small muted', style: 'margin-bottom:10px' },
                fc.count + (fc.count === 1 ? ' Buchung' : ' Buchungen') + ' bis einschließlich ' + formatDate(until, true)));
            fc.items.forEach(function (item) {
                const each = C.expenseSign(item.series) * item.series.amount;
                result.appendChild(h('div', { class: 'kv' },
                    h('span', null, item.series.desc,
                        h('div', { class: 'small muted' }, item.dates.length + '× ' + money(each, cur) + ' · ' + item.dates.map(function (d) { return formatDate(d); }).join(', '))),
                    h('span', null, money(each * item.dates.length, cur))));
            });
            result.appendChild(h('div', { class: 'link-title', style: 'margin-top:12px' }, 'Verteilung und Salden'));
            result.appendChild(h('div', { class: 'table-wrap' },
                h('table', { class: 'stat' },
                    h('thead', null, h('tr', null,
                        h('th', { scope: 'col' }, 'Person'),
                        h('th', { scope: 'col' }, 'Trägt'),
                        h('th', { scope: 'col' }, 'Zahlt'),
                        h('th', { scope: 'col' }, 'Saldo dann'))),
                    h('tbody', null, statPeople(doc, [fc.owed, fc.paid]).map(function (id) {
                        const after = (balances[id] || 0) + (fc.paid[id] || 0) - (fc.owed[id] || 0);
                        return h('tr', null,
                            h('td', null, memberName(doc, id) + (id === me ? ' (du)' : '')),
                            h('td', null, money(fc.owed[id] || 0, cur)),
                            h('td', null, money(fc.paid[id] || 0, cur)),
                            h('td', { class: after > 0 ? 'pos' : after < 0 ? 'neg' : '' }, money(after, cur)));
                    })))));
            result.appendChild(h('p', { class: 'small muted', style: 'margin-top:8px' },
                '„Saldo dann“ ist der heutige Saldo plus diese Buchungen, angenommen, sonst ändert sich nichts. Positiv: bekommt Geld, negativ: schuldet. Gebucht wird erst, wenn ein Termin da ist.'));
        }
        draw();

        const panel = statFold('forecast', 'Vorausberechnung', '', [
            h('div', { class: 'field' },
                h('label', { for: 'forecastDate' }, 'Wiederholungen vorausrechnen bis'),
                h('input', {
                    id: 'forecastDate', type: 'date', value: state.forecastDate, min: C.todayStr(new Date(Date.now() + 86400000)),
                    onchange: function (e) {
                        state.forecastDate = e.target.value;
                        draw();
                    }
                })),
            result]);
        panel.valueEl.textContent = summaryText;
        return panel;
    }

    /** Einklappbare Kachel der Statistik. Beim Öffnen der Statistik sind alle zu. */
    function statFold(key, title, value, body) {
        const valueEl = h('span', { class: 'fold-value' }, value || '');
        const section = fold(title, valueEl, body, !!state.statsOpen[key]);
        section.addEventListener('toggle', function () { state.statsOpen[key] = section.open; });
        const panel = h('section', { class: 'panel panel-fold' }, section);
        panel.valueEl = valueEl;
        return panel;
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
            return h('div', null,
                h('section', { class: 'panel' }, picker, h('div', { class: 'empty' }, 'Noch nichts auszuwerten.')),
                h('h3', { class: 'stat-group' }, 'Hochrechnung'),
                viewFixedCosts(doc, cur),
                viewForecast(doc, cur));
        }

        const maxCategory = stats.byCategory[0].amount;
        return h('div', null,
            h('section', { class: 'panel' },
                picker,
                h('h2', null, 'Überblick'),
                h('div', { class: 'stat-sums' },
                    h('div', null,
                        h('div', { class: 'small muted' }, 'Gesamtausgaben'),
                        h('div', { class: 'stat-total neg' }, money(stats.spent.amount, cur)),
                        h('div', { class: 'small muted' }, stats.spent.count + (stats.spent.count === 1 ? ' Ausgabe' : ' Ausgaben'))),
                    h('div', null,
                        h('div', { class: 'small muted' }, 'Gesamteinnahmen'),
                        h('div', { class: 'stat-total pos' }, money(stats.income.amount, cur)),
                        h('div', { class: 'small muted' }, stats.income.count + (stats.income.count === 1 ? ' Einnahme' : ' Einnahmen'))),
                    h('div', null,
                        h('div', { class: 'small muted' }, 'Ergebnis'),
                        h('div', { class: 'stat-total ' + (stats.total > 0 ? 'neg' : stats.total < 0 ? 'pos' : '') }, money(-stats.total, cur)),
                        h('div', { class: 'small muted' }, 'Einnahmen minus Ausgaben')))),
            // Erst, was war, dann, was kommt.
            statFold('category', 'Nach Kategorie', stats.byCategory.length + (stats.byCategory.length === 1 ? ' Kategorie' : ' Kategorien'),
                stats.byCategory.map(function (row) {
                    return barRow(categoryText(doc, row.id), row.amount, maxCategory, cur);
                })),
            viewMonthPanel(doc, stats.byMonth, cur),
            statFold('person', 'Nach Person', stats.byMember.length + (stats.byMember.length === 1 ? ' Person' : ' Personen'),
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
                        }))))),
            C.liveSeries(doc).some(function (e) { return e.currency === cur; }) ? h('h3', { class: 'stat-group' }, 'Hochrechnung') : null,
            viewFixedCosts(doc, cur),
            viewForecast(doc, cur));
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
            case 'import': return who + ' ' + a.label + ' importiert';
            case 'category-add': return who + ' die Kategorie ' + label + ' hinzugefügt';
            case 'category-del': return who + ' die Kategorie ' + label + ' entfernt';
            case 'pay-add': return who + ' eine Zahlung eingetragen: ' + a.label;
            case 'pay-edit': return who + ' eine Zahlung geändert: ' + a.label;
            case 'pay-del': return who + ' eine Zahlung gelöscht: ' + a.label;
            case 'offset-add': return who + ' ' + a.label;
            case 'offset-edit': return who + ' eine Verrechnung geändert: ' + a.label;
            case 'offset-del': return who + ' eine Verrechnung gelöscht: ' + a.label;
            case 'offset-undo': return who + ' eine Verrechnung rückgängig gemacht: ' + a.label;
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
            h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Der Code neben „Datenstand“ oben ist ein Fingerabdruck eurer Eingaben: Ist er auf zwei Geräten gleich, seid ihr auf demselben Stand. Er ändert sich mit jeder Änderung an den Daten.'));
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
                    h('span', { class: 'field-label' }, 'Symbol'),
                    iconPicker(doc.meta.icon, function (icon) {
                        if (icon !== (doc.meta.icon || '')) saveMeta(doc, { icon: icon }, true);
                    }),
                    h('div', { class: 'field-hint' }, 'Ohne Symbol zeigt Kwidt die Anfangsbuchstaben des Namens.')),
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
    const REPEAT_UNITS = {
        weekly: ['Jede Woche', 'Wochen', 'Woche'],
        monthly: ['Jeden Monat', 'Monate', 'Monat'],
        yearly: ['Jedes Jahr', 'Jahre', 'Jahr']
    };

    /** Alte Serien „alle zwei Wochen“ sind wöchentlich mit doppeltem Intervall. */
    function repeatParts(e) {
        const every = C.seriesEvery(e);
        return e.repeat === 'biweekly' ? { repeat: 'weekly', every: every * 2 } : { repeat: e.repeat, every: every };
    }

    /** „Jeden Monat“, „Alle 3 Monate“ … */
    function repeatLabel(e) {
        const r = repeatParts(e);
        if (r.repeat === 'none' || !REPEAT_UNITS[r.repeat]) return 'Nicht wiederholen';
        return r.every === 1 ? REPEAT_UNITS[r.repeat][0] : 'Alle ' + r.every + ' ' + REPEAT_UNITS[r.repeat][1];
    }

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
            repeat: existing ? repeatParts(existing).repeat : 'none',
            everyText: existing ? String(repeatParts(existing).every) : '1',
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
            const every = readEvery();
            if (form.repeat !== 'none' && form.type !== 'items' && !every) {
                return fail('Bitte gib als Intervall eine ganze Zahl von 1 bis ' + C.MAX_EVERY + ' ein.', moreFold);
            }
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
            if (record.repeat !== 'none') record.every = every;
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

        /** Intervall aus dem Eingabefeld, oder null wenn ungültig. */
        function readEvery() {
            const n = Number(form.everyText.trim());
            return Number.isInteger(n) && n >= 1 && n <= C.MAX_EVERY ? n : null;
        }

        const everyUnit = h('span', { class: 'every-unit' });
        const everyInput = h('input', {
            id: 'expEvery', type: 'text', inputmode: 'numeric', value: form.everyText, autocomplete: 'off',
            oninput: function (e) {
                form.everyText = e.target.value;
                drawEvery();
                refresh();
            }
        });
        const everyField = h('div', { class: 'field' },
            h('label', { for: 'expEvery' }, 'Intervall'),
            h('div', { class: 'every-row' }, h('span', null, 'Alle'), everyInput, everyUnit));

        function drawEvery() {
            everyField.hidden = form.repeat === 'none';
            const unit = REPEAT_UNITS[form.repeat];
            everyUnit.textContent = unit ? (readEvery() === 1 ? unit[2] : unit[1]) : '';
            everyInput.classList.toggle('bad', !!form.everyText.trim() && !readEvery());
        }

        const repeatField = h('div', null,
            h('div', { class: 'field' },
                h('label', { for: 'expRepeat' }, 'Wiederholen'),
                h('select', {
                    id: 'expRepeat', value: form.repeat,
                    onchange: function (e) {
                        form.repeat = e.target.value;
                        drawEvery();
                        refresh();
                    }
                }, [['none', 'Nicht wiederholen'], ['weekly', 'Wöchentlich'], ['monthly', 'Monatlich'], ['yearly', 'Jährlich']]
                    .filter(function (r) { return r[0] !== 'none' || !(existing && existing.series); })
                    .map(function (r) { return h('option', { value: r[0] }, r[1]); }))),
            everyField);
        drawEvery();

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
            : e.del ? repeatLabel(e) : repeatLabel(e) + ' · ' + nextBookingText(doc, e);

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
            if (payment && payment.offset) {
                doc.payments[id].offset = payment.offset;
                doc.payments[id].offsetBy = payment.offsetBy;
            }
            logActivity(doc, payment && payment.offset ? 'offset-edit' : payment ? 'pay-edit' : 'pay-add', id, label(), amount, form.currency);
            commit(doc);
            state.formActive = false;
            go('/g/' + doc.id + '/balances');
        }

        function removePayment() {
            const before = doc.payments[payment.id];
            doc.payments[payment.id] = Object.assign({}, before, { del: true, t: C.nextT(doc) });
            logActivity(doc, before.offset ? 'offset-del' : 'pay-del', payment.id, label(), before.amount, before.currency);
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
                h('h2', null, payment && payment.offset ? 'Verrechnung bearbeiten' : payment ? 'Zahlung bearbeiten' : 'Zahlung eintragen'),
                payment && payment.offset ? h('div', { class: 'notice' }, offsetText(doc, payment, me) + ' (' + money(payment.amount, payment.currency)
                    + '). Dafür ist kein Geld geflossen: Was hier fehlt, wurde in einer anderen Gruppe ausgeglichen. Änderst oder löschst du die Zahlung, gilt das nur für diese Gruppe. '
                    + (payment.offsetBy === me ? 'Angestoßen hast du.'
                        : 'Angestoßen hat das ' + offsetStarter(doc, payment, me) + '. Bei Fragen wende dich an ' + offsetStarter(doc, payment, me)
                            + '. ' + offsetStarter(doc, payment, me) + ' sieht auf dem eigenen Gerät, mit welchen Gruppen verrechnet wurde.')) : null,
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
    // Ohne Link landet man immer auf der Startseite, nicht in der zuletzt offenen Gruppe.
    handleJoin().then(render);

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(function (e) {
            // Normal bei file://, die App läuft dann ohne Offline-Modus.
            console.info('Kwidt: Kein Service Worker.', e);
        });
    }
})();
