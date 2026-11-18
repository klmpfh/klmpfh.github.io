/**
 * Sport – Sport-Modus: Vollbild-Schritt-für-Schritt-Timer.
 */
'use strict';

/* =====================================================================
 * Sport-Modus: Vollbild-Schritt-für-Schritt-Timer
 * ---------------------------------------------------------------------
 * Zerlegt das aktuelle Training in eine flache Liste von "Schritten"
 * (Aufwärmen, Satz mit Haltezeit, Satz mit Wiederholungen ohne Timer,
 * Pause). Zeitbasierte Schritte (Aufwärmen, Haltezeit-Sätze) müssen
 * manuell gestartet werden. Pausen starten dagegen sofort automatisch,
 * weil der Klick, der zur Pause geführt hat (Timer-Ablauf, "Satz
 * erledigt" oder "Überspringen"), bereits als Start-Signal zählt.
 * Schritte ohne feste Zeit (Wiederholungen) haben keinen Timer.
 * ===================================================================== */
var sportState = null;   // { steps, index, remaining, running, deadline, intervalId, lastBeepSecond, elapsedStart, elapsedIntervalId, elapsedTotalSec }
var wakeLockSentinel = null;
var COOLDOWN_DURATION_SEC = 300; // Cool-down-Timer auf der Abschlussseite: ca. 5 Minuten Dehnzeit

// Baut die flache Schrittliste für den Sport-Modus aus dem aktuellen Training.
function buildSportSteps(workout) {
    var steps = [];

    workout.warmup.forEach(function (ex, i) {
        steps.push({
            kind: "warmup",
            exercise: ex,
            duration: 45,
            stepLabel: "Aufwärmen " + (i + 1) + " / " + workout.warmup.length
        });
    });

    // Einheit für Einheit (Einzelübung oder Supersatz), Runde für
    // Runde: je Runde ein Satz jeder Übung der Einheit, danach die
    // Pause (siehe unitRounds). unit = Index der ersten Übung der
    // Einheit, für die Fortschrittsleiste.
    var units = workoutUnits(workout);
    units.forEach(function (members, u) {
        var rounds = unitRounds(workout, members);
        rounds.forEach(function (round, r) {
            round.members.forEach(function (exIndex) {
                var ex = workout.exercises[exIndex];
                var cfg = exerciseCfg(workout, exIndex);
                var partner = pairPartner(workout, exIndex);
                var step = {
                    exercise: ex, exIndex: exIndex, unit: members[0], setIndex: round.setIndex, totalSets: cfg.sets,
                    partnerName: partner === -1 ? null : workout.exercises[partner].name
                };
                if (ex.type === "time") {
                    step.kind = "work-time";
                    step.duration = cfg.holdSec;
                } else {
                    step.kind = "work-reps";
                    step.repsMin = cfg.repsMin;
                    step.repsMax = cfg.repsMax;
                }
                steps.push(step);
            });
            var isLastRound = r === rounds.length - 1;
            if (!(isLastRound && u === units.length - 1)) {
                steps.push({ kind: "rest", exIndex: round.members[round.members.length - 1], unit: members[0], members: members, duration: round.rest });
            }
        });
    });

    steps.push({ kind: "done", cooldownEnabled: workout.cooldownEnabled });
    return steps;
}

// Geschätzte Dauer eines Schritts in Sekunden (Wdh.-Sätze wie in
// workSeconds mit ca. 3 Sek. je Wdh.).
function stepSeconds(step) {
    if (step.kind === "work-reps") return ((step.repsMin + step.repsMax) / 2) * 3;
    return step.duration || 0;
}

