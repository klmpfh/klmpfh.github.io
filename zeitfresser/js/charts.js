/* Zeitfresser – Diagramme.
 *
 * 1. Kreisdiagramm mit Ringen (Sunburst) für die ganze Woche: innen die
 *    Themen, außen ihre Unterpunkte.
 * 2. Gestapelte Balken: eine Zeile für die ganze Woche, darunter je
 *    Wochentag. Gezeigt werden die "Blätter" (Punkte ohne Unterpunkte).
 *
 * Schraffiert = Zeit, die ein Punkt hat, seine Unterpunkte aber nicht
 * abdecken ("nicht zugeordnet", in der Farbe des Punkts), bzw. nicht
 * verplante Zeit der Woche/des Tages ("frei", grau).
 * Ergeben Unterpunkte mehr als der Punkt selbst, werden sie in der Grafik
 * auf die Größe des Punkts gestaucht und rot markiert. Alle roten
 * Überschreitungs-Markierungen pulsieren dauerhaft (CSS-Animation zf-pulse
 * in style.css), solange der Fehler besteht.
 *
 * Tages-Logik: Ein Blatt verteilt seinen Wochenwert gleichmäßig auf seine
 * Wochentage. Ein Punkt mit Unterpunkten besteht an einem Tag aus seinen
 * Unterpunkten plus seinem nicht zugeordneten Rest, der sich gleichmäßig
 * auf die Tage des Punkts verteilt – so bleibt die Wochensumme gleich, auch
 * wenn ein Unterpunkt nur an einzelnen Tagen stattfindet.
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

function tipNode(label, node, ref, scaled) {
    const w = weeklyHours(node);
    const lines = [
        label,
        fmtHours(w) + ' pro Woche · ' + fmtPercent(w / ref) + ' der Woche',
        fmtHours(w / dayCount(node)) + ' pro Tag · ' + fmtDays(node.days)
    ];
    if (scaled) lines.push('⚠ Unterpunkte von „' + scaled + '“ ergeben mehr als der Punkt selbst – hier gestaucht dargestellt.');
    return lines.join('\n');
}

function tipRest(label, hours, ref) {
    return label + ' – nicht zugeordnet\n' + fmtHours(hours) + ' · ' + fmtPercent(hours / ref);
}

function tipFree(hours, ref, unit) {
    return 'Frei / nicht verplant\n' + fmtHours(hours) + ' · ' + fmtPercent(hours / ref) + ' ' + unit;
}

/* ── Kreisdiagramm ── */

function arcPath(cx, cy, r1, r2, a0, a1) {
    if (a1 - a0 >= 2 * Math.PI - 1e-4) a1 = a0 + 2 * Math.PI - 1e-4;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => (cx + r * Math.sin(a)).toFixed(2) + ' ' + (cy - r * Math.cos(a)).toFixed(2);
    return 'M' + p(r2, a0) +
        ' A' + r2 + ' ' + r2 + ' 0 ' + large + ' 1 ' + p(r2, a1) +
        ' L' + p(r1, a1) +
        ' A' + r1 + ' ' + r1 + ' 0 ' + large + ' 0 ' + p(r1, a0) + ' Z';
}

