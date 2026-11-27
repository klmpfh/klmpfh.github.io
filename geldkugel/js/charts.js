/* Geldkugel – Diagramme eines Szenarios und Tooltip.
 *
 * Bilanz: oben eine Statuszeile (passt / reicht nicht), darunter zwei
 * gestapelte Balken im selben Maßstab – Einnahmen nach Kategorien und
 * Ausgaben nach Kategorien. Was von den Einnahmen übrig bleibt, ist im
 * Ausgabenbalken schraffiert („offen“); gehen die Ausgaben über die Einnahmen
 * hinaus, ist dieser Teil rot markiert („fehlt“).
 *
 * Geschichteter Donut: innen die Ausgaben-Kategorien, außen ihre Zahlungen,
 * alles als Monatsbetrag. Der volle Kreis sind die Einnahmen (bzw. die
 * Ausgaben, wenn die größer sind): Offenes ist schraffiert, ein Fehlbetrag eine
 * rote Kante außen. In der Mitte steht, was bleibt oder fehlt.
 * Die Legende darunter ist zugleich die Tabellenansicht der Ausgaben.
 * Die Diagramme des Vergleichs stehen in compare.js.
 */
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(k => el.setAttribute(k, attrs[k]));
    return el;
}

function arcPath(cx, cy, r1, r2, a0, a1) {
    if (a1 - a0 >= 2 * Math.PI - 1e-4) a1 = a0 + 2 * Math.PI - 1e-4;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => (cx + r * Math.sin(a)).toFixed(2) + ' ' + (cy - r * Math.cos(a)).toFixed(2);
    return 'M' + p(r2, a0) +
        ' A' + r2 + ' ' + r2 + ' 0 ' + large + ' 1 ' + p(r2, a1) +
        ' L' + p(r1, a1) +
        ' A' + r1 + ' ' + r1 + ' 0 ' + large + ' 0 ' + p(r1, a0) + ' Z';
}

/** Bezugsgröße für Prozentangaben: die Einnahmen, ohne Einnahmen die Ausgaben. */
function shareBase(sc) {
    return hasIncome(sc) ? incomeTotal(sc) : expenseTotal(sc);
}

function shareText(sc, value) {
    const base = shareBase(sc);
    if (base <= EPS) return '';
    return fmtPercent(value / base) + (hasIncome(sc) ? ' der Einnahmen' : '');
}

function tipPayment(sc, cat, p) {
    const m = monthly(p);
    const lines = [categoryName(cat) + ' › ' + paymentName(p), fmtEuro(m) + ' pro Monat' + (isIncome(cat) ? '' : ' · ' + shareText(sc, m))];
    if (p.interval !== 'month') lines.push(fmtPaymentOriginal(p) + ' (' + intervalExplain(p.interval) + ')');
    return lines.join('\n');
}

function tipCategory(sc, cat, sum, count) {
    const share = isIncome(cat) ? fmtPercent(sum / Math.max(incomeTotal(sc), EPS)) + ' der Einnahmen' : shareText(sc, sum);
    return [categoryName(cat) + (isIncome(cat) ? ' (Einnahmen)' : ''), fmtEuro(sum) + ' pro Monat' + (share ? ' · ' + share : ''),
        fmtEuro(sum * 12) + ' im Jahr · ' + count + (count === 1 ? ' Zahlung' : ' Zahlungen')].join('\n');
}

function tipOpen(sc, value) {
    return 'Offen\n' + fmtEuro(value) + ' pro Monat · ' + shareText(sc, value) + '\n' + fmtEuro(value * 12) + ' im Jahr';
}

function tipShort(value) {
    return 'Fehlt\n' + fmtEuro(value) + ' pro Monat mehr Ausgaben als Einnahmen\n' + fmtEuro(value * 12) + ' im Jahr';
}

/* ── Bilanz ── */

