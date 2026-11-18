/**
 * Arbeitszeit-Tracker – Pausen: Modus (manuell/automatisch), Steuerung, Formular, Liste und Warnungen.
 */
'use strict';

// ── PAUSEN-MODUS (manuell / automatische Pflichtpausen) ─────────────────

/**
 * Schaltet zwischen rein manueller Pauseneingabe und der automatischen Ergänzung von Pflichtpausen um.
 * Manuelle Pausen bleiben in beiden Modi erhalten; im Automatik-Modus werden nur die noch fehlenden
 * Pflichtpausen-Minuten zusätzlich eingeplant.
 */
function toggleAutoPauseMode() {
    autoPauseMode = dom.autoPauseToggle.checked;
    updatePauseControlsAvailability();
    updateTracker();
}

/** Hebt den aktiven Modus hervor und blendet den Hinweis zum Automatik-Modus ein/aus */
function updatePauseControlsAvailability() {
    dom.autoPauseLabelManual.classList.toggle('active', !autoPauseMode);
    dom.autoPauseLabelAuto.classList.toggle('active', autoPauseMode);
    dom.autoPauseHint.style.display = autoPauseMode ? 'block' : 'none';
}

/**
 * Ergänzt die Pausen des Tages auf insgesamt mindestens requiredPauseMin. Wann die vorhandenen
 * Pausen liegen, spielt keine Rolle – es zählt nur die Gesamtsumme. Fehlende Minuten werden ab
 * Erreichen von thresholdMin Netto-Arbeitsminuten eingeplant; dort bereits liegende Pausen werden
 * übersprungen statt überlagert.
 */
function fillPauseDeficit(startMin, thresholdMin, requiredPauseMin, intervals) {
    const added = [];

    for (let guard = 0; guard < 10; guard++) {
        const merged  = mergePauseIntervals(intervals, startMin);
        const deficit = requiredPauseMin - merged.reduce((sum, iv) => sum + iv.end - iv.start, 0);
        if (deficit <= 0) break;

        let t = computeClockTimeForNetMinutes(startMin, thresholdMin, intervals);
        const current = merged.find(iv => iv.start <= t && t < iv.end);
        if (current) t = current.end;

        const next        = merged.find(iv => iv.start > t);
        const durationMin = next ? Math.min(deficit, next.start - t) : deficit;
        added.push({ startMin: t, durationMin, isAuto: true });
        intervals = [...intervals, { start: t, end: t + durationMin }];
    }
    return added;
}

/**
 * Berechnet die gesetzlichen Pflichtpausen (30 min nach 6h, insgesamt 45 min nach 9h Arbeitszeit),
 * soweit sie nicht schon durch manuelle Pausen abgedeckt sind. Wird bei jedem Update neu berechnet,
 * verschiebt sich also mit Startzeit und manuellen Pausen.
 */
function computeAutoPauses(startMin, manualIntervals) {
    const toInterval = p => ({ start: p.startMin, end: p.startMin + p.durationMin });
    const first  = fillPauseDeficit(startMin, 360, 30, manualIntervals);
    const second = fillPauseDeficit(startMin, 540, 45, [...manualIntervals, ...first.map(toInterval)]);
    return [...first, ...second];
}

// ── PAUSEN-STEUERUNG ──────────────────────────────────────────────────

/** Prüft, ob sich [fromMin, toMin) mit einer bestehenden Pause überschneidet (excludeIndex wird bei Bearbeitung ausgelassen) */
function findOverlappingPauseIndex(fromMin, toMin, excludeIndex) {
    return pauses.findIndex((p, i) => {
        if (i === excludeIndex) return false;
        const pEnd = p.startMin + p.durationMin;
        return fromMin < pEnd && p.startMin < toMin;
    });
}

function isMinuteInsideAnyPause(min) {
    return pauses.some(p => min >= p.startMin && min < p.startMin + p.durationMin);
}

