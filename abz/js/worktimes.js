/**
 * Arbeitszeit-Tracker – Arbeitszeiten (mehrere Tages-/Wochenarbeitszeiten) und die Kachel-Zeilen je Arbeitszeit.
 */
'use strict';

// ── ARBEITSZEITEN (mehrere Tages-/Wochenarbeitszeiten) ─────────────────
// Startzeit, Pausen und Zeitstrahl-Ausschnitt gelten für alle; je Arbeitszeit ergeben sich nur
// eigene Zielwerte (Zielzeit, Rest, Fortschritt).

/** Fügt eine Eingabezeile hinzu (Tag ⇄ Woche verknüpft, Woche ÷ 5 = Tag) */
function addWorkTimeRow(daily = '', weekly = '') {
    const uid = workTimeRowUid++;
    const el  = document.createElement('div');
    el.className = 'linked-fields work-time-row';
    el.innerHTML =
          `<div class="input-group">`
        + `<label for="dailyTime${uid}">Tagesarbeitszeit</label>`
        + `<input type="text" id="dailyTime${uid}" class="duration-input" placeholder="H:MM" maxlength="6" aria-label="Tagesarbeitszeit">`
        + `</div>`
        + `<div class="link-indicator" title="Die Felder sind verknüpft (Woche ÷ 5 = Tag)">⇄</div>`
        + `<div class="input-group">`
        + `<label for="weeklyTime${uid}">Wochenarbeitszeit</label>`
        + `<input type="text" id="weeklyTime${uid}" class="duration-input" placeholder="H:MM" maxlength="6" aria-label="Wochenarbeitszeit">`
        + `</div>`
        + `<div class="work-time-move">`
        + `<button type="button" class="work-time-btn work-time-up-btn" title="Nach oben verschieben" aria-label="Nach oben verschieben">▲</button>`
        + `<button type="button" class="work-time-btn work-time-down-btn" title="Nach unten verschieben" aria-label="Nach unten verschieben">▼</button>`
        + `</div>`
        + `<button type="button" class="work-time-btn work-time-relevant-btn" title="Als relevant markieren (Werte im Seitentitel)">☆</button>`
        + `<button type="button" class="work-time-btn work-time-delete-btn" title="Arbeitszeit entfernen">×</button>`;
    dom.workTimeList.appendChild(el);

    const row = {
        el,
        dailyInput:  el.querySelector(`#dailyTime${uid}`),
        weeklyInput: el.querySelector(`#weeklyTime${uid}`),
        relevantBtn: el.querySelector('.work-time-relevant-btn'),
        upBtn:       el.querySelector('.work-time-up-btn'),
        downBtn:     el.querySelector('.work-time-down-btn')
    };
    row.dailyInput.value  = daily;
    row.weeklyInput.value = weekly;

    row.dailyInput.addEventListener('input', () => {
        const min = parseDuration(row.dailyInput.value);
        row.weeklyInput.value = min > 0 ? formatDuration(min * 5) : '';
        markValid(row.dailyInput, min > 0 || !row.dailyInput.value.trim());
        updateTracker();
    });

    row.weeklyInput.addEventListener('input', () => {
        const min = parseDuration(row.weeklyInput.value);
        row.dailyInput.value = min > 0 ? formatDuration(Math.round(min / 5)) : '';
        markValid(row.weeklyInput, min > 0 || !row.weeklyInput.value.trim());
        updateTracker();
    });

    row.upBtn.addEventListener('click',   () => moveWorkTimeRow(workTimeRows.indexOf(row), -1));
    row.downBtn.addEventListener('click', () => moveWorkTimeRow(workTimeRows.indexOf(row), 1));
    row.relevantBtn.addEventListener('click', () => selectRelevantWorkTime(workTimeRows.indexOf(row)));
    el.querySelector('.work-time-delete-btn').addEventListener('click', () => deleteWorkTimeRow(workTimeRows.indexOf(row)));

    workTimeRows.push(row);
    updateWorkTimeRelevantButtons();
    return row;
}

/** „+ Arbeitszeit“: neue leere Zeile, Cursor direkt ins Tagesfeld */
function addWorkTimeRowAndFocus() {
    addWorkTimeRow().dailyInput.focus();
}

/** Entfernt eine Zeile (mindestens eine bleibt); war sie relevant, wird die erste relevant */
function deleteWorkTimeRow(index) {
    if (workTimeRows.length <= 1 || index < 0) return;
    const [row] = workTimeRows.splice(index, 1);
    row.el.remove();
    if (relevantIndex === index)    relevantIndex = 0;
    else if (relevantIndex > index) relevantIndex--;
    updateWorkTimeRelevantButtons();
    updateTracker();
}

/**
 * Verschiebt eine Zeile um delta Positionen (−1 = nach oben, +1 = nach unten). Die Reihenfolge
 * bestimmt auch die Reihenfolge der Kachel-Zeilen und der Werte in der URL; die Markierung
 * „relevant“ bleibt an ihrer Zeile.
 */
