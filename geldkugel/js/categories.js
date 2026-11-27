/* Geldkugel – Kategorien verwalten (gelten für alle Szenarien).
 *
 * Eigener Dialog, erreichbar über „Kategorien“ im Kasten „Für alle Szenarien“
 * und in der Eingabe. Nur hier werden Kategorien angelegt, umbenannt, umgefärbt,
 * sortiert, zwischen Einnahmen und Ausgaben umgestellt und gelöscht. In der
 * Eingabe eines Szenarios sind Kategorien nur Überschriften für die Zahlungen.
 * Jede Änderung wirkt sofort (onChange('hard') baut die Seite darunter neu).
 */
'use strict';

let catChange = null;
let catBox = null;          // Inhalt des offenen Dialogs

/* ── Farbauswahl (im Dialog, sonst wäre sie hinter dem modalen Dialog nicht bedienbar) ── */

let openPicker = null;

function closeColorPicker() {
    if (openPicker) { openPicker.remove(); openPicker = null; }
}

function openColorPicker(anchor, cat) {
    closeColorPicker();
    const box = el('div', 'color-picker');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Farbe für „' + categoryName(cat) + '“');
    readPalette().forEach((c, i) => {
        const b = iconBtn('color-option', 'Farbe ' + (i + 1), '');
        b.style.background = c;
        b.setAttribute('aria-pressed', String(cat.colorSlot === i));
        b.addEventListener('click', () => {
            cat.colorSlot = i;
            closeColorPicker();
            catChange('hard');
            renderCategoryManager('[data-cat="' + cat.id + '"] .cm-swatch');
        });
        box.appendChild(b);
    });
    (anchor.closest('dialog') || document.body).appendChild(box);
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = Math.min(r.bottom + 6, window.innerHeight - box.offsetHeight - 8) + 'px';
    box.anchor = anchor;
    openPicker = box;
    box.querySelector('[aria-pressed="true"], .color-option').focus();
}

/* ── Dialog ── */

function usageText(cat) {
    const users = store.scenarios.filter(s => paymentsOf(s, cat.id).length);
    const n = users.reduce((k, s) => k + paymentsOf(s, cat.id).length, 0);
    if (!n) return 'noch nicht genutzt';
    return n + (n === 1 ? ' Zahlung' : ' Zahlungen') + ' in ' + users.length + (users.length === 1 ? ' Szenario' : ' Szenarien');
}

function categoryRow(cat, index, count, color) {
    const row = el('div', 'cm-row');
    row.dataset.cat = cat.id;
    row.style.setProperty('--cat-color', color);

    const swatch = iconBtn('cm-swatch', 'Farbe wählen', '');
    const name = el('input', 'cm-name');
    name.type = 'text';
    name.value = cat.name;
    name.placeholder = 'Name der Kategorie';
    name.autocomplete = 'off';
    name.setAttribute('aria-label', 'Name der Kategorie');

    const kind = el('select', 'cm-kind');
    kind.setAttribute('aria-label', 'Art der Kategorie');
    [['income', 'Einnahmen'], ['expense', 'Ausgaben']].forEach(k => {
        const o = el('option', null, k[1]);
        o.value = k[0];
        kind.appendChild(o);
    });
    kind.value = cat.kind;

    const usage = el('span', 'cm-usage', usageText(cat));
    const actions = el('div', 'cm-actions');
    const up = iconBtn('icon-btn cm-up', 'Nach oben', '↑');
    const down = iconBtn('icon-btn cm-down', 'Nach unten', '↓');
    up.disabled = index === 0;
    down.disabled = index === count - 1;
    const del = iconBtn('icon-btn icon-del cm-del', 'Kategorie löschen (in allen Szenarien)', '✕');
    actions.append(up, down, del);

    row.append(swatch, name, kind, usage, actions);
    return row;
}

