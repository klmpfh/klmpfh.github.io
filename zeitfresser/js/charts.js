/* Zeitfresser – Diagramme.
 *
 * 1. Gestapelte Balken: eine Zeile für die ganze Woche, darunter je
 *    Wochentag, jeweils mit verplanter und freier Zeit. Gezeigt werden die
 *    "Blätter" (Punkte ohne Unterpunkte).
 * 2. Kreisdiagramm mit Ringen (Sunburst) für die ganze Woche: innen die
 *    Themen, außen ihre Unterpunkte.
 *
 * Schraffiert = Zeit, die ein Thema hat, seine Unterpunkte aber nicht
 * abdecken ("nicht zugeordnet", in der Farbe des Themas), bzw. nicht
 * verplante Zeit der Woche/des Tages ("frei", grau).
 * Ergeben Unterpunkte mehr als das Thema selbst, werden sie in der Grafik
 * auf die Größe des Themas gestaucht und rot markiert. Alle roten
 * Markierungen pulsieren dauerhaft (CSS-Animationen in style.css), solange
 * der Fehler besteht.
 *
 * Tages-Logik: Ein Blatt verteilt seinen Wochenwert gleichmäßig auf seine
 * Wochentage. Ein Thema mit Unterpunkten besteht an einem Tag aus seinen
 * Unterpunkten plus seinem nicht zugeordneten Rest, der sich gleichmäßig
 * auf die Tage des Themas verteilt – so bleibt die Wochensumme gleich, auch
 * wenn ein Unterpunkt nur an einzelnen Tagen stattfindet.
 *
 * Maßstab: Alle Zeilen teilen sich denselben, damit dieselbe Stundenzahl an
 * jedem Tag gleich lang ist. Ist ein Tag überbucht, werden deshalb alle
 * Zeilen entsprechend kürzer, statt nur diesen Tag zu stauchen.
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

function tipNode(label, node, ref, scaledBy) {
    const w = weeklyHours(node);
    const lines = [
        label,
        fmtHours(w) + ' pro Woche · ' + fmtPercent(w / ref) + ' der Woche',
        fmtHours(w / dayCount(node)) + ' pro Tag · ' + fmtDays(node.days)
    ];
    if (scaledBy) lines.push(tipScaled(scaledBy));
    return lines.join('\n');
}

function tipScaled(scaledBy) {
    return '⚠ Unterpunkte von „' + scaledBy + '“ ergeben mehr als das Thema selbst – hier gestaucht dargestellt.';
}

function tipRest(label, hours, ref, unit) {
    return label + ' – nicht zugeordnet\n' + fmtHours(hours) + ' ' + unit + ' · ' + fmtPercent(hours / ref);
}

function tipFree(hours, ref, unit) {
    return 'Frei / nicht verplant\n' + fmtHours(hours) + ' · ' + fmtPercent(hours / ref) + ' ' + unit;
}

/* ── Balken je Tag: Daten ── */

/** Segmente eines Tages (day = 0..6) bzw. der Woche (day = null): Blätter
 *  (kind 'node') und nicht zugeordnete Reste von Themen (kind 'rest').
 *  hours = Breite in der Grafik (ggf. gestaucht), real = tatsächliche Stunden. */
function collectSegments(nodes, day, colors, path, out, scale, scaledBy) {
    scale = scale == null ? 1 : scale;
    nodes.forEach(node => {
        const w = weeklyHours(node);
        if (w <= EPS) return;
        const label = nodeLabel(path, node);
        const n = dayCount(node);
        const color = colors.get(node.id);

        if (!node.children.length) {
            const real = day == null ? w : (node.days[day] ? w / n : 0);
            if (real > EPS) out.push({ id: node.id, kind: 'node', hours: real * scale, real: real, color: color, label: label, scaledBy: scaledBy || null });
            return;
        }

        const cs = sumWeekly(node.children);
        const over = cs > w + EPS;
        collectSegments(node.children, day, colors, label, out, over ? scale * w / cs : scale,
            over ? (node.name.trim() || 'Ohne Namen') : scaledBy);
        if (w - cs > EPS) {
            const rest = w - cs;
            const real = day == null ? rest : (node.days[day] ? rest / n : 0);
            if (real > EPS) out.push({ id: node.id, kind: 'rest', hours: real * scale, real: real, color: color, label: label });
        }
    });
    return out;
}

