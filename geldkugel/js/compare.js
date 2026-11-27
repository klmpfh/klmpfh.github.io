/* Geldkugel – Vergleich zweier Szenarien („Deutung“).
 *
 * Gibt es in A oder B Einnahmen, geht es darum, was am Monatsende bleibt
 * (Bilanz = Einnahmen − Ausgaben). Ohne Einnahmen nur um die Ausgaben.
 * Farbe = Wirkung auf den Geldbeutel: rot = weniger übrig (Ausgabe steigt oder
 * Einnahme sinkt), blau = mehr übrig. Das Vorzeichen steht immer daneben.
 *
 * 1. Übergang (Wasserfall): oben der Stand von A (Bilanz bzw. Ausgaben),
 *    darunter je Kategorie die Änderung als schwebender Balken ab dem bisherigen
 *    Stand, unten der Stand von B. Alle Balken teilen sich einen Maßstab, der 0
 *    enthält; liegen alle Stände weit weg von 0, lässt sich ein Ausschnitt zeigen.
 * 2. Je Kategorie (Tabelle, zugleich Tabellenansicht des Wasserfalls): getrennt
 *    nach Einnahmen und Ausgaben die Beträge von A und B, die Differenz als Balken
 *    um eine Mittellinie (Maßstab = größte Änderung) und darunter, welche
 *    Zahlungen dazukommen, wegfallen oder sich ändern.
 * Sortiert ist nach der Größe der Änderung, Unverändertes steht gesammelt am Ende.
 */
'use strict';

function cmpEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function renderCompareBar() {
    ['cmpA', 'cmpB'].forEach(id => {
        const select = document.getElementById(id);
        select.textContent = '';
        store.scenarios.forEach(s => {
            const o = document.createElement('option');
            o.value = s.id;
            o.textContent = scenarioName(s);
            select.appendChild(o);
        });
    });
    document.getElementById('cmpA').value = store.compare.a;
    document.getElementById('cmpB').value = store.compare.b;
}

/** Wirkung einer Änderung auf das, was übrig bleibt. */
function effectOf(r) {
    return isIncome(r.cat) ? r.delta : -r.delta;
}

function effectClass(e) {
    return e > EPS ? 'is-better' : e < -EPS ? 'is-worse' : 'is-same';
}

/** "+240 € Ausgaben", "−200 € Einnahmen" */
function fmtKindDelta(r, short) {
    return fmtSigned(r.delta, short) + (isIncome(r.cat) ? ' Einnahmen' : ' Ausgaben');
}

/* ── Fazit und Kacheln ── */

function verdict(A, B, rows, withIncome) {
    const p = cmpEl('p', 'cmp-verdict');
    const text = t => p.appendChild(document.createTextNode(t));
    const strong = t => p.appendChild(cmpEl('strong', null, t));
    const nameA = '„' + scenarioName(A) + '“', nameB = '„' + scenarioName(B) + '“';
    text('Die Geldkugel sagt: Mit ' + nameB + ' ');

    if (withIncome) {
        const balA = balance(A), balB = balance(B), d = balB - balA;
        if (balB >= -0.5) {
            text('bleiben dir ');
            strong(fmtEuroShort(Math.max(0, balB)) + ' im Monat');
            text(' offen');
        } else {
            text('fehlen dir ');
            strong(fmtEuroShort(-balB) + ' im Monat');
            text(' – das reicht nicht');
        }
        if (Math.abs(d) < 0.5) {
            text(', genauso viel wie mit ' + nameA);
        } else {
            text(' – ' + fmtEuroShort(Math.abs(d)) + (d < 0 ? ' weniger' : ' mehr') + ' übrig als mit ' + nameA +
                ' (' + fmtSigned(d * 12, true) + ' im Jahr)');
        }
    } else {
        const d = expenseTotal(B) - expenseTotal(A);
        if (Math.abs(d) < 0.5) {
            text('bleibt dein Monat ungefähr so teuer wie mit ' + nameA);
        } else {
            text(d > 0 ? 'brauchst du ' : 'sparst du ');
            strong(fmtEuroShort(Math.abs(d)) + ' im Monat');
            text((d > 0 ? ' mehr' : '') + ' (' + fmtEuroShort(Math.abs(d) * 12) + ' im Jahr) als mit ' + nameA);
        }
    }

    const top = rows.find(r => Math.abs(r.delta) > EPS);
    if (top) {
        text('. Am meisten bewegt sich ');
        strong(categoryName(top.cat) + ' (' + fmtKindDelta(top, true) + ')');
    }
    text('.');
    return p;
}