function renderBalance(el, sc, catColors) {
    el.textContent = '';
    const inc = incomeTotal(sc), exp = expenseTotal(sc), bal = inc - exp;

    const status = document.createElement('p');
    status.className = 'bal-status';
    const icon = document.createElement('span');
    icon.className = 'bal-icon';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    status.append(icon, text);
    const strong = t => { const s = document.createElement('strong'); s.textContent = t; return s; };

    if (inc <= EPS) {
        status.classList.add('is-none');
        icon.textContent = 'ℹ';
        text.append(strong('Noch keine Einnahmen. '),
            'Leg unten eine Einnahmen-Kategorie an (z. B. Gehalt) – dann sagt dir die Geldkugel, ob es reicht.');
    } else if (bal >= -0.5) {
        status.classList.add('is-ok');
        icon.textContent = '✓';
        if (bal < 0.5) {
            text.append(strong('Geht genau auf. '), 'Die Einnahmen decken alle Ausgaben, übrig bleibt aber nichts.');
        } else {
            text.append(strong('Passt. '), 'Nach allen Ausgaben bleiben ', strong(fmtEuro(bal) + ' im Monat'),
                ' offen – ' + fmtPercent(bal / inc) + ' der Einnahmen, ' + fmtEuroShort(bal * 12) + ' im Jahr.');
        }
    } else {
        status.classList.add('is-short');
        icon.textContent = '⚠';
        text.append(strong('Reicht nicht. '), 'Es fehlen ', strong(fmtEuro(-bal) + ' im Monat'),
            ' (' + fmtEuroShort(-bal * 12) + ' im Jahr) – die Ausgaben liegen ' + fmtPercent(-bal / inc) + ' über den Einnahmen.');
    }
    el.appendChild(status);

    const scale = Math.max(inc, exp, EPS);
    const pct = v => (v / scale * 100) + '%';
    const bars = document.createElement('div');
    bars.className = 'bal-bars';

    function barRow(label, value, kind) {
        const row = document.createElement('div');
        row.className = 'bal-row';
        const lbl = document.createElement('span');
        lbl.className = 'bal-label';
        lbl.textContent = label;
        const track = document.createElement('div');
        track.className = 'bal-track';
        const val = document.createElement('span');
        val.className = 'bal-value';
        val.textContent = fmtEuro(value);

        let x = 0;
        categoriesOf(kind).forEach(cat => {
            const sum = categoryTotal(sc, cat.id);
            if (sum <= EPS) return;
            const seg = document.createElement('div');
            seg.className = 'bal-seg';
            seg.style.left = pct(x);
            seg.style.width = 'max(1px, calc(' + pct(sum) + ' - 2px))';
            seg.style.background = catColors.get(cat.id);
            seg.dataset.cat = cat.id;
            seg.dataset.tip = tipCategory(sc, cat, sum, paymentsOf(sc, cat.id).filter(p => monthly(p) > EPS).length);
            track.appendChild(seg);
            x += sum;
        });
        row.append(lbl, track, val);
        bars.appendChild(row);
        return track;
    }

    if (inc > EPS) barRow('Einnahmen', inc, 'income');
    const expTrack = barRow('Ausgaben', exp, 'expense');

    if (inc > EPS && bal > EPS) {
        const open = document.createElement('div');
        open.className = 'bal-seg bal-open';
        open.style.left = pct(exp);
        open.style.width = 'calc(' + pct(bal) + ' - 2px)';
        open.dataset.tip = tipOpen(sc, bal);
        if (bal / scale >= 0.12) {
            const t = document.createElement('span');
            t.className = 'bal-seg-text';
            t.textContent = 'offen';
            open.appendChild(t);
        }
        expTrack.appendChild(open);
    } else if (inc > EPS && bal < -EPS) {
        const short = document.createElement('div');
        short.className = 'bal-seg bal-short';
        short.style.left = pct(inc);
        short.style.width = pct(-bal);
        short.dataset.tip = tipShort(-bal);
        if (-bal / scale >= 0.12) {
            const t = document.createElement('span');
            t.className = 'bal-seg-text';
            t.textContent = 'fehlt';
            short.appendChild(t);
        }
        expTrack.appendChild(short);
    }

    if (inc > EPS) {
        // Linie bei der Höhe der Einnahmen über beide Balken
        const line = document.createElement('div');
        line.className = 'bal-line';
        line.style.setProperty('--at', inc / scale);
        bars.appendChild(line);
    }

    bars.setAttribute('role', 'img');
    bars.setAttribute('aria-label', 'Einnahmen ' + fmtEuro(inc) + ', Ausgaben ' + fmtEuro(exp) +
        (inc > EPS ? (bal >= 0 ? ', offen ' + fmtEuro(bal) : ', es fehlen ' + fmtEuro(-bal)) : '') + ' pro Monat.');
    el.appendChild(bars);
}

/* ── Donut ── */

const DN = { C: 160, R0: 68, R1: 110, R2: 150, OVER: 158 };

