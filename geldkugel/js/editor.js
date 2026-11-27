/* Geldkugel – Eingabe: Kategorien (global) mit den Zahlungen des gewählten Szenarios.
 *
 * Zwei Abschnitte: Einnahmen und Ausgaben. Kategorien sind hier nur
 * Überschriften für die Zahlungen des gewählten Szenarios; angelegt, geändert
 * und gelöscht werden sie im Dialog „Kategorien“ (categories.js), weil sie für
 * alle Szenarien gelten.
 * Tippen ändert nur Zahlen und Diagramme (onChange('soft')), der Fokus bleibt
 * im Feld. Hinzufügen, Löschen und Verschieben baut die Liste neu auf ('hard').
 *
 * Zahlungen verschieben (auch in eine andere Kategorie, auch zwischen Einnahmen
 * und Ausgaben): am Griff ⠿ ziehen – mit Pointer-Events statt HTML-Drag & Drop,
 * damit es mit Maus und Finger gleich geht – oder Griff fokussieren und ↑/↓.
 * Am Anfang bzw. Ende einer Kategorie springt ↑/↓ in die Kategorie davor/danach.
 *
 * ⇉ an einer Zahlung übernimmt Betrag und Intervall in die anderen Szenarien
 * (Zuordnung über Kategorie und Name wie im Vergleich, siehe spreadPlan in state.js).
 */
'use strict';

let editorChange = null;

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function iconBtn(cls, label, text) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
}

function paymentRow(p) {
    const row = el('div', 'pay-row');
    row.dataset.pay = p.id;

    const handle = iconBtn('pay-handle', 'Verschieben: ziehen, oder ↑/↓ drücken', '⠿');

    const name = el('input', 'pay-name');
    name.type = 'text';
    name.value = p.name;
    name.placeholder = 'Bezeichnung';
    name.autocomplete = 'off';
    name.setAttribute('aria-label', 'Bezeichnung');

    const amountWrap = el('div', 'pay-amount-wrap');
    const amount = el('input', 'pay-amount');
    amount.type = 'text';
    amount.inputMode = 'decimal';
    amount.autocomplete = 'off';
    amount.value = fmtInput(p.amount);
    amount.placeholder = '0';
    amount.setAttribute('aria-label', 'Betrag in Euro');
    amountWrap.append(amount, el('span', 'pay-euro', '€'));

    const interval = el('select', 'pay-interval');
    interval.setAttribute('aria-label', 'Wie oft');
    INTERVALS.forEach(i => {
        const o = document.createElement('option');
        o.value = i.key;
        o.textContent = i.label;
        interval.appendChild(o);
    });
    interval.value = p.interval;

    const result = el('span', 'pay-monthly');
    // Titel und Zustand setzt updateEditorNumbers, weil sie von den anderen Szenarien abhängen.
    const all = iconBtn('icon-btn pay-all', 'In alle Szenarien übernehmen', '⇉');
    const del = iconBtn('icon-btn icon-del pay-del', 'Zahlung löschen', '✕');

    row.append(handle, name, amountWrap, interval, result, all, del);
    return row;
}

function categoryBlock(cat, sc, catColors) {
    const block = el('div', 'cat');
    block.dataset.cat = cat.id;
    block.style.setProperty('--cat-color', catColors.get(cat.id));

    const head = el('div', 'cat-head');
    const title = el('h4', 'cat-title');
    title.append(el('span', 'cat-dot'), el('span', 'cat-name', categoryName(cat)));
    const sum = el('span', 'cat-sum');
    const edit = iconBtn('icon-btn cat-edit', 'Kategorie „' + categoryName(cat) + '“ bearbeiten (gilt für alle Szenarien)', '✎');
    edit.dataset.openCategories = cat.id;
    head.append(title, sum, edit);

    const list = el('div', 'pay-list');
    paymentsOf(sc, cat.id).forEach(p => list.appendChild(paymentRow(p)));

    const add = el('button', 'btn-add-sub', '+ Zahlung');
    add.type = 'button';

    block.append(head, list, add);
    return block;
}

const KIND_TEXT = {
    income: { title: 'Einnahmen', empty: 'Noch keine Einnahmen-Kategorie (z. B. „Einkommen“).' },
    expense: { title: 'Ausgaben', empty: 'Noch keine Ausgaben-Kategorie (z. B. „Wohnen“).' }
};