function renderSunburst(svg, sc, colors) {
    const C = 160, R0 = 64, RMAX = 157;
    svg.textContent = '';

    const ref = weekRef(sc);
    const total = sumWeekly(sc.nodes);
    const depth = Math.max(1, treeDepth(sc.nodes));
    const ring = Math.min(48, (RMAX - R0) / depth);
    const perHour = 2 * Math.PI / Math.max(ref, total, EPS);

    const defs = svgEl('defs');
    svg.appendChild(defs);
    const hatchIds = new Map();
    function hatch(color) {
        const key = color || 'free';
        if (hatchIds.has(key)) return 'url(#' + hatchIds.get(key) + ')';
        const id = 'zf-hatch-' + hatchIds.size;
        hatchIds.set(key, id);
        const pat = svgEl('pattern', { id: id, patternUnits: 'userSpaceOnUse', width: 7, height: 7, patternTransform: 'rotate(45)' });
        const bg = svgEl('rect', { width: 7, height: 7 });
        const line = svgEl('rect', { width: 2, height: 7 });
        if (color) {
            bg.setAttribute('fill', color);
            bg.setAttribute('fill-opacity', '0.16');
            line.setAttribute('fill', color);
        } else {
            bg.setAttribute('class', 'hatch-free-bg');
            line.setAttribute('class', 'hatch-free-line');
        }
        pat.appendChild(bg);
        pat.appendChild(line);
        defs.appendChild(pat);
        return 'url(#' + id + ')';
    }

    const g = svgEl('g', { class: 'sunburst-segs' });
    svg.appendChild(g);
    function addArc(r1, r2, a0, a1, fill, tip, id) {
        if (a1 - a0 < 1e-4) return null;
        const path = svgEl('path', { d: arcPath(C, C, r1, r2, a0, a1), class: 'seg' });
        if (fill) path.setAttribute('fill', fill);
        path.dataset.tip = tip;
        if (id) path.dataset.id = id;
        g.appendChild(path);
        return path;
    }

    function level(list, a, hourAngle, d, path, scaledBy) {
        list.forEach(node => {
            const w = weeklyHours(node);
            if (w <= EPS) return;
            const label = nodeLabel(path, node);
            const ang = w * hourAngle;
            const r1 = R0 + d * ring;
            addArc(r1, r1 + ring, a, a + ang, colors.get(node.id), tipNode(label, node, ref, scaledBy), node.id);

            if (node.children.length) {
                const cs = sumWeekly(node.children);
                const over = cs > w + EPS;
                level(node.children, a, over ? hourAngle * w / cs : hourAngle, d + 1, label,
                    over ? (node.name.trim() || 'Ohne Namen') : scaledBy);
                if (w - cs > EPS) {
                    addArc(r1 + ring, r1 + 2 * ring, a + cs * hourAngle, a + ang,
                        hatch(colors.get(node.id)), tipRest(label, w - cs, ref), node.id);
                } else if (over) {
                    // Rote Kante außen am Ring der Unterpunkte: hier passt etwas nicht.
                    const r = r1 + 2 * ring;
                    const mark = addArc(r + 1, r + 5, a, a + ang, '',
                        label + ' – Unterpunkte zu groß\n⚠ ' + fmtHours(cs) + ' eingetragen, aber nur ' + fmtHours(w) +
                        ' verfügbar – ' + fmtHours(cs - w) + ' zu viel', node.id);
                    if (mark) mark.classList.add('seg-over');
                }
            }
            a += ang;
        });
        return a;
    }

    const end = level(sc.nodes, 0, perHour, 0, '', null);
    if (ref - total > EPS) {
        addArc(R0, R0 + ring, end, 2 * Math.PI, hatch(null), tipFree(ref - total, ref, 'der Woche'), null);
    }

    // Mitte: verplante Stunden
    const big = svgEl('text', { x: C, y: C - 4, class: 'sb-center-value', 'text-anchor': 'middle' });
    big.textContent = fmtHours(total);
    const small = svgEl('text', { x: C, y: C + 16, class: 'sb-center-label', 'text-anchor': 'middle' });
    small.textContent = 'von ' + fmtHours(ref);
    svg.appendChild(big);
    svg.appendChild(small);
    if (total - ref > EPS) {
        // Woche überbucht: pulsierender roter Ring innen am Diagramm
        svg.appendChild(svgEl('circle', { cx: C, cy: C, r: R0 - 6, class: 'sb-over-ring' }));
        const warn = svgEl('text', { x: C, y: C + 33, class: 'sb-center-warn', 'text-anchor': 'middle' });
        warn.textContent = '⚠ ' + fmtHours(total - ref) + ' zu viel';
        svg.appendChild(warn);
    }

    svg.setAttribute('aria-label', 'Kreisdiagramm der Woche: ' + fmtHours(total) + ' von ' + fmtHours(ref) + ' verplant.');
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

    const hasRest = (function check(nodes) {
        return nodes.some(n => (n.children.length && weeklyHours(n) - sumWeekly(n.children) > EPS) || check(n.children));
    })(sc.nodes);
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

/* ── Balken je Tag ── */

/** Liefert die Segmente eines Tages (day = 0..6) bzw. der Woche (day = null). */
function collectSegments(nodes, day, scale, colors, path, scaledBy, out) {
    nodes.forEach(node => {
        const w = weeklyHours(node);
        if (w <= EPS) return;
        const label = nodeLabel(path, node);
        const n = dayCount(node);
        const color = colors.get(node.id);

        if (!node.children.length) {
            const real = day == null ? w : (node.days[day] ? w / n : 0);
            if (real > EPS) out.push({ id: node.id, kind: 'node', hours: real * scale, real: real, color: color, label: label, node: node, scaledBy: scaledBy });
            return;
        }

        const cs = sumWeekly(node.children);
        const over = cs > w + EPS;
        collectSegments(node.children, day, over ? scale * w / cs : scale, colors, label,
            over ? (node.name.trim() || 'Ohne Namen') : scaledBy, out);
        if (w - cs > EPS) {
            const rest = w - cs;
            const real = day == null ? rest : (node.days[day] ? rest / n : 0);
            if (real > EPS) out.push({ id: node.id, kind: 'rest', hours: real * scale, real: real, color: color, label: label });
        }
    });
    return out;
}

function renderDays(el, sc, colors) {
    el.textContent = '';
    const rows = [{ day: null, short: 'Woche', long: 'der Woche', ref: weekRef(sc) }];
    for (let d = 0; d < 7; d++) rows.push({ day: d, short: DAY_SHORT[d], long: 'am ' + DAY_LONG[d], ref: sc.hoursPerDay });

    rows.forEach(r => {
        const segs = collectSegments(sc.nodes, r.day, 1, colors, '', null, []);
        const total = segs.reduce((s, x) => s + x.hours, 0);
        const span = Math.max(total, r.ref);

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
            segs.filter(s => s.kind === 'node').map(s => s.label + ' ' + fmtHours(s.real)).join(', '));

        segs.forEach(s => {
            const seg = document.createElement('div');
            seg.className = 'seg day-seg';
            seg.style.flexGrow = s.hours;
            seg.dataset.id = s.id;
            if (s.kind === 'rest') {
                seg.classList.add('seg-rest');
                seg.style.background = 'repeating-linear-gradient(135deg, ' + s.color + ' 0 2px, ' + rgbaFromHex(s.color, 0.16) + ' 2px 7px)';
                seg.dataset.tip = s.label + ' – nicht zugeordnet\n' + fmtHours(s.real) + ' ' + r.long;
            } else {
                seg.style.background = s.color;
                const tipLines = [s.label, fmtHours(s.real) + ' ' + r.long + ' · ' + fmtPercent(s.real / r.ref)];
                if (s.scaledBy) seg.classList.add('seg-scaled');
                if (s.scaledBy) tipLines.push('⚠ Unterpunkte von „' + s.scaledBy + '“ ergeben mehr als der Punkt selbst – hier gestaucht dargestellt.');
                seg.dataset.tip = tipLines.join('\n');
                if (s.hours / span >= 0.11) {
                    const t = document.createElement('span');
                    t.className = 'seg-text';
                    t.style.color = textOn(s.color);
                    t.textContent = fmtShort(s.real);
                    seg.appendChild(t);
                }
            }
            bar.appendChild(seg);
        });

        if (r.ref - total > EPS) {
            const free = document.createElement('div');
            free.className = 'seg day-seg seg-free';
            free.style.flexGrow = r.ref - total;
            free.dataset.tip = tipFree(r.ref - total, r.ref, r.day == null ? 'der Woche' : 'des Tages');
            bar.appendChild(free);
        }

        const sum = document.createElement('span');
        sum.className = 'day-sum';
        if (total - r.ref > EPS) {
            bar.classList.add('is-over');
            sum.classList.add('is-over');
            sum.textContent = '⚠ +' + fmtShort(total - r.ref) + ' h';
            sum.title = fmtHours(total) + ' – mehr als ' + fmtHours(r.ref);
        } else {
            sum.textContent = fmtShort(total) + ' / ' + fmtShort(r.ref) + ' h';
        }

        rowEl.append(lbl, bar, sum);
        el.appendChild(rowEl);
    });
}

function renderCharts() {
    const sc = activeScenario();
    const colors = computeColors(sc);
    renderSunburst(document.getElementById('sunburst'), sc, colors);
    renderLegend(document.getElementById('legend'), sc, colors);
    renderDays(document.getElementById('days'), sc, colors);
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
