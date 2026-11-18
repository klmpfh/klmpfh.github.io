/**
 * Sport – Training generieren und rendern.
 */
'use strict';

/* =====================================================================
 * Training generieren & rendern
 * ===================================================================== */
function generateWorkout() {
    var intensity = trainingIntensity;
    var cfg = INTENSITY_CONFIG[intensity];
    var counts = getCategoryCounts();
    var equipment = getEnabledEquipment();
    var aufwaermenEnabled = toggleAufwaermen.checked;
    var cooldownEnabled = toggleCooldown.checked;

    if (totalCategoryCount(counts) === 0) {
        // Kein Workout möglich - der Hinweis steht bereits live in der
        // Dauer-Anzeige (siehe refreshLiveEstimate), daher hier nur
        // die Ausgabe verstecken statt sie mit einer Warnung zu füllen.
        currentWorkout = null;
        outputEl.hidden = true;
        sportModeBtn.hidden = true;
        return;
    }

    var blockedCategory = findEquipmentBlockedCategory(counts, equipment);
    if (blockedCategory) {
        // Für eine gewählte Kategorie gibt es mit den freigegebenen
        // Geräten keine einzige passende Übung (z. B. alle Geräte
        // abgewählt) - Hinweis anzeigen statt mit undefined weiterzurechnen.
        currentWorkout = null;
        outputEl.hidden = true;
        sportModeBtn.hidden = true;
        updateDurationDisplay(0);
        durationMetaEl.innerHTML = "Für „" + CATEGORY_META[blockedCategory].label + "“ ist mit den gewählten Geräten, Filtern und gesperrten Übungen keine Übung möglich.";
        return;
    }

    var exercises, signature;
    var categoryPlan = buildCategoryPlan(counts);
    // Bis zu 6 Versuche, damit die neue Zusammenstellung nicht exakt
    // der zuletzt angezeigten entspricht (falls die Übungsdatenbank
    // das überhaupt zulässt).
    for (var attempt = 0; attempt < 6; attempt++) {
        var usedNames = new Set();
        exercises = categoryPlan.plan.map(function (cat) {
            var ex = pickExercise(cat, cfg.pool, usedNames, equipment);
            usedNames.add(ex.name);
            return ex;
        });
        hardestFirst(exercises);
        signature = exercises.map(function (e) { return e.name; }).join("|");
        if (signature !== lastSignature) break;
    }
    lastSignature = signature;

    currentWorkout = {
        intensity: intensity,
        cfg: cfg,
        exercises: exercises,
        pairStarts: categoryPlan.pairStarts,
        levels: exercises.map(function (ex) { return startLevel(intensity, ex); }),
        sets: distributeSets(exercises, intensity),
        warmup: aufwaermenEnabled ? pickWarmup(equipment, exercises, usedNames) : [],
        aufwaermenEnabled: aufwaermenEnabled,
        cooldownEnabled: cooldownEnabled
    };

    render();
}

// Würfelt eine einzelne Übung (per Klick auf "andere Übung") innerhalb
// derselben Kategorie neu, ohne den Rest des Trainings zu verändern.
// Gewürfelt wird wie beim Erstellen aus dem Schwierigkeitspool der
// Intensität; die Stufe wird auf die Start-Stufe der neuen Übung gesetzt
// (startLevel, also samt für sie gemerkter Anpassung).
function rerollExercise(idx) {
    var cfg = currentWorkout.cfg;
    var equipment = getEnabledEquipment();
    var current = currentWorkout.exercises[idx];
    var usedNames = new Set(currentWorkout.exercises.map(function (e) { return e.name; }));
    currentWorkout.warmup.forEach(function (e) { usedNames.add(e.name); });
    var replacement = pickExercise(current.category, cfg.pool, usedNames, equipment);
    // replacement kann nur fehlen, wenn buchstäblich jede Übung dieser
    // Kategorie gesperrt ist - dann die Karte unverändert lassen statt abzustürzen.
    if (replacement) {
        currentWorkout.exercises[idx] = replacement;
        currentWorkout.levels[idx] = startLevel(currentWorkout.intensity, replacement);
    }
    render();
}
// Für die inline onclick-Handler im generierten HTML zugänglich machen.
window.rerollExercise = rerollExercise;

