/* Zeitfresser – Eingabebereich (Themen mit höchstens einer Ebene Unterpunkte).
 *
 * Der Baum wird nur bei strukturellen Änderungen (Hinzufügen, Löschen,
 * Verschieben, Tage, Farbe, Auf-/Zuklappen) komplett neu aufgebaut. Beim
 * Tippen in Name/Wert werden nur Modell, Infozeilen und Diagramme
 * aktualisiert, damit der Fokus im Eingabefeld bleibt.
 *
 * Verschieben: per ↑/↓-Knopf innerhalb der eigenen Liste oder per Drag &
 * Drop am Griff (⠿). Themen lassen sich nur zwischen Themen einsortieren;
 * Unterpunkte zwischen Unterpunkte – auch in ein anderes Thema (dann auf
 * die Zeile des Themas ziehen oder zwischen dessen Unterpunkte).
 *
 * Ein Thema ohne eigenen Wert übernimmt automatisch die Summe seiner
 * Unterpunkte (als Platzhalter im leeren Feld). Mit eigenem Wert zeigt die
 * Infozeile, ob die Unterpunkte ihn ganz, teilweise oder zu viel abdecken;
 * bei "zu viel" lässt sich die Summe eintragen oder der Wert entfernen.
 */
'use strict';

function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
}

function iconButton(className, action, text, label) {
    const b = el('button', className, text);
    b.type = 'button';
    b.dataset.action = action;
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
}

function renderEditor() {
    closeColorPicker();
    const sc = activeScenario();
    const colors = computeColors(sc);
    const tree = document.getElementById('tree');
    tree.textContent = '';
    if (!sc.nodes.length) {
        tree.appendChild(el('p', 'tree-empty', 'Noch nichts eingetragen. Leg mit „+ Thema“ los – z. B. Arbeit, Schlaf, Pendeln oder Social Media.'));
    }
    sc.nodes.forEach((n, i) => tree.appendChild(buildNode(n, null, colors, i, sc.nodes.length)));
    updateInfos();
}