/** Zeile "Woche" plus je eine Zeile pro Wochentag, mit Summe und freier Zeit.
 *  full = Stunden, die der vollen Breite entsprechen: für alle Tage gleich, für
 *  die Woche das Siebenfache. */
function computeDayRows(sc, colors) {
    const rows = [{ day: null, short: 'Woche', long: 'der Woche', ref: weekRef(sc) }];
    for (let d = 0; d < 7; d++) rows.push({ day: d, short: DAY_SHORT[d], long: 'am ' + DAY_LONG[d], ref: sc.hoursPerDay });
    rows.forEach(r => {
        r.segs = collectSegments(sc.nodes, r.day, colors, '', []);
        r.total = r.segs.reduce((s, x) => s + x.hours, 0);
        r.free = r.ref - r.total;          // negativ = überbucht
        r.over = r.free < -EPS;
    });
    const stretch = Math.max.apply(null, rows.map(r => r.total / r.ref).concat(1));
    rows.forEach(r => { r.full = r.ref * stretch; });
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
        let start = 0;

        // Feste Prozente statt flex-grow: Dort hinge die Länge davon ab, wie viele
        // Segmente (und Lücken) sich eine Zeile teilen.
        function place(seg, hours) {
            seg.style.left = (start / span * 100) + '%';
            seg.style.width = 'max(1px, calc(' + (hours / span * 100) + '% - 1px))';
            start += hours;
        }

        const rowEl = document.createElement('div');
        rowEl.className = 'day-row' + (r.day == null ? ' day-row-week' : '');

        const lbl = document.createElement('span');
        lbl.className = 'day-label';
        lbl.textContent = r.short;
        lbl.title = r.day == null ? 'ganze Woche' : DAY_LONG[r.day];

        const bar = document.createElement('div');
        bar.className = 'day-bar';
        bar.style.width = (span / r.full * 100) + '%';
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', (r.day == null ? 'Woche' : DAY_LONG[r.day]) + ': ' +
            r.segs.map(s => s.label + (s.kind === 'rest' ? ' (nicht zugeordnet) ' : ' ') + fmtHours(s.real)).join(', ') +
            (r.free > EPS ? ', frei ' + fmtHours(r.free) : ''));

        r.segs.forEach(s => {
            const seg = document.createElement('div');
            seg.className = 'seg day-seg';
            place(seg, s.hours);
            seg.dataset.id = s.id;
            if (s.kind === 'rest') {
                seg.classList.add('seg-rest');
                seg.style.background = 'repeating-linear-gradient(135deg, ' + s.color + ' 0 2px, ' + rgbaFromHex(s.color, 0.16) + ' 2px 7px)';
                seg.dataset.tip = tipRest(s.label, s.real, r.ref, r.long);
            } else {
                seg.style.background = s.color;
                const tipLines = [s.label, fmtHours(s.real) + ' ' + r.long + ' · ' + fmtPercent(s.real / r.ref)];
                if (s.scaledBy) {
                    seg.classList.add('seg-scaled');
                    tipLines.push(tipScaled(s.scaledBy));
                }
                seg.dataset.tip = tipLines.join('\n');
                if (s.hours / r.full >= 0.11) {
                    const t = document.createElement('span');
                    t.className = 'seg-text';
                    t.style.color = textOn(s.color);
                    t.textContent = fmtShort(s.real);
                    seg.appendChild(t);
                }
            }
            bar.appendChild(seg);
        });

        if (r.free > EPS) {
            const freeSeg = document.createElement('div');
            freeSeg.className = 'seg day-seg seg-free';
            place(freeSeg, r.free);
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
 *  kind: 'node' | 'rest' (nicht zugeordnet, schraffiert in color) |
 *  'over' (rote Kante: Unterpunkte zu groß) | 'free' (color = null). */
function computeSunburst(sc, colors) {
    const ref = weekRef(sc);
    const total = sumWeekly(sc.nodes);
    const depth = Math.max(1, treeDepth(sc.nodes));
    const ring = Math.min(48, (SB.RMAX - SB.R0) / depth);
    const perHour = 2 * Math.PI / Math.max(ref, total, EPS);
    const arcs = [];

    function level(list, a, hourAngle, d, path, scaledBy) {
        list.forEach(node => {
            const w = weeklyHours(node);
            if (w <= EPS) return;
            const label = nodeLabel(path, node);
            const ang = w * hourAngle;
            const r1 = SB.R0 + d * ring;
            const color = colors.get(node.id);
            arcs.push({ kind: 'node', r1: r1, r2: r1 + ring, a0: a, a1: a + ang, color: color, id: node.id, tip: tipNode(label, node, ref, scaledBy) });

            if (node.children.length) {
                const cs = sumWeekly(node.children);
                const over = cs > w + EPS;
                level(node.children, a, over ? hourAngle * w / cs : hourAngle, d + 1, label,
                    over ? (node.name.trim() || 'Ohne Namen') : scaledBy);
                if (w - cs > EPS) {
                    arcs.push({ kind: 'rest', r1: r1 + ring, r2: r1 + 2 * ring, a0: a + cs * hourAngle, a1: a + ang,
                        color: color, id: node.id, tip: tipRest(label, w - cs, ref, 'pro Woche') });
                } else if (over) {
                    // Rote Kante außen am Ring der Unterpunkte: hier passt etwas nicht.
                    const r = r1 + 2 * ring;
                    arcs.push({ kind: 'over', r1: r + 1, r2: r + 5, a0: a, a1: a + ang, color: null, id: node.id,
                        tip: label + ' – Unterpunkte zu groß\n⚠ ' + fmtHours(cs) + ' eingetragen, aber nur ' + fmtHours(w) +
                            ' verfügbar – ' + fmtHours(cs - w) + ' zu viel' });
                }
            }
            a += ang;
        });
        return a;
    }

    const end = level(sc.nodes, 0, perHour, 0, '', null);
    if (ref - total > EPS) {
        arcs.push({ kind: 'free', r1: SB.R0, r2: SB.R0 + ring, a0: end, a1: 2 * Math.PI, color: null, id: null, tip: tipFree(ref - total, ref, 'der Woche') });
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

    // Schraffur in Themenfarbe für nicht zugeordnete Reste (eine Vorlage je Farbe)
    const hatchIds = new Map();
    function hatch(color) {
        if (hatchIds.has(color)) return 'url(#' + hatchIds.get(color) + ')';
        const id = 'zf-hatch-' + hatchIds.size;
        hatchIds.set(color, id);
        const p = svgEl('pattern', { id: id, patternUnits: 'userSpaceOnUse', width: 7, height: 7, patternTransform: 'rotate(45)' });
        p.appendChild(svgEl('rect', { width: 7, height: 7, fill: color, 'fill-opacity': '0.16' }));
        p.appendChild(svgEl('rect', { width: 2, height: 7, fill: color }));
        defs.appendChild(p);
        return 'url(#' + id + ')';
    }

    const g = svgEl('g', { class: 'sunburst-segs' });
    svg.appendChild(g);
    data.arcs.forEach(a => {
        const path = svgEl('path', { d: arcPath(C, C, a.r1, a.r2, a.a0, a.a1), class: 'seg' + (a.kind === 'over' ? ' seg-over' : '') });
        if (a.kind === 'rest') path.setAttribute('fill', hatch(a.color));
        else if (a.kind === 'free') path.setAttribute('fill', 'url(#zf-hatch-free)');
        else if (a.kind === 'node') path.setAttribute('fill', a.color);
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

    const hasRest = sc.nodes.some(n => n.children.length && weeklyHours(n) - sumWeekly(n.children) > EPS);
    if (hasRest) {
        const key = document.createElement('p');
        key.className = 'legend-key';
        const sw = document.createElement('span');
        sw.className = 'legend-swatch swatch-rest';
        key.append(sw, document.createTextNode('schraffiert in Themenfarbe: von den Unterpunkten nicht abgedeckt'));
        el.appendChild(key);
    }

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
