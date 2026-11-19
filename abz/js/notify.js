/**
 * Arbeitszeit-Tracker – Browser-Benachrichtigungen: Zielzeit je Arbeitszeit sowie Beginn und Ende von Pausen.
 *
 * Jede Arbeitszeit-Zeile (row.notify) und jede eingetragene Pause (pause.notify) hat eine eigene Glocke;
 * automatisch ergänzte Pflichtpausen teilen sich einen gemeinsamen Schalter (notifyAutoPauses), da sie bei
 * jedem Update neu berechnet werden. Der Hauptschalter (notifyEnabled) schaltet alles stumm. Alles ist
 * standardmäßig aus und wird – wie die übrigen Einstellungen – nur in der URL gemerkt.
 *
 * Benachrichtigt wird nur, solange die Seite geöffnet ist: Bei jedem Update (alle 10 s, im Hintergrund
 * vom Browser ggf. auf einmal je Minute gedrosselt) wird geprüft, welche Zeitpunkte seit dem letzten
 * Update überschritten wurden.
 */
'use strict';

const notifySupported = 'Notification' in window;
// Ereignisse, die länger als so viele Minuten zurückliegen (z. B. nach Standby), nicht mehr melden
const notifyMaxLateMin = 10;

const notifyDom = {
    toggle:         document.getElementById('notifyToggle'),
    labelOff:       document.getElementById('notifyLabelOff'),
    labelOn:        document.getElementById('notifyLabelOn'),
    autoPauses:     document.getElementById('notifyAutoPausesToggle'),
    autoPausesWrap: document.getElementById('notifyAutoPausesOption'),
    permissionBtn:  document.getElementById('notifyPermissionBtn'),
    testBtn:        document.getElementById('notifyTestBtn'),
    hint:           document.getElementById('notifyHint'),
    summary:        document.getElementById('notifySummary')
};

let notifyLastNowMin  = null;     // Minute (Bezugssystem ab Startzeit) des letzten Updates
let notifyLastCheckMs = 0;        // Date.now() des letzten Updates
const notifyFired     = new Set(); // bereits gemeldete Ereignisse, damit nichts doppelt kommt

/** Glocken-Symbol; im ausgeschalteten Zustand durchgestrichen (per CSS über .active) */
function bellIconSvg() {
    return '<svg class="bell-icon" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">'
        + '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>'
        + '<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'
        + '<line class="bell-slash" x1="3" y1="3" x2="21" y2="21"/>'
        + '</svg>';
}

/** Setzt Zustand, Tooltip und ARIA einer Glocke */
function setBellState(btn, active, what) {
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    const text = `Benachrichtigung ${what}: ${active ? 'an' : 'aus'} (klicken zum ${active ? 'Ausschalten' : 'Einschalten'})`;
    btn.title = text;
    btn.setAttribute('aria-label', text);
}

// ── SCHALTER ──────────────────────────────────────────────────────────

/** Hauptschalter im Bereich „Benachrichtigungen“ */
function toggleNotifyEnabled() {
    notifyEnabled = notifyDom.toggle.checked;
    if (notifyEnabled) requestNotifyPermission();
    updateTracker();
}

/** Schaltet eine einzelne Glocke ein und dabei – falls nötig – auch den Hauptschalter */
function enableNotifyForElement() {
    if (notifyEnabled) return;
    notifyEnabled = true;
    notifyDom.toggle.checked = true;
    requestNotifyPermission();
}

function toggleNotifyWorkTime(index) {
    const row = workTimeRows[index];
    if (!row) return;
    row.notify = !row.notify;
    if (row.notify) enableNotifyForElement();
    updateTracker();
}

function toggleNotifyPause(index) {
    const p = pauses[index];
    if (!p) return;
    p.notify = !p.notify;
    if (p.notify) enableNotifyForElement();
    updateTracker();
}

/** Gemeinsamer Schalter für alle automatisch ergänzten Pflichtpausen (Checkbox oder Glocke an einer Pflichtpause) */
function toggleNotifyAutoPauses(value = !notifyAutoPauses) {
    notifyAutoPauses = value;
    notifyDom.autoPauses.checked = value;
    if (value) enableNotifyForElement();
    updateTracker();
}