function togglePause() {
    const btn     = dom.pauseToggleBtn;
    const display = dom.runningPauseDisplay;

    if (runningPauseStart === null) {
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        if (isMinuteInsideAnyPause(nowMin)) {
            alert('Jetzt liegt bereits eine eingetragene Pause vor. Bitte diese zuerst bearbeiten oder löschen.');
            return;
        }
        runningPauseStart = Date.now();
        btn.textContent       = 'Pause beenden';
        btn.className         = 'btn-pause-stop';
        display.style.display = 'inline-flex';
        const now = new Date(runningPauseStart);
        dom.runningPauseStartLabel.textContent =
            `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    } else {
        const durationMin   = Math.round((Date.now() - runningPauseStart) / 60000);
        const now           = new Date();
        const endTotalMin   = now.getHours() * 60 + now.getMinutes();
        const startTotalMin = endTotalMin - durationMin;
        if (durationMin > 0) pauses.push({ startMin: startTotalMin, durationMin });
        runningPauseStart       = null;
        btn.textContent         = 'Pause starten';
        btn.className           = 'btn-pause-start';
        display.style.display   = 'none';
    }
    updateTracker();
}

function toggleAddPauseForm() {
    editingPauseIndex   = null;
    addPauseFormVisible = !addPauseFormVisible;
    dom.addPauseForm.style.display = addPauseFormVisible ? 'flex' : 'none';

    if (addPauseFormVisible) {
        dom.addPauseFormTitle.textContent  = 'Pause eintragen:';
        dom.addPauseConfirmBtn.textContent = 'Hinzufügen';
        const now = new Date();
        dom.pauseFromInput.value =
            `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        dom.pauseToInput.value = '';
        dom.pauseToInput.focus();
    }
    updateTracker();
}

function editPause(index) {
    editingPauseIndex   = index;
    addPauseFormVisible = true;
    const p = pauses[index];
    dom.addPauseForm.style.display    = 'flex';
    dom.addPauseFormTitle.textContent  = 'Pause bearbeiten:';
    dom.addPauseConfirmBtn.textContent = 'Speichern';
    dom.pauseFromInput.value = formatMinutesToTime(p.startMin);
    dom.pauseToInput.value   = formatMinutesToTime(p.startMin + p.durationMin);
    dom.pauseFromInput.focus();
    updateTracker();
}

/** Liest die aktuell im Formular stehende (noch nicht gespeicherte) Pause, sofern gültig */
function getDraftPause() {
    if (!addPauseFormVisible) return null;
    const from = dom.pauseFromInput.value;
    const to   = dom.pauseToInput.value;
    if (!from || !to) return null;

    const fromMin = parseTimeToMinutes(from);
    let   toMin   = parseTimeToMinutes(to);
    if (toMin <= fromMin) toMin += 1440;

    const durationMin = toMin - fromMin;
    if (durationMin <= 0) return null;
    return { startMin: fromMin, durationMin };
}

/**
 * Pausenliste inkl. der gerade im Formular eingegebenen Pause, damit Werte und Grafiken schon
 * während der Eingabe/Bearbeitung live aktualisiert werden, bevor bestätigt wird.
 */
function getEffectivePauses(currentMinOfDay) {
    const draft = getDraftPause();
    let manual  = pauses;
    if (draft) {
        manual = editingPauseIndex !== null
            ? pauses.map((p, i) => i === editingPauseIndex ? { ...draft, isDraft: true } : p)
            : [...pauses, { ...draft, isDraft: true }];
    }
    if (!autoPauseMode) return manual;

    // Pflichtpausen hinten anhängen, damit die Indizes der manuellen Pausen (Bearbeiten/Löschen) gleich bleiben
    const startMin = parseTimeToMinutes(startTimeInput.value);
    return [...manual, ...computeAutoPauses(startMin, buildPauseIntervals(currentMinOfDay, manual))];
}

function addPauseFromForm() {
    const from = dom.pauseFromInput.value;
    const to   = dom.pauseToInput.value;
    if (!from || !to) { alert('Bitte Von- und Bis-Uhrzeit eingeben.'); return; }

    const fromMin = parseTimeToMinutes(from);
    let   toMin   = parseTimeToMinutes(to);
    if (toMin <= fromMin) toMin += 1440;

    const durationMin = toMin - fromMin;
    if (durationMin <= 0) { alert('Die Endzeit muss nach der Startzeit liegen.'); return; }

    if (findOverlappingPauseIndex(fromMin, toMin, editingPauseIndex) !== -1) {
        alert('Diese Pause überschneidet sich mit einer bereits eingetragenen Pause.');
        return;
    }

    if (editingPauseIndex !== null) {
        pauses[editingPauseIndex] = { startMin: fromMin, durationMin };
        editingPauseIndex = null;
    } else {
        pauses.push({ startMin: fromMin, durationMin });
    }
    addPauseFormVisible = false;
    dom.addPauseForm.style.display = 'none';
    updateTracker();
}

