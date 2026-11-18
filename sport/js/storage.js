/**
 * Sport – Persistenz in localStorage (Einstellungen, gesperrte Übungen, Stufen-Anpassungen).
 */
'use strict';

/* =====================================================================
 * Persistenz (localStorage)
 * ---------------------------------------------------------------------
 * Drei unabhängige Speicher, alle über die Oberfläche einsehbar (die
 * Regler/Checkboxen selbst zeigen die gespeicherten Werte, die Liste
 * der gesperrten Übungen ist über "Gesperrte Übungen" einsehbar,
 * gemerkte Stufen stehen auf der jeweiligen Übungskarte und in
 * "Alle Übungen & Anpassungen") und
 * gemeinsam über "Alle Daten löschen" komplett entfernbar:
 *   sport.settings         - zuletzt gewählte Regler-/Checkbox-Werte
 *   sport.blockedExercises - dauerhaft gesperrte Übungsnamen (werden
 *                            nie wieder ausgewählt)
 *   sport.levelOffsets     - je Übungsname die per "leichter"/
 *                            "schwerer" gemerkte Abweichung von der
 *                            Standard-Stufe, z. B. { "Liegestütze": 1 }
 * ===================================================================== */
var STORAGE_KEY_SETTINGS = "sport.settings";
var STORAGE_KEY_BLOCKED = "sport.blockedExercises";
var STORAGE_KEY_LEVELS = "sport.levelOffsets";

function loadJson(key, fallback) {
    try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

function saveJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* z. B. privater Modus ohne Storage-Zugriff - ignorieren */ }
}

// Jede Eingabe-Änderung landet hier, daher auch die Kurzfassung im
// eingeklappten Einstellungsbereich an dieser Stelle aktualisieren.
function saveSettings() {
    updateSettingsSummary();
    var equipment = [];
    document.querySelectorAll(".equipment-checkbox").forEach(function (cb) {
        if (cb.checked) equipment.push(cb.value);
    });
    saveJson(STORAGE_KEY_SETTINGS, {
        groups: groupStates,
        intensity: trainingIntensity,
        volume: Number(volumeRange.value),
        muted: muted,
        aufwaermen: toggleAufwaermen.checked,
        cooldown: toggleCooldown.checked,
        jump: toggleJump.checked,
        settingsOpen: settingsPanelEl.open,
        equipment: equipment
    });
}

// Überträgt zuletzt gespeicherte Einstellungen auf die Steuerelemente -
// wird einmalig beim Laden der Seite aufgerufen, bevor irgendetwas
// gerendert wird.
function restoreSettings() {
    var s = loadJson(STORAGE_KEY_SETTINGS, null);
    if (!s) return;
    // Frühere Gruppen-Schlüssel: "ruecken" ist jetzt "ziehen", "push"
    // ist jetzt "druecken".
    var legacyKeys = { ziehen: "ruecken", druecken: "push" };
    function savedValue(map, cat) {
        return map[cat] != null ? map[cat] : map[legacyKeys[cat]];
    }
    if (s.groups) {
        CATEGORY_ORDER.forEach(function (cat) {
            var state = savedValue(s.groups, cat);
            if (GROUP_STATES.indexOf(state) !== -1) groupStates[cat] = state;
        });
    } else if (s.counts) {
        // Alte Fassung mit Anzahl-Reglern je Gruppe (0-5) übernehmen:
        // 0 = aus, 1-2 = normal, 3-5 = Schwerpunkt.
        CATEGORY_ORDER.forEach(function (cat) {
            var n = savedValue(s.counts, cat);
            if (n == null) return;
            groupStates[cat] = n <= 0 ? "off" : (n <= 2 ? "normal" : "focus");
        });
    }
    if (INTENSITY_CONFIG[s.intensity]) trainingIntensity = s.intensity;
    if (s.volume != null) volumeRange.value = s.volume;
    if (s.aufwaermen != null) toggleAufwaermen.checked = s.aufwaermen;
    if (s.cooldown != null) toggleCooldown.checked = s.cooldown;
    if (s.jump != null) toggleJump.checked = s.jump;
    if (s.settingsOpen != null) settingsPanelEl.open = s.settingsOpen;
    if (Array.isArray(s.equipment)) {
        var enabled = new Set(s.equipment);
        document.querySelectorAll(".equipment-checkbox").forEach(function (cb) {
            cb.checked = enabled.has(cb.value);
        });
    }
    if (s.muted) {
        muted = true;
        volume = Number(volumeRange.value) / 100;
    }
}

