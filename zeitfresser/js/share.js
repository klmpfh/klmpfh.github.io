/* Zeitfresser – Ergebnis als Bild teilen.
 *
 * Zeichnet Balken (Woche + Tage, mit verplant/frei), Kreisdiagramm und eine
 * Legende inklusive Unterpunkte auf ein Canvas und bietet das PNG im Flyover
 * zum Kopieren, Teilen (Web Share API, v. a. am Handy) oder Herunterladen an.
 * Nutzt dieselben Berechnungen wie die Diagramme (computeDayRows,
 * computeSunburst) und die Farben des aktuellen Hell/Dunkel-Designs.
 */
'use strict';

const SHARE_W = 1080;
const SHARE_PAD = 44;
const SHARE_SCALE = 2;

function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function shareTheme() {
    return {
        bg: cssVar('--theme-surface', '#ffffff'),
        text: cssVar('--theme-text-strong', '#111111'),
        muted: cssVar('--theme-text-muted', '#666666'),
        border: cssVar('--theme-border', '#dddddd'),
        danger: cssVar('--theme-danger', '#d33'),
        freeLine: cssVar('--zf-free-line', '#c3c2b7'),
        freeBg: cssVar('--zf-free-bg', 'rgba(137,135,129,0.08)'),
        font: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
    };
}

/** Füllt eine Fläche (Path2D) mit Schraffur: grau für "frei", sonst in der
 *  übergebenen Themenfarbe (nicht zugeordneter Rest). */
function fillHatched(ctx, path, t, color) {
    ctx.save();
    ctx.fillStyle = color ? rgbaFromHex(color, 0.16) : t.freeBg;
    ctx.fill(path);
    ctx.clip(path);
    ctx.strokeStyle = color || t.freeLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Diagonale Linien über die gesamte Zeichenfläche; der Clip begrenzt sie.
    for (let x = -2000; x < 3000; x += 7) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 2000, 2000);
    }
    ctx.stroke();
    ctx.restore();
}

function roundRectPath(x, y, w, h, r) {
    const p = new Path2D();
    r = Math.min(r, w / 2, h / 2);
    p.moveTo(x + r, y);
    p.arcTo(x + w, y, x + w, y + h, r);
    p.arcTo(x + w, y + h, x, y + h, r);
    p.arcTo(x, y + h, x, y, r);
    p.arcTo(x, y, x + w, y, r);
    p.closePath();
    return p;
}

function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
}

/** Legendenzeilen: Themen mit ihren Unterpunkten, dann "frei". */
function shareLegendRows(sc, colors) {
    const rows = [];
    sc.nodes.forEach(n => {
        const w = weeklyHours(n);
        if (w <= EPS) return;
        rows.push({ name: n.name.trim() || 'Ohne Namen', hours: w, color: colors.get(n.id), sub: false });
        n.children.forEach(c => {
            const cw = weeklyHours(c);
            if (cw > EPS) rows.push({ name: c.name.trim() || 'Ohne Namen', hours: cw, color: colors.get(c.id), sub: true });
        });
    });
    const free = weekRef(sc) - sumWeekly(sc.nodes);
    if (free > EPS) rows.push({ name: 'Frei / nicht verplant', hours: free, color: null, sub: false });
    return rows;
}