// Aufteilung der Fortschrittsleiste nach geschätzter Dauer: jeder
// Schritt bekommt so viel Platz, wie er voraussichtlich Zeit braucht -
// eine kurze Aufwärm-Übung also deutlich weniger als eine Hauptübung
// samt Sätzen und Pausen. starts[i] = Position (%), an der Schritt i
// beginnt ("done" = 100); markers = Übergänge, major = Wechsel der
// Einheit (Aufwärm-Übung, Hauptübung bzw. Supersatz).
function buildProgressLayout(steps) {
    var total = 0;
    steps.forEach(function (step) { if (step.kind !== "done") total += stepSeconds(step); });
    var starts = [];
    var markers = [];
    var elapsed = 0;
    var prevKey = null;
    steps.forEach(function (step, i) {
        if (step.kind === "done") {
            starts[i] = 100;
            return;
        }
        var pos = total > 0 ? elapsed / total * 100 : 0;
        var key = step.kind === "warmup" ? "w" + i : "e" + step.unit;
        starts[i] = pos;
        if (i > 0) markers.push({ pos: pos, major: key !== prevKey });
        prevKey = key;
        elapsed += stepSeconds(step);
    });
    return { starts: starts, markers: markers };
}

function renderProgressMarkers(markers) {
    sportProgressMarkersEl.innerHTML = markers.map(function (m) {
        return "<div class=\"sport-progress-marker" + (m.major ? " is-exercise" : "") + "\" style=\"left:" + m.pos + "%\"></div>";
    }).join("");
}

function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
}

// "Sätze werden heruntergezählt": zeigt zusätzlich zur Satzposition an,
// wie viele Sätze danach noch folgen.
function remainingSetsText(setIndex, totalSets) {
    var remaining = totalSets - setIndex;
    if (remaining <= 0) return "letzter Satz";
    if (remaining === 1) return "noch 1 Satz danach";
    return "noch " + remaining + " Sätze danach";
}

function workSubInfo(step) {
    var text = remainingSetsText(step.setIndex, step.totalSets);
    return step.partnerName ? "Supersatz mit " + step.partnerName + " · " + text : text;
}

// "Als Nächstes"-Block am Ende des Pause-Bildschirms: Name, Vorgabe
// und Anleitung der folgenden Übung, damit man sich während der Pause
// auf die Ausführung vorbereiten kann. Bei einer Wiederholungs-Übung
// (die selbst keinen Timer hat) steht hier schon die Ziel-
// Wiederholungszahl, damit sie sichtbar ist, bevor der Satz beginnt.
function sportNextHtml(next) {
    if (!next) return "";
    if (!next.exercise) {
        return next.kind === "done"
            ? "<div class=\"sport-next\"><div class=\"sport-section-title\">Als Nächstes</div><p class=\"sport-desc\">Letzter Schritt – gleich geschafft!</p></div>"
            : "";
    }
    var target = next.kind === "work-reps"
        ? next.repsMin + "–" + next.repsMax + " Wiederholungen"
        : next.duration + " Sek. halten";
    return "" +
        "<div class=\"sport-next\">" +
        "  <div class=\"sport-section-title\">Als Nächstes</div>" +
        "  <h3 class=\"sport-next-name\">" + next.exercise.name + "</h3>" +
        "  <div class=\"sport-set-info\">" + target + " · Satz " + next.setIndex + " / " + next.totalSets + "</div>" +
        (next.partnerName ? "  <div class=\"sport-sub-info\">Supersatz mit " + next.partnerName + "</div>" : "") +
        sportDetailsHtml(next.exercise) +
        "</div>";
}

function overallStepLabel(step) {
    if (step.kind === "warmup") return "Aufwärmen";
    if (step.kind === "done") return "Fertig";
    return "Übung " + (step.exIndex + 1) + " / " + currentWorkout.exercises.length;
}

// Geräte-Namen einer Übung als lesbare Liste ("Sportmatte, Wand zum
// Anlehnen") oder "" ohne Geräteanforderung - Basis für die
// Geräte-Anzeige im Sport-Modus (siehe renderSportStep).
function equipmentLabelList(ex) {
    if (!ex.equipment || ex.equipment.length === 0) return "";
    return ex.equipment.map(function (code) { return EQUIPMENT_META[code].label; }).join(", ");
}

