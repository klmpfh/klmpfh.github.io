/* Zeitfresser – Übertragen per Einmal-Link (Oberfläche in Flyovers).
 *
 * Verbindung und Verschlüsselung: assets/js/transfer.js, Abgleich: sync.js.
 * Gesendet wird über den Knopf „Einmal-Link“; die Sitzung läuft weiter, wenn der
 * Flyover geschlossen wird. Empfangen wird über den Link (#transfer=…).
 */
'use strict';

const initTransfer = (() => {
    const BACKUP_KEY = STORE_KEY + '-vorher';
    const TRANSFER = createTransfer('klmpfh-zeitfresser', 'Zeitfresser');

    const OUT_TEXT = {
        connecting: 'Verbinde …',
        offline: 'Gerade keine Verbindung, sie wird neu aufgebaut …',
        sending: 'Überträgt …',
        confirm: 'Angekommen. Auf dem anderen Gerät muss der Abgleich jetzt bestätigt werden, lass diese Seite so lange offen.',
        sent: 'Übertragen. Der Link ist verbraucht.',
        synced: 'Abgeglichen, beide Geräte haben jetzt denselben Stand. Der Link ist verbraucht.',
        declined: 'Das andere Gerät hat die Daten nicht übernommen, hier hat sich nichts geändert. Der Link ist verbraucht.',
        noReply: 'Die Daten sind angekommen, aber es kam nichts zurück. Hier hat sich nichts geändert. Der Link ist verbraucht.',
        broken: 'Die Verbindung ist während der Übertragung abgebrochen. Der Link ist verbraucht, bitte einen neuen erstellen.',
        badResult: 'Die Antwort des anderen Geräts war nicht lesbar, hier hat sich nichts geändert. Der Link ist verbraucht. Bitte auf beiden Geräten die Seite neu laden.',
        expired: 'Der Link ist abgelaufen.',
        cancelled: 'Abgebrochen, der Link gilt nicht mehr.',
        error: 'Der Vermittlungsdienst ist gerade nicht erreichbar. Bitte später noch einmal versuchen oder die Szenarien als Datei übertragen (Export/Import).',
        unsupported: 'Das geht in diesem Browser nicht. Bitte die Szenarien als Datei übertragen (Export/Import).'
    };

    const IN_TEXT = {
        connecting: 'Verbinde mit dem anderen Gerät …',
        replying: 'Schicke den gemeinsamen Stand zurück …',
        done: 'Abgeglichen, beide Geräte haben jetzt denselben Stand.',
        noAck: 'Hier ist alles übernommen, aber das andere Gerät hat den gemeinsamen Stand nicht bestätigt. Für den Rückweg kannst du hier einen neuen Einmal-Link erstellen.',
        invalid: 'Dieser Link ist ungültig. Wurde er vollständig kopiert?',
        denied: 'Der Schlüssel im Link passt nicht. Wurde er vollständig kopiert? Auf dem anderen Gerät gilt der Link weiter.',
        version: 'Die beiden Geräte haben verschiedene Versionen dieser Seite. Bitte auf beiden neu laden und einen neuen Link erstellen.',
        gone: 'Das andere Gerät ist nicht erreichbar. Entweder ist der Link schon benutzt oder abgelaufen, oder die Seite ist dort gerade nicht offen.',
        offline: 'Keine Verbindung zum Vermittlungsdienst. Bist du online?',
        unsupported: 'Das geht in diesem Browser nicht. Öffne den Link in einem aktuellen Browser, er gilt weiter.',
        unreadable: 'Die Daten vom anderen Gerät sind nicht lesbar. Bitte auf beiden Geräten die Seite neu laden und einen neuen Link erstellen.',
        taken: 'Übernommen.'
    };

    let mode = 'sync';
    let out = null;       // laufende oder letzte Sitzung beim Senden
    let note = null;      // was der letzte Abgleich auf diesem Gerät geändert hat (SYNC.diff)
    let outBox = null;    // Inhalt des Flyovers, solange er offen ist
    let inn = null;       // geöffneter Link: { r, box, close }

    /* ── Daten ── */

    function current() {
        saveStore();
        return { data: SYNC.plain(store), stamps: stamps };
    }

    /** Stand vom anderen Gerät prüfen: { data, stamps } in der heutigen Form, sonst Fehler. */
    function readTransfer(x) {
        if (!x || !x.data || !Array.isArray(x.data.scenarios) || !x.data.scenarios.length) throw new Error('Keine Szenarien');
        const data = SYNC.plain(SYNC.toStore(x.data));
        data.scenarios.forEach(sc => [sc].concat(sc.nodes).forEach(e => {
            if (!/^[\w-]{1,60}$/.test(e.id)) throw new Error('Ungültige Kennung');
        }));
        return { data: data, stamps: SYNC.cleanStamps(x.stamps) };
    }

    /** Übernimmt einen fertigen Stand und hebt den bisherigen zum Wiederherstellen auf. */
    function applyTransfer(next) {
        const before = current();
        const st = SYNC.toStore(next.data, store);
        const changes = SYNC.diff(before.data, SYNC.plain(st));
        if (changes && !SYNC.pristine(before.data)) {
            try { localStorage.setItem(BACKUP_KEY, JSON.stringify(Object.assign({ at: Date.now() }, before))); } catch (e) { /* kein Platz: dann ohne */ }
        }
        replaceStore(st, next.stamps);
        renderAll();
        return changes;
    }

    function readBackup() {
        try {
            const b = JSON.parse(localStorage.getItem(BACKUP_KEY));
            return b && b.data && Array.isArray(b.data.scenarios) ? b : null;
        } catch (e) { return null; }
    }

    async function restoreBackup(anchor) {
        const b = readBackup();
        if (!b) return;
        const ok = await confirmFlyover({
            title: 'Stand wiederherstellen?',
            message: 'Zurück zum Stand von ' + fmtTime(b.at) + '. Alles, was seitdem auf diesem Gerät übernommen oder geändert wurde, geht verloren.',
            confirmLabel: 'Wiederherstellen', danger: true, anchor: anchor
        });
        if (!ok) return;
        replaceStore(SYNC.toStore(b.data, store), SYNC.cleanStamps(b.stamps));
        try { localStorage.removeItem(BACKUP_KEY); } catch (e) { /* egal */ }
        out = note = null;
        renderAll();
        renderSend();
    }

    /* ── Bausteine ── */

    function fmtTime(ms, timeOnly) {
        const d = new Date(ms), time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
        return timeOnly ? time : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' }) + ', ' + time;
    }

    function text(box, s, cls, role) {
        const p = el('p', 'transfer-text' + (cls ? ' ' + cls : ''), s);
        if (role) p.setAttribute('role', role);
        box.appendChild(p);
        return p;
    }

    function button(label, kind, onClick) {
        const b = el('button', 'btn btn-' + kind, label);
        b.type = 'button';
        b.addEventListener('click', () => onClick(b));
        return b;
    }

    function actions(box, list) {
        const row = el('div', 'transfer-actions');
        row.append(...list.filter(Boolean));
        box.appendChild(row);
        return row;
    }

    function changeList(box, d) {
        const list = el('ul', 'transfer-changes');
        [['added', 'neu'], ['changed', 'geändert'], ['removed', 'entfernt']].forEach(w => {
            d[w[0]].forEach(name => list.appendChild(el('li', null, name + ' (' + w[1] + ')')));
        });
        box.appendChild(list);
    }

    function flash(btn, label) {
        const old = btn.textContent;
        btn.textContent = label;
        setTimeout(() => { if (btn.isConnected) btn.textContent = old; }, 1600);
    }

    /** Neu zeichnen, ohne dass der Fokus aus dem Flyover fällt. */
    function redraw(box, draw) {
        const had = box.contains(document.activeElement);
        box.textContent = '';
        draw();
        if (had) {
            const next = box.querySelector('button, select, input') || box.closest('dialog').querySelector('button');
            if (next) next.focus();
        }
    }

    /* ── Senden ── */

    function openSend(anchor) {
        if (outBox) return;
        outBox = el('div', 'transfer');
        openFlyover({
            title: 'Per Einmal-Link übertragen',
            message: 'Überträgt alle Szenarien direkt auf ein anderes Gerät, deins oder das von jemand anderem. Beide müssen gleichzeitig online sein, danach gilt der Link nicht mehr. ' +
                'Beim Abgleich zählt je Angabe die neuere Änderung, auch Gelöschtes. Die Daten gehen verschlüsselt von Gerät zu Gerät, der öffentliche Dienst PeerJS vermittelt nur die Verbindung.',
            body: outBox,
            anchor: anchor,
            wide: true,
            buttons: [{ label: 'Schließen', value: null, kind: 'ghost' }]
        }).then(() => {
            outBox = null;
            if (out && out.ended) out = note = null;
            updateButton();
        });
        renderSend();
    }

    function updateButton() {
        const active = out && !out.ended;
        document.getElementById('btnTransfer').textContent = active ? 'Einmal-Link (aktiv)' : 'Einmal-Link';
    }

    function start() {
        if (out) out.cancel();
        note = null;
        const t = TRANSFER.send({
            mode: mode,
            payload: current,
            onChange: () => {
                if (t !== out) return;
                // Geschlossener Flyover: Ergebnis trotzdem zeigen.
                if (t.ended && !outBox && ['cancelled', 'expired'].indexOf(t.status) < 0) openSend(document.getElementById('btnTransfer'));
                else renderSend();
            },
            onResult: x => {
                // Was hier in der Zwischenzeit eingegeben wurde, bleibt erhalten.
                note = applyTransfer(SYNC.merge(current(), readTransfer(x)));
            }
        });
        out = t;
        renderSend();
    }

    function renderSend() {
        updateButton();
        if (outBox) redraw(outBox, () => drawSend(outBox));
    }

    function drawSend(box) {
        const t = out, active = t && !t.ended, open = active && (t.status === 'waiting' || t.status === 'offline');
        if (t) {
            text(box, t.status === 'waiting'
                ? 'Wartet auf das andere Gerät. Gültig bis ' + fmtTime(t.until, true) + ', für genau eine Übertragung.' : OUT_TEXT[t.status], 'is-status', 'status');
        }
        if (t && t.status === 'synced') {
            if (note) changeList(box, note);
            else text(box, 'Hier war schon alles auf dem neuesten Stand.', 'is-muted');
        }
        if (open) {
            const qr = el('div', 'transfer-qr');
            const share = el('div', 'transfer-share');
            text(share, 'Link verschicken oder QR-Code scannen. Lass diese Seite offen, bis hier steht, dass es geklappt hat. ' +
                'Wer den Link zuerst öffnet, bekommt alle Szenarien' +
                (t.mode === 'sync' ? ' und kann deine ändern (der jetzige Stand bleibt wiederherstellbar).' : '.'), 'is-muted');
            const field = el('div', 'field');
            const input = el('input');
            input.type = 'text';
            input.readOnly = true;
            input.value = t.link;
            input.setAttribute('aria-label', 'Einmal-Link');
            input.addEventListener('focus', () => input.select());
            field.appendChild(input);
            share.appendChild(field);
            actions(share, [
                button('Link kopieren', 'primary', b => {
                    const copied = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t.link) : Promise.reject();
                    copied.then(() => flash(b, 'Kopiert ✓'), () => {
                        input.select();
                        flash(b, document.execCommand('copy') ? 'Kopiert ✓' : 'Nicht möglich');
                    });
                }),
                navigator.share && button('Teilen …', 'ghost', () => {
                    navigator.share({ title: 'Zeitfresser', url: t.link }).catch(() => { /* abgebrochen */ });
                }),
                button('Abbrechen', 'ghost', () => t.cancel())
            ]);
            const row = el('div', 'transfer-link');
            row.append(qr, share);
            box.appendChild(row);
            TRANSFER.loadQr().then(() => {
                if (qr.isConnected) new QRCode(qr, { text: t.link, width: 176, height: 176, colorDark: '#14121a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });
            }).catch(() => qr.remove());
        } else if (active) {
            actions(box, [button('Abbrechen', 'ghost', () => t.cancel())]);
        } else {
            const row = el('div', 'transfer-start');
            const field = el('div', 'field');
            const label = el('label', null, 'Richtung');
            const select = el('select');
            select.id = 'transferMode';
            label.htmlFor = select.id;
            [['sync', 'In beide Richtungen abgleichen'], ['send', 'Nur von hier senden']].forEach(o => {
                const opt = el('option', null, o[1]);
                opt.value = o[0];
                select.appendChild(opt);
            });
            select.value = mode;
            select.addEventListener('change', () => { mode = select.value; });
            field.append(label, select);
            row.append(field, button(t ? 'Neuen Einmal-Link erstellen' : 'Einmal-Link erstellen', 'primary', start));
            box.appendChild(row);
        }
        const backup = active ? null : readBackup();
        if (backup) {
            actions(box, [button('Stand vor der letzten Übertragung wiederherstellen (' + fmtTime(backup.at) + ')', 'ghost', restoreBackup)]);
        }
    }

    /* ── Empfangen ── */

    function linkValue() {
        const m = location.hash.match(/^#transfer=(.*)$/);
        return m ? m[1] : null;
    }

    function checkLink() {
        const value = linkValue();
        if (value === null || (inn && inn.r.value === value)) return;
        if (inn) inn.close();
        const r = TRANSFER.receive(value, () => {
            if (!inn || inn.r !== r) return;
            if (r.status === 'received' && !r.remote) {
                try { r.remote = readTransfer(r.data); } catch (e) {
                    console.warn('Zeitfresser: Daten nicht lesbar.', e);
                    r.close();
                    r.status = 'unreadable';
                }
            }
            renderIn();
        });
        const box = el('div', 'transfer');
        const mine = inn = { r: r, box: box, close: () => {} };
        openFlyover({
            title: 'Daten empfangen',
            body: box,
            buttons: [],
            sticky: true,
            onOpen: close => {
                mine.close = close;
                renderIn();
            }
        }).then(() => {
            if (r.close) r.close();
            if (inn === mine) inn = null;
            // Der Link soll nicht in der Adresse stehen bleiben.
            if (linkValue() === value) history.replaceState(null, '', location.pathname + location.search);
        });
    }

    function renderIn() {
        if (inn) redraw(inn.box, () => drawIn(inn.box, inn.r, () => inn.close()));
    }

    function drawIn(box, r, leave) {
        const again = r.status === 'gone' || r.status === 'offline';
        if (r.status === 'ready') {
            text(box, 'Jemand möchte dir die Szenarien aus „Zeitfresser“ schicken. Der Link gilt nur einmal, und auf dem anderen Gerät muss die Seite gerade offen sein.');
            text(box, 'Alles landet in diesem Browser. Hat sich der Link innerhalb einer anderen App geöffnet (z. B. WhatsApp oder Telegram), öffne ihn erst im normalen Browser.', 'is-muted');
            actions(box, [button('Verbinden', 'primary', r.start), button('Abbrechen', 'ghost', leave)]);
        } else if (r.status === 'received') {
            drawReceived(box, r, leave);
        } else {
            text(box, IN_TEXT[r.status], 'is-status', 'status');
            if (r.changes) changeList(box, r.changes);
            if (r.status === 'connecting') actions(box, [button('Abbrechen', 'ghost', leave)]);
            else if (r.status !== 'replying') actions(box, [
                again && button('Erneut versuchen', 'primary', r.start),
                button('Schließen', again ? 'ghost' : 'primary', leave)
            ]);
        }
    }

    function drawReceived(box, r, leave) {
        const mine = current(), fresh = SYNC.pristine(mine.data), sync = r.mode === 'sync';
        const merged = SYNC.merge(r.remote, mine);
        const changes = SYNC.diff(mine.data, merged.data);
        const names = r.remote.data.scenarios.map(s => s.name.trim() || 'Ohne Namen');

        function take(next) {
            const done = applyTransfer(next);
            r.changes = fresh ? null : done;
            if (sync) r.reply(next);
            else { r.close(); r.status = 'taken'; renderIn(); }
        }

        text(box, 'Vom anderen Gerät: ' + (names.length === 1 ? '1 Szenario' : names.length + ' Szenarien') + ' (' + names.join(', ') + ').');
        if (!fresh) {
            if (changes) {
                text(box, 'Das ändert sich hier:', 'is-muted');
                changeList(box, changes);
                text(box, 'Je Angabe zählt die neuere Änderung. Den jetzigen Stand kannst du danach unter „Einmal-Link“ wiederherstellen.', 'is-muted');
            } else text(box, 'Hier ändert sich nichts.' + (sync && r.online ? ' Das andere Gerät bekommt, was dort noch fehlt.' : ''), 'is-muted');
        }
        if (sync && !r.online) text(box, 'Die Verbindung ist inzwischen weg. Du kannst die Daten hier noch übernehmen, aber es geht nichts zurück.', 'is-warn');
        actions(box, [
            button(fresh ? 'Übernehmen' : sync && r.online ? 'Abgleichen' : 'Zusammenführen', 'primary', () => take(merged)),
            !fresh && !sync && button('Alles hier ersetzen', 'ghost', b => {
                confirmFlyover({
                    title: 'Alles ersetzen?', message: 'Alle Szenarien auf diesem Gerät werden durch die empfangenen ersetzt.',
                    confirmLabel: 'Ersetzen', danger: true, anchor: b
                }).then(ok => { if (ok) take(r.remote); });
            }),
            button('Verwerfen', 'ghost', leave)
        ]);
    }

    return function init() {
        document.getElementById('btnTransfer').addEventListener('click', e => openSend(e.currentTarget));
        window.addEventListener('hashchange', checkLink);
        checkLink();
    };
})();
