/* Zeitfresser – Start, Szenario-Menü und Zusammenspiel der Teile. */
'use strict';

function renderScenarioBar() {
    const sc = activeScenario();
    const select = document.getElementById('scenarioSelect');
    select.textContent = '';
    store.scenarios.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name.trim() || 'Ohne Namen';
        select.appendChild(opt);
    });
    select.value = sc.id;

    const name = document.getElementById('scenarioName');
    if (document.activeElement !== name) name.value = sc.name;

    const hpd = document.getElementById('hoursPerDay');
    if (document.activeElement !== hpd) {
        hpd.value = fmtNumber(sc.hoursPerDay);
        hpd.classList.remove('invalid');
    }
}

function renderAll() {
    renderScenarioBar();
    renderEditor();
    renderCharts();
    updatePanelSummaries();
}

/* ── Einklappbare Boxen ──
 * Nur im einspaltigen Layout (gleiche Grenze wie in style.css) lassen sich
 * die Boxen per Klick auf die Überschrift einklappen. Der Zustand ist eine
 * reine Ansichts-Vorliebe dieses Browsers und liegt getrennt von den Daten. */

const COLLAPSE_KEY = 'klmpfh-zeitfresser-collapsed';
const ONE_COLUMN_MQ = '(max-width: 1040px)';

function initCollapsibles() {
    let state = {};
    try { state = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}') || {}; } catch (e) { state = {}; }
    const mq = window.matchMedia(ONE_COLUMN_MQ);
    const panels = Array.from(document.querySelectorAll('.collapsible[data-panel]'));

    function apply() {
        panels.forEach(panel => {
            const btn = panel.querySelector('.panel-toggle');
            const collapsed = mq.matches && !!state[panel.dataset.panel];
            panel.classList.toggle('is-collapsed', collapsed);
            btn.disabled = !mq.matches;
            btn.setAttribute('aria-expanded', String(!collapsed));
        });
    }

    panels.forEach(panel => {
        panel.querySelector('.panel-toggle').addEventListener('click', () => {
            if (!mq.matches) return;
            const key = panel.dataset.panel;
            state[key] = !state[key];
            try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state)); } catch (e) { /* egal */ }
            apply();
        });
    });
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
    apply();
}

/** Kurzinfo in den Box-Überschriften – vor allem für eingeklappte Boxen. */
function updatePanelSummaries() {
    const sc = activeScenario();
    const ref = weekRef(sc);
    const total = sumWeekly(sc.nodes);

    function set(id, text, warn) {
        const el = document.getElementById(id);
        el.textContent = '';
        if (text) el.appendChild(document.createTextNode(text));
        if (warn) {
            const w = document.createElement('span');
            w.className = 'sum-warn';
            w.textContent = (text ? ' · ' : '') + warn;
            el.appendChild(w);
        }
    }

    set('sumScenario', (sc.name.trim() || 'Ohne Namen') +
        (sc.hoursPerDay !== 24 ? ' · ' + fmtShort(sc.hoursPerDay) + ' h/Tag' : ''));

    const subs = sc.nodes.reduce((s, n) => s + n.children.length, 0);
    const subOver = sc.nodes.some(n => n.children.length && sumWeekly(n.children) - weeklyHours(n) > EPS);
    set('sumEditor', sc.nodes.length + (sc.nodes.length === 1 ? ' Thema' : ' Themen') +
        (subs ? ' · ' + subs + ' Unterpunkt' + (subs === 1 ? '' : 'e') : ''),
        subOver ? '⚠ Unterpunkte zu groß' : '');

    set('sumWeek', fmtShort(total) + ' / ' + fmtShort(ref) + ' h',
        total - ref > EPS ? '⚠ ' + fmtShort(total - ref) + ' h zu viel' : '');

    const colors = computeColors(sc);
    let overDays = 0;
    for (let d = 0; d < 7; d++) {
        const dayTotal = collectSegments(sc.nodes, d, 1, colors, '', null, []).reduce((s, x) => s + x.hours, 0);
        if (dayTotal - sc.hoursPerDay > EPS) overDays++;
    }
    set('sumDays', overDays ? '' : 'alle Tage im Rahmen',
        overDays ? '⚠ an ' + overDays + (overDays === 1 ? ' Tag' : ' Tagen') + ' zu viel' : '');
}