// Jede Hauptübung hat eine eigene Intensitätsstufe (Start: siehe
// startLevel), deren Wdh./Haltezeit/Pause für sie gelten (siehe
// levelCfg), und eine Satzzahl aus dem Satz-Budget des Trainings
// (siehe distributeSets).
function exerciseCfg(workout, idx) {
    return Object.assign({ sets: workout.sets[idx] }, levelCfg(workout.exercises[idx], workout.levels[idx]));
}

// "leichter"/"schwerer": verschiebt nur die Stufe dieser einen Übung
// um eins (innerhalb 1-5), die Übung selbst bleibt dieselbe. Die
// Satzzahl bleibt, damit das Satz-Budget des Trainings erhalten bleibt.
// Die Abweichung von der Standard-Stufe wird für die Übung gemerkt und
// gilt auch in künftigen Trainings (siehe startLevel).
function changeExerciseLevel(idx, delta) {
    var level = currentWorkout.levels[idx] + delta;
    if (!INTENSITY_CONFIG[level]) return;
    currentWorkout.levels[idx] = level;
    var ex = currentWorkout.exercises[idx];
    var offset = level - balancedLevel(currentWorkout.intensity, ex.difficulty);
    if (offset === 0) delete levelOffsets[ex.name]; else levelOffsets[ex.name] = offset;
    saveJson(STORAGE_KEY_LEVELS, levelOffsets);
    updateLibraryBadge();
    updateSettingsSummary();
    render();
}
window.changeExerciseLevel = changeExerciseLevel;

// Würfelt eine einzelne Aufwärm-Übung (per Klick auf "andere Übung")
// neu - gleicher Art (Mobility oder Puls), ohne den Rest des
// Aufwärmens oder das Haupttraining zu verändern.
function rerollWarmupExercise(idx) {
    var equipment = getEnabledEquipment();
    var current = currentWorkout.warmup[idx];
    var others = currentWorkout.warmup.filter(function (e, i) { return i !== idx; });
    var usedNames = new Set(currentWorkout.exercises.map(function (e) { return e.name; }));
    currentWorkout.warmup.forEach(function (e) { usedNames.add(e.name); });
    var replacement = pickWarmupExercise(warmupKind(current), equipment, usedNames,
        openWarmupTargets(currentWorkout.exercises, others));
    if (replacement) {
        currentWorkout.warmup[idx] = replacement;
    } else if (!warmupEligible(current, equipment)) {
        // Kein Ersatz verfügbar (z. B. alle Cardio-Übungen gesperrt) -
        // Slot entfernen statt eine gesperrte Übung stehen zu lassen.
        currentWorkout.warmup.splice(idx, 1);
    }
    render();
}
window.rerollWarmupExercise = rerollWarmupExercise;

function equipmentChipHtml(ex) {
    var names = equipmentLabelList(ex);
    return names ? "<span class=\"stat-chip stat-chip-equipment\">Benötigt: " + names + "</span>" : "";
}

// Fasst alle Geräte zusammen, die für das aktuelle Training (Aufwärmen
// und Hauptteil) insgesamt benötigt werden, in fester Geräte-Reihenfolge.
function requiredEquipmentSummary(workout) {
    var codes = new Set();
    workout.exercises.forEach(function (ex) { (ex.equipment || []).forEach(function (c) { codes.add(c); }); });
    workout.warmup.forEach(function (ex) { (ex.equipment || []).forEach(function (c) { codes.add(c); }); });
    var names = Object.keys(EQUIPMENT_META).filter(function (c) { return codes.has(c); })
        .map(function (c) { return EQUIPMENT_META[c].label; });
    return names.length === 0
        ? "Benötigte Geräte: <strong>keine</strong> – reines Bodyweight-Training."
        : "Benötigte Geräte: <strong>" + names.join(", ") + "</strong>";
}