// Anleitung einer Übung (Beschreibung, Muskeln, Gerät). Steht auf
// allen Seiten unter den Buttons, damit Timer und Start/Weiter auch
// bei langen Beschreibungen ohne Scrollen erreichbar bleiben.
function sportDetailsHtml(ex) {
    if (!ex) return "";
    var equipment = equipmentLabelList(ex);
    return "" +
        "<div class=\"sport-details\">" +
        (ex.description ? "<p class=\"sport-desc\">" + ex.description + "</p>" : "") +
        (ex.muscles ? "<p class=\"sport-muscles\">Muskeln: " + ex.muscles + "</p>" : "") +
        (equipment ? "<p class=\"sport-muscles\">Gerät: " + equipment + "</p>" : "") +
        "</div>";
}

// Aufbau aller Timer-Seiten: Überschrift → Timer → Buttons →
// Anleitung → Zusatzblöcke (Intensität, "Als Nächstes").
function sportTimedStepHtml(o) {
    return "" +
        "<div class=\"sport-kicker\" style=\"color:" + o.catColor + "\">" + o.kicker + "</div>" +
        "<h2 class=\"sport-exercise-name\">" + o.name + "</h2>" +
        (o.info ? "<div class=\"sport-set-info\">" + o.info + "</div>" : "") +
        (o.subInfo ? "<div class=\"sport-sub-info\">" + o.subInfo + "</div>" : "") +
        "<div class=\"sport-timer\" id=\"sportTimerDisplay\">" + formatTime(sportState.remaining) + "</div>" +
        "<div class=\"sport-controls\">" +
        "  <button type=\"button\" class=\"sport-btn sport-btn-primary\" id=\"sportTimerBtn\" onclick=\"sportToggleTimer()\">▶ Start</button>" +
        "  <button type=\"button\" class=\"sport-btn sport-btn-secondary\" onclick=\"sportSkipStep()\">Überspringen</button>" +
        "</div>" +
        sportDetailsHtml(o.exercise) +
        (o.extra || "");
}

// Intensität im Sport-Modus anpassen: je Übung "leichter"/"schwerer"
// mit aktueller Stufe und Satz-Vorgabe - in der Pause für die Übungen
// der laufenden Einheit (Einzelübung bzw. beide Supersatz-Übungen),
// während eines Satzes für die aktuelle Übung.
function sportAdjustHtml(members, hint, title) {
    var rows = members.map(function (idx) {
        var ex = currentWorkout.exercises[idx];
        var level = currentWorkout.levels[idx];
        return "" +
            "<div class=\"sport-adjust-row\" style=\"--cat-color:" + CATEGORY_META[ex.category].color + "\">" +
            "  <div class=\"sport-adjust-name\">" + ex.name +
            "    <span>Intensität " + level + " (" + INTENSITY_LABELS[level] + ") · " + formatSets(ex, exerciseCfg(currentWorkout, idx)) + "</span>" +
            "  </div>" +
            "  <button type=\"button\" class=\"reroll-btn\" onclick=\"sportChangeLevel(" + idx + ", -1)\"" + (INTENSITY_CONFIG[level - 1] ? "" : " disabled") + " aria-label=\"" + ex.name + " leichter machen\">leichter</button>" +
            "  <button type=\"button\" class=\"reroll-btn\" onclick=\"sportChangeLevel(" + idx + ", 1)\"" + (INTENSITY_CONFIG[level + 1] ? "" : " disabled") + " aria-label=\"" + ex.name + " schwerer machen\">schwerer</button>" +
            "</div>";
    }).join("");
    return "" +
        "<div class=\"sport-adjust\">" +
        "  <div class=\"sport-section-title\">" + (title || "Zu leicht oder zu schwer?") + "</div>" +
        rows +
        "  <p class=\"sport-hint\">" + (hint || "Gilt für die restlichen Sätze und wird für künftige Trainings gemerkt.") + "</p>" +
        "</div>";
}