// Umbenannte Übungen: alte Namen aus gespeicherten Sperrlisten auf die
// neuen abbilden, damit Sperrungen beim Umbenennen erhalten bleiben.
var RENAMED_EXERCISES = {
    "Einbeinige Hüftheben": "Einbeiniges Hüftheben",
    "Curtsy-Sprünge": "Knicks-Sprünge",
    "Hängender Windscheibenwischer": "Hängender Scheibenwischer"
};
var storedBlocked = loadJson(STORAGE_KEY_BLOCKED, []);
var blockedExercises = new Set((Array.isArray(storedBlocked) ? storedBlocked : []).map(function (name) {
    return RENAMED_EXERCISES[name] || name;
}));

var storedOffsets = loadJson(STORAGE_KEY_LEVELS, {});
var levelOffsets = storedOffsets && typeof storedOffsets === "object" && !Array.isArray(storedOffsets) ? storedOffsets : {};

function saveBlockedExercises() {
    saveJson(STORAGE_KEY_BLOCKED, Array.from(blockedExercises));
}

function updateBlockedCountBadge() {
    blockedCountBadgeEl.textContent = String(blockedExercises.size);
}

// Löscht alle gespeicherten Daten (Einstellungen, gesperrte Übungen,
// gemerkte Stufen) auf einmal und lädt die Seite neu, damit alle
// Regler/Checkboxen wieder ihre HTML-Standardwerte zeigen statt
// einzeln zurückgesetzt werden zu müssen.
function resetAllData() {
    localStorage.removeItem(STORAGE_KEY_SETTINGS);
    localStorage.removeItem(STORAGE_KEY_BLOCKED);
    localStorage.removeItem(STORAGE_KEY_LEVELS);
    location.reload();
}

// "leichter"/"schwerer" für das ganze Training: ein Schritt ist groß
// (mehr Sätze und Übungen, die Stufen ändern sich) und verwirft alle
// angehobenen Stufen, deshalb nur mit Rückfrage. Abgesenkte Übungen
// behalten ihren Offset und wandern mit der Intensität mit.
function requestIntensityChange(delta) {
    var target = trainingIntensity + delta;
    if (!INTENSITY_CONFIG[target]) return;
    pendingIntensity = target;
    var from = VOLUME_CONFIG[trainingIntensity];
    var to = VOLUME_CONFIG[target];
    var raised = EXERCISES.filter(function (e) { return levelOffsets[e.name] > 0; }).length;
    var lowered = EXERCISES.filter(function (e) { return levelOffsets[e.name] < 0; }).length;
    var detail = "Intensität " + trainingIntensity + " (" + INTENSITY_LABELS[trainingIntensity] + ") → " +
        target + " (" + INTENSITY_LABELS[target] + "): " + to.totalSets + " statt " + from.totalSets + " Sätze, " +
        to.exercises + " statt " + from.exercises + " Übungen. Das aktuelle Training wird neu erstellt.";
    if (raised) {
        detail += "<br><br><strong>" + (raised === 1 ? "1 angehobene Übung wird" : raised + " angehobene Übungen werden") +
            " auf die Standard-Stufe zurückgesetzt.</strong> Das lässt sich nicht rückgängig machen.";
    }
    if (lowered) {
        detail += "<br><br>" + (lowered === 1 ? "1 abgesenkte Übung bleibt" : lowered + " abgesenkte Übungen bleiben") +
            " gegenüber der neuen Standard-Stufe abgesenkt.";
    }
    intensityConfirmTextEl.textContent = delta > 0 ? "Training schwerer machen?" : "Training leichter machen?";
    intensityConfirmDetailEl.innerHTML = detail;
    intensityConfirmYesBtn.textContent = delta > 0 ? "Erhöhen" : "Senken";
    intensityConfirmEl.hidden = false;
}

function hideIntensityConfirm() {
    intensityConfirmEl.hidden = true;
    pendingIntensity = null;
}

function confirmIntensityChange() {
    trainingIntensity = pendingIntensity;
    hideIntensityConfirm();
    Object.keys(levelOffsets).forEach(function (name) {
        if (levelOffsets[name] > 0) delete levelOffsets[name];
    });
    saveJson(STORAGE_KEY_LEVELS, levelOffsets);
    updateLibraryBadge();
    handleControlChange();
    generateWorkout();
}

// Kombiniert Geräte-Verfügbarkeit, dauerhafte Sperrung und den
// Springen/Hüpfen-Filter: nur Übungen, die alles erfüllen, dürfen
// überhaupt zur Auswahl stehen.
function exerciseSelectable(ex, allowedEquipment) {
    return equipmentAllowed(ex, allowedEquipment) && !blockedExercises.has(ex.name) && (!ex.jump || toggleJump.checked);
}