function tile(label, value, sub, cls) {
    const t = cmpEl('div', 'cmp-tile' + (cls ? ' ' + cls : ''));
    t.append(cmpEl('span', 'cmp-tile-label', label), cmpEl('span', 'cmp-tile-value', value));
    if (sub) t.appendChild(cmpEl('span', 'cmp-tile-sub', sub));
    return t;
}

function scenarioTile(sc, withIncome) {
    if (!withIncome) {
        const exp = expenseTotal(sc);
        return tile(scenarioName(sc) + ' · Ausgaben', fmtEuro(exp), fmtEuroShort(exp * 12) + ' im Jahr');
    }
    const bal = balance(sc), short = bal < -0.5;
    return tile(scenarioName(sc) + (short ? ' · fehlt' : ' · bleibt'), (short ? '⚠ ' : '') + fmtEuro(Math.abs(bal)),
        'Einnahmen ' + fmtEuroShort(incomeTotal(sc)) + ' · Ausgaben ' + fmtEuroShort(expenseTotal(sc)), short ? 'is-short' : '');
}

/* ── Wasserfall ── */

// Ansichts-Vorliebe dieses Browsers, getrennt von den Daten.
const ZOOM_KEY = 'klmpfh-geldkugel-zoom';
let bridgeZoom = (() => { try { return localStorage.getItem(ZOOM_KEY) !== '0'; } catch (e) { return true; } })();

/** Glatte Zahl darunter: 1.342 → 1.300, 87 → 87. */
function niceFloor(v) {
    if (v <= 0) return 0;
    const step = Math.pow(10, Math.floor(Math.log10(v))) / 10;
    return Math.floor(v / step) * step;
}

/** Achsenbereich, der 0 enthält – oder, im Ausschnitt, knapp um die Werte herum. */
function bridgeDomain(values) {
    let lo = Math.min(0, ...values), hi = Math.max(0, ...values);
    let cutLo = false, cutHi = false;
    const min = Math.min(...values), max = Math.max(...values);
    if (bridgeZoom && min > 0 && min > hi * 0.4) {
        lo = niceFloor(min - (max - min) * 0.35);
        cutLo = lo > 0;
    } else if (bridgeZoom && max < 0 && -max > -lo * 0.4) {
        hi = -niceFloor(-max - (max - min) * 0.35);
        cutHi = hi < 0;
    }
    if (hi - lo < EPS) hi = lo + 1;
    return { lo: lo, hi: hi, cutLo: cutLo, cutHi: cutHi };
}