function sportRepsStepHtml(o) {
    return "" +
        "<div class=\"sport-kicker\" style=\"color:" + o.catColor + "\">" + o.kicker + "</div>" +
        "<h2 class=\"sport-exercise-name\">" + o.name + "</h2>" +
        (o.info ? "<div class=\"sport-set-info\">" + o.info + "</div>" : "") +
        (o.subInfo ? "<div class=\"sport-sub-info\">" + o.subInfo + "</div>" : "") +
        "<div class=\"sport-reps-target\">" + o.reps + "</div>" +
        "<div class=\"sport-controls\">" +
        "  <button type=\"button\" class=\"sport-btn sport-btn-primary\" onclick=\"sportSkipStep()\">" + o.buttonLabel + "</button>" +
        "</div>" +
        "<p class=\"sport-hint\">" + o.hint + "</p>" +
        sportDetailsHtml(o.exercise) +
        (o.extra || "");
}

// Sammelt alle Muskelgruppen aus Aufwärmen + Training (ohne Duplikate,
// in Reihenfolge des ersten Auftretens) - fürs Dehnen im Cool-down.
function collectWorkoutMuscles(workout) {
    var seen = [];
    workout.warmup.concat(workout.exercises).forEach(function (ex) {
        if (!ex.muscles) return;
        ex.muscles.split(",").forEach(function (m) {
            var name = m.trim();
            if (name && seen.indexOf(name) === -1) seen.push(name);
        });
    });
    return seen;
}

function sportDoneHtml(cooldownEnabled) {
    var muscles = collectWorkoutMuscles(currentWorkout);
    // Cool-down-Timer vor der (ggf. langen) Muskelliste, damit er
    // ohne Scrollen sichtbar ist.
    var reminder = cooldownEnabled
        ? "<p class=\"sport-desc\">Stark durchgezogen. Nimm dir jetzt noch ca. 5 Minuten zum Dehnen – 20–30 Sekunden pro Muskelgruppe, ruhig weiteratmen.</p>" +
          "<div class=\"sport-sub-info\">Cool-down-Timer</div>" +
          "<div class=\"sport-timer\" id=\"sportTimerDisplay\">" + formatTime(sportState.remaining) + "</div>" +
          (muscles.length
              ? "<div class=\"sport-section-title\">Zu dehnen</div>" +
                "<ul class=\"sport-muscles-list\">" + muscles.map(function (m) { return "<li>" + m + "</li>"; }).join("") + "</ul>"
              : "")
        : "<p class=\"sport-desc\">Stark durchgezogen!</p>";
    return "" +
        "<div class=\"sport-kicker\">Geschafft</div>" +
        "<h2 class=\"sport-exercise-name\">Training abgeschlossen!</h2>" +
        "<div class=\"sport-set-info\">Trainingszeit: " + formatTime(sportState.elapsedTotalSec || 0) + "</div>" +
        reminder +
        "<div class=\"sport-controls\">" +
        "  <button type=\"button\" class=\"sport-btn sport-btn-primary\" onclick=\"exitSportMode()\">Sport-Modus verlassen</button>" +
        "</div>";
}

