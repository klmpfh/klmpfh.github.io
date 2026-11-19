/* Zeitfresser – Diagramme.
 *
 * 1. Gestapelte Balken: eine Zeile für die ganze Woche, darunter je
 *    Wochentag, jeweils mit verplanter und freier Zeit. Gezeigt werden die
 *    "Blätter" (Punkte ohne Unterpunkte).
 * 2. Kreisdiagramm mit Ringen (Sunburst) für die ganze Woche: innen die
 *    Themen, außen ihre Unterpunkte.
 *
 * Ein Thema mit Unterpunkten ist immer genau so groß wie die Summe seiner
 * Unterpunkte (siehe weeklyHours in state.js) – der äußere Ring füllt den
 * inneren also stets vollständig aus.
 * Schraffiert grau = nicht verplante Zeit der Woche/des Tages ("frei").
 * Ist die Woche bzw. ein Tag überbucht, pulsieren die roten Markierungen
 * dauerhaft (CSS-Animationen in style.css), solange der Fehler besteht.
 *
 * Tages-Logik: Ein Blatt verteilt seinen Wochenwert gleichmäßig auf seine
 * Wochentage.
 *
 * Die Berechnung (computeDayRows, computeSunburst) ist von der Darstellung
 * getrennt, damit share.js dieselben Daten für das Bild nutzen kann.
 */
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(k => el.setAttribute(k, attrs[k]));
    return el;
}

function nodeLabel(path, node) {
    const name = node.name.trim() || 'Ohne Namen';
    return path ? path + ' › ' + name : name;
}

/* ── Tooltip-Texte ── */

function tipNode(label, node, ref) {
    const w = weeklyHours(node);
    const lines = [
        label,
        fmtHours(w) + ' pro Woche · ' + fmtPercent(w / ref) + ' der Woche',
        fmtHours(w / dayCount(node)) + ' pro Tag · ' + fmtDays(node.days)
    ];
    if (node.children.length) lines.push('Summe aus ' + node.children.length + ' Unterpunkt' + (node.children.length === 1 ? '' : 'en'));
    return lines.join('\n');
}

function tipFree(hours, ref, unit) {
    return 'Frei / nicht verplant\n' + fmtHours(hours) + ' · ' + fmtPercent(hours / ref) + ' ' + unit;
}

/* ── Balken je Tag: Daten ── */

/** Segmente (Blätter) eines Tages (day = 0..6) bzw. der Woche (day = null). */
function collectSegments(nodes, day, colors, path, out) {
    nodes.forEach(node => {
        const w = weeklyHours(node);
        if (w <= EPS) return;
        const label = nodeLabel(path, node);
        if (node.children.length) {
            collectSegments(node.children, day, colors, label, out);
            return;
        }
        const hours = day == null ? w : (node.days[day] ? w / dayCount(node) : 0);
        if (hours > EPS) out.push({ id: node.id, hours: hours, color: colors.get(node.id), label: label });
    });
    return out;
}

/** Zeile "Woche" plus je eine Zeile pro Wochentag, mit Summe und freier Zeit. */
function computeDayRows(sc, colors) {
    const rows = [{ day: null, short: 'Woche', long: 'der Woche', ref: weekRef(sc) }];
    for (let d = 0; d < 7; d++) rows.push({ day: d, short: DAY_SHORT[d], long: 'am ' + DAY_LONG[d], ref: sc.hoursPerDay });
    rows.forEach(r => {
        r.segs = collectSegments(sc.nodes, r.day, colors, '', []);
        r.total = r.segs.reduce((s, x) => s + x.hours, 0);
        r.free = r.ref - r.total;          // negativ = überbucht
        r.over = r.free < -EPS;
    });
    return rows;
}