function renderBridge(A, B, rows, catColors, withIncome) {
    const wrap = cmpEl('div', 'bridge');
    wrap.setAttribute('role', 'img');

    const startVal = withIncome ? balance(A) : expenseTotal(A);
    const endVal = withIncome ? balance(B) : expenseTotal(B);
    const steps = [];
    let run = startVal;
    rows.forEach(r => {
        if (Math.abs(r.delta) <= EPS) return;
        const v = withIncome ? effectOf(r) : r.delta;
        steps.push({ r: r, v: v, from: run, to: run + v });
        run += v;
    });

    const dom = bridgeDomain([startVal, endVal].concat(...steps.map(s => [s.from, s.to])));
    const pos = v => (Math.min(dom.hi, Math.max(dom.lo, v)) - dom.lo) / (dom.hi - dom.lo) * 100;
    const fmtVal = v => withIncome ? fmtSigned(v, true) : fmtEuroShort(v);

    function row(label, swatch, from, to, value, cls, tip, isTotal) {
        const rowEl = cmpEl('div', 'br-row ' + cls);
        const lbl = cmpEl('span', 'br-label');
        if (swatch) {
            const sw = cmpEl('span', 'legend-swatch');
            sw.style.background = swatch;
            lbl.appendChild(sw);
        }
        lbl.appendChild(cmpEl('span', 'br-name', label));
        const track = cmpEl('div', 'br-track');
        if (dom.lo < 0 && dom.hi > 0) {
            const zero = cmpEl('span', 'br-zero');
            zero.style.left = pos(0) + '%';
            track.appendChild(zero);
        }
        const a = pos(Math.min(from, to)), b = pos(Math.max(from, to));
        let cut = '';
        if (isTotal && dom.cutLo && to > 0) cut = ' is-cut';
        if (isTotal && dom.cutHi && to < 0) cut = ' is-cut-right';
        const bar = cmpEl('div', 'br-bar' + cut);
        bar.style.left = a + '%';
        bar.style.width = 'max(2px, ' + (b - a) + '%)';
        bar.dataset.tip = tip;
        track.appendChild(bar);
        rowEl.append(lbl, track, cmpEl('span', 'br-value', value));
        wrap.appendChild(rowEl);
        return track;
    }

    function link(track, at) {
        const l = cmpEl('span', 'br-link');
        l.style.left = pos(at) + '%';
        track.appendChild(l);
    }

    function totalTip(sc) {
        if (!withIncome) return scenarioName(sc) + '\n' + fmtEuro(expenseTotal(sc)) + ' Ausgaben pro Monat';
        const bal = balance(sc);
        return scenarioName(sc) + '\nEinnahmen ' + fmtEuro(incomeTotal(sc)) + ' · Ausgaben ' + fmtEuro(expenseTotal(sc)) +
            '\n' + (bal < -EPS ? '⚠ fehlt ' + fmtEuro(-bal) : 'bleibt ' + fmtEuro(bal)) + ' pro Monat';
    }

    let track = row(scenarioName(A), null, 0, startVal, fmtVal(startVal), 'br-total', totalTip(A), true);
    link(track, startVal);
    steps.forEach(s => {
        const r = s.r, e = effectOf(r);
        const tip = [categoryName(r.cat) + (isIncome(r.cat) ? ' (Einnahmen)' : ' (Ausgaben)'),
            fmtEuro(r.a) + ' → ' + fmtEuro(r.b) + ' pro Monat',
            fmtKindDelta(r) + (r.a > EPS ? ' (' + fmtSignedPercent(r.delta / r.a) + ')' : ' (neu)')];
        if (withIncome) tip.push(fmtEuro(Math.abs(e)) + (e < 0 ? ' weniger' : ' mehr') + ' übrig · Stand danach: ' + fmtSigned(s.to));
        track = row(categoryName(r.cat), catColors.get(r.cat.id), s.from, s.to, fmtSigned(s.v, true),
            'br-step ' + effectClass(e), tip.join('\n'), false);
        link(track, s.to);
    });
    row(scenarioName(B), null, 0, endVal, fmtVal(endVal), 'br-total', totalTip(B), true);

    // Achse: Anfang, ggf. 0, Ende
    const axis = cmpEl('div', 'br-row br-axis');
    const ticks = cmpEl('div', 'br-ticks');
    function tick(v, prefix, cls) {
        const t = cmpEl('span', cls, prefix + fmtEuroShort(v));
        t.style.left = pos(v) + '%';
        ticks.appendChild(t);
    }
    tick(dom.lo, dom.cutLo ? 'ab ' : '', 'tick-start');
    if (dom.lo < 0 && dom.hi > 0) tick(0, '', 'tick-mid');
    tick(dom.hi, dom.cutHi ? 'bis ' : '', 'tick-end');
    axis.append(cmpEl('span'), ticks, cmpEl('span'));
    wrap.appendChild(axis);

    wrap.setAttribute('aria-label', 'Übergang von ' + scenarioName(A) + ' (' + fmtVal(startVal) + ') zu ' + scenarioName(B) +
        ' (' + fmtVal(endVal) + '): ' + steps.map(s => categoryName(s.r.cat) + ' ' + fmtSigned(s.v)).join(', ') + '.');
    return wrap;
}