function renderEditor() {
    const root = document.getElementById('editor');
    const sc = activeScenario();
    const catColors = categoryColors();
    root.textContent = '';
    ['income', 'expense'].forEach(kind => {
        const section = el('section', 'kind-section kind-' + kind);
        section.dataset.kind = kind;
        const head = el('h3', 'kind-head');
        head.append(el('span', 'kind-title', KIND_TEXT[kind].title), el('span', 'kind-sum'));
        section.appendChild(head);
        const cats = categoriesOf(kind);
        if (!cats.length) {
            const p = el('p', 'editor-empty', KIND_TEXT[kind].empty + ' ');
            const open = el('button', 'link-btn', 'Unter „Kategorien“ anlegen');
            open.type = 'button';
            open.dataset.openCategories = '';
            p.appendChild(open);
            section.appendChild(p);
        }
        cats.forEach(cat => section.appendChild(categoryBlock(cat, sc, catColors)));
        root.appendChild(section);
    });
    updateEditorNumbers();
}

/** Nur Summen und Monatswerte neu schreiben, ohne die Felder anzufassen. */
function updateEditorNumbers() {
    const sc = activeScenario();
    document.querySelectorAll('#editor .kind-section').forEach(section => {
        section.querySelector('.kind-sum').textContent = fmtEuro(kindTotal(sc, section.dataset.kind)) + ' / Monat';
    });
    document.querySelectorAll('#editor .cat').forEach(block => {
        const id = block.dataset.cat;
        const n = paymentsOf(sc, id).length;
        const sum = categoryTotal(sc, id);
        block.querySelector('.cat-sum').textContent = n ? fmtEuro(sum) + ' / Monat' : 'noch keine Zahlung';
        block.classList.toggle('is-unused', !n);
    });
    document.querySelectorAll('#editor .pay-row').forEach(row => {
        const p = sc.payments.find(x => x.id === row.dataset.pay);
        if (!p) return;
        const out = row.querySelector('.pay-monthly');
        out.textContent = '= ' + fmtEuro(monthly(p)) + ' / Monat';
        out.title = p.interval === 'month' ? '' : fmtPaymentOriginal(p) + ', ' + intervalExplain(p.interval);
        updateSpreadButton(row.querySelector('.pay-all'), p, sc);
    });
}

/** Knopf ⇉: nur bei mehreren Szenarien, blass, wenn es nichts zu übernehmen gibt. */
function updateSpreadButton(btn, p, sc) {
    btn.hidden = store.scenarios.length < 2;
    if (btn.hidden) return;
    let label, done = false;
    if (!p.name.trim()) {
        label = 'In alle Szenarien übernehmen (braucht eine Bezeichnung)';
        done = true;
    } else {
        const open = spreadPlan(p, sc).filter(s => s.kind !== 'same').length;
        done = !open;
        label = done ? 'Gilt schon in allen Szenarien so'
            : 'Betrag und Intervall in alle Szenarien übernehmen – ' +
              (open === 1 ? '1 Szenario weicht ab' : open + ' Szenarien weichen ab');
    }
    btn.classList.toggle('is-done', done);
    btn.title = label;
    btn.setAttribute('aria-label', label);
}

