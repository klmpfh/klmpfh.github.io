/**
 * Arbeitszeit-Tracker – Haupt-Update (alle 10 s und bei jeder Eingabe), Seitentitel und Kurzfassung der Einstellungen.
 */
'use strict';

/**
 * Wird beim Klick auf eine Statistik-Kachel aufgerufen und legt fest, was im Seitentitel steht.
 * Kacheln einer Arbeitszeit-Zeile übergeben ihren Zeilenindex und machen diese Zeile zugleich relevant.
 */
function selectTitleStat(stat, index = null) {
    titleStat = stat;
    if (index !== null) relevantIndex = index;
    updateWorkTimeRelevantButtons();
    updateTracker();
}

/** Markiert eine Arbeitszeit als relevant, ohne die Art des Titel-Werts zu ändern */
function selectRelevantWorkTime(index) {
    if (index === null || index < 0) return;
    relevantIndex = index;
    updateWorkTimeRelevantButtons();
    updateTracker();
}

/** Markiert die aktuell für den Titel gewählte Kachel der gemeinsamen Werte visuell */
function updateStatCardSelection() {
    Object.entries(titleStatCards).forEach(([stat, el]) => {
        el.classList.toggle('selected', stat === titleStat);
    });
}

/** Setzt den Seitentitel gemäß der gewählten Statistik-Kachel (Zielwerte der relevanten Arbeitszeit) */
function updateTitle(ctx) {
    const label = titleStatLabels[titleStat];

    if (titleStat === 'net')   { document.title = `${formatDuration(ctx.netWorkMin)} h – ${label}`;  return; }
    if (titleStat === 'pause') { document.title = `${formatDuration(ctx.allPauseMin)} h – ${label}`; return; }
    if (titleStat === 'pauseElapsed') { document.title = `${formatDuration(ctx.elapsedPauseMin)} h – ${label}`; return; }
    if (titleStat === 'nextStart') {
        document.title = ctx.nextStartMin === null ? 'Arbeitszeit-Tracker' : `${formatMinutesToTime(ctx.nextStartMin)} – ${label}`;
        return;
    }

    const t = ctx.relevantTarget;
    if (!t || t.targetEndMin === undefined) { document.title = 'Arbeitszeit-Tracker'; return; }

    // Bei mehreren Arbeitszeiten dazuschreiben, auf welche sich der Wert bezieht
    const suffix = ctx.multipleTargets ? ` (${t.label})` : '';
    if (titleStat === 'target') {
        document.title = `${formatMinutesToTime(t.targetEndMin)} – ${label}${suffix}`;
    } else if (titleStat === 'countdown') {
        document.title = `${formatDifference(t.countdown)} – ${label}${suffix}`;
    } else if (titleStat === 'diff') {
        document.title = `${formatDifference(t.remaining)} – ${label}${suffix}`;
    } else {
        document.title = `${t.progressUncapped.toFixed(1)} % – ${label}${suffix}`;
    }
}

// ── KURZFASSUNG EINGEKLAPPTER EINSTELLUNGEN ───────────────────────────
/** Zeigt im Kopf der Bereiche „Zeiten“ und „Pausen“ das Wichtigste, damit es auch eingeklappt sichtbar bleibt */
function updateSettingsSummaries(targets, pausesList, allPauseMin) {
    const workTimes = targets.length ? targets.map(t => t.label).join(', ') : 'keine Arbeitszeit';
    dom.timesSummary.textContent = `Start ${startTimeInput.value || '–'} · ${workTimes}`;

    const count = pausesList.length;
    const parts = [
        autoPauseMode ? 'Automatisch' : 'Manuell',
        (count === 0 ? 'keine Pausen' : count === 1 ? '1 Pause' : `${count} Pausen`)
            + (allPauseMin > 0 ? ` (${formatDuration(allPauseMin)} h)` : '')
    ];
    if (runningPauseStart !== null) {
        parts.push(`<span class="running-pause-info"><span class="running-dot"></span>läuft seit ${dom.runningPauseStartLabel.textContent}</span>`);
    }
    // Warnungen nicht unbemerkt wegklappen
    const warningCount = dom.legalWarnings.children.length;
    if (warningCount) {
        parts.push(`<span class="settings-summary-warning">&#9888; ${warningCount === 1 ? '1 Warnung' : `${warningCount} Warnungen`}</span>`);
    }
    dom.pausesSummary.innerHTML = parts.join(' · ');
}