/* ── Tabelle je Kategorie ── */

function changeLine(ch, income) {
    const li = cmpEl('li', 'chg chg-' + ch.kind);
    const p = ch.pb || ch.pa;
    const mark = ch.kind === 'new' ? '+' : ch.kind === 'gone' ? '−' : '→';
    li.appendChild(cmpEl('span', 'chg-mark', mark));
    li.appendChild(cmpEl('span', 'chg-name', paymentName(p)));

    const detail = cmpEl('span', 'chg-detail');
    if (ch.kind === 'new') {
        detail.textContent = 'kommt dazu: ' + fmtEuro(monthly(ch.pb)) + ' / Monat';
        if (ch.pb.interval !== 'month') detail.textContent += ' (' + fmtPaymentOriginal(ch.pb) + ')';
    } else if (ch.kind === 'gone') {
        detail.textContent = 'fällt weg: ' + fmtEuro(monthly(ch.pa)) + ' / Monat';
        if (ch.pa.interval !== 'month') detail.textContent += ' (' + fmtPaymentOriginal(ch.pa) + ')';
    } else {
        detail.textContent = fmtEuro(monthly(ch.pa)) + ' → ' + fmtEuro(monthly(ch.pb)) + ' / Monat';
        if (ch.pa.interval !== 'month' || ch.pb.interval !== 'month') {
            detail.textContent += ' (' + fmtPaymentOriginal(ch.pa) + ' → ' + fmtPaymentOriginal(ch.pb) + ')';
        }
    }
    li.appendChild(detail);
    const d = (ch.pb ? monthly(ch.pb) : 0) - (ch.pa ? monthly(ch.pa) : 0);
    li.appendChild(cmpEl('span', 'chg-delta ' + effectClass(income ? d : -d), fmtSigned(d)));
    return li;
}

function deltaCell(delta, base, effect, tip, maxAbs) {
    const td = cmpEl('td', 'col-delta');
    const cell = cmpEl('div', 'div-cell');
    const track = cmpEl('div', 'div-track');
    const bar = cmpEl('div', 'div-bar ' + effectClass(effect));
    const w = Math.abs(delta) / maxAbs * 50;
    bar.style.width = 'max(' + (Math.abs(delta) > EPS ? 2 : 0) + 'px, ' + w + '%)';
    if (delta < 0) bar.style.right = '50%'; else bar.style.left = '50%';
    bar.dataset.tip = tip;
    track.appendChild(bar);
    cell.append(track, cmpEl('span', 'div-value', fmtSigned(delta)),
        cmpEl('span', 'div-rel', base > EPS ? fmtSignedPercent(delta / base) : Math.abs(delta) > EPS ? 'neu' : ''));
    td.appendChild(cell);
    return td;
}

function totalCell(delta, base) {
    const td = cmpEl('td', 'col-delta');
    const cell = cmpEl('div', 'div-cell div-cell-total');
    cell.append(cmpEl('span', 'div-value', fmtSigned(delta)),
        cmpEl('span', 'div-rel', base > EPS ? fmtSignedPercent(delta / base) : ''));
    td.appendChild(cell);
    return td;
}