/** Rückfrage zu ⇉: welche Szenarien was bekommen, alle anderen vorausgewählt. */
async function spreadDialog(id, anchor) {
    const sc = activeScenario();
    const p = findPayment(id);
    if (!p) return;
    if (!p.name.trim()) {
        alertFlyover({
            title: 'Erst eine Bezeichnung eingeben',
            message: 'Über die Bezeichnung wird die Zahlung in den anderen Szenarien wiedergefunden.',
            anchor: anchor
        });
        return;
    }
    const what = '„' + paymentName(p) + '“ mit ' + fmtPaymentOriginal(p);
    const plan = spreadPlan(p, sc);
    if (plan.every(s => s.kind === 'same')) {
        alertFlyover({ title: 'Schon überall gleich', message: what + ' steht in allen Szenarien schon so.', anchor: anchor });
        return;
    }

    const body = el('div', 'spread');
    plan.forEach(step => {
        const row = el('label', 'spread-row' + (step.kind === 'same' ? ' is-same' : ''));
        const box = el('input');
        box.type = 'checkbox';
        box.value = step.sc.id;
        box.checked = step.kind !== 'same';
        box.disabled = step.kind === 'same';
        const note = step.kind === 'same' ? 'schon gleich'
            : step.kind === 'new' ? 'fehlt dort – wird angelegt'
            : fmtPaymentOriginal(step.target) + ' → ' + fmtPaymentOriginal(p);
        row.append(box, el('span', 'spread-name', scenarioName(step.sc)), el('span', 'spread-note', note));
        body.appendChild(row);
    });

    const ok = await openFlyover({
        title: 'In alle Szenarien übernehmen?',
        message: what + ' gilt danach in allen ausgewählten Szenarien.',
        body: body,
        anchor: anchor,
        buttons: [
            { label: 'Abbrechen', value: false, kind: 'ghost' },
            { label: 'Übernehmen', value: true, kind: 'primary', autofocus: true }
        ]
    });
    if (!ok) return;
    const chosen = new Set(Array.from(body.querySelectorAll('input:checked')).map(b => b.value));
    // Neu berechnen: Der Stand kann sich währenddessen geändert haben (anderer Tab).
    const fresh = findPayment(id);
    if (!fresh || activeScenario() !== sc) return;
    const steps = spreadPlan(fresh, sc).filter(s => s.kind !== 'same' && chosen.has(s.sc.id));
    if (!steps.length) return;
    spreadPayment(fresh, steps);
    editorChange('soft');
    revealItem(id, true);
}

function findPayment(id) {
    return activeScenario().payments.find(p => p.id === id) || null;
}

function focusIn(selector) {
    const e = document.querySelector(selector);
    if (e) { e.focus(); if (e.select) e.select(); }
}

/** Zum Eintrag springen (Klick ins Diagramm) und kurz aufleuchten lassen. */
function revealItem(id, noScroll) {
    const target = document.querySelector('#editor [data-pay="' + id + '"], #editor [data-cat="' + id + '"] > .cat-head');
    if (!target) return;
    if (!noScroll) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
}

/* ── Ereignisse ── */

function initEditor(onChange) {
    editorChange = onChange;
    const root = document.getElementById('editor');
    initPaymentDrag(root);

    root.addEventListener('input', e => {
        const t = e.target;
        const row = t.closest('.pay-row');
        if (!row) return;
        const p = findPayment(row.dataset.pay);
        if (!p) return;
        if (t.classList.contains('pay-name')) {
            p.name = t.value;
        } else if (t.classList.contains('pay-amount')) {
            const v = parseAmount(t.value);
            t.classList.toggle('invalid', v == null);
            if (v == null) return;
            p.amount = v;
        } else if (t.classList.contains('pay-interval')) {
            p.interval = t.value;
        } else {
            return;
        }
        onChange('soft');
    });

    // Betrag nach dem Verlassen des Felds sauber anzeigen (ungültige Eingaben verwerfen).
    root.addEventListener('focusout', e => {
        const t = e.target;
        if (!t.classList.contains('pay-amount')) return;
        const p = findPayment(t.closest('.pay-row').dataset.pay);
        if (!p) return;
        t.value = fmtInput(p.amount);
        t.classList.remove('invalid');
    });

    // Enter im Zahlungsfeld: nächste Zahlung in derselben Kategorie anlegen.
    root.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.isComposing) return;
        const row = e.target.closest('.pay-row');
        if (!row || e.target.tagName !== 'INPUT') return;   // Knöpfe und Auswahl behalten ihr Enter
        e.preventDefault();
        addPayment(row.closest('.cat').dataset.cat, row.dataset.pay);
    });

    root.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const block = btn.closest('.cat');
        const cat = block && categoryById(block.dataset.cat);
        if (!cat) return;
        const sc = activeScenario();

        if (btn.classList.contains('btn-add-sub')) {
            addPayment(cat.id, null);
        } else if (btn.classList.contains('pay-all')) {
            spreadDialog(btn.closest('.pay-row').dataset.pay, btn);
        } else if (btn.classList.contains('pay-del')) {
            const id = btn.closest('.pay-row').dataset.pay;
            sc.payments = sc.payments.filter(p => p.id !== id);
            onChange('hard');
            focusIn('#editor [data-cat="' + cat.id + '"] .btn-add-sub');
        }
    });

}

