/**
 * Sport – Übersicht aller Übungen (Bibliothek).
 */
'use strict';

/* =====================================================================
 * Übersicht aller Übungen: nach Muskelgruppe gruppiert, filterbar nach
 * Text, Gruppe und "nur angepasste". Je Übung lässt sich die gemerkte
 * Stufen-Anpassung (siehe levelOffsets) direkt einstellen, statt zu
 * warten, bis die Übung zufällig im Training landet.
 * ===================================================================== */
var libraryFilter = { text: "", cat: "all", onlyAdjusted: false };

function updateLibraryBadge() {
    libraryAdjustedBadgeEl.textContent = String(EXERCISES.filter(function (e) { return levelOffsets[e.name]; }).length);
}

// Verschiebt die Stufe einer Übung bei der aktuellen Intensität
// um eins (innerhalb 1-5) und merkt sich die Abweichung wie
// "leichter"/"schwerer" auf der Übungskarte; delta 0 setzt sie auf
// Standard zurück. Steckt die Übung im aktuellen Training, übernimmt
// sie die neue Stufe sofort.
function changeLibraryOffset(name, delta) {
    var ex = EXERCISES.find(function (e) { return e.name === name; });
    var intensity = trainingIntensity;
    if (delta === 0) {
        delete levelOffsets[name];
    } else {
        var level = startLevel(intensity, ex) + delta;
        if (!INTENSITY_CONFIG[level]) return;
        var offset = level - balancedLevel(intensity, ex.difficulty);
        if (offset === 0) delete levelOffsets[name]; else levelOffsets[name] = offset;
    }
    saveJson(STORAGE_KEY_LEVELS, levelOffsets);
    updateLibraryBadge();
    updateSettingsSummary();
    if (currentWorkout) {
        currentWorkout.exercises.forEach(function (e, idx) {
            if (e.name === name) currentWorkout.levels[idx] = startLevel(currentWorkout.intensity, e);
        });
        render();
    }
    renderLibraryList();
}
window.changeLibraryOffset = changeLibraryOffset;

function libraryEntryHtml(ex, intensity) {
    var offset = levelOffsets[ex.name] || 0;
    var level = startLevel(intensity, ex);
    var cfg = levelCfg(ex, level);
    var work = ex.type === "time" ? cfg.holdSec + " Sek. Halten" : cfg.repsMin + "–" + cfg.repsMax + " Wdh.";
    return "" +
        "<div class=\"blocked-entry\">" +
        "  <div class=\"library-entry-info\">" +
        "    <span class=\"blocked-entry-name\">" + ex.name + "</span>" +
        (blockedExercises.has(ex.name) ? " <span class=\"stat-chip\">gesperrt</span>" : "") +
        "    <span class=\"library-entry-meta\">Schwierigkeit: " + ex.difficulty + " · " + ex.muscles + "</span>" +
        "    <span class=\"library-entry-meta\"><strong>" + (offset ? "gemerkt: " + (offset > 0 ? "+" : "") + offset : "Standard") + "</strong>" +
        " → Intensität " + level + " (" + INTENSITY_LABELS[level] + ") · " + work + "</span>" +
        "  </div>" +
        "  <div class=\"library-entry-actions\" style=\"--cat-color:" + CATEGORY_META[ex.category].color + "\">" +
        "    <button type=\"button\" class=\"reroll-btn\" onclick=\"changeLibraryOffset('" + ex.name + "', -1)\"" + (INTENSITY_CONFIG[level - 1] ? "" : " disabled") + " aria-label=\"" + ex.name + " leichter machen\">leichter</button>" +
        "    <button type=\"button\" class=\"reroll-btn\" onclick=\"changeLibraryOffset('" + ex.name + "', 1)\"" + (INTENSITY_CONFIG[level + 1] ? "" : " disabled") + " aria-label=\"" + ex.name + " schwerer machen\">schwerer</button>" +
        "    <button type=\"button\" class=\"reroll-btn\" onclick=\"changeLibraryOffset('" + ex.name + "', 0)\"" + (offset ? "" : " disabled") + " aria-label=\"" + ex.name + " auf Standard zurücksetzen\">Standard</button>" +
        "  </div>" +
        "</div>";
}

function renderLibraryList() {
    var intensity = trainingIntensity;
    libraryHintEl.innerHTML = "Stufen bei der aktuellen Intensität <strong>" + intensity + " (" + INTENSITY_LABELS[intensity] + ")</strong>. " +
        "Eine Anpassung verschiebt die Standard-Stufe der Übung und gilt in jedem künftigen Training – genauso wie „leichter“/„schwerer“ auf der Übungskarte oder im Sport-Modus. Ändert sich die Intensität des ganzen Trainings, werden angehobene Übungen zurückgesetzt, abgesenkte bleiben abgesenkt.";
    libraryGroupFilterEl.querySelectorAll(".library-filter-chip").forEach(function (btn) {
        btn.setAttribute("aria-pressed", String(btn.getAttribute("data-cat") === libraryFilter.cat));
    });
    var text = libraryFilter.text.trim().toLowerCase();
    var html = CATEGORY_ORDER.filter(function (cat) {
        return libraryFilter.cat === "all" || libraryFilter.cat === cat;
    }).map(function (cat) {
        var entries = EXERCISES.filter(function (ex) {
            return ex.category === cat &&
                (!libraryFilter.onlyAdjusted || levelOffsets[ex.name]) &&
                (!text || (ex.name + " " + ex.muscles).toLowerCase().indexOf(text) !== -1);
        }).sort(function (a, b) { return a.name.localeCompare(b.name, "de"); });
        if (entries.length === 0) return "";
        var meta = CATEGORY_META[cat];
        return "" +
            "<section class=\"library-group\" style=\"--cat-color:" + meta.color + "\">" +
            "  <h3 class=\"library-group-title\">" + meta.label + " <span class=\"library-group-count\">" + entries.length + "</span></h3>" +
            entries.map(function (ex) { return libraryEntryHtml(ex, intensity); }).join("") +
            "</section>";
    }).join("");
    libraryListEl.innerHTML = html || "<p class=\"blocked-empty\">Keine Übung passt zum Filter.</p>";
}

libraryGroupFilterEl.innerHTML = ["all"].concat(CATEGORY_ORDER).map(function (cat) {
    return "<button type=\"button\" class=\"group-chip library-filter-chip\" data-cat=\"" + cat + "\" aria-pressed=\"false\">" +
        (cat === "all" ? "Alle" : CATEGORY_META[cat].label) + "</button>";
}).join("");

function showLibrary() {
    renderLibraryList();
    libraryOverlayEl.hidden = false;
}

function hideLibrary() {
    libraryOverlayEl.hidden = true;
}