function renderTable(A, B, rows, catColors, withIncome) {
    const table = cmpEl('table', 'cmp-table');
    const head = cmpEl('thead');
    const hr = cmpEl('tr');
    [['Kategorie', ''], [scenarioName(A), 'num col-ab'], [scenarioName(B), 'num col-ab'], ['Differenz pro Monat', 'col-delta']].forEach(h => {
        const th = cmpEl('th', h[1], h[0]);
        th.scope = 'col';
        hr.appendChild(th);
    });
    head.appendChild(hr);
    table.appendChild(head);

    const maxAbs = Math.max(...rows.map(r => Math.abs(r.delta)), EPS);
    const body = cmpEl('tbody');

    ['income', 'expense'].forEach(kind => {
        const group = rows.filter(r => r.cat.kind === kind);
        if (!group.length) return;
        if (withIncome) {
            const tr = cmpEl('tr', 'cmp-group');
            const th = cmpEl('th', null, kind === 'income' ? 'Einnahmen' : 'Ausgaben');
            th.colSpan = 4;
            th.scope = 'colgroup';
            tr.appendChild(th);
            body.appendChild(tr);
        }
        const changed = group.filter(r => Math.abs(r.delta) > EPS || r.changes.length);
        changed.forEach(r => {
            const tr = cmpEl('tr', 'cmp-row');
            const name = cmpEl('th', 'cmp-cat');
            name.scope = 'row';
            const sw = cmpEl('span', 'legend-swatch');
            sw.style.background = catColors.get(r.cat.id);
            name.append(sw, document.createTextNode(categoryName(r.cat)));
            const tip = categoryName(r.cat) + '\n' + fmtEuro(r.a) + ' → ' + fmtEuro(r.b) + ' pro Monat\n' +
                fmtKindDelta(r) + ' · ' + fmtSigned(r.delta * 12) + ' im Jahr';
            tr.append(name, cmpEl('td', 'num col-ab', fmtEuro(r.a)), cmpEl('td', 'num col-ab', fmtEuro(r.b)),
                deltaCell(r.delta, r.a, effectOf(r), tip, maxAbs));
            body.appendChild(tr);

            if (r.changes.length) {
                const sub = cmpEl('tr', 'cmp-sub');
                const td = cmpEl('td');
                td.colSpan = 4;
                const ul = cmpEl('ul', 'chg-list');
                r.changes.forEach(ch => ul.appendChild(changeLine(ch, isIncome(r.cat))));
                td.appendChild(ul);
                sub.appendChild(td);
                body.appendChild(sub);
            }
        });
        const sameNames = group.filter(r => !changed.includes(r) && r.a > EPS).map(r => categoryName(r.cat));
        if (sameNames.length) {
            const tr = cmpEl('tr', 'cmp-same');
            const td = cmpEl('td', null, 'Unverändert: ' + sameNames.join(', '));
            td.colSpan = 4;
            tr.appendChild(td);
            body.appendChild(tr);
        }
    });
    table.appendChild(body);

    const foot = cmpEl('tfoot');
    function footRow(label, a, b, signed, cls) {
        const fr = cmpEl('tr', cls || '');
        const th = cmpEl('th', null, label);
        th.scope = 'row';
        const f = signed ? v => fmtSigned(v) : fmtEuro;
        fr.append(th, cmpEl('td', 'num col-ab', f(a)), cmpEl('td', 'num col-ab', f(b)), totalCell(b - a, signed ? 0 : a));
        foot.appendChild(fr);
    }
    if (withIncome) {
        footRow('Einnahmen', incomeTotal(A), incomeTotal(B), false, 'foot-sub');
        footRow('Ausgaben', expenseTotal(A), expenseTotal(B), false, 'foot-sub');
        footRow('Bleibt / fehlt', balance(A), balance(B), true, 'foot-main');
    } else {
        footRow('Ausgaben', expenseTotal(A), expenseTotal(B), false, 'foot-main');
    }
    table.appendChild(foot);
    return table;
}

/* ── Zusammenbau ── */