/** Muss aus einer Benutzeraktion heraus aufgerufen werden, sonst blockiert der Browser die Abfrage */
function requestNotifyPermission() {
    if (!notifySupported || Notification.permission !== 'default') return;
    const done = () => updateTracker();
    // Ältere Safari-Versionen kennen nur die Callback-Variante
    const result = Notification.requestPermission(done);
    if (result && typeof result.then === 'function') result.then(done, done);
}

function sendTestNotification() {
    if (notifySupported && Notification.permission === 'default') {
        Notification.requestPermission().then(() => { updateTracker(); sendTestNotification(); });
        return;
    }
    showNotification('Test-Benachrichtigung', 'So sehen Benachrichtigungen des Arbeitszeit-Trackers aus.', 'abz-test');
}

// ── ANZEIGEN ──────────────────────────────────────────────────────────

function showNotification(title, body, tag) {
    if (!notifySupported || Notification.permission !== 'granted') return;
    const options = { body, tag, icon: '../assets/img/favicon.svg' };
    try {
        const n = new Notification(title, options);
        n.onclick = () => { window.focus(); n.close(); };
    } catch (e) {
        // z. B. Chrome auf Android: Benachrichtigungen nur über einen Service Worker möglich
        if (navigator.serviceWorker) {
            navigator.serviceWorker.getRegistration()
                .then(reg => reg && reg.showNotification(title, options))
                .catch(() => {});
        }
    }
}

// ── PRÜFEN (bei jedem Update) ─────────────────────────────────────────

/**
 * Alle eingeschalteten Ereignisse mit ihrem Zeitpunkt im Bezugssystem ab Startzeit (wie targetEndMin:
 * nach Mitternacht fortlaufend über 1440 hinaus).
 */
function collectNotifyEvents(ctx) {
    const events = [];
    if (!ctx.hasStart) return events;

    // Pausen sind als Minuten ab Mitternacht gespeichert; nach Mitternacht liegende Pausen in das Bezugssystem holen
    const toFrame = min => {
        let rel = min - ctx.startMin;
        if (rel < -120) rel += 1440;
        return ctx.startMin + rel;
    };

    ctx.targets.forEach(t => {
        const row = workTimeRows[t.index];
        if (t.targetEndMin === undefined || !row || !row.notify) return;
        events.push({
            key:   `target:${t.min}`,
            atMin: t.targetEndMin,
            title: `Zielzeit erreicht: ${t.label}`,
            body:  `Die Arbeitszeit von ${t.label} ist um ${formatMinutesToTime(t.targetEndMin)} Uhr erreicht.`
        });
    });

    ctx.pauses.forEach(p => {
        if (p.isDraft || !(p.isAuto ? notifyAutoPauses : p.notify)) return;
        const kind  = p.isAuto ? 'Pflichtpause' : 'Pause';
        const range = `${formatMinutesToTime(p.startMin)}–${formatMinutesToTime(p.startMin + p.durationMin)}`;
        const start = toFrame(p.startMin);
        events.push({
            key:   `pause-start:${p.startMin}+${p.durationMin}`,
            atMin: start,
            title: `${kind} beginnt`,
            body:  `${kind} ${range} Uhr (${p.durationMin} min)`
        });
        events.push({
            key:   `pause-end:${p.startMin}+${p.durationMin}`,
            atMin: start + p.durationMin,
            title: `${kind} endet`,
            body:  `Die ${kind} ${range} Uhr ist vorbei.`
        });
    });
    return events;
}

/**
 * Meldet alle Ereignisse, deren Zeitpunkt seit dem letzten Update erreicht wurde. Beim ersten Update
 * nach dem Laden wird nichts nachgeholt; ebenso nicht, wenn eine Eingabe einen Zeitpunkt in die
 * Vergangenheit verschiebt (dann liegt er nicht im Fenster seit dem letzten Update).
 */
