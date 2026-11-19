/**
 * Arbeitszeit-Tracker – URL-Parameter: Einstellungen und Pausen als Link merken (ohne Speicherung im Browser).
 */
'use strict';

// ── URL-PARAMETER (Tages-/Wochenarbeitszeit & Pausen als Link merken) ───

/** Liest daily/weekly/pauses aus den GET-Parametern und befüllt die Felder */
function loadFromUrlParams() {
    const params = new URLSearchParams(window.location.search);

    // daily/weekly: kommagetrennt, eine Position je Arbeitszeit (alte Links mit nur einem Wert bleiben gültig)
    const dailyList  = (params.get('daily')  || '').split(',');
    const weeklyList = (params.get('weekly') || '').split(',');
    for (let i = 0; i < Math.max(dailyList.length, weeklyList.length); i++) {
        const daily  = (dailyList[i]  || '').trim();
        const weekly = (weeklyList[i] || '').trim();
        if (daily) {
            const min = parseDuration(daily);
            addWorkTimeRow(daily, min > 0 ? formatDuration(min * 5) : '');
        } else if (weekly) {
            const min = parseDuration(weekly);
            addWorkTimeRow(min > 0 ? formatDuration(Math.round(min / 5)) : '', weekly);
        }
    }

    const relevantParam = parseInt(params.get('relevant'), 10);
    if (relevantParam > 0 && relevantParam < workTimeRows.length) {
        relevantIndex = relevantParam;
        updateWorkTimeRelevantButtons();
    }

    const autoPauseParam = params.get('autoPause');
    if (autoPauseParam === '1') {
        autoPauseMode = true;
        dom.autoPauseToggle.checked = true;
    }

    const pausesParam = params.get('pauses');
    if (pausesParam) pauses = parsePausesParam(pausesParam);

    // Benachrichtigungen: Hauptschalter, Pflichtpausen, Positionen der Arbeitszeiten (wie in daily) und der Pausen
    notifyEnabled    = params.get('notify') === '1';
    notifyAutoPauses = params.get('notifyAuto') === '1';
    parseIndexList(params.get('notifyWork')).forEach(i => { if (workTimeRows[i]) workTimeRows[i].notify = true; });
    parseIndexList(params.get('notifyPauses')).forEach(i => { if (pauses[i]) pauses[i].notify = true; });

    // "H:MM"; fehlt der Parameter, bleibt der gesetzliche Standardwert
    const maxWorkParam = parseDuration(params.get('maxWork'));
    if (maxWorkParam > 0) maxWorkInput.value = formatDuration(maxWorkParam);
    const restParam = parseDuration(params.get('rest'));
    if (restParam > 0) restInput.value = formatDuration(restParam);

    const titleStatParam = params.get('titleStat');
    if (titleStatParam && titleStatLabels[titleStatParam]) titleStat = titleStatParam;

    // "HH:MM-HH:MM"; eine leere Seite (z. B. "-20:00") bedeutet „automatisch“
    const timelineParam = params.get('timeline');
    if (timelineParam !== null) {
        const [from = '', to = ''] = timelineParam.split('-');
        timelineFromInput.value = /^\d{1,2}:\d{2}$/.test(from) ? from.padStart(5, '0') : '';
        timelineToInput.value   = /^\d{1,2}:\d{2}$/.test(to)   ? to.padStart(5, '0')   : '';
    }

    // "times,pauses": eingeklappte Einstellungsbereiche
    const collapsed = (params.get('collapsed') || '').split(',');
    Object.entries(settingsPanels).forEach(([key, panel]) => { panel.open = !collapsed.includes(key); });
}

/** "0,2" → [0, 2] (ungültige Einträge entfallen) */
function parseIndexList(str) {
    return (str || '').split(',').map(s => parseInt(s, 10)).filter(i => i >= 0);
}

/** Positionen der Einträge mit gesetztem Merkmal → "0,2" */
function serializeIndexList(list, isSet) {
    return list.map((item, i) => isSet(item) ? i : -1).filter(i => i >= 0).join(',');
}

/** "HH:MM-HH:MM,HH:MM-HH:MM" → [{ startMin, durationMin }] */
function parsePausesParam(str) {
    return str.split(',').map(part => {
        const [from, to] = part.split('-');
        if (!from || !to) return null;
        const fromMin = parseTimeToMinutes(from);
        let   toMin   = parseTimeToMinutes(to);
        if (toMin <= fromMin) toMin += 1440;
        return { startMin: fromMin, durationMin: toMin - fromMin };
    }).filter(p => p && p.durationMin > 0);
}

/** Pausenliste → "HH:MM-HH:MM,HH:MM-HH:MM" */
function serializePausesParam() {
    return pauses
        .map(p => `${formatMinutesToTime(p.startMin)}-${formatMinutesToTime(p.startMin + p.durationMin)}`)
        .join(',');
}

/** Baut einen Query-String, hält ":" und "," aber unkodiert (Lesbarkeit) */
function buildQueryString(paramsObj) {
    return Object.entries(paramsObj)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%3A/g, ':').replace(/%2C/g, ',')}`)
        .join('&');
}

/** Schreibt daily/weekly/pauses/titleStat als GET-Parameter in die URL (ohne Reload/History-Eintrag) */
let lastUrlQuery = null;

function updateUrlParams() {
    const timelineFrom      = timelineFromInput.value;
    const timelineTo        = timelineToInput.value;
    const isDefaultTimeline = timelineFrom === defaultTimelineFrom && timelineTo === defaultTimelineTo;
    // Nur gültige Arbeitszeiten, normalisiert auf H:MM (ein Komma im Feld, z. B. „7,5“, würde sonst die Liste trennen)
    const targets     = getWorkTargets();
    const relevantPos = targets.findIndex(t => t.index === relevantIndex);
    const maxWorkMin  = readMaxWorkMin();
    const restMin     = readRestMin();
    const qs = buildQueryString({
        daily:     targets.map(t => formatDuration(t.min)).join(','),
        weekly:    targets.map(t => formatDuration(t.min * 5)).join(','),
        relevant:  relevantPos > 0 ? String(relevantPos) : '',
        pauses:    serializePausesParam(),
        titleStat: titleStat !== 'percent' ? titleStat : '',
        autoPause: autoPauseMode ? '1' : '',
        maxWork:   maxWorkMin !== defaultMaxWorkMin ? formatDuration(maxWorkMin) : '',
        rest:      restMin !== defaultRestMin ? formatDuration(restMin) : '',
        timeline:  isDefaultTimeline ? '' : `${timelineFrom}-${timelineTo}`,
        collapsed: Object.keys(settingsPanels).filter(key => !settingsPanels[key].open).join(','),
        notify:       notifyEnabled ? '1' : '',
        notifyAuto:   notifyAutoPauses ? '1' : '',
        notifyWork:   serializeIndexList(targets, t => workTimeRows[t.index].notify),
        notifyPauses: serializeIndexList(pauses, p => p.notify)
    });
    if (qs === lastUrlQuery) return;
    lastUrlQuery = qs;
    const newUrl = window.location.pathname + (qs ? '?' + qs : '');
    history.replaceState(null, '', newUrl);
}
