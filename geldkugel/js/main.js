/* Geldkugel – Start, Szenario-Leiste, Export/Import und Zusammenspiel der Teile. */
'use strict';

function renderScenarioBar() {
    const sc = activeScenario();
    const select = document.getElementById('scenarioSelect');
    select.textContent = '';
    store.scenarios.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = scenarioName(s);
        select.appendChild(opt);
    });
    select.value = sc.id;

    const name = document.getElementById('scenarioName');
    if (document.activeElement !== name) name.value = sc.name;
}

function updateSummaries() {
    const sc = activeScenario();
    const n = sc.payments.length;
    document.getElementById('sumEditor').textContent = n + (n === 1 ? ' Zahlung' : ' Zahlungen') + ' in „' + scenarioName(sc) + '“';
    const inc = categoriesOf('income').length, exp = categoriesOf('expense').length, scs = store.scenarios.length;
    document.getElementById('globalSub').textContent = scs + (scs === 1 ? ' Szenario' : ' Szenarien') + ' · ' +
        inc + (inc === 1 ? ' Einnahmen-' : ' Einnahmen-') + ' und ' + exp + ' Ausgaben-Kategorie' + (exp === 1 ? '' : 'n');
    document.getElementById('btnCategories').textContent = 'Kategorien (' + store.categories.length + ')';
}

function renderAll() {
    renderScenarioBar();
    renderEditor();
    renderCharts();
    renderCompare();
    updateSummaries();
}

/**
 * Zentrale Rückmeldung nach jeder Änderung.
 * 'soft' = nur Werte geändert (Eingabe bleibt stehen, Fokus bleibt im Feld),
 * 'hard' = Struktur geändert (Eingabe neu aufbauen).
 */
function onChange(kind) {
    saveStore();
    if (kind === 'hard') renderEditor();
    else updateEditorNumbers();
    renderCharts();
    renderCompare();
    updateSummaries();
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
        if (opt) opt.textContent = scenarioName(activeScenario());
        renderCompare();
        updateSummaries();
    });

    document.getElementById('btnNew').addEventListener('click', () => {
        const sc = createScenario(uniqueScenarioName('Neues Szenario'));
        store.scenarios.push(sc);
        store.activeId = sc.id;
        ensureCompare();
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
            name: uniqueScenarioName(scenarioName(src) + ' (Kopie)'),
            payments: src.payments.map(p => Object.assign({}, p, { id: uid() }))
        };
        store.scenarios.splice(store.scenarios.indexOf(src) + 1, 0, copy);
        store.activeId = copy.id;
        // Frisch dupliziert = meist „was wäre, wenn“: gleich gegen das Original vergleichen.
        store.compare = { a: src.id, b: copy.id };
        saveStore();
        renderAll();
        const name = document.getElementById('scenarioName');
        name.focus();
        name.select();
    });

    document.getElementById('btnDel').addEventListener('click', async e => {
        const sc = activeScenario();
        const ok = await confirmFlyover({
            title: 'Szenario „' + scenarioName(sc) + '“ löschen?',
            message: (store.scenarios.length > 1
                ? 'Alle Zahlungen dieses Szenarios werden entfernt, die Kategorien bleiben.'
                : 'Es ist das letzte Szenario – danach bleibt ein leeres Szenario übrig, die Kategorien bleiben.') +
                ' Tipp: Vorher mit „Export“ sichern.',
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
        ensureCompare();
        saveStore();
        renderAll();
    });
}

/* ── Export / Import (JSON) ── */

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initImportExport() {
    document.getElementById('btnExport').addEventListener('click', () => {
        const json = JSON.stringify(storeToExport(), null, 2);
        const day = new Date().toISOString().slice(0, 10);
        downloadBlob(new Blob([json], { type: 'application/json' }), 'geldkugel-' + day + '.json');
    });

    const file = document.getElementById('importFile');
    const btnImport = document.getElementById('btnImport');
    btnImport.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        file.value = '';   // gleiche Datei erneut wählbar
        if (!f) return;
        let imp;
        try {
            imp = readImport(await f.text());
        } catch (err) {
            alertFlyover({ title: 'Import nicht möglich', message: err.message, anchor: btnImport });
            return;
        }
        const n = imp.scenarios.length;
        const choice = await openFlyover({
            title: 'Import: ' + n + (n === 1 ? ' Szenario' : ' Szenarien') + ', ' + imp.categories.length + ' Kategorien',
            message: '„Hinzufügen“ behält alles Bisherige; Kategorien mit gleichem Namen werden zusammengelegt. ' +
                '„Alles ersetzen“ übernimmt genau den Stand aus der Datei.',
            anchor: btnImport,
            buttons: [
                { label: 'Abbrechen', value: null, kind: 'ghost' },
                { label: 'Alles ersetzen', value: 'replace', kind: 'ghost' },
                { label: 'Hinzufügen', value: 'add', kind: 'primary', autofocus: true }
            ]
        });
        if (!choice) return;
        if (choice === 'replace') {
            replaceWithImported(imp);
        } else {
            const added = addImported(imp);
            store.activeId = added[0].id;
            ensureCompare();
        }
        saveStore();
        renderAll();
    });
}

/* ── Mitlaufende Diagramme (wie im Zeitfresser) ──
 * Passen die Diagramme ins Fenster, reicht position: sticky aus style.css.
 * Sind sie höher, scrollen sie mit der Seite mit, bis ihr unterer bzw. oberer
 * Rand erreicht ist, und bleiben dort stehen. */

const ONE_COLUMN_MQ = '(max-width: 980px)';

function initStickyCharts() {
    const panel = document.querySelector('.chart-panel');
    const layout = panel.parentElement;
    const mq = window.matchMedia(ONE_COLUMN_MQ);
    let lastY = window.scrollY;

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
            if (dy > 0 ? held <= lim.min : held >= lim.max) return;
            const shift = panel.getBoundingClientRect().top - layout.getBoundingClientRect().top - dy;
            const room = Math.max(0, layout.offsetHeight - panel.offsetHeight);
            panel.style.position = 'relative';
            panel.style.top = Math.min(room, Math.max(0, shift)) + 'px';
        }
        const top = panel.getBoundingClientRect().top;
        if (dy > 0 && top <= lim.min) stick(lim.min);
        else if (dy < 0 && top >= lim.max) stick(lim.max);
    }

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

/* Diagrammfarben hängen vom Hell/Dunkel-Design ab → bei Wechsel neu zeichnen. */
function watchTheme() {
    const rerender = () => { renderEditor(); renderCharts(); renderCompare(); };
    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (mq.addEventListener) mq.addEventListener('change', rerender);
    }
    new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/* In einem anderen Tab geändert: übernehmen, sonst überschreibt dieser Tab es beim nächsten Speichern. */
function watchOtherTabs() {
    window.addEventListener('storage', e => {
        if (e.key !== STORE_KEY || !e.newValue) return;
        const activeId = store.activeId;
        if (document.activeElement) document.activeElement.blur();
        loadStore();
        if (scenarioById(activeId)) store.activeId = activeId;
        renderAll();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    loadStore();
    saveStore();
    initScenarioBar();
    initImportExport();
    initEditor(onChange);
    initCategories(onChange);
    initCompare(() => { saveStore(); renderCompare(); });
    initTooltip(['balance', 'donut', 'legend'], revealItem);
    initTooltip(['compareOut'], null);
    watchTheme();
    renderAll();
    initStickyCharts();
    watchOtherTabs();
    initTransfer();
    initAiImport();
});