// keepTimer: nur neu zeichnen (nach einer Intensitäts-Anpassung in
// der Pause), ohne den laufenden Timer zurückzusetzen.
function renderSportStep(keepTimer) {
    var step = sportState.steps[sportState.index];
    var next = sportState.steps[sportState.index + 1];
    var html;

    if (!keepTimer) sportState.timerStarted = false;
    sportStepCounterEl.textContent = overallStepLabel(step);
    sportProgressFillEl.style.width = sportState.progress.starts[sportState.index] + "%";

    if (step.kind === "warmup") {
        sportState.remaining = step.duration;
        sportState.lastBeepSecond = null;
        html = sportTimedStepHtml({
            kicker: "Aufwärmen",
            name: step.exercise.name,
            info: step.stepLabel,
            subInfo: "Lockeres Tempo",
            exercise: step.exercise,
            catColor: CATEGORY_META.cardio.color
        });
    } else if (step.kind === "work-time") {
        var metaT = CATEGORY_META[step.exercise.category];
        if (!keepTimer) {
            sportState.remaining = step.duration;
            sportState.lastBeepSecond = null;
        }
        html = sportTimedStepHtml({
            kicker: metaT.label,
            name: step.exercise.name,
            info: "Satz " + step.setIndex + " / " + step.totalSets,
            subInfo: workSubInfo(step),
            exercise: step.exercise,
            catColor: metaT.color,
            extra: sportAdjustHtml([step.exIndex], "Gilt ab sofort für diesen und die restlichen Sätze und wird für künftige Trainings gemerkt.")
        });
    } else if (step.kind === "work-reps") {
        var metaR = CATEGORY_META[step.exercise.category];
        var buttonLabel = "Satz erledigt – Training abschließen";
        var hint = "Kein Timer für diese Übung.";
        if (next && next.kind === "rest") {
            buttonLabel = "Satz erledigt – weiter zur Pause";
            hint = "Kein Timer für diese Übung – nur die Pause danach lässt sich starten.";
        } else if (next && next.exercise) {
            // Supersatz: ohne Pause direkt zur Partner-Übung.
            buttonLabel = "Satz erledigt – weiter mit " + next.exercise.name;
            hint = "Kein Timer für diese Übung – im Supersatz geht es ohne Pause direkt weiter.";
        }
        html = sportRepsStepHtml({
            kicker: metaR.label,
            name: step.exercise.name,
            info: "Satz " + step.setIndex + " / " + step.totalSets,
            subInfo: workSubInfo(step),
            reps: step.repsMin + "–" + step.repsMax + " Wiederholungen",
            exercise: step.exercise,
            catColor: metaR.color,
            buttonLabel: buttonLabel,
            hint: hint,
            extra: sportAdjustHtml([step.exIndex], "Gilt ab sofort für diesen und die restlichen Sätze und wird für künftige Trainings gemerkt.")
        });
    } else if (step.kind === "rest") {
        if (!keepTimer) {
            sportState.remaining = step.duration;
            sportState.lastBeepSecond = null;
        }
        // Erst Timer + Buttons, dann die Bewertung der gerade
        // beendeten Übung(en), zuletzt die Anleitung der nächsten
        // Übung zur Vorbereitung.
        html = sportTimedStepHtml({
            kicker: "Pause",
            name: "Kurz durchatmen",
            catColor: "#71717a",
            extra: sportAdjustHtml(step.members, null, "Gerade geschafft – zu leicht oder zu schwer?") +
                sportNextHtml(next)
        });
    } else {
        if (step.cooldownEnabled) {
            sportState.remaining = COOLDOWN_DURATION_SEC;
            sportState.lastBeepSecond = null;
        }
        html = sportDoneHtml(step.cooldownEnabled);
    }

    sportBodyEl.innerHTML = html;

    // Pausen und der Cool-down-Timer auf der Abschlussseite starten sofort:
    // der Klick/Timer-Ablauf, der zu diesem Schritt geführt hat, zählt
    // bereits als Start-Signal. Der Gesamt-Trainingstimer bleibt dabei
    // gestoppt (startOverallTimer() ist dann bereits "verbraucht").
    if (keepTimer) {
        updateTimerDisplay();
        if (sportState.timerStarted) updateTimerButtonLabel();
    } else if (step.kind === "rest" || (step.kind === "done" && step.cooldownEnabled)) {
        startSportTimer();
    }
}

