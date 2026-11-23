/**
 * Arbeitszeit-Tracker – Zeitstrahl: sichtbarer Ausschnitt und SVG-Darstellung.
 */
'use strict';

/** Zeitstrahl-Ausschnitt als Minuten ab Mitternacht; leeres Feld → null. „bis 23:59“ zählt als
 *  24 Uhr, weil ein Zeitfeld kein 24:00 kennt – so erscheint auch die 24-Uhr-Markierung. */
function readTimelineRange() {
    const to = timelineToInput.value ? parseTimeToMinutes(timelineToInput.value) : null;
    return {
        from: timelineFromInput.value ? parseTimeToMinutes(timelineFromInput.value) : null,
        to:   to === 1439 ? 1440 : to
    };
}

/** Markiert die Zeitstrahl-Felder rot, wenn „bis“ nicht nach „von“ liegt (Achse fällt dann auf automatisch zurück) */
function validateTimelineRange() {
    const { from, to } = readTimelineRange();
    const valid = from === null || to === null || to > from;
    markValid(timelineFromInput, valid);
    markValid(timelineToInput, valid);
}

/**
 * Zeigt einen Hinweis, wenn Startzeit, eines der Tagesziele oder aktuelle Zeit außerhalb des
 * eingestellten Ausschnitts liegen (Werte nach Mitternacht zählen als Tagesende).
 * targetEnds: [{ label, endMin }]
 */
function updateTimelineRangeWarning(startMin, targetEnds, nowMin) {
    const { from, to } = readTimelineRange();
    const outside = [];

    // Leere Seite = automatisch, ungültiger Bereich = komplett automatisch → nichts kann herausfallen
    if (startTimeInput.value && !(from !== null && to !== null && to <= from)) {
        const check = (label, clockMin) => {
            const m = Math.min(clockMin, 1440);
            if ((from !== null && m < from) || (to !== null && m > to)) outside.push(label);
        };
        check('Startzeit', startMin);
        targetEnds.forEach(t => check(t.label, t.endMin));
        check('aktuelle Zeit', nowMin);
    }

    dom.timelineRangeWarning.style.display = outside.length ? '' : 'none';
    dom.timelineRangeWarningText.textContent = outside.join(', ');
}

/** Setzt den Zeitstrahl auf den ganzen Tag (0–24 Uhr; „23:59“ im Feld gilt als 24 Uhr) */
function applyTimelineFix() {
    timelineFromInput.value = '00:00';
    timelineToInput.value   = '23:59';
    validateTimelineRange();
    updateTracker();
}

// ── TIMELINE ──────────────────────────────────────────────────────────
/** Liest eine --theme-*-Variable (siehe assets/css/theme.css) als fertigen CSS-Farbstring aus,
 *  damit die per nav.js zufällig gewürfelte Akzentfarbe auch im SVG (fill/stroke) ankommt. */