function deletePause(index) {
    if (editingPauseIndex === index) {
        addPauseFormVisible = false;
        editingPauseIndex   = null;
        dom.addPauseForm.style.display = 'none';
    }
    pauses.splice(index, 1);
    updateTracker();
}

// ── PAUSENLISTE RENDERN ───────────────────────────────────────────────
function renderPauseList(currentMinOfDay, pausesList, runningPauseMin) {
    const list  = dom.pauseList;
    const items = [];

    pausesList.forEach((p, i) => {
        const endMin   = p.startMin + p.durationMin;
        const startStr = formatMinutesToTime(p.startMin);
        const endStr   = formatMinutesToTime(endMin);
        const isFuture = p.startMin > currentMinOfDay;
        const cls      = p.isDraft ? 'pause-future' : (isFuture ? 'pause-future' : 'pause-done');
        const tag      = p.isDraft ? ' <em>(Entwurf)</em>' : (p.isAuto ? ' <em>(Pflichtpause)</em>' : (isFuture ? ' <em>(geplant)</em>' : ''));

        const actions = (p.isDraft || p.isAuto)
            ? ''
            : ` <button class="pause-edit-btn" onclick="editPause(${i})" title="Bearbeiten">✎</button>`
            + ` <button class="pause-delete-btn" onclick="deletePause(${i})" title="Entfernen">×</button>`;

        items.push(
            `<span class="pause-item ${cls}">`
            + `${startStr}–${endStr} · ${p.durationMin} min${tag}`
            + actions
            + `</span>`
        );
    });

    if (runningPauseStart !== null) {
        items.push(`<span class="pause-item pause-running"><span class="running-dot"></span> Läuft (${runningPauseMin} min)</span>`);
    }

    list.innerHTML = items.length > 0
        ? `<div class="pause-items-list">${items.join('')}</div>`
        : '';
}

// ── WARNUNGEN ─────────────────────────────────────────────────────────
/**
 * warnMarkersAll liefert je Schwelle auch die Uhrzeit (clockMin), zu der die Pflichtpause fällig
 * wurde – darüber lässt sich die fehlende Pause per Knopfdruck exakt ab diesem Zeitpunkt eintragen.
 */
function renderWarnings(netWorkMin, allPauseMin, warnMarkersAll, maxWorkMin) {
    const container = dom.legalWarnings;
    const warnings  = [];

    if (!autoPauseMode) {
        warnMarkersAll.forEach(w => {
            if (!w.active || w.requiredPauseMin === null) return;
            const missing = Math.ceil(w.requiredPauseMin - allPauseMin);
            warnings.push(
                `<div class="warning-banner">`
                + `<span>&#9888; Bei über ${w.label} Arbeitszeit sind mindestens ${w.requiredPauseMin} min Pause vorgeschrieben. `
                + `Es fehlen noch <strong>${missing} min</strong>.</span>`
                + `<button type="button" class="btn-add-missing-pause" onclick="addMissingPause(${w.clockMin}, ${missing})">Pause automatisch eintragen</button>`
                + `</div>`
            );
        });
    }

    if (netWorkMin > maxWorkMin) {
        warnings.push(`<div class="warning-banner"><span>&#9888; Die Höchstarbeitszeit von ${formatDuration(maxWorkMin)} h innerhalb von 24 h ist überschritten.</span></div>`);
    }

    container.innerHTML = warnings.join('');
}


/** Trägt die fehlende Pflichtpause automatisch ein, beginnend zum Zeitpunkt, zu dem die Warnung entstand */
function addMissingPause(startClockMin, missingMin) {
    if (autoPauseMode || !(missingMin > 0)) return;

    const fromMin = Math.round(startClockMin);
    const toMin   = fromMin + Math.round(missingMin);

    if (findOverlappingPauseIndex(fromMin, toMin, null) !== -1) {
        alert('Die automatisch erzeugte Pause würde sich mit einer bereits eingetragenen Pause überschneiden. Bitte manuell eintragen.');
        return;
    }

    pauses.push({ startMin: fromMin, durationMin: toMin - fromMin });
    updateTracker();
}