// ── HAUPT-UPDATE ──────────────────────────────────────────────────────
function updateTracker() {
    const now             = new Date();
    const currentMinOfDay = now.getHours() * 60 + now.getMinutes();

    const startMin = parseTimeToMinutes(startTimeInput.value);
    const hasStart = !!startTimeInput.value;

    // Pausenliste inkl. eines gerade im Formular eingegebenen Entwurfs (Live-Vorschau)
    const effectivePauses = getEffectivePauses(currentMinOfDay);

    // Uhr-Minuten seit Arbeitsbeginn (nach Mitternacht fortlaufend; bis 2h vor Start negativ)
    let clockSinceStartMin = currentMinOfDay - startMin;
    if (clockSinceStartMin < -120) clockSinceStartMin += 1440;
    // Vergangene Zeit seit Arbeitsbeginn (Uhr-Minuten)
    const elapsedMin = Math.max(0, clockSinceStartMin);

    // Vergangene Pausenminuten
    let elapsedPauseMin = 0;
    effectivePauses.forEach(p => {
        const pEnd = p.startMin + p.durationMin;
        if (currentMinOfDay >= pEnd) {
            elapsedPauseMin += p.durationMin;
        } else if (currentMinOfDay > p.startMin) {
            elapsedPauseMin += currentMinOfDay - p.startMin;
        }
    });

    let runningPauseMin = 0;
    if (runningPauseStart !== null) {
        // Auf Basis von currentMinOfDay (volle Minuten) statt Date.now()-Differenz berechnen,
        // damit runningPauseMin exakt im selben Minutentakt wächst wie elapsedMin. Sonst driftet
        // netWorkMin während der laufenden Pause innerhalb jeder Minute kurz nach unten/oben.
        const runStart    = new Date(runningPauseStart);
        const runStartMin = runStart.getHours() * 60 + runStart.getMinutes();
        runningPauseMin   = Math.max(0, currentMinOfDay - runStartMin);
        elapsedPauseMin  += runningPauseMin;
        dom.runningPauseDuration.textContent = runningPauseMin;
    }

    const netWorkMin     = Math.max(0, elapsedMin - elapsedPauseMin);
    const allPauseMin    = effectivePauses.reduce((s, p) => s + p.durationMin, 0) + runningPauseMin;
    const pauseIntervals = buildPauseIntervals(currentMinOfDay, effectivePauses);

    // Stat-Cards befüllen
    dom.statNetWork.textContent = formatDuration(netWorkMin) + ' h';
    dom.statNetWork.className   = 'stat-value';

    dom.statPauseTotal.textContent = formatDuration(allPauseMin) + ' h';
    dom.statPauseTotal.className   = 'stat-value muted';

    dom.statPauseElapsed.textContent = formatDuration(elapsedPauseMin) + ' h';
    dom.statPauseElapsed.className   = 'stat-value muted';

    // Frühester Start am Folgetag bei Feierabend jetzt: Ruhezeit ab Arbeitsende (Beginn einer gerade
    // laufenden Pause zählt als Ende) und Höchstarbeitszeit im 24h-Fenster ab heutigem Start – was heute
    // davon nicht verbraucht wurde, darf morgen noch vor Ablauf der 24h liegen. Frühestens jedoch zum
    // Beginn des Zeitstrahls am Folgetag (leer = Startzeit), sonst läge der Wert bei wenig Arbeit noch heute.
    const maxWorkMin = readMaxWorkMin();
    const restMin    = readRestMin();
    let nextStartMin = null;
    if (hasStart) {
        const workEndMin     = computeClockTimeForNetMinutes(startMin, netWorkMin, pauseIntervals);
        const byRestMin      = workEndMin + restMin;
        const byWindowMin    = startMin + 1440 - Math.max(0, maxWorkMin - netWorkMin);
        const byScaleMin     = 1440 + (readTimelineRange().from ?? startMin);
        nextStartMin         = Math.max(byRestMin, byWindowMin, byScaleMin);
        dom.statNextStart.textContent     = formatMinutesToTime(nextStartMin);
        dom.statNextStart.className       = 'stat-value';
        dom.statNextStartHint.textContent =
              nextStartMin === byScaleMin  ? 'Beginn Zeitstrahl'
            : nextStartMin === byRestMin   ? 'durch Ruhezeit'
            : `durch max. ${formatDuration(maxWorkMin)} h / 24 h`;
    } else {
        dom.statNextStart.textContent     = '–';
        dom.statNextStart.className       = 'stat-value muted';
        dom.statNextStartHint.textContent = '';
    }

    // Zielwerte je Arbeitszeit (Netto-Ziel = Tagesarbeitszeit); ohne Startzeit keine Zielwerte.
    // Pausen gelten für alle Arbeitszeiten gleich – Pausen nach einer Zielzeit verschieben diese nicht.
    // Countdown: Uhr-Abstand zur Zielzeit – läuft anders als „Rest“ (Netto) auch während Pausen weiter;
    // gleiche Vorzeichen-Logik wie „Rest“ (negativ = noch bis Ziel, positiv = Ziel überschritten).
    const targets = getWorkTargets().map(t => {
        if (!hasStart) return t;
        const targetEndMin = computeClockTimeForNetMinutes(startMin, t.min, pauseIntervals);
        return {
            ...t,
            targetEndMin,
            countdown:        startMin + clockSinceStartMin - targetEndMin,
            remaining:        netWorkMin - t.min,
            progressUncapped: Math.max(0, (netWorkMin / t.min) * 100)
        };
    });
    // Relevante Zeile leer/ungültig → erste gültige Arbeitszeit
    const relevantTarget  = targets.find(t => t.index === relevantIndex) ?? targets[0] ?? null;
    const resolvedTargets = targets.filter(t => t.targetEndMin !== undefined);

    renderTargetStats(targets, relevantTarget);
    updateStatCardSelection();
    updateTitle({ netWorkMin, allPauseMin, elapsedPauseMin, nextStartMin, relevantTarget, multipleTargets: targets.length > 1 });

    // Warnschwellen (6h/9h/Höchstarbeitszeit) als Uhrzeit-Marker für den Zeitstrahl, mit Bezug zum "Jetzt"-Zeiger.
    // Pflichtpausen-Schwellen (6h/9h) werden ausgeblendet, sobald die Pausen des Tages insgesamt
    // (genommen + geplant) ausreichen – wann die Pause liegt, ist für die Regel unerheblich.
    const warnMarkersAll = [
        { thresholdMin: 360, label: '6h', requiredPauseMin: 30,   active: netWorkMin > 360 && allPauseMin < 30 },
        { thresholdMin: 540, label: '9h', requiredPauseMin: 45,   active: netWorkMin > 540 && allPauseMin < 45 },
        { thresholdMin: maxWorkMin, label: `${formatDuration(maxWorkMin).replace(/:00$/, '')}h`, requiredPauseMin: null, active: netWorkMin > maxWorkMin }
    ].map(w => {
        const clockMin         = computeClockTimeForNetMinutes(startMin, w.thresholdMin, pauseIntervals);
        const alreadySatisfied = w.requiredPauseMin !== null && allPauseMin >= w.requiredPauseMin;
        return { clockMin, label: w.label, requiredPauseMin: w.requiredPauseMin, active: w.active, visible: !alreadySatisfied };
    });
    const warnMarkers = warnMarkersAll.filter(w => w.visible);

    // Dynamische Länge der Zeitachse: wächst mit, damit verstrichene Zeit, Zielzeit, die Höchstarbeitszeit
    // und geplante Pausen immer sichtbar sind, statt bei einer fixen Länge abgeschnitten zu werden.
    const maxWorkClockMin = computeClockTimeForNetMinutes(startMin, maxWorkMin, pauseIntervals);
    let axisMaxDuration = Math.max(minTimelineDuration, elapsedMin, maxWorkClockMin - startMin);
    resolvedTargets.forEach(t => {
        axisMaxDuration = Math.max(axisMaxDuration, t.targetEndMin - startMin);
    });
    effectivePauses.forEach(p => {
        axisMaxDuration = Math.max(axisMaxDuration, p.startMin + p.durationMin - startMin);
    });
    axisMaxDuration = Math.ceil((axisMaxDuration + 15) / 60) * 60; // aufrunden + etwas Platz am rechten Rand

    const targetMarkers = resolvedTargets.map(t => ({ endMin: t.targetEndMin, relevant: t === relevantTarget }));
    const targetEnds    = resolvedTargets.map(t => ({
        label:  resolvedTargets.length > 1 ? `Tagesziel ${t.label}` : 'Tagesziel',
        endMin: t.targetEndMin
    }));

    renderPauseList(currentMinOfDay, effectivePauses, runningPauseMin);
    renderWarnings(netWorkMin, allPauseMin, warnMarkersAll, maxWorkMin);
    updateSettingsSummaries(targets, effectivePauses, allPauseMin);
    drawTimeline(elapsedMin, startMin, currentMinOfDay, runningPauseMin, targetMarkers, warnMarkers, effectivePauses, axisMaxDuration);
    updateTimelineRangeWarning(startMin, targetEnds, startMin + elapsedMin);
    updateUrlParams();

    dom.lastUpdate.textContent =
        `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
}