// Pause nach einer Supersatz-Runde: die längere der beiden Pausen.
function pairRestSeconds(workout, idx) {
    return Math.max(exerciseCfg(workout, idx).restSec, exerciseCfg(workout, pairPartner(workout, idx)).restSec);
}

function render() {
    var workout = currentWorkout;

    outputEl.hidden = false;
    sportModeBtn.hidden = false;

    durationMetaEl.innerHTML = formatDurationMeta(workout.exercises.length, workout.intensity, workoutTotalSets(workout)) +
        " · Gesamt Ø " + formatDecimal(averageScore(workout));
    intensitySummaryEl.innerHTML = intensitySummary(workout);
    updateDurationDisplay(estimateDurationMinutes(workout));

    equipmentSummaryEl.innerHTML = requiredEquipmentSummary(workout);

    warmupSectionEl.hidden = !workout.aufwaermenEnabled;
    if (workout.aufwaermenEnabled) {
        warmupTimeLabelEl.textContent = "ca. " + warmupMinutesEstimate(workout.exercises.length) + " Min.";
        warmupListEl.innerHTML = workout.warmup.map(function (ex, idx) {
            var equipChip = equipmentChipHtml(ex);
            return "<li>" +
                "  <div class=\"warmup-item-head\">" +
                "    <span><strong>" + ex.name + "</strong> – ca. 45 Sek. lockeres Tempo</span>" +
                "    <div class=\"warmup-item-actions\">" +
                "      <button type=\"button\" class=\"reroll-btn\" onclick=\"rerollWarmupExercise(" + idx + ")\" aria-label=\"Andere Aufwärm-Übung für " + ex.name + " auswürfeln\">andere Übung</button>" +
                "      <button type=\"button\" class=\"reroll-btn lock-btn\" onclick=\"blockExercise('" + ex.name + "', 'warmup', " + idx + ")\" aria-label=\"" + ex.name + " dauerhaft sperren\">Übung für immer sperren</button>" +
                "    </div>" +
                "  </div>" +
                "  <div class=\"warmup-desc\">" + ex.description + "</div>" +
                (equipChip ? "  <div class=\"exercise-card-stats\">" + equipChip + "</div>" : "") +
                "</li>";
        }).join("");
    }

    cooldownSectionEl.hidden = !workout.cooldownEnabled;

    exerciseListEl.innerHTML = workout.exercises.map(function (ex, idx) {
        var meta = CATEGORY_META[ex.category];
        var cfg = exerciseCfg(workout, idx);
        var level = workout.levels[idx];
        var offset = levelOffsets[ex.name] || 0;
        var levelChip = "    <span class=\"stat-chip\">Intensität " + level + " (" + INTENSITY_LABELS[level] + ")" +
            (offset ? " · gemerkt: " + (offset > 0 ? "+" : "") + offset : "") + "</span>";
        var partner = pairPartner(workout, idx);
        var restChip = partner === -1
            ? "    <span class=\"stat-chip\">Pause: " + cfg.restSec + " Sek.</span>"
            : "    <span class=\"stat-chip stat-chip-superset\">Supersatz mit " + workout.exercises[partner].name + " – im Wechsel, " +
              pairRestSeconds(workout, idx) + " Sek. Pause nach beiden</span>";
        return "" +
            "<div class=\"exercise-card" + (partner === -1 ? "" : partner > idx ? " superset-first" : " superset-second") + "\" style=\"--cat-color:" + meta.color + "\">" +
            "  <div class=\"exercise-card-head\">" +
            "    <span class=\"exercise-name\">" + ex.name + "</span>" +
            "    <span class=\"badge-category\">" + meta.label + "</span>" +
            "  </div>" +
            // Buttons direkt unter dem Titel, damit sie beim Tauschen
            // der Übung (andere Chips/Textlänge) nicht verspringen.
            "  <div class=\"exercise-card-actions\">" +
            "    <button type=\"button\" class=\"reroll-btn\" onclick=\"changeExerciseLevel(" + idx + ", -1)\"" + (INTENSITY_CONFIG[level - 1] ? "" : " disabled") + " aria-label=\"" + ex.name + " leichter machen\" title=\"Wird für diese Übung gemerkt\">leichter</button>" +
            "    <button type=\"button\" class=\"reroll-btn\" onclick=\"changeExerciseLevel(" + idx + ", 1)\"" + (INTENSITY_CONFIG[level + 1] ? "" : " disabled") + " aria-label=\"" + ex.name + " schwerer machen\" title=\"Wird für diese Übung gemerkt\">schwerer</button>" +
            "    <button type=\"button\" class=\"reroll-btn\" onclick=\"rerollExercise(" + idx + ")\" aria-label=\"Andere Übung für " + meta.label.replace(/&amp;/g, "&") + " auswürfeln\">andere Übung</button>" +
            "    <button type=\"button\" class=\"reroll-btn lock-btn\" onclick=\"blockExercise('" + ex.name + "', 'main', " + idx + ")\" aria-label=\"" + ex.name + " dauerhaft sperren\">Übung für immer sperren</button>" +
            "  </div>" +
            "  <div class=\"exercise-card-stats\">" +
            "    <span class=\"stat-chip\">" + formatSets(ex, cfg) + "</span>" +
            restChip +
            levelChip +
            "    <span class=\"stat-chip\">Schwierigkeit: " + ex.difficulty + "</span>" +
            "    <span class=\"stat-chip\">Gesamt: " + formatDecimal(exerciseScore(workout, idx)) + "</span>" +
            equipmentChipHtml(ex) +
            "  </div>" +
            "  <div class=\"exercise-card-body\">" +
            "    <p class=\"exercise-desc\">" + ex.description + "</p>" +
            "    <p class=\"exercise-muscles\">Muskeln: " + ex.muscles + "</p>" +
            "  </div>" +
            "</div>";
    }).join("");
}

