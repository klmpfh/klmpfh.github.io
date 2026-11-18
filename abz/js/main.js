/**
 * Arbeitszeit-Tracker – Einstieg: Eingabe-Events verdrahten und die Seite initialisieren.
 * Muss als letzte App-Datei geladen werden, da hier Funktionen aller anderen Dateien
 * direkt referenziert werden.
 */
'use strict';

/**
 * Native Zeitfelder lassen beim Blättern mit den Pfeiltasten nur die Minuten überlaufen
 * (59 → 00 bzw. 00 → 59), ohne die Stunde mitzuziehen. Dieser Handler ergänzt den Übertrag.
 * Muss vor den übrigen 'input'-Listenern registriert werden, damit diese bereits den korrigierten Wert sehen.
 */
function enableMinuteCarry(input) {
    let lastKey   = null;
    let prevValue = input.value;

    input.addEventListener('keydown', e => {
        lastKey   = e.key;
        prevValue = input.value;
    });
    input.addEventListener('keyup', () => { lastKey = null; });

    input.addEventListener('input', () => {
        if (lastKey !== 'ArrowUp' && lastKey !== 'ArrowDown') return;
        if (!prevValue || !input.value) return;

        const [prevH, prevM] = prevValue.split(':').map(Number);
        const [newH,  newM]  = input.value.split(':').map(Number);
        if (prevH !== newH) return; // Stunde wurde selbst geändert

        let delta = 0;
        if (lastKey === 'ArrowUp'   && prevM === 59 && newM === 0)  delta = 1;
        if (lastKey === 'ArrowDown' && prevM === 0  && newM === 59) delta = -1;
        if (delta) {
            const h = (newH + delta + 24) % 24;
            input.value = `${String(h).padStart(2,'0')}:${String(newM).padStart(2,'0')}`;
        }
        prevValue = input.value; // für gedrückt gehaltene Taste (Auto-Repeat)
    });
}

[startTimeInput, dom.pauseFromInput, dom.pauseToInput, timelineFromInput, timelineToInput].forEach(enableMinuteCarry);

// Eingabe-Events
startTimeInput.addEventListener('input', updateTracker);

dom.pauseFromInput.addEventListener('input', updateTracker);
dom.pauseToInput.addEventListener('input', updateTracker);

[timelineFromInput, timelineToInput].forEach(input => input.addEventListener('input', () => {
    validateTimelineRange();
    updateTracker();
}));

// Höchstarbeitszeit/Ruhezeit: leeres oder ungültiges Feld → gesetzlicher Standardwert
[maxWorkInput, restInput].forEach(input => input.addEventListener('input', () => {
    markValid(input, parseDuration(input.value) > 0 || !input.value.trim());
    updateTracker();
}));

// ── INITIALISIERUNG ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    timelineFromInput.value = defaultTimelineFrom;
    timelineToInput.value   = defaultTimelineTo;
    maxWorkInput.value      = formatDuration(defaultMaxWorkMin);
    restInput.value         = formatDuration(defaultRestMin);
    loadFromUrlParams();
    // Erst nach dem Einlesen, sonst überschreibt ein frühes toggle-Event die URL-Parameter
    Object.values(settingsPanels).forEach(panel => panel.addEventListener('toggle', updateUrlParams));
    if (!workTimeRows.length) addWorkTimeRow();
    validateTimelineRange();
    if (!startTimeInput.value) {
        const now = new Date();
        startTimeInput.value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }
    updatePauseControlsAvailability();
    startTimeInput.focus();
    startTimeInput.select();
    updateTracker();
    setInterval(updateTracker, 10000);
});