/* ── Zahlungen verschieben ── */

/** Kategorien in der Reihenfolge der Eingabe: erst Einnahmen, dann Ausgaben. */
function editorCategoryOrder() {
    return categoriesOf('income').concat(categoriesOf('expense'));
}

/** Zahlung in eine Kategorie verschieben, vor beforeId (null = ans Ende der Kategorie). */
function movePayment(id, categoryId, beforeId) {
    const sc = activeScenario();
    const i = sc.payments.findIndex(p => p.id === id);
    if (i < 0 || id === beforeId) return false;
    const p = sc.payments[i];
    const before = JSON.stringify(sc.payments.map(x => x.id + x.categoryId));
    sc.payments.splice(i, 1);
    p.categoryId = categoryId;
    let at = beforeId ? sc.payments.findIndex(x => x.id === beforeId) : -1;
    if (at < 0) {
        // hinter die letzte Zahlung dieser Kategorie
        let last = -1;
        sc.payments.forEach((x, k) => { if (x.categoryId === categoryId) last = k; });
        at = last + 1 || sc.payments.length;
    }
    sc.payments.splice(at, 0, p);
    return JSON.stringify(sc.payments.map(x => x.id + x.categoryId)) !== before;
}

/** ↑/↓ per Tastatur: innerhalb der Kategorie, am Rand in die Nachbarkategorie. */
function stepPayment(id, dir) {
    const sc = activeScenario();
    const p = sc.payments.find(x => x.id === id);
    if (!p) return false;
    const list = paymentsOf(sc, p.categoryId);
    const k = list.indexOf(p);
    if (dir < 0 && k > 0) return movePayment(id, p.categoryId, list[k - 1].id);
    if (dir > 0 && k < list.length - 1) return movePayment(id, p.categoryId, list[k + 2] ? list[k + 2].id : null);
    const cats = editorCategoryOrder();
    const next = cats[cats.findIndex(c => c.id === p.categoryId) + dir];
    if (!next) return false;
    const target = paymentsOf(sc, next.id);
    // nach oben: ans Ende der vorigen Kategorie, nach unten: an den Anfang der nächsten
    return movePayment(id, next.id, dir < 0 ? null : (target[0] ? target[0].id : null));
}

