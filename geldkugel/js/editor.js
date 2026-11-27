/* Geldkugel – Eingabe: Kategorien (global) mit den Zahlungen des gewählten Szenarios.
 *
 * Zwei Abschnitte: Einnahmen und Ausgaben. Name, Art (Einnahmen/Ausgaben),
 * Farbe, Reihenfolge und Löschen einer Kategorie wirken in allen Szenarien;
 * Zahlungen gehören nur zum gewählten Szenario.
 * Tippen ändert nur Zahlen und Diagramme (onChange('soft')), der Fokus bleibt
 * im Feld. Hinzufügen, Löschen und Verschieben baut die Liste neu auf ('hard').
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
    const del = iconBtn('icon-btn icon-del pay-del', 'Zahlung löschen', '✕');

    row.append(name, amountWrap, interval, result, del);
    return row;
}

function categoryBlock(cat, sc, catColors, index, count) {
    const block = el('div', 'cat');
    block.dataset.cat = cat.id;
    block.style.setProperty('--cat-color', catColors.get(cat.id));

    const head = el('div', 'cat-head');
    const swatch = iconBtn('cat-swatch', 'Farbe wählen', '');
    const name = el('input', 'cat-name');
    name.type = 'text';
    name.value = cat.name;
    name.placeholder = 'Kategorie';
    name.autocomplete = 'off';
    name.setAttribute('aria-label', 'Name der Kategorie (gilt in allen Szenarien)');
    const sum = el('span', 'cat-sum');
    const kind = el('select', 'cat-kind');
    kind.setAttribute('aria-label', 'Art der Kategorie (gilt in allen Szenarien)');
    kind.title = 'Art der Kategorie – gilt in allen Szenarien';
    [['expense', 'Ausgaben'], ['income', 'Einnahmen']].forEach(k => {
        const o = document.createElement('option');
        o.value = k[0];
        o.textContent = k[1];
        kind.appendChild(o);
    });
    kind.value = cat.kind;
    const actions = el('div', 'cat-actions');
    const up = iconBtn('icon-btn cat-up', 'Nach oben', '↑');
    const down = iconBtn('icon-btn cat-down', 'Nach unten', '↓');
    up.disabled = index === 0;
    down.disabled = index === count - 1;
    const del = iconBtn('icon-btn icon-del cat-del', 'Kategorie löschen (in allen Szenarien)', '✕');
    actions.append(up, down, del);
    head.append(swatch, name, sum, kind, actions);

    const list = el('div', 'pay-list');
    paymentsOf(sc, cat.id).forEach(p => list.appendChild(paymentRow(p)));

    const add = el('button', 'btn-add-sub', '+ Zahlung');
    add.type = 'button';

    block.append(head, list, add);
    return block;
}

const KIND_TEXT = {
    income: { title: 'Einnahmen', add: '+ Einnahmen-Kategorie', empty: 'Noch keine Einnahmen-Kategorie – z. B. „Einkommen“ mit Gehalt, Nebenjob, Kindergeld.' },
    expense: { title: 'Ausgaben', add: '+ Ausgaben-Kategorie', empty: 'Noch keine Ausgaben-Kategorie – z. B. „Wohnen“ mit Miete und Strom.' }
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
        if (!cats.length) section.appendChild(el('p', 'editor-empty', KIND_TEXT[kind].empty));
        cats.forEach((cat, i) => section.appendChild(categoryBlock(cat, sc, catColors, i, cats.length)));
        const add = el('button', 'btn btn-add', KIND_TEXT[kind].add);
        add.type = 'button';
        add.dataset.addKind = kind;
        section.appendChild(add);
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
        block.querySelector('.cat-sum').textContent = n ? fmtEuro(sum) + ' / Monat' : 'hier nicht genutzt';
        block.classList.toggle('is-unused', !n);
    });
    document.querySelectorAll('#editor .pay-row').forEach(row => {
        const p = sc.payments.find(x => x.id === row.dataset.pay);
        if (!p) return;
        const out = row.querySelector('.pay-monthly');
        out.textContent = '= ' + fmtEuro(monthly(p)) + ' / Monat';
        out.title = p.interval === 'month' ? '' : fmtPaymentOriginal(p) + ', ' + intervalExplain(p.interval);
    });
}

function findPayment(id) {
    return activeScenario().payments.find(p => p.id === id) || null;
}

function focusIn(selector) {
    const e = document.querySelector(selector);
    if (e) { e.focus(); if (e.select) e.select(); }
}

/** Zum Eintrag springen (Klick ins Diagramm) und kurz aufleuchten lassen. */
function revealItem(id) {
    const target = document.querySelector('#editor [data-pay="' + id + '"], #editor [data-cat="' + id + '"] > .cat-head');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
}

/* ── Farbauswahl ── */

let openPicker = null;

