/* Geldkugel – Farben.
 *
 * Jede Kategorie hat einen der 12 Farbslots (--series-1 … -12 in style.css,
 * hell/dunkel getrennt gepflegt, dieselbe geprüfte Palette wie im
 * Zeitfresser). Zahlungen leiten ihre Farbe von der Kategorie ab:
 * abwechselnd heller/dunkler, damit benachbarte Segmente im äußeren Ring
 * unterscheidbar bleiben, die Zugehörigkeit aber am Farbton erkennbar ist.
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

function childColor(parentColor, index) {
    const step = Math.floor(index / 2);
    const t = Math.min(0.55, 0.24 + 0.12 * step);
    return index % 2 === 0 ? mixHex(parentColor, '#ffffff', t) : mixHex(parentColor, '#000000', t * 0.8);
}

/** Map Kategorie-ID → Farbe. */
function categoryColors() {
    const palette = readPalette();
    const map = new Map();
    store.categories.forEach(c => map.set(c.id, palette[c.colorSlot % SLOT_COUNT]));
    return map;
}

/** Map Zahlungs-ID → Farbe für ein Szenario (nur Zahlungen mit Betrag zählen für hell/dunkel). */
function paymentColors(sc, catColors) {
    const map = new Map();
    store.categories.forEach(cat => {
        paymentsOf(sc, cat.id).filter(p => monthly(p) > EPS).forEach((p, i) => map.set(p.id, childColor(catColors.get(cat.id), i)));
    });
    return map;
}

/** Erster Farbslot, den noch keine Kategorie belegt. */
function nextFreeSlot() {
    const used = new Set(store.categories.map(c => c.colorSlot));
    for (let i = 0; i < SLOT_COUNT; i++) if (!used.has(i)) return i;
    return store.categories.length % SLOT_COUNT;
}
