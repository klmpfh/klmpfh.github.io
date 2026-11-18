/**
 * Arbeitszeit-Tracker – Zielzeit-Berechnung: Pausen als Intervalle, Netto-Arbeitszeit → Uhrzeit.
 */
'use strict';

// ── ZIELZEIT-BERECHNUNG ──────────────────────────────────────────────
// Pausen, die zeitlich VOR bzw. WÄHREND der errechneten Zielzeit liegen, verschieben diese nach
// hinten. Pausen, die erst NACH der Zielzeit beginnen, dürfen sie nicht beeinflussen.

/** Pausen (inkl. laufender Pause) als {start,end}-Intervalle für die Zielzeit-/Warnschwellen-Berechnung */
function buildPauseIntervals(currentMinOfDay, pausesList) {
    const intervals = pausesList.map(p => ({ start: p.startMin, end: p.startMin + p.durationMin }));
    if (runningPauseStart !== null) {
        const runStart    = new Date(runningPauseStart);
        const runStartMin = runStart.getHours() * 60 + runStart.getMinutes();
        intervals.push({ start: runStartMin, end: currentMinOfDay });
    }
    return intervals;
}

/** Schneidet Intervalle auf >= startMin zu, sortiert und verschmilzt Überlappungen */
function mergePauseIntervals(pauseIntervals, startMin) {
    const clipped = pauseIntervals
        .map(iv => ({ start: Math.max(iv.start, startMin), end: iv.end }))
        .filter(iv => iv.end > iv.start)
        .sort((a, b) => a.start - b.start);

    const merged = [];
    clipped.forEach(iv => {
        const last = merged[merged.length - 1];
        if (last && iv.start <= last.end) {
            last.end = Math.max(last.end, iv.end);
        } else {
            merged.push({ ...iv });
        }
    });
    return merged;
}

/**
 * Uhrzeit (Minuten ab Mitternacht), zu der ab startMin insgesamt netMinutesNeeded Netto-Arbeitsminuten
 * erreicht sind. Pausen, die dabei durchlaufen werden, verlängern die Uhrzeit; Pausen, die erst nach
 * diesem Zeitpunkt beginnen, bleiben unberücksichtigt.
 */
function computeClockTimeForNetMinutes(startMin, netMinutesNeeded, pauseIntervals) {
    const merged = mergePauseIntervals(pauseIntervals, startMin);
    let cursor    = startMin;
    let remaining = netMinutesNeeded;

    for (const iv of merged) {
        const availableBeforePause = iv.start - cursor;
        if (availableBeforePause >= remaining) return cursor + remaining;
        remaining -= availableBeforePause;
        cursor = iv.end;
    }
    return cursor + remaining;
}