// "leichter"/"schwerer" im Sport-Modus: wie auf der Übungskarte (Stufe
// ändern und für die Übung merken), danach die Schritte neu aufbauen,
// damit die restlichen Sätze die neue Stufe nutzen. Anzahl und
// Reihenfolge der Schritte bleiben gleich (die Satzzahl ändert sich
// nicht). Eine laufende Pause behält ihre Länge; ein laufender Satz
// übernimmt die neue Vorgabe sofort, bei Halte-Übungen verlängert
// bzw. verkürzt sich die Restzeit um die Differenz.
function sportChangeLevel(idx, delta) {
    if (!sportState) return;
    changeExerciseLevel(idx, delta);
    var steps = buildSportSteps(currentWorkout);
    var current = sportState.steps[sportState.index];
    if (current.kind === "rest") {
        steps[sportState.index] = current;
    } else if (current.kind === "work-time") {
        if (sportState.running) {
            sportState.remaining = Math.max(0, Math.ceil((sportState.deadline - Date.now()) / 1000));
        }
        sportState.remaining = Math.max(1, sportState.remaining + steps[sportState.index].duration - current.duration);
        if (sportState.running) sportState.deadline = Date.now() + sportState.remaining * 1000;
    }
    sportState.steps = steps;
    sportState.progress = buildProgressLayout(steps);
    renderProgressMarkers(sportState.progress.markers);
    renderSportStep(true);
}
window.sportChangeLevel = sportChangeLevel;

function updateTimerDisplay() {
    var el = document.getElementById("sportTimerDisplay");
    if (!el) return;
    el.textContent = formatTime(sportState.remaining);
    el.classList.toggle("is-urgent", sportState.remaining <= 5 && sportState.remaining >= 1);
}

function updateTimerButtonLabel() {
    var btn = document.getElementById("sportTimerBtn");
    if (btn) btn.textContent = sportState.running ? "Anhalten" : "Weiter";
}

function sportTick() {
    var msLeft = sportState.deadline - Date.now();
    var secLeft = Math.max(0, Math.ceil(msLeft / 1000));
    if (secLeft !== sportState.remaining) {
        sportState.remaining = secLeft;
        updateTimerDisplay();
    }
    if (secLeft >= 1 && secLeft <= 5 && secLeft !== sportState.lastBeepSecond) {
        sportState.lastBeepSecond = secLeft;
        playCountdownBeep(secLeft);
        vibrate(900);
    }
    if (msLeft <= 0) {
        clearInterval(sportState.intervalId);
        sportState.intervalId = null;
        sportState.running = false;
        playCompletionBeep();
        vibrate(200);
        advanceSportStep();
    }
}

// Trainings-Stoppuhr: läuft ab dem ersten Start eines Schritts (egal ob
// Aufwärmen, Zeit- oder Wiederholungs-Übung) durchgehend bis zum Ende
// des Sport-Modus, unabhängig von den einzelnen Schritt-Timern.
function startOverallTimer() {
    if (!sportState || sportState.elapsedStart) return;
    sportState.elapsedStart = Date.now();
    sportElapsedTimerEl.hidden = false;
    updateOverallTimerDisplay();
    sportState.elapsedIntervalId = setInterval(updateOverallTimerDisplay, 500);
}

function updateOverallTimerDisplay() {
    if (!sportState || !sportState.elapsedStart) return;
    sportElapsedTimerEl.textContent = formatTime(Math.floor((Date.now() - sportState.elapsedStart) / 1000));
}

function stopOverallTimer() {
    if (!sportState || !sportState.elapsedStart) return;
    if (sportState.elapsedIntervalId) {
        clearInterval(sportState.elapsedIntervalId);
        sportState.elapsedIntervalId = null;
    }
    sportState.elapsedTotalSec = Math.floor((Date.now() - sportState.elapsedStart) / 1000);
    updateOverallTimerDisplay();
}