function buildNode(node, parent, colors, index, count) {
    const isTop = !parent;
    const wrap = el('div', 'node' + (isTop ? ' node-top' : ' node-sub'));
    wrap.dataset.id = node.id;
    wrap.style.setProperty('--node-color', colors.get(node.id));

    const row = el('div', 'node-row');

    const handle = el('span', 'node-handle', '⠿');
    handle.draggable = true;
    handle.title = 'Ziehen zum Verschieben';
    handle.setAttribute('aria-hidden', 'true');

    const toggle = el('button', 'node-toggle');
    toggle.type = 'button';
    if (node.children.length) {
        toggle.dataset.action = 'toggle';
        toggle.textContent = node.collapsed ? '▸' : '▾';
        toggle.setAttribute('aria-expanded', String(!node.collapsed));
        toggle.setAttribute('aria-label', node.collapsed ? 'Unterpunkte aufklappen' : 'Unterpunkte zuklappen');
    } else {
        toggle.classList.add('is-empty');
        toggle.tabIndex = -1;
        toggle.setAttribute('aria-hidden', 'true');
    }

    const swatch = el('button', 'node-swatch');
    swatch.type = 'button';
    if (isTop) {
        swatch.dataset.action = 'color';
        swatch.title = 'Farbe wählen';
        swatch.setAttribute('aria-label', 'Farbe wählen');
        swatch.setAttribute('aria-haspopup', 'true');
    } else {
        swatch.disabled = true;
        swatch.tabIndex = -1;
        swatch.setAttribute('aria-hidden', 'true');
    }

    const name = el('input', 'node-name');
    name.type = 'text';
    name.value = node.name;
    name.placeholder = isTop ? 'Thema' : 'Unterpunkt';
    name.setAttribute('aria-label', 'Name');
    name.autocomplete = 'off';

    const amountWrap = el('div', 'node-amount');
    const amount = el('input', 'node-value');
    amount.type = 'text';
    amount.inputMode = 'decimal';
    amount.autocomplete = 'off';
    amount.value = node.amount ? fmtNumber(node.amount) : '';
    amount.setAttribute('aria-label', 'Stunden');
    const per = el('select', 'node-per');
    per.setAttribute('aria-label', 'Einheit');
    [['day', 'pro Tag'], ['week', 'pro Woche']].forEach(o => {
        const opt = el('option', null, o[1]);
        opt.value = o[0];
        per.appendChild(opt);
    });
    per.value = node.per;
    // Erst die Einheit wählen, dann den Wert eintragen.
    amountWrap.append(per, amount);

    const days = el('div', 'node-days');
    days.setAttribute('role', 'group');
    days.setAttribute('aria-label', 'Wochentage');
    for (let d = 0; d < 7; d++) {
        const chip = el('button', 'day-chip', DAY_SHORT[d]);
        chip.type = 'button';
        chip.dataset.action = 'day';
        chip.dataset.day = d;
        chip.title = DAY_LONG[d];
        chip.setAttribute('aria-pressed', String(node.days[d]));
        if (parent && !parent.days[d]) {
            chip.disabled = true;
            chip.title = DAY_LONG[d] + ' – beim Thema nicht gewählt';
        }
        days.appendChild(chip);
    }

    const actions = el('div', 'node-actions');
    const up = iconButton('node-move', 'up', '↑', 'Nach oben');
    const down = iconButton('node-move', 'down', '↓', 'Nach unten');
    up.disabled = index === 0;
    down.disabled = index === count - 1;
    actions.append(up, down);
    if (isTop) {
        const add = iconButton('node-add', 'add', '+ Unter', 'Unterpunkt hinzufügen');
        // Sind Unterpunkte aufgeklappt, sitzt der Knopf unter dem letzten
        // Unterpunkt; hier oben bleibt nur sein Platz (Spalten bleiben bündig).
        if (node.children.length && !node.collapsed) {
            add.classList.add('is-placeholder');
            add.tabIndex = -1;
            add.setAttribute('aria-hidden', 'true');
        }
        actions.appendChild(add);
    }
    actions.appendChild(iconButton('node-del', 'del', '✕', 'Löschen'));

    row.append(handle, toggle, swatch, name, amountWrap, days, actions);
    wrap.appendChild(row);
    wrap.appendChild(el('div', 'node-info'));

    if (isTop && node.children.length && !node.collapsed) {
        const kids = el('div', 'node-children');
        node.children.forEach((c, i) => kids.appendChild(buildNode(c, node, colors, i, node.children.length)));
        const addSub = el('button', 'btn-add-sub', '+ Unterpunkt');
        addSub.type = 'button';
        addSub.dataset.action = 'add';
        addSub.setAttribute('aria-label', 'Unterpunkt zu „' + (node.name.trim() || 'Thema') + '“ hinzufügen');
        kids.appendChild(addSub);
        wrap.appendChild(kids);
    }
    return wrap;
}

/** Knöpfe, wenn die Unterpunkte mehr ergeben als der eingetragene Wert. */
function buildSumActions(node) {
    const wrap = el('span', 'info-actions');
    const set = el('button', 'btn-info', fmtNumber(childrenAmount(node)) + (node.per === 'day' ? ' h/T' : ' h/W') + ' eintragen');
    set.type = 'button';
    set.dataset.action = 'sum-set';
    set.title = 'Summe der Unterpunkte als festen Wert des Themas eintragen';
    const auto = el('button', 'btn-info', 'Wert entfernen (automatisch)');
    auto.type = 'button';
    auto.dataset.action = 'sum-auto';
    auto.title = 'Eingetragenen Wert entfernen – dann gilt immer die Summe der Unterpunkte';
    wrap.append(set, auto);
    return wrap;
}

