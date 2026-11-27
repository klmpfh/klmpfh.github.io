/* Geldkugel – Flyover (gleich wie im Zeitfresser) für Rückfragen und Hinweise (statt confirm/alert).
 *
 * Baut auf <dialog> mit showModal() auf: Fokus bleibt im Flyover, Esc
 * schließt, der Rest der Seite ist solange gesperrt. Mit "anchor" erscheint
 * der Flyover direkt am auslösenden Knopf (mit Pfeil), sonst mittig. Auf
 * schmalen Bildschirmen immer mittig.
 */
'use strict';

const FLYOVER_ANCHOR_MQ = '(min-width: 560px)';

/**
 * Öffnet einen Flyover und liefert ein Promise mit dem Wert des gedrückten
 * Knopfs (bzw. null bei Esc / Klick daneben).
 * opts: { title, message, body (Element), anchor, wide,
 *         sticky (kein Schließen per Esc oder Klick daneben), onOpen(close),
 *         buttons: [{ label, value, kind: 'primary'|'danger-solid'|'ghost', autofocus, onClick(btn, close) }] }
 */
function openFlyover(opts) {
    return new Promise(resolve => {
        const dlg = document.createElement('dialog');
        dlg.className = 'flyover' + (opts.wide ? ' flyover-wide' : '');
        if (opts.sticky) dlg.setAttribute('closedby', 'none');

        const box = document.createElement('div');
        box.className = 'flyover-box';
        if (opts.title) {
            const h = document.createElement('h3');
            h.className = 'flyover-title';
            h.textContent = opts.title;
            box.appendChild(h);
            dlg.setAttribute('aria-label', opts.title);
        }
        if (opts.message) {
            const p = document.createElement('p');
            p.className = 'flyover-message';
            p.textContent = opts.message;
            box.appendChild(p);
        }
        if (opts.body) box.appendChild(opts.body);

        const actions = document.createElement('div');
        actions.className = 'flyover-actions';
        let focusBtn = null;
        (opts.buttons || [{ label: 'OK', value: true, kind: 'primary', autofocus: true }]).forEach(b => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-' + (b.kind || 'ghost');
            btn.textContent = b.label;
            btn.addEventListener('click', () => {
                // onClick: eigener Ablauf ohne automatisches Schließen (close wird mitgegeben)
                if (b.onClick) { b.onClick(btn, close); return; }
                close(b.value);
            });
            actions.appendChild(btn);
            if (b.autofocus) focusBtn = btn;
        });
        if (actions.children.length) box.appendChild(actions);
        dlg.appendChild(box);
        document.body.appendChild(dlg);

        let done = false;
        function close(value) {
            if (done) return;
            done = true;
            dlg.close();
            dlg.remove();
            if (opts.anchor && opts.anchor.isConnected) opts.anchor.focus();
            resolve(value === undefined ? null : value);
        }

        dlg.addEventListener('cancel', e => { e.preventDefault(); if (!opts.sticky) close(null); });
        // Ohne closedby schließen manche Browser beim zweiten Esc trotzdem.
        dlg.addEventListener('close', () => close(null));
        // Klick auf den abgedunkelten Hintergrund (= das <dialog> selbst, nicht sein Inhalt)
        dlg.addEventListener('click', e => { if (e.target === dlg && !opts.sticky) close(null); });

        dlg.showModal();
        // Breite Flyover (z. B. Bildvorschau) immer mittig
        if (!opts.wide) placeFlyover(dlg, opts.anchor);
        if (opts.onOpen) opts.onOpen(close);
        const first = focusBtn || actions.lastChild || box.querySelector('button');
        if (first) first.focus();
    });
}

function placeFlyover(dlg, anchor) {
    if (!anchor || !window.matchMedia(FLYOVER_ANCHOR_MQ).matches) return;
    const r = anchor.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const w = dlg.offsetWidth, h = dlg.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const gap = 10;
    let top = r.bottom + gap;
    let below = true;
    if (top + h > vh - 8 && r.top - gap - h >= 8) { top = r.top - gap - h; below = false; }
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
    dlg.classList.add('is-anchored', below ? 'arrow-up' : 'arrow-down');
    dlg.style.left = left + 'px';
    dlg.style.top = Math.max(8, top) + 'px';
    dlg.style.setProperty('--arrow-x', Math.max(16, Math.min(w - 16, r.left + r.width / 2 - left)) + 'px');
}

/** Ja/Nein-Rückfrage. Liefert true bei Bestätigung. */
function confirmFlyover(opts) {
    return openFlyover({
        title: opts.title,
        message: opts.message,
        anchor: opts.anchor,
        buttons: [
            // Bei Löschen o. Ä. liegt der Fokus auf "Abbrechen", damit Enter nichts zerstört.
            { label: opts.cancelLabel || 'Abbrechen', value: false, kind: 'ghost', autofocus: !!opts.danger },
            { label: opts.confirmLabel || 'OK', value: true, kind: opts.danger ? 'danger-solid' : 'primary', autofocus: !opts.danger }
        ]
    }).then(v => v === true);
}

/** Hinweis mit einem OK-Knopf. */
function alertFlyover(opts) {
    return openFlyover({
        title: opts.title,
        message: opts.message,
        anchor: opts.anchor,
        buttons: [{ label: 'OK', value: true, kind: 'primary', autofocus: true }]
    });
}