function renderCompare() {
    ensureCompare();
    renderCompareBar();
    const out = document.getElementById('compareOut');
    out.textContent = '';
    const A = scenarioById(store.compare.a), B = scenarioById(store.compare.b);

    if (store.scenarios.length < 2 || A === B) {
        out.appendChild(cmpEl('p', 'cmp-hint', store.scenarios.length < 2
            ? 'Für eine Deutung braucht es zwei Szenarien: Leg oben ein zweites an – am einfachsten mit „Duplizieren“ – und ändere dort, was anders werden soll.'
            : 'Wähle zwei verschiedene Szenarien.'));
        return;
    }

    const catColors = categoryColors();
    const withIncome = hasIncome(A) || hasIncome(B);
    const rows = compareScenarios(A, B)
        .filter(r => r.a > EPS || r.b > EPS || r.changes.length)
        .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

    out.appendChild(verdict(A, B, rows, withIncome));

    const d = withIncome ? balance(B) - balance(A) : expenseTotal(B) - expenseTotal(A);
    const effect = withIncome ? d : -d;
    const base = withIncome ? 0 : expenseTotal(A);
    const tiles = cmpEl('div', 'cmp-tiles');
    tiles.append(
        scenarioTile(A, withIncome),
        scenarioTile(B, withIncome),
        tile('Differenz', fmtSigned(d),
            (withIncome ? (Math.abs(d) < 0.5 ? 'gleich viel übrig' : d < 0 ? 'weniger übrig' : 'mehr übrig')
                : (base > EPS ? fmtSignedPercent(d / base) + ' Ausgaben' : 'Ausgaben')) + ' · ' + fmtSigned(d * 12, true) + ' im Jahr',
            'cmp-tile-delta ' + effectClass(effect))
    );
    out.appendChild(tiles);

    const grid = cmpEl('div', 'cmp-grid');
    const left = cmpEl('div', 'cmp-block');
    left.appendChild(cmpEl('h3', 'cmp-subtitle', withIncome ? 'Übergang – was am Monatsende bleibt' : 'Übergang – Ausgaben'));
    left.appendChild(renderBridge(A, B, rows, catColors, withIncome));
    const key = cmpEl('p', 'cmp-key');
    [['is-worse', withIncome ? 'weniger übrig' : 'teurer'], ['is-better', withIncome ? 'mehr übrig' : 'günstiger'],
        ['is-total', withIncome ? 'bleibt / fehlt' : 'Ausgaben']].forEach(k => {
        key.append(cmpEl('span', 'key-sw ' + k[0]), document.createTextNode(k[1]));
    });
    const zoom = cmpEl('label', 'cmp-zoom');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = bridgeZoom;
    box.addEventListener('change', () => {
        bridgeZoom = box.checked;
        try { localStorage.setItem(ZOOM_KEY, bridgeZoom ? '1' : '0'); } catch (e) { /* egal */ }
        renderCompare();
    });
    zoom.append(box, document.createTextNode('Ausschnitt vergrößern'));
    key.appendChild(zoom);
    left.appendChild(key);

    const right = cmpEl('div', 'cmp-block');
    right.appendChild(cmpEl('h3', 'cmp-subtitle', 'Was sich ändern muss'));
    right.appendChild(renderTable(A, B, rows, catColors, withIncome));

    grid.append(left, right);
    out.appendChild(grid);
}

function initCompare(onChange) {
    const a = document.getElementById('cmpA'), b = document.getElementById('cmpB');
    // Dasselbe Szenario auf beiden Seiten ergibt keinen Vergleich: dann tauschen.
    a.addEventListener('change', () => {
        const c = store.compare;
        if (a.value === c.b) c.b = c.a;
        c.a = a.value;
        onChange();
    });
    b.addEventListener('change', () => {
        const c = store.compare;
        if (b.value === c.a) c.a = c.b;
        c.b = b.value;
        onChange();
    });
    document.getElementById('cmpSwap').addEventListener('click', () => {
        const c = store.compare;
        const t = c.a; c.a = c.b; c.b = t;
        onChange();
    });
}