function renderDays(el, sc, colors) {
    el.textContent = '';

    const head = document.createElement('div');
    head.className = 'day-row day-head';
    head.append(document.createElement('span'), document.createElement('span'));
    [['day-sum', 'verplant'], ['day-free', 'frei']].forEach(c => {
        const s = document.createElement('span');
        s.className = c[0];
        s.textContent = c[1];
        head.appendChild(s);
    });
    el.appendChild(head);

    computeDayRows(sc, colors).forEach(r => {
        const span = Math.max(r.total, r.ref);

        const rowEl = document.createElement('div');
        rowEl.className = 'day-row' + (r.day == null ? ' day-row-week' : '');

        const lbl = document.createElement('span');
        lbl.className = 'day-label';
        lbl.textContent = r.short;
        lbl.title = r.day == null ? 'ganze Woche' : DAY_LONG[r.day];

        const bar = document.createElement('div');
        bar.className = 'day-bar';
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', (r.day == null ? 'Woche' : DAY_LONG[r.day]) + ': ' +
            r.segs.map(s => s.label + ' ' + fmtHours(s.hours)).join(', ') +
            (r.free > EPS ? ', frei ' + fmtHours(r.free) : ''));

        r.segs.forEach(s => {
            const seg = document.createElement('div');
            seg.className = 'seg day-seg';
            seg.style.flexGrow = s.hours;
            seg.dataset.id = s.id;
            seg.style.background = s.color;
            seg.dataset.tip = s.label + '\n' + fmtHours(s.hours) + ' ' + r.long + ' · ' + fmtPercent(s.hours / r.ref);
            if (s.hours / span >= 0.11) {
                const t = document.createElement('span');
                t.className = 'seg-text';
                t.style.color = textOn(s.color);
                t.textContent = fmtShort(s.hours);
                seg.appendChild(t);
            }
            bar.appendChild(seg);
        });

        if (r.free > EPS) {
            const freeSeg = document.createElement('div');
            freeSeg.className = 'seg day-seg seg-free';
            freeSeg.style.flexGrow = r.free;
            freeSeg.dataset.tip = tipFree(r.free, r.ref, r.day == null ? 'der Woche' : 'des Tages');
            bar.appendChild(freeSeg);
        }

        const sum = document.createElement('span');
        sum.className = 'day-sum';
        sum.textContent = fmtShort(r.total) + ' h';
        sum.title = fmtHours(r.total) + ' von ' + fmtHours(r.ref) + ' verplant';

        const free = document.createElement('span');
        free.className = 'day-free';
        if (r.over) {
            bar.classList.add('is-over');
            free.classList.add('is-over');
            free.textContent = '⚠ −' + fmtShort(-r.free) + ' h';
            free.title = fmtHours(-r.free) + ' mehr verplant, als ' + (r.day == null ? 'die Woche' : 'der Tag') + ' hat (' + fmtHours(r.ref) + ')';
        } else {
            free.textContent = fmtShort(Math.max(0, r.free)) + ' h';
            free.title = fmtHours(Math.max(0, r.free)) + ' frei · ' + fmtPercent(Math.max(0, r.free) / r.ref);
        }

        rowEl.append(lbl, bar, sum, free);
        el.appendChild(rowEl);
    });
}

/* ── Kreisdiagramm ── */

const SB = { C: 160, R0: 64, RMAX: 157 };

function arcPath(cx, cy, r1, r2, a0, a1) {
    if (a1 - a0 >= 2 * Math.PI - 1e-4) a1 = a0 + 2 * Math.PI - 1e-4;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => (cx + r * Math.sin(a)).toFixed(2) + ' ' + (cy - r * Math.cos(a)).toFixed(2);
    return 'M' + p(r2, a0) +
        ' A' + r2 + ' ' + r2 + ' 0 ' + large + ' 1 ' + p(r2, a1) +
        ' L' + p(r1, a1) +
        ' A' + r1 + ' ' + r1 + ' 0 ' + large + ' 0 ' + p(r1, a0) + ' Z';
}

/** Ringsegmente im Koordinatensystem 0..320 (Mittelpunkt SB.C).
 *  color = null kennzeichnet "frei". */
function computeSunburst(sc, colors) {
    const ref = weekRef(sc);
    const total = sumWeekly(sc.nodes);
    const depth = Math.max(1, treeDepth(sc.nodes));
    const ring = Math.min(48, (SB.RMAX - SB.R0) / depth);
    const perHour = 2 * Math.PI / Math.max(ref, total, EPS);
    const arcs = [];

    function level(list, a, d, path) {
        list.forEach(node => {
            const w = weeklyHours(node);
            if (w <= EPS) return;
            const label = nodeLabel(path, node);
            const r1 = SB.R0 + d * ring;
            arcs.push({ r1: r1, r2: r1 + ring, a0: a, a1: a + w * perHour, color: colors.get(node.id), id: node.id, tip: tipNode(label, node, ref) });
            if (node.children.length) level(node.children, a, d + 1, label);
            a += w * perHour;
        });
        return a;
    }

    const end = level(sc.nodes, 0, 0, '');
    if (ref - total > EPS) {
        arcs.push({ r1: SB.R0, r2: SB.R0 + ring, a0: end, a1: 2 * Math.PI, color: null, id: null, tip: tipFree(ref - total, ref, 'der Woche') });
    }
    return { arcs: arcs.filter(x => x.a1 - x.a0 >= 1e-4), total: total, ref: ref };
}