function renderDonut(svg, sc, catColors, payColors) {
    const C = DN.C;
    svg.textContent = '';
    const inc = incomeTotal(sc), exp = expenseTotal(sc), bal = inc - exp;
    const ring = Math.max(inc, exp);

    const defs = svgEl('defs');
    const pat = svgEl('pattern', { id: 'gk-hatch-open', patternUnits: 'userSpaceOnUse', width: 7, height: 7, patternTransform: 'rotate(45)' });
    pat.appendChild(svgEl('rect', { width: 7, height: 7, class: 'hatch-open-bg' }));
    pat.appendChild(svgEl('rect', { width: 2, height: 7, class: 'hatch-open-line' }));
    defs.appendChild(pat);
    svg.appendChild(defs);

    const g = svgEl('g', { class: 'donut-segs' });
    svg.appendChild(g);

    if (ring <= EPS) {
        g.appendChild(svgEl('circle', { cx: C, cy: C, r: (DN.R0 + DN.R2) / 2, class: 'donut-empty', 'stroke-width': DN.R2 - DN.R0 }));
    } else {
        const perEuro = 2 * Math.PI / ring;
        let a = 0;
        categoriesOf('expense').forEach(cat => {
            const list = paymentsOf(sc, cat.id).filter(p => monthly(p) > EPS);
            const sum = list.reduce((s, p) => s + monthly(p), 0);
            if (sum <= EPS) return;
            const end = a + sum * perEuro;
            const seg = svgEl('path', { d: arcPath(C, C, DN.R0, DN.R1, a, end), class: 'seg', fill: catColors.get(cat.id) });
            seg.dataset.tip = tipCategory(sc, cat, sum, list.length);
            seg.dataset.cat = cat.id;
            g.appendChild(seg);

            let pa = a;
            list.forEach(p => {
                const pe = pa + monthly(p) * perEuro;
                const ps = svgEl('path', { d: arcPath(C, C, DN.R1, DN.R2, pa, pe), class: 'seg', fill: payColors.get(p.id) });
                ps.dataset.tip = tipPayment(sc, cat, p);
                ps.dataset.pay = p.id;
                g.appendChild(ps);
                pa = pe;
            });
            a = end;
        });

        if (inc > EPS && bal > EPS) {
            const open = svgEl('path', { d: arcPath(C, C, DN.R0, DN.R2, a, 2 * Math.PI), class: 'seg seg-open', fill: 'url(#gk-hatch-open)' });
            open.dataset.tip = tipOpen(sc, bal);
            g.appendChild(open);
        } else if (inc > EPS && bal < -EPS) {
            const over = svgEl('path', { d: arcPath(C, C, DN.R2 + 2, DN.OVER, inc * perEuro, 2 * Math.PI), class: 'seg seg-short' });
            over.dataset.tip = tipShort(-bal);
            g.appendChild(over);
        }
    }

    const texts = [];
    if (inc > EPS) {
        const short = bal < -0.5;
        texts.push([fmtEuroShort(Math.abs(bal)), 'dn-center-value' + (short ? ' is-short' : '')]);
        texts.push([short ? '⚠ fehlen im Monat' : 'bleiben im Monat', 'dn-center-label' + (short ? ' is-short' : '')]);
        texts.push(['von ' + fmtEuroShort(inc) + ' Einnahmen', 'dn-center-sub']);
    } else {
        texts.push([fmtEuroShort(exp), 'dn-center-value']);
        texts.push(['Ausgaben im Monat', 'dn-center-label']);
        texts.push([fmtEuroShort(exp * 12) + ' im Jahr', 'dn-center-sub']);
    }
    [C - 2, C + 17, C + 33].forEach((y, i) => {
        const t = svgEl('text', { x: C, y: y, class: texts[i][1], 'text-anchor': 'middle' });
        t.textContent = texts[i][0];
        svg.appendChild(t);
    });

    svg.setAttribute('aria-label', 'Ringdiagramm der Ausgaben: ' + fmtEuro(exp) + ' pro Monat' +
        (inc > EPS ? (bal >= 0 ? ', offen ' + fmtEuro(bal) : ', es fehlen ' + fmtEuro(-bal)) : '') +
        '. Innen nach Kategorien, außen nach Zahlungen.');
}

/* ── Legende ── */