function moveWorkTimeRow(index, delta) {
    const newIndex = index + delta;
    if (index < 0 || newIndex < 0 || newIndex >= workTimeRows.length) return;

    const relevantRow = workTimeRows[relevantIndex];
    const [row] = workTimeRows.splice(index, 1);
    workTimeRows.splice(newIndex, 0, row);
    dom.workTimeList.insertBefore(row.el, workTimeRows[newIndex + 1]?.el ?? null);
    if (relevantRow) relevantIndex = workTimeRows.indexOf(relevantRow);

    // Fokus beim geklickten Pfeil lassen; ist er am Rand jetzt unsichtbar, auf den anderen wechseln
    const atEdge = delta < 0 ? newIndex === 0 : newIndex === workTimeRows.length - 1;
    const clicked = delta < 0 ? row.upBtn : row.downBtn;
    const other   = delta < 0 ? row.downBtn : row.upBtn;
    (atEdge ? other : clicked).focus();

    updateWorkTimeRelevantButtons();
    updateTracker();
}

/** Stern an der Eingabezeile: ★ = relevant, ☆ = nicht relevant */
function updateWorkTimeRelevantButtons() {
    workTimeRows.forEach((row, i) => {
        const active = i === relevantIndex;
        row.relevantBtn.classList.toggle('active', active);
        row.relevantBtn.textContent = active ? '★' : '☆';
        row.relevantBtn.setAttribute('aria-pressed', String(active));
    });
}

/** Gültige Arbeitszeiten als { index, min, label }; index = Zeile in workTimeRows, label = Tageswert */
function getWorkTargets() {
    return workTimeRows
        .map((row, index) => ({ index, min: parseDuration(row.dailyInput.value) }))
        .filter(t => t.min > 0)
        .map(t => ({ ...t, label: `${formatDuration(t.min)} h` }));
}

// ── WERTE JE ARBEITSZEIT ──────────────────────────────────────────────
// Struktur nur neu aufbauen, wenn sich Anzahl/Werte der Arbeitszeiten ändern, sonst nur Zahlen
// aktualisieren (vermeidet Flackern und verlorenen Hover beim 10-Sekunden-Takt).
let targetStatsSignature = null;

function targetStatRowHtml(index) {
    const card = (stat, label, extra = '') =>
          `<div class="stat-card selectable" data-stat="${stat}" onclick="selectTitleStat('${stat}', ${index})" title="Klicken, um diesen Wert im Seitentitel anzuzeigen">`
        + `<div class="stat-label">${label}</div><div class="stat-value muted">–</div>${extra}</div>`;
    // Arbeitszeit-Kachel kann nicht in den Titel; relevant markieren über ☆ oder die übrigen Kacheln der Zeile
    return `<div class="stat-row">`
        + `<div class="stat-card" data-stat="worktime">`
        + `<div class="stat-label">Arbeitszeit</div><div class="stat-value">–</div><div class="stat-hint stat-hint-compact"></div></div>`
        + card('target', 'Zielzeit')
        + card('countdown', 'Countdown bis Ziel')
        + card('diff', 'Rest / Überziehung')
        + card('percent', 'Fortschritt', '<div class="stat-progress-bar"><div class="stat-progress-fill"></div></div>')
        + `</div>`;
}

/** Eine Zeile je gültiger Arbeitszeit; ohne gültige Arbeitszeit eine Platzhalterzeile mit „–“ */
function renderTargetStats(targets, relevantTarget) {
    const rows      = targets.length ? targets : [null];
    const signature = rows.map(t => t ? `${t.index}:${t.min}` : '–').join('|');
    if (signature !== targetStatsSignature) {
        targetStatsSignature = signature;
        dom.targetStats.innerHTML = rows.map(t => targetStatRowHtml(t ? t.index : null)).join('');
    }

    rows.forEach((t, r) => {
        const rowEl      = dom.targetStats.children[r];
        const card       = stat => rowEl.querySelector(`[data-stat="${stat}"]`);
        const setValue   = (stat, text, cls) => {
            const el = card(stat).querySelector('.stat-value');
            el.textContent = text;
            el.className   = 'stat-value' + (cls ? ' ' + cls : '');
        };
        const isRelevant = t === relevantTarget; // Platzhalterzeile: beide null
        const hasValues  = !!t && t.targetEndMin !== undefined;

        const workTimeCard = card('worktime');
        workTimeCard.classList.toggle('relevant', isRelevant && !!t);
        workTimeCard.querySelector('.stat-label').textContent = isRelevant && targets.length > 1 ? '★ Arbeitszeit' : 'Arbeitszeit';
        setValue('worktime', t ? t.label : '–', t ? '' : 'muted');
        workTimeCard.querySelector('.stat-hint').textContent = t ? `${formatDuration(t.min * 5)} h / Woche` : '';

        const selectableStats = ['target', 'countdown', 'diff', 'percent'];
        // Countdown nur zeigen, wenn er sich (angezeigt) von „Rest / Überziehung“ unterscheidet, z. B. nach Pausen
        let countdownRedundant = false;
        if (hasValues) {
            const countdownText = formatDifference(t.countdown);
            const diffText      = formatDifference(t.remaining);
            countdownRedundant  = countdownText === diffText;
            setValue('target',    formatMinutesToTime(t.targetEndMin), '');
            setValue('countdown', countdownText, t.countdown >= 0 ? 'pos' : 'neg');
            setValue('diff',      diffText, t.remaining >= 0 ? 'pos' : 'neg');
            setValue('percent',   `${t.progressUncapped.toFixed(1)} %`, '');
        } else {
            selectableStats.forEach(stat => setValue(stat, '–', 'muted'));
        }
        card('countdown').classList.toggle('redundant', countdownRedundant);
        rowEl.querySelector('.stat-progress-fill').style.width = hasValues ? `${Math.min(100, t.progressUncapped)}%` : '0%';

        selectableStats.forEach(stat => card(stat).classList.toggle('selected', isRelevant && titleStat === stat));
    });
}