/** Infozeilen und Platzhalter jedes Punkts neu berechnen (ohne den Baum neu aufzubauen). */
function updateInfos() {
    const sc = activeScenario();
    const ref = weekRef(sc);
    walk(sc.nodes, node => {
        const wrap = document.querySelector('.node[data-id="' + node.id + '"]');
        if (!wrap) return;
        const info = wrap.querySelector(':scope > .node-info');
        const valueInput = wrap.querySelector(':scope > .node-row .node-value');
        info.textContent = '';
        const n = dayCount(node);
        const w = weeklyHours(node);
        const auto = isAutoSum(node);
        let over = false;

        if (!n) {
            info.appendChild(el('span', 'info-hint', '⚠ Keine Wochentage gewählt – zählt nicht mit.'));
        } else {
            // Kurzform der Einheiten: h/T = Stunden pro Tag, h/W = Stunden pro Woche.
            const perDay = h => fmtNumber(h) + ' h/T';
            const perWeek = h => fmtNumber(h) + ' h/W';
            const parts = node.per === 'day'
                ? ['= ' + perWeek(w), fmtDays(node.days), fmtPercent(w / ref) + ' der Woche']
                : ['= ' + perDay(w / n), fmtDays(node.days), fmtPercent(w / ref) + ' der Woche'];
            info.appendChild(el('span', 'info-main', parts.join(' · ')));

            if (auto) {
                info.appendChild(el('span', 'info-auto', 'Σ automatisch: Summe der Unterpunkte'));
            } else if (node.children.length) {
                const cs = sumWeekly(node.children);
                const label = node.name.trim() || 'dieses Thema';
                // Pro-Tag-Werte beziehen sich auf die beim Thema gewählten Tage.
                if (cs - w > EPS) {
                    over = true;
                    info.appendChild(el('span', 'info-warn zf-pulse',
                        '⚠ Unterpunkte: ' + perDay(cs / n) + ' (' + perWeek(cs) + ') – ' +
                        perDay((cs - w) / n) + ' mehr als „' + label + '“'));
                    info.appendChild(buildSumActions(node));
                } else if (w - cs > EPS) {
                    const span = el('span', 'info-rest');
                    span.appendChild(el('span', 'info-hatch'));
                    span.appendChild(document.createTextNode(
                        'Unterpunkte: ' + fmtNumber(cs / n) + ' von ' + perDay(w / n) + ' (' +
                        fmtNumber(cs) + ' von ' + perWeek(w) + ') – ' +
                        perDay((w - cs) / n) + ' (' + perWeek(w - cs) + ') nicht zugeordnet'));
                    info.appendChild(span);
                } else {
                    info.appendChild(el('span', 'info-ok', '✓ Unterpunkte decken alles ab'));
                }
            }
        }
        valueInput.classList.toggle('is-over', over);
        valueInput.classList.toggle('is-auto', auto);
        valueInput.placeholder = auto ? fmtNumber(childrenAmount(node)) : '0';
        valueInput.title = 'Stunden, z. B. 6, 1,5 oder 1:30' +
            (node.children.length ? ' – leer = Summe der Unterpunkte' : '');
    });
}

/* ── Farbauswahl (12 Farben) ── */

let colorPicker = null;

function closeColorPicker() {
    if (!colorPicker) return;
    colorPicker.remove();
    colorPicker = null;
}

function openColorPicker(node, anchor, onPick) {
    closeColorPicker();
    const pop = el('div', 'color-picker');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Farbe wählen');
    for (let i = 0; i < SLOT_COUNT; i++) {
        const b = el('button', 'color-option');
        b.type = 'button';
        b.style.background = 'var(--series-' + (i + 1) + ')';
        b.setAttribute('aria-label', 'Farbe ' + (i + 1));
        b.setAttribute('aria-pressed', String(node.colorSlot === i));
        b.addEventListener('click', () => {
            closeColorPicker();
            onPick(i);
        });
        pop.appendChild(b);
    }
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(window.scrollX + r.left - 6, window.scrollX + document.documentElement.clientWidth - w - 8)) + 'px';
    pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
    colorPicker = pop;
    const current = pop.querySelector('[aria-pressed="true"]') || pop.firstChild;
    current.focus();
}

/* ── Verschieben ── */

/** Punkt an neue Stelle hängen. Wechselt ein Unterpunkt das Thema, gelten
 *  nur noch Wochentage, die auch das neue Thema hat. */
function moveNode(id, targetList, targetIndex, newParent) {
    const sc = activeScenario();
    const src = findNode(sc.nodes, id);
    if (!src) return;
    src.list.splice(src.index, 1);
    if (src.list === targetList && src.index < targetIndex) targetIndex--;
    targetList.splice(targetIndex, 0, src.node);
    if (newParent) {
        src.node.days = src.node.days.map((d, i) => d && newParent.days[i]);
        newParent.collapsed = false;
    }
}