/**
 * Zentrale Rückmeldung nach jeder Änderung.
 * 'soft' = nur Werte geändert (Baum bleibt stehen, Fokus bleibt im Feld),
 * 'hard' = Struktur geändert (Baum neu aufbauen, optional Fokus setzen).
 */
function onChange(kind, opts) {
    saveStore();
    if (kind === 'hard') {
        renderEditor();
        if (opts && opts.focus) focusNode(opts.focus, opts.selector);
    } else {
        updateInfos();
    }
    renderCharts();
    updatePanelSummaries();
}

function uniqueScenarioName(base) {
    const names = new Set(store.scenarios.map(s => s.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(base + ' ' + i)) i++;
    return base + ' ' + i;
}

function initScenarioBar() {
    document.getElementById('scenarioSelect').addEventListener('change', e => {
        store.activeId = e.target.value;
        saveStore();
        renderAll();
    });

    document.getElementById('scenarioName').addEventListener('input', e => {
        activeScenario().name = e.target.value;
        saveStore();
        const opt = document.querySelector('#scenarioSelect option[value="' + store.activeId + '"]');
        if (opt) opt.textContent = e.target.value.trim() || 'Ohne Namen';
        updatePanelSummaries();
    });

    const hpd = document.getElementById('hoursPerDay');
    hpd.addEventListener('input', e => {
        const v = parseHours(e.target.value);
        const ok = v != null && v > 0 && v <= 24;
        e.target.classList.toggle('invalid', !ok);
        if (!ok) return;
        activeScenario().hoursPerDay = v;
        onChange('soft');
    });
    hpd.addEventListener('focusout', () => renderScenarioBar());

    document.getElementById('btnNew').addEventListener('click', () => {
        const sc = createScenario(uniqueScenarioName('Neues Szenario'));
        store.scenarios.push(sc);
        store.activeId = sc.id;
        saveStore();
        renderAll();
        const name = document.getElementById('scenarioName');
        name.focus();
        name.select();
    });

    document.getElementById('btnDup').addEventListener('click', () => {
        const src = activeScenario();
        const copy = {
            id: uid(),
            name: uniqueScenarioName((src.name.trim() || 'Szenario') + ' (Kopie)'),
            hoursPerDay: src.hoursPerDay,
            nodes: cloneNodesWithNewIds(src.nodes)
        };
        store.scenarios.splice(store.scenarios.indexOf(src) + 1, 0, copy);
        store.activeId = copy.id;
        saveStore();
        renderAll();
    });

    document.getElementById('btnDel').addEventListener('click', () => {
        const sc = activeScenario();
        if (!confirm('Szenario „' + (sc.name.trim() || 'Ohne Namen') + '“ löschen?')) return;
        const idx = store.scenarios.indexOf(sc);
        store.scenarios.splice(idx, 1);
        if (!store.scenarios.length) store.scenarios.push(createScenario('Neues Szenario'));
        store.activeId = store.scenarios[Math.max(0, idx - 1)].id;
        saveStore();
        renderAll();
    });

    document.getElementById('btnAddTop').addEventListener('click', () => {
        const sc = activeScenario();
        const node = createNode({ colorSlot: nextFreeSlot(sc.nodes) });
        sc.nodes.push(node);
        onChange('hard', { focus: node.id, selector: '.node-name' });
    });
}

/* Diagrammfarben hängen vom Hell/Dunkel-Design ab → bei Wechsel neu zeichnen. */
function watchTheme() {
    const rerender = () => { renderEditor(); renderCharts(); };
    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (mq.addEventListener) mq.addEventListener('change', rerender);
    }
    new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

document.addEventListener('DOMContentLoaded', () => {
    loadStore();
    saveStore();
    initCollapsibles();
    initScenarioBar();
    initEditor(onChange);
    initChartInteraction(revealNode);
    watchTheme();
    renderAll();
});
