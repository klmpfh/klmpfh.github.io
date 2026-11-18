/**
 * Arbeitszeit-Tracker – Allgemeine Hilfsfunktionen: Zeit-/Dauer-Formate, SVG-Elemente, Feldvalidierung.
 * Ohne Zustand und ohne Abhängigkeiten zu anderen Dateien.
 */
'use strict';

// ── HILFSFUNKTIONEN ───────────────────────────────────────────────────

/** Erstellt ein SVG-Element mit Attributen */
function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

/** "H:MM" oder "HH:MM" Dauer → Minuten (kein Bezug auf Uhrzeit) */
function parseDuration(str) {
    if (!str || !str.trim()) return 0;
    str = str.trim().replace(',', '.');
    if (str.includes(':')) {
        const [h, m] = str.split(':').map(s => parseInt(s, 10) || 0);
        return h * 60 + m;
    }
    // Reine Zahl → als Stunden interpretieren
    const hours = parseFloat(str);
    return isNaN(hours) ? 0 : Math.round(hours * 60);
}

/** Minuten → "H:MM" Dauer-String */
function formatDuration(totalMin) {
    totalMin = Math.round(totalMin);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
}

/** "HH:MM" Uhrzeit → Minuten ab Mitternacht */
function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
}

/** Minuten ab Mitternacht → "HH:MM" Uhrzeit (mit 24h-Wrap) */
function formatMinutesToTime(totalMin) {
    const norm = (Math.round(totalMin) % 1440 + 1440) % 1440;
    return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
}

/** Differenz in Minuten → "+H:MM" oder "-H:MM" */
function formatDifference(diffMin) {
    const sign = diffMin >= 0 ? '+' : '-';
    const abs  = Math.abs(diffMin);
    return `${sign}${Math.floor(abs / 60)}:${String(Math.floor(abs % 60)).padStart(2, '0')}`;
}

function markValid(input, valid) {
    input.classList.toggle('invalid', !valid);
}