function renderShareCanvas(sc) {
    const t = shareTheme();
    const colors = computeColors(sc);
    const days = computeDayRows(sc, colors);
    const sun = computeSunburst(sc, colors);
    const legend = shareLegendRows(sc, colors);
    const ref = weekRef(sc);

    // Höhen vorab bestimmen
    const headH = 92;
    const barHeadH = 22, weekRowH = 34, dayRowH = 28, rowGap = 8;
    const barsH = barHeadH + weekRowH + 14 + 7 * (dayRowH + rowGap);
    const sunSize = 380;
    const legRowH = 26;
    const legendH = legend.length * legRowH + (sun.total - ref > EPS ? 40 : 0);
    const lowerH = Math.max(sunSize, legendH);
    const footH = 40;
    const H = SHARE_PAD + headH + barsH + 30 + lowerH + footH + SHARE_PAD - 20;

    const canvas = document.createElement('canvas');
    canvas.width = SHARE_W * SHARE_SCALE;
    canvas.height = H * SHARE_SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SHARE_SCALE, SHARE_SCALE);
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, SHARE_W, H);
    ctx.textBaseline = 'middle';
    const font = (size, weight) => (weight || 400) + ' ' + size + 'px ' + t.font;
    const L = SHARE_PAD, R = SHARE_W - SHARE_PAD;

    // ── Kopf ──
    let y = SHARE_PAD;
    ctx.fillStyle = t.text;
    ctx.font = font(30, 800);
    ctx.textAlign = 'left';
    ctx.fillText(ellipsize(ctx, sc.name.trim() || 'Ohne Namen', R - L), L, y + 18);
    ctx.font = font(16, 500);
    ctx.fillStyle = t.muted;
    const free = ref - sun.total;
    let sub = fmtHours(sun.total) + ' von ' + fmtHours(ref) + ' pro Woche verplant · ' +
        (free >= -EPS ? fmtHours(Math.max(0, free)) + ' frei' : fmtHours(-free) + ' zu viel');
    if (sc.hoursPerDay !== 24) sub += ' · Bezug ' + fmtHours(sc.hoursPerDay) + ' pro Tag';
    ctx.fillText(sub, L, y + 54);
    y += headH;

    // ── Balken ──
    const labelW = 64, sumW = 86, freeW = 96, gap = 12;
    const barX = L + labelW + gap;
    const barW = R - barX - gap - sumW - gap - freeW;
    const sumX = barX + barW + gap + sumW;   // rechtsbündig
    const freeX = R;

    ctx.font = font(12, 700);
    ctx.fillStyle = t.muted;
    ctx.textAlign = 'right';
    ctx.fillText('VERPLANT', sumX, y + barHeadH / 2);
    ctx.fillText('FREI', freeX, y + barHeadH / 2);
    y += barHeadH;

    days.forEach(r => {
        const isWeek = r.day == null;
        const h = isWeek ? weekRowH : dayRowH;
        const cy = y + h / 2;

        ctx.textAlign = 'left';
        ctx.font = font(14, 700);
        ctx.fillStyle = t.muted;
        ctx.fillText(r.short, L, cy);

        const items = r.segs.map(s => ({ hours: s.hours, real: s.real, color: s.color, rest: s.kind === 'rest' }));
        if (r.free > EPS) items.push({ hours: r.free, real: r.free, color: null, rest: false });
        const segGap = 1;
        let x = barX;
        items.forEach(it => {
            // Gleicher Maßstab in allen Zeilen, die Lücke geht vom Segment selbst ab.
            const slot = barW * it.hours / r.full;
            const w = Math.max(1, slot - segGap);
            const p = roundRectPath(x, y, w, h, 4);
            if (it.rest) {
                fillHatched(ctx, p, t, it.color);
            } else if (it.color) {
                ctx.fillStyle = it.color;
                ctx.fill(p);
                if (it.hours / r.full >= 0.09) {
                    ctx.font = font(12, 700);
                    ctx.fillStyle = textOn(it.color);
                    ctx.textAlign = 'left';
                    ctx.fillText(fmtShort(it.real), x + 6, cy);
                }
            } else {
                fillHatched(ctx, p, t);
            }
            x += slot;
        });
        if (r.over) {
            ctx.strokeStyle = t.danger;
            ctx.lineWidth = 2;
            ctx.stroke(roundRectPath(barX - 3, y - 3, barW * r.total / r.full + 6, h + 6, 6));
        }

        ctx.textAlign = 'right';
        ctx.font = font(14, 600);
        ctx.fillStyle = t.text;
        ctx.fillText(fmtShort(r.total) + ' h', sumX, cy);
        ctx.fillStyle = r.over ? t.danger : t.muted;
        ctx.font = font(14, r.over ? 700 : 600);
        ctx.fillText(r.over ? '−' + fmtShort(-r.free) + ' h' : fmtShort(Math.max(0, r.free)) + ' h', freeX, cy);

        y += h + rowGap;
        if (isWeek) {
            ctx.fillStyle = t.border;
            ctx.fillRect(L, y + 2, R - L, 1);
            y += 14;
        }
    });
    y += 30 - rowGap;

    // ── Kreisdiagramm ──
    const k = sunSize / 320;
    ctx.save();
    ctx.translate(L, y);
    ctx.scale(k, k);
    sun.arcs.forEach(a => {
        const p = new Path2D(arcPath(SB.C, SB.C, a.r1, a.r2, a.a0, a.a1));
        if (a.kind === 'over') {
            ctx.fillStyle = t.danger;
            ctx.fill(p);
            return;
        }
        if (a.kind === 'rest') {
            fillHatched(ctx, p, t, a.color);
        } else if (a.color) {
            ctx.fillStyle = a.color;
            ctx.fill(p);
        } else {
            fillHatched(ctx, p, t);
        }
        ctx.strokeStyle = t.bg;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke(p);
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = t.text;
    ctx.font = font(22, 700);
    ctx.fillText(fmtHours(sun.total), SB.C, SB.C - 6);
    ctx.fillStyle = t.muted;
    ctx.font = font(12, 400);
    ctx.fillText('von ' + fmtHours(ref), SB.C, SB.C + 14);
    if (sun.total - ref > EPS) {
        ctx.strokeStyle = t.danger;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(SB.C, SB.C, SB.R0 - 6, 0, 2 * Math.PI);
        ctx.stroke();
    }
    ctx.restore();

    // ── Legende ──
    const lx = L + sunSize + 48;
    const valX = R - 64, pctX = R;
    let ly = y + Math.max(0, (sunSize - legendH) / 2);
    legend.forEach(row => {
        const cy = ly + legRowH / 2;
        const indent = row.sub ? 22 : 0;
        const sw = row.sub ? 10 : 14;
        const swP = roundRectPath(lx + indent, cy - sw / 2, sw, sw, 3);
        if (row.color) { ctx.fillStyle = row.color; ctx.fill(swP); } else fillHatched(ctx, swP, t);
        ctx.textAlign = 'left';
        ctx.font = font(row.sub ? 14 : 15, row.sub ? 400 : 700);
        ctx.fillStyle = row.sub ? t.muted : t.text;
        ctx.fillText(ellipsize(ctx, row.name, valX - 90 - (lx + indent + sw + 10)), lx + indent + sw + 10, cy);
        ctx.textAlign = 'right';
        ctx.fillText(fmtHours(row.hours), valX, cy);
        ctx.fillStyle = t.muted;
        ctx.font = font(14, 400);
        ctx.fillText(fmtPercent(row.hours / ref), pctX, cy);
        ly += legRowH;
    });
    if (sun.total - ref > EPS) {
        ctx.textAlign = 'left';
        ctx.fillStyle = t.danger;
        ctx.font = font(14, 700);
        ctx.fillText('⚠ ' + fmtHours(sun.total - ref) + ' mehr, als die Woche hat', lx, ly + 22);
    }
    y += lowerH;

    // ── Fuß ──
    ctx.textAlign = 'left';
    ctx.fillStyle = t.muted;
    ctx.font = font(12, 400);
    ctx.fillText('Zeitfresser · ' + new Date().toLocaleDateString('de-DE'), L, y + footH - 8);

    return canvas;
}

function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG konnte nicht erzeugt werden.')), 'image/png'));
}

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