function initDragAndDrop(tree, onChange) {
    let drag = null;   // { id, isTop }
    let drop = null;   // { el, targetId, pos: 'before' | 'after' | 'into' }

    function clearIndicator() {
        tree.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach(e =>
            e.classList.remove('drop-before', 'drop-after', 'drop-into'));
        drop = null;
    }

    tree.addEventListener('dragstart', e => {
        const handle = e.target.closest && e.target.closest('.node-handle');
        if (!handle) return;
        const wrap = handle.closest('.node');
        drag = { id: wrap.dataset.id, isTop: wrap.classList.contains('node-top') };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', drag.id);
        e.dataTransfer.setDragImage(wrap.querySelector(':scope > .node-row'), 16, 20);
        requestAnimationFrame(() => wrap.classList.add('is-dragging'));
    });

    tree.addEventListener('dragover', e => {
        if (!drag) return;
        const wrap = e.target.closest('.node');
        clearIndicator();
        if (!wrap || wrap.dataset.id === drag.id) return;

        let target, pos;
        if (drag.isTop) {
            // Themen nur zwischen Themen
            target = wrap.closest('.node-top');
            if (!target || target.dataset.id === drag.id) return;
            const r = target.getBoundingClientRect();
            pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
        } else if (wrap.classList.contains('node-sub')) {
            if (wrap.closest('.is-dragging')) return;
            target = wrap;
            const r = target.getBoundingClientRect();
            pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
        } else {
            // Unterpunkt auf eine Themenzeile → wird dort letzter Unterpunkt
            if (!e.target.closest('.node-row')) return;
            target = wrap;
            pos = 'into';
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        (pos === 'into' ? target.querySelector(':scope > .node-row') : target).classList.add('drop-' + pos);
        drop = { targetId: target.dataset.id, pos: pos };
    });

    tree.addEventListener('drop', e => {
        if (!drag || !drop) return;
        e.preventDefault();
        const sc = activeScenario();
        const tgt = findNode(sc.nodes, drop.targetId);
        if (tgt) {
            if (drop.pos === 'into') {
                moveNode(drag.id, tgt.node.children, tgt.node.children.length, tgt.node);
            } else {
                moveNode(drag.id, tgt.list, tgt.index + (drop.pos === 'after' ? 1 : 0), tgt.parent);
            }
            const movedId = drag.id;
            drag = null;
            clearIndicator();
            onChange('hard', { focus: movedId, selector: '.node-name' });
        }
    });

    tree.addEventListener('dragend', () => {
        drag = null;
        clearIndicator();
        tree.querySelectorAll('.is-dragging').forEach(e => e.classList.remove('is-dragging'));
    });
}

/* ── Ereignisse ── */

function initEditor(onChange) {
    const tree = document.getElementById('tree');

    function nodeFromEvent(e) {
        const wrap = e.target.closest('.node');
        return wrap ? findNode(activeScenario().nodes, wrap.dataset.id) : null;
    }

    tree.addEventListener('input', e => {
        const hit = nodeFromEvent(e);
        if (!hit) return;
        if (e.target.classList.contains('node-name')) {
            hit.node.name = e.target.value;
            onChange('soft');
        } else if (e.target.classList.contains('node-value')) {
            const v = parseHours(e.target.value);
            e.target.classList.toggle('invalid', v == null);
            if (v == null) return;
            hit.node.amount = v;
            onChange('soft');
        }
    });

    // Wert beim Verlassen in Normalform bringen (z. B. "1:30" → "1,5"), ungültige Eingabe zurücksetzen.
    tree.addEventListener('focusout', e => {
        if (!e.target.classList.contains('node-value')) return;
        const hit = nodeFromEvent(e);
        if (!hit) return;
        e.target.classList.remove('invalid');
        e.target.value = hit.node.amount ? fmtNumber(hit.node.amount) : '';
    });

    tree.addEventListener('change', e => {
        if (!e.target.classList.contains('node-per')) return;
        const hit = nodeFromEvent(e);
        if (!hit) return;
        const node = hit.node;
        const w = weeklyHours(node);
        const n = dayCount(node);
        // Einheit wechseln, ohne den Wochenwert zu verändern (Automatik bleibt ohne eigenen Wert).
        node.per = e.target.value === 'day' ? 'day' : 'week';
        if (n && !isAutoSum(node)) node.amount = node.per === 'day' ? w / n : w;
        const input = e.target.closest('.node-amount').querySelector('.node-value');
        input.value = node.amount ? fmtNumber(node.amount) : '';
        onChange('soft');
    });

    tree.addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn || btn.disabled) return;
        const hit = nodeFromEvent(e);
        if (!hit) return;
        const node = hit.node;

        switch (btn.dataset.action) {
            case 'toggle':
                node.collapsed = !node.collapsed;
                onChange('hard', { focus: node.id, selector: '.node-toggle' });
                break;
            case 'color':
                if (colorPicker) { closeColorPicker(); break; }
                openColorPicker(node, btn, slot => {
                    node.colorSlot = slot;
                    onChange('hard', { focus: node.id, selector: '.node-swatch' });
                });
                break;
            case 'up':
            case 'down': {
                const to = hit.index + (btn.dataset.action === 'up' ? -1 : 1);
                if (to < 0 || to >= hit.list.length) return;
                hit.list.splice(hit.index, 1);
                hit.list.splice(to, 0, node);
                const edge = to === 0 || to === hit.list.length - 1;
                // Fokus bleibt auf dem Knopf, außer er ist am Rand jetzt deaktiviert.
                const sel = edge ? '.node-move[data-action="' + (btn.dataset.action === 'up' ? 'down' : 'up') + '"]'
                                 : '.node-move[data-action="' + btn.dataset.action + '"]';
                onChange('hard', { focus: node.id, selector: sel });
                break;
            }
            case 'day': {
                const d = Number(btn.dataset.day);
                const on = !node.days[d];
                // Bei Einheit "pro Woche" bleibt der Wochenwert gleich; bei "pro Tag" ändert er sich mit der Anzahl der Tage.
                node.days[d] = on;
                // Abgewählte Tage gelten auch für alle Unterpunkte nicht mehr.
                if (!on) node.children.forEach(c => { c.days[d] = false; });
                onChange('hard', { focus: node.id, selector: '.day-chip[data-day="' + d + '"]' });
                break;
            }
            case 'sum-set':
            case 'sum-auto':
                node.amount = btn.dataset.action === 'sum-set' ? childrenAmount(node) : 0;
                // Der Knopf verschwindet; die Einheit fokussieren statt des Werts (sonst geht am Handy die Tastatur auf).
                onChange('hard', { focus: node.id, selector: '.node-per' });
                break;
            case 'add': {
                if (hit.parent) return; // höchstens zwei Ebenen
                const child = createNode({ days: node.days });
                node.children.push(child);
                node.collapsed = false;
                onChange('hard', { focus: child.id, selector: '.node-name' });
                break;
            }
            case 'del': {
                const doDelete = () => {
                    const again = findNode(activeScenario().nodes, node.id);
                    if (!again) return;
                    again.list.splice(again.index, 1);
                    // Fokus nicht ins Leere fallen lassen: Nachbar oder Elternpunkt
                    const next = again.list[Math.min(again.index, again.list.length - 1)] || again.parent;
                    onChange('hard', next ? { focus: next.id, selector: '.node-name' } : null);
                };
                // Leere Punkte ohne Rückfrage löschen
                if (!(node.name.trim() || node.amount || node.children.length)) { doDelete(); break; }
                const label = node.name.trim() ? '„' + node.name.trim() + '“' : 'Diesen Punkt';
                const kids = node.children.length;
                let message = hit.parent ? 'Der Unterpunkt wird entfernt.' : 'Das Thema wird entfernt.';
                if (kids) message = 'Das Thema wird samt ' + kids + ' Unterpunkt' + (kids > 1 ? 'en' : '') + ' entfernt.';
                confirmFlyover({
                    title: label + ' löschen?',
                    message: message,
                    confirmLabel: 'Löschen',
                    danger: true,
                    anchor: btn
                }).then(ok => { if (ok) doDelete(); });
                break;
            }
        }
    });

    initDragAndDrop(tree, onChange);

    document.addEventListener('pointerdown', e => {
        if (colorPicker && !colorPicker.contains(e.target) && !e.target.closest('.node-swatch')) closeColorPicker();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && colorPicker) {
            closeColorPicker();
        }
    });
}

function focusNode(id, selector) {
    const wrap = document.querySelector('.node[data-id="' + id + '"]');
    if (!wrap) return;
    const target = wrap.querySelector(':scope > .node-row ' + (selector || '.node-name'));
    if (target) target.focus();
}

/** Für Klicks im Diagramm: Thema aufklappen, hinscrollen und kurz hervorheben. */
function revealNode(id) {
    const sc = activeScenario();
    const hit = findNode(sc.nodes, id);
    if (!hit) return;
    if (hit.parent && hit.parent.collapsed) {
        hit.parent.collapsed = false;
        saveStore();
        renderEditor();
    }
    const wrap = document.querySelector('.node[data-id="' + id + '"]');
    if (!wrap) return;
    const row = wrap.querySelector(':scope > .node-row');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    focusNode(id, '.node-name');
}