function themeColor(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/**
 * elapsedMin: verstrichene Arbeitszeit ab Start (≥ 0); nowMin: aktuelle Uhrzeit relativ zur Startzeit –
 * negativ, solange der Arbeitsbeginn noch bevorsteht. targetMarkers: [{ endMin, relevant }] – eine Zielzeit je Arbeitszeit
 */
function drawTimeline(elapsedMin, nowMin, startMinOfDay, currentMinOfDay, runningPauseMin, targetMarkers, warnMarkers, pausesList, maxDuration) {
    const accent       = themeColor('--theme-accent');
    const accentStrong = themeColor('--theme-accent-strong');
    const border       = themeColor('--theme-border');
    const textMuted    = themeColor('--theme-text-muted');
    const warningColor = themeColor('--theme-warning');
    const width        = svg.clientWidth || 940;
    const paddingLeft  = 30;
    const paddingRight = 30;
    const chartWidth   = width - paddingLeft - paddingRight;
    const barY         = 40;
    const barHeight    = 24;

    // Sichtbarer Achsenbereich, relativ zur Startzeit (alle Aufrufer von getX rechnen in Minuten ab Start)
    const range      = readTimelineRange();
    // Automatischer Beginn: Startzeit – oder, solange der Arbeitsbeginn noch bevorsteht, die volle
    // Stunde vor „jetzt“, damit der Jetzt-Zeiger links vom Start sichtbar bleibt
    const autoStartMin = nowMin < 0 ? Math.floor((startMinOfDay + nowMin) / 60) * 60 - startMinOfDay : 0;
    let axisStartMin = range.from !== null ? range.from - startMinOfDay : autoStartMin;
    let axisEndMin   = (range.to ?? startMinOfDay + maxDuration) - startMinOfDay;
    if (axisEndMin <= axisStartMin) { axisStartMin = autoStartMin; axisEndMin = maxDuration; } // ungültig → automatisch
    const axisSpan     = axisEndMin - axisStartMin;
    const inAxis       = m => m >= axisStartMin && m <= axisEndMin;

    function getX(minutes) {
        return paddingLeft + ((Math.min(Math.max(minutes, axisStartMin), axisEndMin) - axisStartMin) / axisSpan) * chartWidth;
    }

    svg.innerHTML = '';

    // 1. Hintergrundbalken
    svg.appendChild(svgEl('rect', { x: paddingLeft, y: barY, width: chartWidth, height: barHeight, fill: border, rx: 4 }));

    // 2. Fortschrittsbalken (verstrichene Uhr-Zeit)
    const startX   = getX(0);
    const elapsedX = getX(elapsedMin);
    if (elapsedX > startX) {
        svg.appendChild(svgEl('rect', {
            x: startX, y: barY + 2,
            width: elapsedX - startX,
            height: barHeight - 4,
            fill: themeColor('--theme-success'), opacity: 0.85, rx: 2
        }));
    }

    // 3. Pausenblöcke
    pausesList.forEach(p => {
        const offsetMin = p.startMin - startMinOfDay;
        if (offsetMin > axisEndMin || offsetMin + p.durationMin < axisStartMin) return;
        const pX1      = getX(offsetMin);
        const pX2      = getX(offsetMin + p.durationMin);
        const isFuture = p.startMin > currentMinOfDay;
        svg.appendChild(svgEl('rect', {
            x: pX1, y: barY,
            width: Math.max(0, pX2 - pX1), height: barHeight,
            fill: p.isDraft ? 'rgba(217,119,6,0.35)' : (isFuture ? 'rgba(161,161,170,0.3)' : 'rgba(113,113,122,0.45)')
        }));
    });

    // Laufende Pause
    if (runningPauseStart !== null && runningPauseMin > 0) {
        const runStart    = new Date(runningPauseStart);
        const runStartMin = runStart.getHours() * 60 + runStart.getMinutes();
        const offsetMin   = runStartMin - startMinOfDay;
        if (offsetMin >= 0) {
            svg.appendChild(svgEl('rect', {
                x: getX(offsetMin), y: barY,
                width: Math.max(0, getX(offsetMin + runningPauseMin) - getX(offsetMin)),
                height: barHeight, fill: 'rgba(22,163,74,0.4)'
            }));
        }
    }

    // 4. X-Achse (volle Uhrzeit-Stunden; Beschriftung wird bei wenig Platz ausgedünnt)
    const firstHour  = Math.ceil((startMinOfDay + axisStartMin) / 60);
    const lastHour   = Math.floor((startMinOfDay + axisEndMin) / 60);
    const pxPerHour  = chartWidth * 60 / axisSpan;
    const labelEvery = pxPerHour >= 38 ? 1 : pxPerHour >= 19 ? 2 : 3;
    for (let h = firstHour; h <= lastHour; h++) {
        const tX = getX(h * 60 - startMinOfDay);
        svg.appendChild(svgEl('line', { x1: tX, y1: barY - 5, x2: tX, y2: barY, stroke: border, 'stroke-width': 1.5 }));
        if (h % labelEvery !== 0) continue;
        const txt = svgEl('text', { x: tX, y: barY - 9, 'text-anchor': 'middle', 'font-size': '11px', fill: textMuted, 'font-weight': 500 });
        txt.textContent = `${h < 0 ? h + 24 : h}:00`; // Vortag (Jetzt vor einer Startzeit kurz nach Mitternacht)
        svg.appendChild(txt);
    }

    // 5. Zielmarker je Arbeitszeit: die relevante voll beschriftet, weitere dezent nur mit Uhrzeit.
    //    Beschriftungen, die sich mit einer bereits platzierten überschneiden würden, entfallen (Linie bleibt).
    if (startMinOfDay > 0) {
        const levelY  = barY + barHeight + 20;
        const markers = targetMarkers
            .filter(t => inAxis(t.endMin - startMinOfDay))
            .map(t => {
                const mX      = getX(t.endMin - startMinOfDay);
                const time    = formatMinutesToTime(t.endMin);
                const text    = t.relevant ? `Tagesziel (${time})` : time;
                const approxW = text.length * 6 + 10;
                return { ...t, mX, text, approxW, x1: mX - approxW / 2, x2: mX + approxW / 2 };
            })
            .sort((a, b) => b.relevant - a.relevant); // relevante Beschriftung zuerst platzieren

        const placed = [];
        markers.forEach(m => {
            m.showLabel = !placed.some(p => m.x1 < p.x2 + 4 && p.x1 < m.x2 + 4);
            if (m.showLabel) placed.push(m);
        });

        // Weitere zuerst zeichnen, damit die relevante obenauf liegt
        [...markers].reverse().forEach(m => {
            const opacity = m.relevant ? 1 : 0.6;
            svg.appendChild(svgEl('line', {
                x1: m.mX, y1: barY - 2, x2: m.mX, y2: levelY - 8, stroke: accent, opacity,
                'stroke-width': m.relevant ? 2 : 1.5, 'stroke-dasharray': m.relevant ? '3,2' : '2,3'
            }));
            svg.appendChild(svgEl('circle', { cx: m.mX, cy: levelY - 9, r: m.relevant ? 3 : 2.5, fill: accent, opacity }));
            if (!m.showLabel) return;

            svg.appendChild(svgEl('rect', { x: m.x1, y: levelY - 8, width: m.approxW, height: 14, class: 'label-bg' }));
            const lTxt = svgEl('text', {
                x: m.mX, y: levelY + 3, 'text-anchor': 'middle', 'font-size': m.relevant ? '11px' : '10px',
                'font-weight': 600, fill: accentStrong, opacity: m.relevant ? 1 : 0.8
            });
            lTxt.textContent = m.text;
            svg.appendChild(lTxt);
        });
    }

    // 6. Warnschwellen-Marker (zeigen, wann eine Pausen-Warnung entsteht – Bezug zum „Jetzt"-Zeiger)
    if (startMinOfDay > 0 && warnMarkers) {
        warnMarkers.forEach(w => {
            const offsetMin = w.clockMin - startMinOfDay;
            if (!inAxis(offsetMin)) return;
            const wX    = getX(offsetMin);
            // Noch nicht überschritten: gleiche Warnfarbe, aber gestrichelt und etwas zurückgenommen
            const color   = warningColor;
            const opacity = w.active ? 1 : 0.75;

            svg.appendChild(svgEl('line', {
                x1: wX, y1: barY - 18, x2: wX, y2: barY,
                stroke: color, 'stroke-width': 2, opacity,
                'stroke-dasharray': w.active ? '0' : '3,2'
            }));
            svg.appendChild(svgEl('circle', { cx: wX, cy: barY - 18, r: 3, fill: color, opacity }));

            const wTxt = svgEl('text', {
                x: wX, y: barY - 23, 'text-anchor': 'middle', 'font-size': '10px',
                'font-weight': w.active ? 800 : 700, fill: color, opacity
            });
            wTxt.textContent = w.label;
            svg.appendChild(wTxt);
        });
    }

    // 7. „Jetzt"-Marker – Label unterhalb des Balkens (unter der Tagesziel-Zeile), damit es die
    //    Warnschwellen-Marker oberhalb des Balkens nicht verdeckt
    //    Vor Arbeitsbeginn steht er links von der Startzeit.
    if (startTimeInput.value && inAxis(nowMin)) {
        const nowX       = getX(nowMin);
        const nowTimeStr = formatMinutesToTime(startMinOfDay + nowMin);
        const nowLabelY  = barY + barHeight + 32;

        svg.appendChild(svgEl('line', { x1: nowX, y1: barY - 4, x2: nowX, y2: nowLabelY, stroke: accent, 'stroke-width': 2.5 }));

        svg.appendChild(svgEl('rect', { x: nowX - 36, y: nowLabelY, width: 72, height: 14, fill: accent, rx: 4 }));

        const nowTxt = svgEl('text', { x: nowX, y: nowLabelY + 10, 'text-anchor': 'middle', 'font-size': '10px', 'font-weight': 'bold', fill: '#ffffff' });
        nowTxt.textContent = `Jetzt: ${nowTimeStr}`;
        svg.appendChild(nowTxt);
    }
}