/** Flyover mit Vorschau und den Möglichkeiten zum Weitergeben. */
async function openShareImage(anchor) {
    const sc = activeScenario();
    let blob;
    try {
        blob = await canvasToBlob(renderShareCanvas(sc));
    } catch (e) {
        alertFlyover({ title: 'Bild teilen', message: e.message, anchor: anchor });
        return;
    }
    const filename = fileBaseName(sc) + '.png';
    const file = new File([blob], filename, { type: 'image/png' });
    const url = URL.createObjectURL(blob);

    const body = document.createElement('div');
    body.className = 'share-preview';
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Vorschau: Diagramme von „' + (sc.name.trim() || 'Ohne Namen') + '“';
    body.appendChild(img);

    const flash = (btn, text) => {
        const old = btn.textContent;
        btn.textContent = text;
        setTimeout(() => { if (btn.isConnected) btn.textContent = old; }, 1600);
    };

    const buttons = [];
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        buttons.push({
            label: 'Teilen …', kind: 'ghost', onClick: btn => {
                navigator.share({ files: [file], title: 'Zeitfresser: ' + (sc.name.trim() || 'Woche') })
                    .catch(err => { if (err && err.name !== 'AbortError') flash(btn, 'Fehlgeschlagen'); });
            }
        });
    }
    if (navigator.clipboard && window.ClipboardItem) {
        buttons.push({
            label: 'Kopieren', kind: 'ghost', onClick: btn => {
                navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                    .then(() => flash(btn, 'Kopiert ✓'), () => flash(btn, 'Nicht möglich'));
            }
        });
    }
    buttons.push({ label: 'Herunterladen', kind: 'primary', autofocus: true, onClick: btn => { downloadBlob(blob, filename); flash(btn, 'Gespeichert ✓'); } });
    buttons.push({ label: 'Schließen', value: null, kind: 'ghost' });

    await openFlyover({
        title: 'Als Bild teilen',
        message: 'PNG mit Balken, Kreisdiagramm und Legende. Zum Weitergeben der bearbeitbaren Daten eignet sich „Export“ (JSON).',
        body: body,
        anchor: anchor,
        wide: true,
        buttons: buttons
    });
    URL.revokeObjectURL(url);
}
