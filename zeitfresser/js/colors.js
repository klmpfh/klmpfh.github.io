/* Zeitfresser – Farben.
 *
 * Oberste Punkte bekommen einen der 12 Farbslots (--series-1 … -12 in
 * style.css, hell/dunkel getrennt gepflegt), frei wählbar über das Farbmenü
 * am Farbquadrat (gespeichert als colorSlot). Unterpunkte leiten ihre
 * Farbe vom Elternpunkt ab: Geschwister abwechselnd heller/dunkler, damit
 * benachbarte Segmente unterscheidbar bleiben, die Zugehörigkeit zum
 * Elternthema aber am Farbton erkennbar ist.
 */
'use strict';

function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const out = [];
    for (let i = 1; i <= SLOT_COUNT; i++) {
        out.push(cs.getPropertyValue('--series-' + i).trim() || '#888888');
    }
    return out;
}

function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
    return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function mixHex(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
}

function rgbaFromHex(hex, alpha) {
    const c = hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
}

/** Weiß oder Fast-Schwarz als Schrift auf einer Füllfarbe, je nach Helligkeit. */
function textOn(hex) {
    const lin = hexToRgb(hex).map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    return L > 0.36 ? '#0b0b0b' : '#ffffff';
}

function childColor(parentColor, index) {
    const step = Math.floor(index / 2);
    const t = Math.min(0.55, 0.24 + 0.12 * step);
    return index % 2 === 0 ? mixHex(parentColor, '#ffffff', t) : mixHex(parentColor, '#000000', t * 0.8);
}

/** Map Knoten-ID → Farbe (Hex) für ein ganzes Szenario. */
function computeColors(sc) {
    const palette = readPalette();
    const map = new Map();
    function assign(list, parentColor) {
        list.forEach((n, i) => {
            const c = parentColor == null ? palette[n.colorSlot % SLOT_COUNT] : childColor(parentColor, i);
            map.set(n.id, c);
            assign(n.children, c);
        });
    }
    assign(sc.nodes, null);
    return map;
}

/** Erster Farbslot, den noch kein oberster Punkt belegt. */
function nextFreeSlot(nodes) {
    const used = new Set(nodes.map(n => n.colorSlot));
    for (let i = 0; i < SLOT_COUNT; i++) if (!used.has(i)) return i;
    return nodes.length % SLOT_COUNT;
}