function initPaymentDrag(root) {
    let drag = null;   // { id, row, ghost, dx, dy, target: { cat, before }, line, raf, y }

    function clearTarget() {
        root.querySelectorAll('.cat.is-drop-target').forEach(c => c.classList.remove('is-drop-target'));
        if (drag && drag.line) drag.line.hidden = true;
    }

    /** Ziel unter dem Zeiger: Kategorie und Zahlung, vor der eingefügt wird. */
    function findTarget(y) {
        const blocks = Array.from(root.querySelectorAll('.cat'));
        if (!blocks.length) return null;
        let block = blocks.find(b => { const r = b.getBoundingClientRect(); return y >= r.top && y <= r.bottom; });
        if (!block) {
            // zwischen zwei Kategorien oder außerhalb: die nächstgelegene
            block = blocks.reduce((best, b) => {
                const r = b.getBoundingClientRect();
                const d = y < r.top ? r.top - y : y - r.bottom;
                return !best || d < best.d ? { b: b, d: d } : best;
            }, null).b;
        }
        const rows = Array.from(block.querySelectorAll('.pay-row')).filter(r => r !== drag.row);
        const before = rows.find(r => { const rc = r.getBoundingClientRect(); return y < rc.top + rc.height / 2; });
        return { block: block, rows: rows, before: before || null };
    }

    function showTarget(t) {
        clearTarget();
        if (!t) return;
        t.block.classList.add('is-drop-target');
        const listRect = t.block.querySelector('.pay-list').getBoundingClientRect();
        const headRect = t.block.querySelector('.cat-head').getBoundingClientRect();
        let y;
        if (t.before) y = t.before.getBoundingClientRect().top - 4;
        else if (t.rows.length) y = t.rows[t.rows.length - 1].getBoundingClientRect().bottom + 2;
        else y = headRect.bottom + 3;
        const left = t.rows.length || t.before ? listRect.left : headRect.left + 30;
        drag.line.hidden = false;
        drag.line.style.top = (y + window.scrollY) + 'px';
        drag.line.style.left = (left + window.scrollX) + 'px';
        drag.line.style.width = Math.max(60, (t.rows.length || t.before ? listRect.width : headRect.width - 30)) + 'px';
    }

    function move(e) {
        if (!drag) return;
        drag.y = e.clientY;
        drag.ghost.style.transform = 'translate(' + (e.clientX - drag.dx) + 'px,' + (e.clientY - drag.dy) + 'px)';
        drag.target = findTarget(e.clientY);
        showTarget(drag.target);
    }

    // Am oberen/unteren Rand mitscrollen
    function autoScroll() {
        if (!drag) return;
        const edge = 70, h = window.innerHeight;
        const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--theme-nav-height')) || 0;
        let dy = 0;
        if (drag.y < top + edge) dy = -Math.ceil((top + edge - drag.y) / 6);
        else if (drag.y > h - edge) dy = Math.ceil((drag.y - (h - edge)) / 6);
        if (dy) {
            window.scrollBy(0, dy);
            drag.target = findTarget(drag.y);
            showTarget(drag.target);
        }
        drag.raf = requestAnimationFrame(autoScroll);
    }

    function end(drop) {
        if (!drag) return;
        const d = drag;
        drag = null;
        cancelAnimationFrame(d.raf);
        d.ghost.remove();
        d.line.remove();
        d.row.classList.remove('is-dragging');
        document.body.classList.remove('is-dragging-payment');
        root.querySelectorAll('.cat.is-drop-target').forEach(c => c.classList.remove('is-drop-target'));
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey, true);
        if (!drop || !d.target) return;
        const moved = movePayment(d.id, d.target.block.dataset.cat, d.target.before ? d.target.before.dataset.pay : null);
        if (!moved) return;
        editorChange('hard');
        revealItem(d.id, true);
    }

    function onUp() { end(true); }
    function onCancel() { end(false); }
    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); }
    }

    root.addEventListener('pointerdown', e => {
        const handle = e.target.closest('.pay-handle');
        if (!handle || e.button !== 0 || drag) return;
        e.preventDefault();
        const row = handle.closest('.pay-row');
        const r = row.getBoundingClientRect();
        const ghost = row.cloneNode(true);
        ghost.classList.add('pay-ghost');
        ghost.removeAttribute('data-pay');
        ghost.querySelectorAll('input, select').forEach((x, i) => {
            const src = row.querySelectorAll('input, select')[i];
            x.value = src.value;
            x.tabIndex = -1;
        });
        ghost.style.width = r.width + 'px';
        ghost.style.setProperty('--cat-color', getComputedStyle(row).getPropertyValue('--cat-color'));
        document.body.appendChild(ghost);
        const line = el('div', 'drop-line');
        line.hidden = true;
        document.body.appendChild(line);
        drag = { id: row.dataset.pay, row: row, ghost: ghost, line: line, dx: e.clientX - r.left, dy: e.clientY - r.top, target: null, y: e.clientY };
        row.classList.add('is-dragging');
        document.body.classList.add('is-dragging-payment');
        move(e);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('keydown', onKey, true);
        drag.raf = requestAnimationFrame(autoScroll);
    });

    root.addEventListener('keydown', e => {
        const handle = e.target.closest('.pay-handle');
        if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const id = handle.closest('.pay-row').dataset.pay;
        if (!stepPayment(id, e.key === 'ArrowUp' ? -1 : 1)) return;
        editorChange('hard');
        const h = root.querySelector('[data-pay="' + id + '"] .pay-handle');
        if (h) { h.focus(); revealItem(id, true); }
    });
}

/** Neue Zahlung in einer Kategorie, optional direkt hinter einer bestehenden. */
function addPayment(categoryId, afterId) {
    const sc = activeScenario();
    const p = createPayment(categoryId, '', 0, 'month');
    const at = afterId ? sc.payments.findIndex(x => x.id === afterId) : -1;
    if (at >= 0) sc.payments.splice(at + 1, 0, p);
    else sc.payments.push(p);
    editorChange('hard');
    focusIn('#editor [data-pay="' + p.id + '"] .pay-name');
}