function renderCategoryManager(focusSelector) {
    if (!catBox) return;
    const hadFocus = catBox.contains(document.activeElement);
    catBox.textContent = '';
    const colors = categoryColors();
    [['income', 'Einnahmen', '+ Einnahmen-Kategorie', 'z. B. Einkommen, Kindergeld, Nebenjob'],
        ['expense', 'Ausgaben', '+ Ausgaben-Kategorie', 'z. B. Wohnen, Lebensmittel, Mobilität']].forEach(k => {
        const section = el('section', 'cm-section');
        section.appendChild(el('h4', 'cm-title', k[1]));
        const cats = categoriesOf(k[0]);
        if (!cats.length) section.appendChild(el('p', 'cm-empty', 'Noch keine – ' + k[3] + '.'));
        cats.forEach((cat, i) => section.appendChild(categoryRow(cat, i, cats.length, colors.get(cat.id))));
        const add = el('button', 'btn btn-add cm-add', k[2]);
        add.type = 'button';
        add.dataset.addKind = k[0];
        section.appendChild(add);
        catBox.appendChild(section);
    });
    const target = focusSelector && catBox.querySelector(focusSelector);
    if (target) { target.focus(); if (target.select) target.select(); }
    else if (hadFocus) {
        const any = catBox.querySelector('input, button');
        if (any) any.focus();
    }
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
        if (!ok) return false;
    }
    store.categories = store.categories.filter(c => c !== cat);
    store.scenarios.forEach(s => { s.payments = s.payments.filter(p => p.categoryId !== cat.id); });
    catChange('hard');
    return true;
}

function openCategories(anchor, focusCatId) {
    if (catBox && catBox.isConnected) return;   // schon offen
    const mine = catBox = el('div', 'cm');
    catBox.addEventListener('input', e => {
        const t = e.target;
        const cat = t.closest('.cm-row') && categoryById(t.closest('.cm-row').dataset.cat);
        if (!cat) return;
        if (t.classList.contains('cm-name')) {
            cat.name = t.value;
            catChange('hard');
        } else if (t.classList.contains('cm-kind')) {
            // ans Ende des anderen Abschnitts
            cat.kind = t.value === 'income' ? 'income' : 'expense';
            store.categories = store.categories.filter(c => c !== cat).concat(cat);
            catChange('hard');
            renderCategoryManager('[data-cat="' + cat.id + '"] .cm-kind');
        }
    });
    catBox.addEventListener('click', async e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.addKind) {
            const cat = createCategory('', nextFreeSlot(), btn.dataset.addKind);
            store.categories.push(cat);
            catChange('hard');
            renderCategoryManager('[data-cat="' + cat.id + '"] .cm-name');
            return;
        }
        const row = btn.closest('.cm-row');
        const cat = row && categoryById(row.dataset.cat);
        if (!cat) return;
        if (btn.classList.contains('cm-swatch')) {
            e.stopPropagation();
            openColorPicker(btn, cat);
        } else if (btn.classList.contains('cm-up') || btn.classList.contains('cm-down')) {
            const up = btn.classList.contains('cm-up');
            const same = categoriesOf(cat.kind);
            const k = same.indexOf(cat) + (up ? -1 : 1);
            if (k < 0 || k >= same.length) return;
            const i = store.categories.indexOf(cat), j = store.categories.indexOf(same[k]);
            store.categories[i] = same[k];
            store.categories[j] = cat;
            catChange('hard');
            renderCategoryManager('[data-cat="' + cat.id + '"] .' + (up ? 'cm-up' : 'cm-down') + ':not(:disabled)');
        } else if (btn.classList.contains('cm-del')) {
            const list = categoriesOf(cat.kind);
            const next = list[list.indexOf(cat) + 1] || list[list.indexOf(cat) - 1];
            if (await deleteCategory(cat, btn)) {
                renderCategoryManager(next ? '[data-cat="' + next.id + '"] .cm-del' : '[data-add-kind="' + cat.kind + '"]');
            }
        }
    });

    openFlyover({
        title: 'Kategorien – für alle Szenarien',
        message: 'Was du hier anlegst, umbenennst oder löschst, gilt in jedem Szenario. Die Beträge trägst du je Szenario in der Eingabe ein.',
        body: catBox,
        anchor: anchor,
        wide: true,
        buttons: [{ label: 'Fertig', value: null, kind: 'primary', autofocus: !focusCatId }]
    }).then(() => {
        closeColorPicker();
        if (catBox === mine) catBox = null;
    });
    renderCategoryManager(focusCatId ? '[data-cat="' + focusCatId + '"] .cm-name' : null);
}

function initCategories(onChange) {
    catChange = onChange;
    document.addEventListener('click', e => {
        const btn = e.target.closest('[data-open-categories]');
        if (btn) openCategories(btn, btn.dataset.openCategories || null);
    });
    document.addEventListener('pointerdown', e => {
        if (openPicker && !openPicker.contains(e.target)) closeColorPicker();
    });
    // Esc schließt erst die Farbauswahl, nicht gleich den ganzen Dialog.
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && openPicker) {
            e.preventDefault();
            e.stopPropagation();
            const swatch = openPicker.anchor;
            closeColorPicker();
            if (swatch && swatch.isConnected) swatch.focus();
        }
    }, true);
}