function renderLegend(el, sc, catColors) {
    el.textContent = '';
    const exp = expenseTotal(sc), inc = incomeTotal(sc), bal = inc - exp;
    const list = document.createElement('ul');
    list.className = 'legend-list';

    function row(opts) {
        const li = document.createElement('li');
        if (opts.cls) li.className = opts.cls;
        if (opts.cat) li.dataset.cat = opts.cat;
        if (opts.tip) li.dataset.tip = opts.tip;
        const sw = document.createElement('span');
        sw.className = 'legend-swatch' + (opts.swatchClass ? ' ' + opts.swatchClass : '');
        if (opts.color) sw.style.background = opts.color;
        const nm = document.createElement('span');
        nm.className = 'legend-name';
        nm.textContent = opts.name;
        const val = document.createElement('span');
        val.className = 'legend-value';
        val.textContent = fmtEuro(opts.value);
        const pct = document.createElement('span');
        pct.className = 'legend-pct';
        const base = shareBase(sc);
        pct.textContent = opts.noPct || base <= EPS ? '' : fmtPercent(opts.value / base);
        li.append(sw, nm, val, pct);
        list.appendChild(li);
    }

    let shown = 0;
    categoriesOf('expense').forEach(cat => {
        const sum = categoryTotal(sc, cat.id);
        if (sum <= EPS) return;
        shown++;
        row({ cat: cat.id, color: catColors.get(cat.id), name: categoryName(cat), value: sum,
            tip: tipCategory(sc, cat, sum, paymentsOf(sc, cat.id).filter(p => monthly(p) > EPS).length) });
    });
    if (inc > EPS && bal > EPS) row({ swatchClass: 'swatch-open', name: 'Offen', value: bal, tip: tipOpen(sc, bal) });

    if (!shown && inc <= EPS) {
        const p = document.createElement('p');
        p.className = 'legend-empty';
        p.textContent = 'Die Kugel ist noch leer – trag rechts deine ersten Zahlungen ein.';
        el.appendChild(p);
        return;
    }

    row({ cls: 'legend-total', name: 'Ausgaben', value: exp, noPct: !inc });
    if (inc > EPS && bal < -EPS) row({ cls: 'legend-short', swatchClass: 'swatch-short', name: 'Fehlt', value: -bal, tip: tipShort(-bal) });
    el.appendChild(list);

    document.getElementById('donutKey').textContent = 'innen Kategorien · außen Zahlungen' + (inc > EPS ? ' · ganzer Kreis = Einnahmen' : '');
}

function renderCharts() {
    const sc = activeScenario();
    const catColors = categoryColors();
    const payColors = paymentColors(sc, catColors);
    renderBalance(document.getElementById('balance'), sc, catColors);
    renderDonut(document.getElementById('donut'), sc, catColors, payColors);
    renderLegend(document.getElementById('legend'), sc, catColors);
}

/* ── Tooltip & Klick auf Segmente ── */

function initTooltip(rootIds, onSelect) {
    const tip = document.getElementById('tooltip');
    let lastPointer = 'mouse';

    function show(target, x, y) {
        tip.textContent = '';
        target.dataset.tip.split('\n').forEach((line, i) => {
            const div = document.createElement('div');
            if (i === 0) div.className = 'tooltip-title';
            div.textContent = line;
            tip.appendChild(div);
        });
        tip.hidden = false;
        const pad = 14;
        const rect = tip.getBoundingClientRect();
        let left = x + pad, top = y + pad;
        if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
        if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
        tip.style.left = Math.max(8, left) + 'px';
        tip.style.top = Math.max(8, top) + 'px';
    }

    function hide() { tip.hidden = true; }

    rootIds.forEach(id => {
        const root = document.getElementById(id);
        root.addEventListener('pointermove', e => {
            lastPointer = e.pointerType;
            const t = e.target.closest('[data-tip]');
            if (t && root.contains(t)) show(t, e.clientX, e.clientY);
            else hide();
        });
        root.addEventListener('pointerdown', e => {
            lastPointer = e.pointerType;
            const t = e.target.closest('[data-tip]');
            if (t) show(t, e.clientX, e.clientY);
        });
        root.addEventListener('pointerleave', hide);
        root.addEventListener('click', e => {
            const t = e.target.closest('[data-cat], [data-pay]');
            // Auf Touch-Geräten zeigt ein Tippen nur den Tooltip, statt zur Eingabe zu springen.
            if (t && onSelect && lastPointer === 'mouse') onSelect(t.dataset.pay || t.dataset.cat);
        });
    });
    window.addEventListener('scroll', hide, { passive: true });
    document.addEventListener('pointerdown', e => {
        if (!e.target.closest('[data-tip]')) hide();
    });
}