function startSportTimer() {
    if (!sportState || sportState.running) return;
    ensureAudioContext();
    startOverallTimer();
    sportState.running = true;
    sportState.timerStarted = true;
    sportState.deadline = Date.now() + sportState.remaining * 1000;
    updateTimerButtonLabel();
    sportState.intervalId = setInterval(sportTick, 250);
}

function pauseSportTimer() {
    if (!sportState || !sportState.running) return;
    clearInterval(sportState.intervalId);
    sportState.intervalId = null;
    sportState.running = false;
    sportState.remaining = Math.max(0, Math.ceil((sportState.deadline - Date.now()) / 1000));
    updateTimerButtonLabel();
}

function sportToggleTimer() {
    if (!sportState) return;
    if (sportState.running) pauseSportTimer(); else startSportTimer();
}
window.sportToggleTimer = sportToggleTimer;

function advanceSportStep() {
    if (sportState.index < sportState.steps.length - 1) {
        sportState.index++;
        if (sportState.steps[sportState.index].kind === "done") stopOverallTimer();
        renderSportStep();
    }
}

// Manuelles Weiterschalten: sowohl für "Überspringen" als auch für
// "Satz erledigt" bei Wiederholungs-Übungen ohne eigenen Timer.
function sportSkipStep() {
    if (!sportState) return;
    startOverallTimer();
    if (sportState.intervalId) {
        clearInterval(sportState.intervalId);
        sportState.intervalId = null;
    }
    sportState.running = false;
    advanceSportStep();
}
window.sportSkipStep = sportSkipStep;

// Verhindert die automatische Bildschirmsperre während des Trainings.
// Der Wake Lock wird vom Browser beim Verstecken des Tabs automatisch
// freigegeben, daher bei Rückkehr in den sichtbaren Zustand erneut anfordern.
function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen").then(function (sentinel) {
        wakeLockSentinel = sentinel;
    }).catch(function () { /* z. B. Akkusparmodus aktiv - ignorieren */ });
}

function releaseWakeLock() {
    if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(function () {});
        wakeLockSentinel = null;
    }
}

function handleVisibilityChange() {
    if (document.visibilityState === "visible" && sportOverlayEl && !sportOverlayEl.hidden) {
        requestWakeLock();
    }
}

function handleSportKeydown(e) {
    if (e.key === "Escape") {
        requestExitSportMode();
        return;
    }
    if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        var step = sportState.steps[sportState.index];
        if (step.kind === "work-reps") sportSkipStep(); else sportToggleTimer();
    }
}

function enterSportMode() {
    if (!currentWorkout) return;
    ensureAudioContext();
    var steps = buildSportSteps(currentWorkout);
    sportState = { steps: steps, progress: buildProgressLayout(steps), index: 0, remaining: 0, running: false, timerStarted: false, deadline: 0, intervalId: null, lastBeepSecond: null, elapsedStart: null, elapsedIntervalId: null, elapsedTotalSec: 0 };
    renderProgressMarkers(sportState.progress.markers);
    sportElapsedTimerEl.hidden = true;
    sportElapsedTimerEl.textContent = "0:00";
    sportOverlayEl.hidden = false;
    requestWakeLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("keydown", handleSportKeydown);
    renderSportStep();
}

function exitSportMode() {
    if (sportState && sportState.intervalId) {
        clearInterval(sportState.intervalId);
    }
    if (sportState && sportState.elapsedIntervalId) {
        clearInterval(sportState.elapsedIntervalId);
    }
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("keydown", handleSportKeydown);
    releaseWakeLock();
    sportOverlayEl.hidden = true;
    sportState = null;
}
window.exitSportMode = exitSportMode;

// Zeigt vor dem vorzeitigen Beenden (Schließen-Button oder Esc) eine
// Ja/Nein-Rückfrage, damit ein laufendes Training nicht versehentlich
// abgebrochen wird.
function requestExitSportMode() {
    sportExitConfirmEl.hidden = false;
}

function hideSportExitConfirm() {
    sportExitConfirmEl.hidden = true;
}
