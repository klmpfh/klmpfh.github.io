/**
 * Arbeitszeit-Tracker – Zustand, Konstanten und einmalig aufgelöste DOM-Elemente.
 * Wird vor allen anderen App-Dateien geladen; die übrigen Dateien greifen global darauf zu.
 */
'use strict';

// ── ZUSTAND ───────────────────────────────────────────────────────────
let pauses             = [];     // [{ startMin, durationMin }] – Minuten ab Mitternacht
let runningPauseStart  = null;   // Date.now() wenn Pause läuft, sonst null
let addPauseFormVisible= false;
let editingPauseIndex  = null;   // null = neue Pause, number = Bearbeitung
let titleStat          = 'percent'; // welcher Stat-Wert im Seitentitel angezeigt wird
let autoPauseMode      = false;  // true = fehlende Pflichtpausen werden automatisch ergänzt
let workTimeRows       = [];     // [{ el, dailyInput, weeklyInput, relevantBtn }] – eingegebene Arbeitszeiten
let workTimeRowUid     = 0;      // fortlaufend für eindeutige Feld-IDs
let relevantIndex      = 0;      // Zeile in workTimeRows, deren Werte im Seitentitel stehen
let notifyEnabled      = false;  // Hauptschalter Benachrichtigungen (einzelne: row.notify, pause.notify)
let notifyAutoPauses   = false;  // Benachrichtigung für automatisch ergänzte Pflichtpausen

const titleStatLabels = {
    percent: 'Fortschritt',
    target:  'Zielzeit',
    countdown: 'Countdown bis Ziel',
    net:    'Netto-Arbeitszeit',
    pause:   'Pausen gesamt',
    pauseElapsed: 'Verstrichene Pausenzeit',
    nextStart: 'Frühester Start morgen',
    diff:    'Rest / Überziehung'
};
// Höchstarbeitszeit je 24h ab Arbeitsbeginn (§3 ArbZG: „werktäglich“ = 24h ab Arbeitsbeginn) und
// Mindestruhezeit zwischen Ende und nächstem Start (§5 ArbZG). Betrieblich/tariflich abweichend einstellbar.
const defaultMaxWorkMin = 600;
const defaultRestMin    = 660;
const minTimelineDuration = 660; // 11h – Mindestlänge der X-Achse in Minuten, wächst bei Bedarf mit
// Standard-Uhrzeit-Ausschnitt der X-Achse (Felder „Zeitstrahl von/bis“). Leeres Feld → Achse
// beginnt bei der Startzeit bzw. wächst dynamisch (siehe minTimelineDuration).
const defaultTimelineFrom = '06:30';
const defaultTimelineTo   = '20:00';

// ── DOM (einmalig auflösen statt bei jedem Update neu zu suchen) ───────
const startTimeInput    = document.getElementById('startTime');
const maxWorkInput      = document.getElementById('maxWorkTime');
const restInput         = document.getElementById('restTime');
const timelineFromInput = document.getElementById('timelineFrom');
const timelineToInput   = document.getElementById('timelineTo');
const svg               = document.getElementById('timelineSvg');

const dom = {
    pauseToggleBtn:         document.getElementById('pauseToggleBtn'),
    runningPauseDisplay:    document.getElementById('runningPauseDisplay'),
    runningPauseStartLabel: document.getElementById('runningPauseStartLabel'),
    runningPauseDuration:   document.getElementById('runningPauseDuration'),
    addPauseForm:           document.getElementById('addPauseForm'),
    addPauseFormTitle:      document.getElementById('addPauseFormTitle'),
    addPauseConfirmBtn:     document.getElementById('addPauseConfirmBtn'),
    pauseFromInput:         document.getElementById('pauseFromInput'),
    pauseToInput:           document.getElementById('pauseToInput'),
    addPauseBtn:            document.getElementById('addPauseBtn'),
    autoPauseToggle:        document.getElementById('autoPauseToggle'),
    autoPauseLabelManual:   document.getElementById('autoPauseLabelManual'),
    autoPauseLabelAuto:     document.getElementById('autoPauseLabelAuto'),
    autoPauseHint:          document.getElementById('autoPauseHint'),
    pauseList:              document.getElementById('pauseList'),
    legalWarnings:          document.getElementById('legalWarnings'),
    workTimeList:           document.getElementById('workTimeList'),
    statNetWork:            document.getElementById('statNetWork'),
    statPauseTotal:         document.getElementById('statPauseTotal'),
    statPauseElapsed:       document.getElementById('statPauseElapsed'),
    statNextStart:          document.getElementById('statNextStart'),
    statNextStartHint:      document.getElementById('statNextStartHint'),
    targetStats:            document.getElementById('targetStats'),
    lastUpdate:             document.getElementById('lastUpdate'),
    timelineRangeWarning:     document.getElementById('timelineRangeWarning'),
    timelineRangeWarningText: document.getElementById('timelineRangeWarningText'),
    timesSummary:           document.getElementById('timesSummary'),
    pausesSummary:          document.getElementById('pausesSummary'),
};

// Einklappbare Einstellungsbereiche; Schlüssel = Wert im URL-Parameter „collapsed“
const settingsPanels = {
    times:  document.getElementById('timesPanel'),
    pauses: document.getElementById('pausesPanel'),
    notify: document.getElementById('notifyPanel')
};

// Kacheln der gemeinsamen Werte; die Kacheln je Arbeitszeit entstehen dynamisch (renderTargetStats)
const titleStatCards = {
    net:     document.getElementById('statCardNet'),
    pause:   document.getElementById('statCardPause'),
    pauseElapsed: document.getElementById('statCardPauseElapsed'),
    nextStart: document.getElementById('statCardNextStart')
};

function readMaxWorkMin() { return parseDuration(maxWorkInput.value) || defaultMaxWorkMin; }
function readRestMin()    { return parseDuration(restInput.value)    || defaultRestMin; }