function checkNotifications(ctx) {
    const last   = notifyLastNowMin;
    const lastMs = notifyLastCheckMs;
    notifyLastNowMin  = ctx.nowMin;
    notifyLastCheckMs = Date.now();
    if (!notifyEnabled || last === null || ctx.nowMin <= last) return;
    // Springt das Bezugssystem (z. B. Startzeit so geändert, dass „jetzt“ als nach Mitternacht gilt),
    // passt der Fortschritt nicht zur tatsächlich vergangenen Zeit → nichts melden
    const realElapsedMin = (notifyLastCheckMs - lastMs) / 60000;
    if (Math.abs((ctx.nowMin - last) - realElapsedMin) > 1.5) return;
    if (!notifySupported || Notification.permission !== 'granted') return;

    collectNotifyEvents(ctx).forEach(ev => {
        if (ev.atMin <= last || ev.atMin > ctx.nowMin) return;
        if (ctx.nowMin - ev.atMin > notifyMaxLateMin) return;
        const id = `${ev.key}@${ev.atMin}`;
        if (notifyFired.has(id)) return;
        notifyFired.add(id);
        showNotification(ev.title, ev.body, `abz-${id}`);
    });
}

// ── OBERFLÄCHE ────────────────────────────────────────────────────────

/** Hauptschalter, Hinweistext, Kurzfassung und die Glocken der Arbeitszeit-Zeilen aktualisieren */
function updateNotifyUi(targets) {
    const permission = notifySupported ? Notification.permission : 'unsupported';

    notifyDom.toggle.checked = notifyEnabled;
    notifyDom.labelOff.classList.toggle('active', !notifyEnabled);
    notifyDom.labelOn.classList.toggle('active', notifyEnabled);
    notifyDom.autoPauses.checked = notifyAutoPauses;
    notifyDom.autoPausesWrap.style.display = autoPauseMode ? '' : 'none';
    notifyDom.permissionBtn.style.display  = notifyEnabled && permission === 'default' ? '' : 'none';
    notifyDom.testBtn.disabled             = permission === 'unsupported' || permission === 'denied';
    document.body.classList.toggle('notify-off', !notifyEnabled);

    let problem = '';
    if (permission === 'unsupported') problem = 'Dieser Browser unterstützt keine Benachrichtigungen.';
    else if (permission === 'denied') problem = 'Benachrichtigungen sind für diese Seite im Browser blockiert – bitte in den Website-Einstellungen erlauben.';
    else if (notifyEnabled && permission === 'default') problem = 'Der Browser hat Benachrichtigungen noch nicht erlaubt.';
    notifyDom.hint.innerHTML = (problem ? `<span class="settings-summary-warning">&#9888; ${problem}</span><br>` : '')
        + 'Die Glocke an einer Arbeitszeit bzw. Pause schaltet die Benachrichtigung zur Zielzeit bzw. zu Beginn und Ende der Pause ein oder aus. '
        + 'Benachrichtigt wird nur, solange diese Seite geöffnet ist.';

    workTimeRows.forEach(row => setBellState(row.notifyBtn, !!row.notify, 'bei Erreichen der Zielzeit'));

    // Kurzfassung für den eingeklappten Bereich
    if (!notifyEnabled) {
        notifyDom.summary.textContent = 'Aus';
        return;
    }
    const targetCount = targets.filter(t => workTimeRows[t.index]?.notify).length;
    const pauseCount  = pauses.filter(p => p.notify).length;
    const parts = ['An'];
    if (targetCount) parts.push(targetCount === 1 ? '1 Zielzeit' : `${targetCount} Zielzeiten`);
    if (pauseCount)  parts.push(pauseCount === 1 ? '1 Pause' : `${pauseCount} Pausen`);
    if (notifyAutoPauses && autoPauseMode) parts.push('Pflichtpausen');
    if (parts.length === 1) parts.push('nichts ausgewählt');
    if (problem) parts.push('<span class="settings-summary-warning">&#9888; nicht erlaubt</span>');
    notifyDom.summary.innerHTML = parts.join(' · ');
}