function closeColorPicker() {
    if (openPicker) { openPicker.remove(); openPicker = null; }
}

function openColorPicker(anchor, cat) {
    closeColorPicker();
    const palette = readPalette();
    const box = el('div', 'color-picker');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Farbe für „' + categoryName(cat) + '“');
    palette.forEach((c, i) => {
        const b = iconBtn('color-option', 'Farbe ' + (i + 1), '');
        b.style.background = c;
        b.setAttribute('aria-pressed', String(cat.colorSlot === i));
        b.addEventListener('click', () => {
            cat.colorSlot = i;
            closeColorPicker();
            editorChange('hard');
            focusIn('#editor [data-cat="' + cat.id + '"] .cat-swatch');
        });
        box.appendChild(b);
    });
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = (r.bottom + window.scrollY + 6) + 'px';
    openPicker = box;
    box.querySelector('[aria-pressed="true"], .color-option').focus();
}

/* ── Ereignisse ── */

function initEditor(onChange) {
    editorChange = onChange;
    const root = document.getElementById('editor');

    root.addEventListener('input', e => {
        const t = e.target;
        const row = t.closest('.pay-row');
        if (t.classList.contains('cat-name')) {
            const cat = categoryById(t.closest('.cat').dataset.cat);
            if (cat) { cat.name = t.value; onChange('soft'); }
            return;
        }
        if (t.classList.contains('cat-kind')) {
            const cat = categoryById(t.closest('.cat').dataset.cat);
            if (!cat) return;
            // An das Ende des anderen Abschnitts
            cat.kind = t.value === 'income' ? 'income' : 'expense';
            store.categories = store.categories.filter(c => c !== cat).concat(cat);
            onChange('hard');
            revealItem(cat.id);
            focusIn('#editor [data-cat="' + cat.id + '"] .cat-kind');
            return;
        }
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
        if (!row || e.target.tagName === 'SELECT') return;
        e.preventDefault();
        addPayment(row.closest('.cat').dataset.cat, row.dataset.pay);
    });

    root.addEventListener('click', async e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.addKind) {
            const cat = createCategory('', nextFreeSlot(), btn.dataset.addKind);
            store.categories.push(cat);
            onChange('hard');
            focusIn('#editor [data-cat="' + cat.id + '"] .cat-name');
            return;
        }
        const block = btn.closest('.cat');
        const cat = block && categoryById(block.dataset.cat);
        if (!cat) return;
        const sc = activeScenario();

        if (btn.classList.contains('btn-add-sub')) {
            addPayment(cat.id, null);
        } else if (btn.classList.contains('pay-del')) {
            const id = btn.closest('.pay-row').dataset.pay;
            sc.payments = sc.payments.filter(p => p.id !== id);
            onChange('hard');
            focusIn('#editor [data-cat="' + cat.id + '"] .btn-add-sub');
        } else if (btn.classList.contains('cat-swatch')) {
            e.stopPropagation();
            openColorPicker(btn, cat);
        } else if (btn.classList.contains('cat-up') || btn.classList.contains('cat-down')) {
            // Mit dem Nachbarn derselben Art tauschen
            const same = categoriesOf(cat.kind);
            const k = same.indexOf(cat) + (btn.classList.contains('cat-up') ? -1 : 1);
            if (k < 0 || k >= same.length) return;
            const i = store.categories.indexOf(cat), j = store.categories.indexOf(same[k]);
            store.categories[i] = same[k];
            store.categories[j] = cat;
            onChange('hard');
            focusIn('#editor [data-cat="' + cat.id + '"] .' + (btn.classList.contains('cat-up') ? 'cat-up' : 'cat-down') + ':not(:disabled)');
        } else if (btn.classList.contains('cat-del')) {
            await deleteCategory(cat, btn);
        }
    });

    document.addEventListener('pointerdown', e => {
        if (openPicker && !openPicker.contains(e.target)) closeColorPicker();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && openPicker) closeColorPicker();
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

async function deleteCategory(cat, anchor) {
    const users = store.scenarios.filter(s => paymentsOf(s, cat.id).length);
    const count = users.reduce((n, s) => n + paymentsOf(s, cat.id).length, 0);
    if (count) {
        const ok = await confirmFlyover({
            title: 'Kategorie „' + categoryName(cat) + '“ löschen?',
            message: 'Die Kategorie gilt in allen Szenarien. Mit ihr verschwinden ' + count +
                (count === 1 ? ' Zahlung' : ' Zahlungen') + ' aus ' +
                users.map(s => '„' + scenarioName(s) + '“').join(', ') + '.',
            confirmLabel: 'Löschen',
            danger: true,
            anchor: anchor
        });
        if (!ok) return;
    }
    store.categories = store.categories.filter(c => c !== cat);
    store.scenarios.forEach(s => { s.payments = s.payments.filter(p => p.categoryId !== cat.id); });
    editorChange('hard');
}