// Sperrt eine Übung dauerhaft (wird nie wieder ausgewählt) und würfelt
// sie, falls sie gerade im aktuellen Training angezeigt wird, direkt
// durch eine andere Übung derselben Rolle (Haupttraining oder
// Aufwärmen) aus.
function blockExercise(name, kind, idx) {
    blockedExercises.add(name);
    saveBlockedExercises();
    updateBlockedCountBadge();
    updateSettingsSummary();
    if (kind === "main") {
        rerollExercise(idx);
    } else if (kind === "warmup") {
        rerollWarmupExercise(idx);
    }
}
window.blockExercise = blockExercise;

function unblockExercise(name) {
    blockedExercises.delete(name);
    saveBlockedExercises();
    updateBlockedCountBadge();
    updateSettingsSummary();
    renderBlockedList();
}
window.unblockExercise = unblockExercise;

function renderBlockedList() {
    var entries = EXERCISES.filter(function (e) { return blockedExercises.has(e.name); })
        .sort(function (a, b) { return a.name.localeCompare(b.name, "de"); });
    if (entries.length === 0) {
        blockedBodyEl.innerHTML = "<p class=\"blocked-empty\">Keine Übungen gesperrt.</p>";
        return;
    }
    blockedBodyEl.innerHTML = entries.map(function (ex) {
        var meta = CATEGORY_META[ex.category];
        return "" +
            "<div class=\"blocked-entry\">" +
            "  <span class=\"blocked-entry-name\">" + ex.name + "</span>" +
            "  <span class=\"badge-category\" style=\"--cat-color:" + meta.color + "\">" + meta.label + "</span>" +
            "  <button type=\"button\" class=\"reroll-btn\" onclick=\"unblockExercise('" + ex.name + "')\">entsperren</button>" +
            "</div>";
    }).join("");
}

function showBlockedList() {
    renderBlockedList();
    blockedOverlayEl.hidden = false;
}

function hideBlockedList() {
    blockedOverlayEl.hidden = true;
}
