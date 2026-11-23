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
 * Die Diagramm-Boxen (data-always) lassen sich immer per Klick auf die
 * Überschrift einklappen, Szenario und Themen nur im einspaltigen Layout
 * (gleiche Grenze wie in style.css). Der Zustand ist eine reine
 * Ansichts-Vorliebe dieses Browsers und liegt getrennt von den Daten. */

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
            const can = mq.matches || panel.hasAttribute('data-always');
            const collapsed = can && !!state[panel.dataset.panel];
            panel.classList.toggle('is-collapsed', collapsed);
            btn.disabled = !can;
            btn.setAttribute('aria-expanded', String(!collapsed));
        });
    }

    panels.forEach(panel => {
        panel.querySelector('.panel-toggle').addEventListener('click', () => {
            if (!mq.matches && !panel.hasAttribute('data-always')) return;
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

/* ── Mitlaufende Diagramme ──
 * Passen die Diagramme ins Fenster, reicht position: sticky aus style.css.
 * Sind sie höher, scrollen sie mit der Seite mit, bis beim Runterscrollen ihr
 * unterer bzw. beim Hochscrollen ihr oberer Rand erreicht ist, und bleiben dort
 * stehen. Unterwegs sind sie "lose" (position: relative), damit nichts ruckelt. */

function initStickyCharts() {
    const panel = document.querySelector('.chart-panel');
    const layout = panel.parentElement;
    const mq = window.matchMedia(ONE_COLUMN_MQ);
    let lastY = window.scrollY;

    /** Oberste (max) und unterste (min) Haltestelle der Oberkante im Fenster. */
    function limits() {
        const nav = parseFloat(getComputedStyle(panel).getPropertyValue('--theme-nav-height')) || 0;
        const max = nav + 16;
        return { min: Math.min(max, window.innerHeight - panel.offsetHeight), max: max };
    }

    function stick(top) {
        panel.style.position = '';
        panel.style.top = top + 'px';
    }

    function clear() {
        panel.style.position = '';
        panel.style.top = '';
    }

    function onScroll() {
        const dy = window.scrollY - lastY;
        lastY = window.scrollY;
        if (mq.matches || !dy) return;
        const lim = limits();
        if (lim.min === lim.max) { clear(); return; }

        if (panel.style.position !== 'relative') {
            const held = panel.style.top ? parseFloat(panel.style.top) : lim.max;
            if (dy > 0 ? held <= lim.min : held >= lim.max) return;   // steht schon am richtigen Rand
            // Loslassen: dort weiter, wo die Diagramme vor diesem Scrollschritt standen.
            const shift = panel.getBoundingClientRect().top - layout.getBoundingClientRect().top - dy;
            const room = Math.max(0, layout.offsetHeight - panel.offsetHeight);
            panel.style.position = 'relative';
            panel.style.top = Math.min(room, Math.max(0, shift)) + 'px';
        }
        const top = panel.getBoundingClientRect().top;
        if (dy > 0 && top <= lim.min) stick(lim.min);
        else if (dy < 0 && top >= lim.max) stick(lim.max);
    }

    /** Größe geändert: möglichst an Ort und Stelle festhalten. */
    function onResize() {
        if (mq.matches) { clear(); return; }
        const lim = limits();
        if (lim.min === lim.max) { clear(); return; }
        stick(Math.min(lim.max, Math.max(lim.min, panel.getBoundingClientRect().top)));
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(onResize);
        ro.observe(panel);
        ro.observe(document.querySelector('.editor-panel'));
    }
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
    set('sumEditor', sc.nodes.length + (sc.nodes.length === 1 ? ' Thema' : ' Themen') +
        (subs ? ' · ' + subs + ' Unterpunkt' + (subs === 1 ? '' : 'e') : ''));

    set('sumWeek', fmtShort(total) + ' / ' + fmtShort(ref) + ' h',
        total - ref > EPS ? '⚠ ' + fmtShort(total - ref) + ' h zu viel' : '');

    const rows = computeDayRows(sc, computeColors(sc));
    const overDays = rows.filter(r => r.day != null && r.over).length;
    set('sumDays', overDays ? '' : fmtShort(Math.max(0, rows[0].free)) + ' h frei pro Woche',
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

    document.getElementById('btnDel').addEventListener('click', async e => {
        const sc = activeScenario();
        const ok = await confirmFlyover({
            title: 'Szenario „' + (sc.name.trim() || 'Ohne Namen') + '“ löschen?',
            message: store.scenarios.length > 1
                ? 'Alle Themen dieses Szenarios werden entfernt. Tipp: Vorher mit „Export“ sichern.'
                : 'Es ist das letzte Szenario – danach bleibt ein leeres Szenario übrig.',
            confirmLabel: 'Löschen',
            danger: true,
            anchor: e.currentTarget
        });
        if (!ok) return;
        const idx = store.scenarios.indexOf(sc);
        if (idx < 0) return;
        store.scenarios.splice(idx, 1);
        if (!store.scenarios.length) store.scenarios.push(createScenario('Neues Szenario'));
        store.activeId = store.scenarios[Math.max(0, idx - 1)].id;
        saveStore();
        renderAll();
    });

    initImportExport();

    document.getElementById('btnAddTop').addEventListener('click', () => {
        const sc = activeScenario();
        const node = createNode({ colorSlot: nextFreeSlot(sc.nodes) });
        sc.nodes.push(node);
        onChange('hard', { focus: node.id, selector: '.node-name' });
    });
}

/* ── Export / Import (JSON) und Bild ── */

function initImportExport() {
    document.getElementById('btnExport').addEventListener('click', () => {
        const sc = activeScenario();
        const json = JSON.stringify(scenarioToExport(sc), null, 2);
        downloadBlob(new Blob([json], { type: 'application/json' }), fileBaseName(sc) + '.json');
    });

    const file = document.getElementById('importFile');
    const btnImport = document.getElementById('btnImport');
    btnImport.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        file.value = '';   // gleiche Datei erneut wählbar
        if (!f) return;
        let imported;
        try {
            imported = scenariosFromImport(await f.text());
        } catch (err) {
            alertFlyover({ title: 'Import nicht möglich', message: err.message, anchor: btnImport });
            return;
        }
        // Als neue Szenarien anlegen – nichts Bestehendes wird überschrieben.
        imported.forEach(sc => {
            sc.name = uniqueScenarioName(sc.name.trim() || 'Importiert');
            store.scenarios.push(sc);
        });
        store.activeId = imported[0].id;
        saveStore();
        renderAll();
        alertFlyover({
            title: 'Import fertig',
            message: imported.length === 1
                ? 'Szenario „' + imported[0].name + '“ wurde hinzugefügt und ist jetzt ausgewählt.'
                : imported.length + ' Szenarien wurden hinzugefügt.',
            anchor: btnImport
        });
    });

    document.getElementById('btnShare').addEventListener('click', e => openShareImage(e.currentTarget));
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
    initStickyCharts();
});