function renderSunburst(svg, sc, colors) {
    const C = SB.C;
    svg.textContent = '';
    const data = computeSunburst(sc, colors);

    const defs = svgEl('defs');
    const pat = svgEl('pattern', { id: 'zf-hatch-free', patternUnits: 'userSpaceOnUse', width: 7, height: 7, patternTransform: 'rotate(45)' });
    pat.appendChild(svgEl('rect', { width: 7, height: 7, class: 'hatch-free-bg' }));
    pat.appendChild(svgEl('rect', { width: 2, height: 7, class: 'hatch-free-line' }));
    defs.appendChild(pat);
    svg.appendChild(defs);

    const g = svgEl('g', { class: 'sunburst-segs' });
    svg.appendChild(g);
    data.arcs.forEach(a => {
        const path = svgEl('path', { d: arcPath(C, C, a.r1, a.r2, a.a0, a.a1), class: 'seg' });
        path.setAttribute('fill', a.color || 'url(#zf-hatch-free)');
        path.dataset.tip = a.tip;
        if (a.id) path.dataset.id = a.id;
        g.appendChild(path);
    });

    // Mitte: verplante Stunden
    const big = svgEl('text', { x: C, y: C - 4, class: 'sb-center-value', 'text-anchor': 'middle' });
    big.textContent = fmtHours(data.total);
    const small = svgEl('text', { x: C, y: C + 16, class: 'sb-center-label', 'text-anchor': 'middle' });
    small.textContent = 'von ' + fmtHours(data.ref);
    svg.appendChild(big);
    svg.appendChild(small);
    if (data.total - data.ref > EPS) {
        // Woche überbucht: pulsierender roter Ring innen am Diagramm
        svg.appendChild(svgEl('circle', { cx: C, cy: C, r: SB.R0 - 6, class: 'sb-over-ring' }));
        const warn = svgEl('text', { x: C, y: C + 33, class: 'sb-center-warn', 'text-anchor': 'middle' });
        warn.textContent = '⚠ ' + fmtHours(data.total - data.ref) + ' zu viel';
        svg.appendChild(warn);
    }

    svg.setAttribute('aria-label', 'Kreisdiagramm der Woche: ' + fmtHours(data.total) + ' von ' + fmtHours(data.ref) + ' verplant.');
}

/* ── Legende (dient zugleich als Tabellenansicht der obersten Ebene) ── */

function renderLegend(el, sc, colors) {
    el.textContent = '';
    const ref = weekRef(sc);
    const total = sumWeekly(sc.nodes);

    const list = document.createElement('ul');
    list.className = 'legend-list';
    function row(swatchStyle, swatchClass, name, hours, id) {
        const li = document.createElement('li');
        if (id) li.dataset.id = id;
        const sw = document.createElement('span');
        sw.className = 'legend-swatch ' + (swatchClass || '');
        if (swatchStyle) sw.style.cssText = swatchStyle;
        const nm = document.createElement('span');
        nm.className = 'legend-name';
        nm.textContent = name;
        const val = document.createElement('span');
        val.className = 'legend-value';
        val.textContent = fmtHours(hours);
        const pct = document.createElement('span');
        pct.className = 'legend-pct';
        pct.textContent = fmtPercent(hours / ref);
        li.append(sw, nm, val, pct);
        list.appendChild(li);
    }

    sc.nodes.forEach(n => {
        const w = weeklyHours(n);
        if (w <= EPS) return;
        row('background:' + colors.get(n.id), '', n.name.trim() || 'Ohne Namen', w, n.id);
    });
    if (ref - total > EPS) row(null, 'swatch-free', 'Frei / nicht verplant', ref - total, null);
    el.appendChild(list);

    if (total - ref > EPS) {
        const warn = document.createElement('p');
        warn.className = 'legend-warn';
        warn.textContent = '⚠ Zusammen ' + fmtHours(total) + ' – das sind ' + fmtHours(total - ref) +
            ' mehr, als die Woche hat (' + fmtHours(ref) + ').';
        el.appendChild(warn);
    }
}

function renderCharts() {
    const sc = activeScenario();
    const colors = computeColors(sc);
    renderDays(document.getElementById('days'), sc, colors);
    renderSunburst(document.getElementById('sunburst'), sc, colors);
    renderLegend(document.getElementById('legend'), sc, colors);
}

/* ── Tooltip & Klick auf Segmente ── */

function initChartInteraction(onSelect) {
    const tip = document.getElementById('tooltip');
    let lastPointer = 'mouse';

    function show(target, x, y) {
        const text = target.dataset.tip;
        tip.textContent = '';
        text.split('\n').forEach((line, i) => {
            const div = document.createElement('div');
            if (i === 0) div.className = 'tooltip-title';
            else if (line.charAt(0) === '⚠') div.className = 'tooltip-warn';
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

    ['sunburst', 'days', 'legend'].forEach(id => {
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
            const t = e.target.closest('[data-id]');
            // Auf Touch-Geräten zeigt ein Tippen nur den Tooltip, statt zur Eingabe zu springen.
            if (t && lastPointer === 'mouse') onSelect(t.dataset.id);
        });
    });
    window.addEventListener('scroll', hide, { passive: true });
    document.addEventListener('pointerdown', e => {
        if (!e.target.closest('[data-tip]')) hide();
    });
}
