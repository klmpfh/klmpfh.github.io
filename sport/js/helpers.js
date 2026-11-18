/**
 * Sport – Hilfsfunktionen: Übungsauswahl, Stufen, Zeiten, Aufwärmen.
 */
'use strict';

/* =====================================================================
 * Hilfsfunktionen
 * ===================================================================== */

// Übungen je Gruppe: die Gesamtzahl aus VOLUME_CONFIG wird nach Gewicht
// (normal 1, Schwerpunkt 2) aufgeteilt - abgerundet, jede aktive
// Gruppe mindestens 1, Rest nach größtem Nachkommaanteil (bei
// Gleichstand Schwerpunkt zuerst, dann CATEGORY_ORDER). Beispiel
// Stufe 3 (8 Übungen), Beine Schwerpunkt, Drücken/Ziehen/Core normal:
// 3 / 2 / 2 / 1.
function getCategoryCounts() {
    var counts = {};
    var active = CATEGORY_ORDER.filter(function (cat) { return GROUP_WEIGHT[groupStates[cat]] > 0; });
    CATEGORY_ORDER.forEach(function (cat) { counts[cat] = 0; });
    if (active.length === 0) return counts;

    var total = Math.max(VOLUME_CONFIG[trainingIntensity].exercises, active.length);
    var weightSum = active.reduce(function (sum, cat) { return sum + GROUP_WEIGHT[groupStates[cat]]; }, 0);
    var assigned = 0;
    var shares = active.map(function (cat) {
        var exact = total * GROUP_WEIGHT[groupStates[cat]] / weightSum;
        counts[cat] = Math.max(1, Math.floor(exact));
        assigned += counts[cat];
        // Auf 1 angehobene Gruppen haben schon mehr als ihren Anteil -
        // beim Verteilen des Rests hinten anstellen.
        var frac = exact >= 1 ? exact - Math.floor(exact) : -1;
        return { cat: cat, frac: frac, weight: GROUP_WEIGHT[groupStates[cat]] };
    });
    shares.sort(function (a, b) { return (b.frac - a.frac) || (b.weight - a.weight); });
    for (var i = 0; assigned < total; i = (i + 1) % shares.length) {
        counts[shares[i].cat]++;
        assigned++;
    }
    // Durch das Mindestens-1 kann es eine Übung zu viel werden - dann
    // bei der Gruppe mit den meisten Übungen wieder abziehen.
    while (assigned > total) {
        var largest = active.reduce(function (a, b) { return counts[b] > counts[a] ? b : a; });
        counts[largest]--;
        assigned--;
    }
    return counts;
}

// Verteilt das Satz-Budget gleichmäßig auf die Übungen (je SETS_MIN
// bis SETS_MAX); übrige Sätze gehen zuerst an Schwerpunkt-Übungen,
// dann der Reihe nach.
function distributeSets(exercises, intensity) {
    var budget = VOLUME_CONFIG[intensity].totalSets;
    var base = Math.max(SETS_MIN, Math.min(SETS_MAX, Math.floor(budget / exercises.length)));
    var sets = exercises.map(function () { return base; });
    var rest = budget - base * exercises.length;
    var order = exercises.map(function (ex, idx) { return idx; });
    order.sort(function (a, b) {
        return GROUP_WEIGHT[groupStates[exercises[b].category]] - GROUP_WEIGHT[groupStates[exercises[a].category]] || a - b;
    });
    for (var i = 0; rest > 0 && i < order.length; i++) {
        if (sets[order[i]] < SETS_MAX) {
            sets[order[i]]++;
            rest--;
        }
    }
    return sets;
}

function totalCategoryCount(counts) {
    return CATEGORY_ORDER.reduce(function (sum, cat) { return sum + counts[cat]; }, 0);
}

function getEnabledEquipment() {
    var set = new Set();
    document.querySelectorAll(".equipment-checkbox").forEach(function (cb) {
        if (cb.checked) set.add(cb.value);
    });
    return set;
}

function equipmentAllowed(ex, allowedEquipment) {
    var required = ex.equipment || [];
    return required.every(function (code) { return allowedEquipment.has(code); });
}

// Liefert die erste Kategorie mit offenem Kontingent, für die es bei den
// aktuell freigegebenen Geräten überhaupt keine passende Übung gibt
// (z. B. wenn alle Geräte abgewählt wurden). Verhindert, dass
// pickExercise ins Leere greift.
function findEquipmentBlockedCategory(counts, allowedEquipment) {
    return CATEGORY_ORDER.find(function (cat) {
        return counts[cat] > 0 && !EXERCISES.some(function (e) {
            return e.category === cat && exerciseSelectable(e, allowedEquipment);
        });
    });
}

// Baut die Reihenfolge der Hauptübungen aus der je Muskelgruppe
// ermittelten Anzahl, nach Trainingslehre in drei Blöcken:
//  1. Kraft (Beine, Drücken, Ziehen) zuerst, solange man frisch ist.
//     Je eine Drücken- und eine Ziehen-Übung bilden einen Supersatz
//     (im Wechsel, Pause erst nach beiden - der Gegenspieler erholt
//     sich, während der andere arbeitet). Beine, Supersätze und übrige
//     Einzelübungen wechseln sich so ab, dass dieselbe Einheit möglichst
//     nie zweimal direkt hintereinander kommt: Als Nächstes immer die
//     mit dem größten offenen Kontingent, die nicht gerade dran war
//     (bei Gleichstand in STRENGTH_UNITS-Reihenfolge), z. B. Beine 2,
//     Drücken 2, Ziehen 2 → B [D Z] B [D Z].
//  2. Core - ein müder Rumpf stabilisiert die Kraftübungen schlechter.
//  3. Cardio als Finisher.
// Liefert die Kategorien in Ausführungsreihenfolge und je Supersatz
// den Index der ersten Übung (pairStarts).
var STRENGTH_UNITS = ["beine", "paar", "druecken", "ziehen"];

function buildCategoryPlan(counts) {
    var pairCount = Math.min(counts.druecken, counts.ziehen);
    var remaining = {
        beine: counts.beine,
        paar: pairCount,
        druecken: counts.druecken - pairCount,
        ziehen: counts.ziehen - pairCount
    };
    var total = STRENGTH_UNITS.reduce(function (sum, u) { return sum + remaining[u]; }, 0);
    var plan = [];
    var pairStarts = [];
    var prev = null;
    for (var n = 0; n < total; n++) {
        var next = null;
        STRENGTH_UNITS.forEach(function (u) {
            if (u === prev || remaining[u] <= 0) return;
            if (next === null || remaining[u] > remaining[next]) next = u;
        });
        if (next === null) next = prev; // nur noch die vorige Einheit übrig
        if (next === "paar") {
            pairStarts.push(plan.length);
            plan.push("druecken", "ziehen");
        } else {
            plan.push(next);
        }
        remaining[next]--;
        prev = next;
    }
    ["core", "cardio"].forEach(function (cat) {
        for (var i = 0; i < counts[cat]; i++) plan.push(cat);
    });
    return { plan: plan, pairStarts: pairStarts };
}

// Innerhalb jeder Gruppe die schwerste Übung zuerst (technisch
// anspruchsvoll, also solange man frisch ist). Die Positionen der
// Gruppen im Plan bleiben, nur die Übungen tauschen untereinander.
function hardestFirst(exercises) {
    CATEGORY_ORDER.forEach(function (cat) {
        var positions = [];
        exercises.forEach(function (ex, idx) { if (ex.category === cat) positions.push(idx); });
        var sorted = positions.map(function (idx) { return exercises[idx]; })
            .sort(function (a, b) { return DIFFICULTY_SCORE[b.difficulty] - DIFFICULTY_SCORE[a.difficulty]; });
        positions.forEach(function (idx, k) { exercises[idx] = sorted[k]; });
    });
}

// Index des Supersatz-Partners einer Hauptübung oder -1.
function pairPartner(workout, idx) {
    if (workout.pairStarts.indexOf(idx) !== -1) return idx + 1;
    if (workout.pairStarts.indexOf(idx - 1) !== -1) return idx - 1;
    return -1;
}

// Ausführungseinheiten des Hauptteils: Einzelübungen und Supersätze,
// jeweils als Liste der Übungs-Indizes.
function workoutUnits(workout) {
    var units = [];
    for (var idx = 0; idx < workout.exercises.length; idx++) {
        if (workout.pairStarts.indexOf(idx) !== -1) {
            units.push([idx, idx + 1]);
            idx++;
        } else {
            units.push([idx]);
        }
    }
    return units;
}

// Ablauf einer Einheit in Runden: je Runde ein Satz jeder Übung (hat
// im Supersatz eine Übung mehr Sätze, kommt sie am Ende allein),
// danach die längste Pause der beteiligten Übungen.
function unitRounds(workout, members) {
    var cfgs = members.map(function (idx) { return exerciseCfg(workout, idx); });
    var count = Math.max.apply(null, cfgs.map(function (c) { return c.sets; }));
    var rounds = [];
    for (var s = 1; s <= count; s++) {
        var round = { setIndex: s, members: [], rest: 0 };
        members.forEach(function (idx, k) {
            if (s > cfgs[k].sets) return;
            round.members.push(idx);
            round.rest = Math.max(round.rest, cfgs[k].restSec);
        });
        rounds.push(round);
    }
    return rounds;
}

// Wählt zufällig eine Übung einer Kategorie, bevorzugt aus dem zur
// Intensität passenden Schwierigkeitspool, ohne bereits verwendete
// Namen und nur unter den freigegebenen Geräten. Fällt kontrolliert
// zurück, falls der Pool zu klein ist.
function pickExercise(category, pool, usedNames, allowedEquipment) {
    var candidates = EXERCISES.filter(function (e) {
        return e.category === category && pool.indexOf(e.difficulty) !== -1 &&
            !usedNames.has(e.name) && exerciseSelectable(e, allowedEquipment);
    });
    if (candidates.length === 0) {
        candidates = EXERCISES.filter(function (e) {
            return e.category === category && pool.indexOf(e.difficulty) !== -1 && exerciseSelectable(e, allowedEquipment);
        });
    }
    if (candidates.length === 0) {
        candidates = EXERCISES.filter(function (e) { return e.category === category && exerciseSelectable(e, allowedEquipment); });
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
}

// Je weniger Hauptübungen insgesamt gewählt sind, desto kürzer fällt
// auch das Aufwärmen aus.
function warmupExerciseCount(mainCount) {
    return mainCount <= 4 ? 2 : 3;
}

function warmupMinutesEstimate(mainCount) {
    if (mainCount <= 4) return 3;
    if (mainCount <= 6) return 4;
    return 5;
}

// Aufwärmen: nur leichte und mittlere Cardio/Mobility-Übungen (keine
// schweren Sprünge mit kalten Muskeln), in fester Reihenfolge - erst
// Mobility für die Gelenke, dann Puls für den Kreislauf, bei längeren
// Trainings zum Schluss noch einmal Mobility. Mobility-Übungen werden
// bevorzugt passend zu den Gruppen des Hauptteils gewählt (Feld
// mobility), die zweite möglichst für noch nicht vorbereitete Gruppen.
var WARMUP_SLOTS = { 2: ["mobility", "pulse"], 3: ["mobility", "pulse", "mobility"] };

function warmupKind(ex) {
    return ex.mobility ? "mobility" : "pulse";
}

function warmupEligible(ex, allowedEquipment) {
    return ex.category === "cardio" && ex.difficulty !== "schwer" && exerciseSelectable(ex, allowedEquipment);
}

// Gruppen des Hauptteils, die noch keine der übrigen Mobility-Übungen
// im Aufwärmen vorbereitet - oder alle, falls schon jede abgedeckt ist.
function openWarmupTargets(mainExercises, otherWarmup) {
    var targets = [];
    mainExercises.forEach(function (ex) {
        if (targets.indexOf(ex.category) === -1) targets.push(ex.category);
    });
    var open = targets.filter(function (cat) {
        return !otherWarmup.some(function (ex) { return (ex.mobility || []).indexOf(cat) !== -1; });
    });
    return open.length ? open : targets;
}

// Wählt zufällig eine Aufwärm-Übung der gewünschten Art, die noch
// nicht verwendet ist. Fällt kontrolliert zurück: erst ohne
// Gruppen-Bezug, dann jede Art. Liefert undefined, wenn gar nichts
// mehr frei ist.
function pickWarmupExercise(kind, allowedEquipment, usedNames, targetCats) {
    var pool = EXERCISES.filter(function (e) { return warmupEligible(e, allowedEquipment) && !usedNames.has(e.name); });
    var filters = [
        function (e) {
            return warmupKind(e) === kind && (e.mobility || []).some(function (cat) { return targetCats.indexOf(cat) !== -1; });
        },
        function (e) { return warmupKind(e) === kind; },
        function () { return true; }
    ];
    for (var i = 0; i < filters.length; i++) {
        var candidates = pool.filter(filters[i]);
        if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return undefined;
}

// usedNames enthält die Namen der bereits für die Hauptübungen
// gewürfelten Übungen (Kategorie "cardio" kann in beiden vorkommen),
// damit dieselbe Übung nicht in Aufwärmen UND Hauptteil auftaucht.
function pickWarmup(allowedEquipment, mainExercises, usedNames) {
    var picked = [];
    WARMUP_SLOTS[warmupExerciseCount(mainExercises.length)].forEach(function (kind) {
        var ex = pickWarmupExercise(kind, allowedEquipment, usedNames, openWarmupTargets(mainExercises, picked));
        if (!ex) return;
        picked.push(ex);
        usedNames.add(ex.name);
    });
    return picked;
}

function formatSets(ex, cfg) {
    if (ex.type === "time") {
        return cfg.sets + " × " + cfg.holdSec + " Sek. Halten";
    }
    return cfg.sets + " × " + cfg.repsMin + "–" + cfg.repsMax + " Wdh.";
}

// Stufe, mit der eine Übung nach dem Würfeln startet: so gewählt, dass
// ihr Gesamtwert (Schwierigkeit + Stufe) / 2 möglichst genau der
// Intensität des Trainings entspricht - leichte Übungen bekommen mehr
// Umfang, schwere weniger. Begrenzt auf die Stufen 1-5.
function balancedLevel(intensity, difficulty) {
    var level = 2 * intensity - DIFFICULTY_SCORE[difficulty];
    return Math.min(5, Math.max(1, level));
}

// Start-Stufe einschließlich der für diese Übung gemerkten Anpassung
// aus "leichter"/"schwerer" (siehe levelOffsets).
function startLevel(intensity, ex) {
    var level = balancedLevel(intensity, ex.difficulty) + (levelOffsets[ex.name] || 0);
    return Math.min(5, Math.max(1, level));
}

// Pause nach einem Satz dieser Übung auf dieser Stufe (siehe REST_CONFIG).
function restSeconds(ex, level) {
    var rc = ex.category === "cardio" ? REST_CONFIG.cardio : REST_CONFIG.strength;
    var score = (DIFFICULTY_SCORE[ex.difficulty] + level) / 2;
    return Math.round((rc.base + rc.perPoint * score) / 5) * 5;
}

// Wdh./Haltezeit/Pause einer Übung auf einer Stufe: die
// Stufen-Vorgabe, skaliert mit dem scale-Faktor der Übung.
function levelCfg(ex, level) {
    var base = INTENSITY_CONFIG[level];
    var scale = ex.scale || 1;
    var repsMin = Math.max(1, Math.round(base.repsMin * scale));
    return {
        repsMin: repsMin,
        repsMax: Math.max(repsMin + 1, Math.round(base.repsMax * scale)),
        holdSec: Math.max(10, Math.round(base.holdSec * scale / 5) * 5),
        restSec: restSeconds(ex, level)
    };
}

// Reine Arbeitszeit eines Satzes in Sekunden (ca. 3 Sek. je Wdh.).
function workSeconds(ex, cfg) {
    return ex.type === "time" ? cfg.holdSec : ((cfg.repsMin + cfg.repsMax) / 2) * 3;
}

// Sätze + Pausen einer Übung in Sekunden (ohne Übergang zur nächsten).
function exerciseSeconds(ex, cfg) {
    return cfg.sets * workSeconds(ex, cfg) + (cfg.sets - 1) * cfg.restSec;
}

// Übungen dieser Kategorie, aus denen bei der aktuellen
// Intensität/Geräte-Auswahl gewürfelt würde (wie pickExercise).
function categoryCandidates(category, intensity, allowedEquipment) {
    var pool = INTENSITY_CONFIG[intensity].pool;
    var candidates = EXERCISES.filter(function (e) {
        return e.category === category && pool.indexOf(e.difficulty) !== -1 && exerciseSelectable(e, allowedEquipment);
    });
    if (candidates.length === 0) {
        candidates = EXERCISES.filter(function (e) { return e.category === category && exerciseSelectable(e, allowedEquipment); });
    }
    return candidates;
}

// Durchschnittliche Dauer (Sek.) und Pause einer Übung dieser
// Kategorie unter der aktuellen Intensität/Geräte-Auswahl, jeweils mit
// ihrer Start-Stufe (siehe startLevel) und der durchschnittlichen
// Satzzahl aus dem Satz-Budget - Basis für die live aktualisierte
// Dauer-Schätzung, bevor überhaupt konkret gewürfelt wurde.
function categoryAverages(category, intensity, allowedEquipment, sets) {
    var candidates = categoryCandidates(category, intensity, allowedEquipment);
    if (candidates.length === 0) return { seconds: 0, rest: 0 };
    var seconds = 0;
    var rest = 0;
    candidates.forEach(function (e) {
        var cfg = Object.assign(levelCfg(e, startLevel(intensity, e)), { sets: sets });
        seconds += exerciseSeconds(e, cfg);
        rest += cfg.restSec;
    });
    return { seconds: seconds / candidates.length, rest: rest / candidates.length };
}

// Live-Schätzung der Trainingsdauer allein aus den aktuellen
// Einstellungen (ohne dass schon konkret gewürfelt wurde). Wird bei
// jeder Eingabe neu berechnet und in der Dauer-Anzeige hervorgehoben.
function estimateDurationMinutesLive() {
    var intensity = trainingIntensity;
    var counts = getCategoryCounts();
    var equipment = getEnabledEquipment();
    var transitionSec = 15;
    var totalSec = 0;
    var mainCount = totalCategoryCount(counts);
    var avgSets = mainCount > 0 ? Math.max(SETS_MIN, Math.min(SETS_MAX, VOLUME_CONFIG[intensity].totalSets / mainCount)) : 0;
    var averages = {};

    CATEGORY_ORDER.forEach(function (cat) {
        var count = counts[cat];
        if (count <= 0) return;
        averages[cat] = categoryAverages(cat, intensity, equipment, avgSets);
        totalSec += count * (averages[cat].seconds + transitionSec);
    });

    // Im Supersatz entfällt je Runde die kürzere der beiden Pausen.
    var pairCount = Math.min(counts.druecken, counts.ziehen);
    if (pairCount > 0) {
        totalSec -= pairCount * (avgSets - 1) * Math.min(averages.druecken.rest, averages.ziehen.rest);
    }

    if (toggleAufwaermen.checked && mainCount > 0) totalSec += warmupMinutesEstimate(mainCount) * 60;
    if (toggleCooldown.checked && mainCount > 0) totalSec += COOLDOWN_MIN * 60;

    return roundUpToFiveMinutes(totalSec);
}

// Exakte Dauer-Schätzung anhand der tatsächlich gewürfelten Übungen,
// Einheit für Einheit wie im Sport-Modus (siehe unitRounds).
function estimateDurationMinutes(workout) {
    var transitionSec = 15;
    var totalSec = 0;

    workoutUnits(workout).forEach(function (members) {
        var rounds = unitRounds(workout, members);
        rounds.forEach(function (round, r) {
            round.members.forEach(function (idx) {
                totalSec += workSeconds(workout.exercises[idx], exerciseCfg(workout, idx));
            });
            if (r < rounds.length - 1) totalSec += round.rest;
        });
        totalSec += members.length * transitionSec;
    });

    if (workout.aufwaermenEnabled) totalSec += warmupMinutesEstimate(workout.exercises.length) * 60;
    if (workout.cooldownEnabled) totalSec += COOLDOWN_MIN * 60;
    return roundUpToFiveMinutes(totalSec);
}

// Rundet eine Sekundenzahl auf die nächsten vollen 5 Minuten auf.
function roundUpToFiveMinutes(totalSec) {
    if (totalSec <= 0) return 0;
    return Math.ceil(totalSec / 60 / 5) * 5;
}

function updateDurationDisplay(minutes) {
    durationNumberEl.textContent = minutes > 0 ? String(minutes) : "–";
}

function formatDurationMeta(exerciseCount, intensity, totalSets) {
    return exerciseCount + " Übungen · " + totalSets + " Sätze · Intensität " + intensity + " (" + INTENSITY_LABELS[intensity] + ")";
}

function plannedTotalSets(exerciseCount, intensity) {
    return Math.max(SETS_MIN * exerciseCount, Math.min(SETS_MAX * exerciseCount, VOLUME_CONFIG[intensity].totalSets));
}

function workoutTotalSets(workout) {
    return workout.sets.reduce(function (a, s) { return a + s; }, 0);
}

// Gesamtwert je Übung = Mittelwert aus Schwierigkeit der Übung und
// ihrer Intensitätsstufe, beides auf der 1-5-Skala der Intensität
// (Schwierigkeit: leicht=1, mittel=3, schwer=5). Der Ø dieser Werte
// über alle Hauptübungen ist die Gesamtschwierigkeit des Trainings.
// Dazu ein Hinweis, wenn gewürfelte Übungen außerhalb der von der Intensität
// erlaubten Schwierigkeit liegen (Fallback bei zu kleinem Pool, siehe
// pickExercise).
var DIFFICULTY_ORDER = ["leicht", "mittel", "schwer"];
var DIFFICULTY_SCORE = { leicht: 1, mittel: 3, schwer: 5 };

function formatDecimal(n) {
    return n.toFixed(1).replace(".", ",");
}

function exerciseScore(workout, idx) {
    return (DIFFICULTY_SCORE[workout.exercises[idx].difficulty] + workout.levels[idx]) / 2;
}

function averageScore(workout) {
    var sum = 0;
    workout.exercises.forEach(function (ex, idx) { sum += exerciseScore(workout, idx); });
    return sum / workout.exercises.length;
}

function intensitySummary(workout) {
    var pool = workout.cfg.pool;
    var poolMin = DIFFICULTY_ORDER.indexOf(pool[0]);
    var poolMax = DIFFICULTY_ORDER.indexOf(pool[pool.length - 1]);
    var easier = 0;
    var harder = 0;
    workout.exercises.forEach(function (ex) {
        var d = DIFFICULTY_ORDER.indexOf(ex.difficulty);
        if (d < poolMin) easier++;
        if (d > poolMax) harder++;
    });
    var poolText = pool.length > 1 ? pool[0] + "–" + pool[pool.length - 1] : pool[0];
    var text = "Gesamtschwierigkeit: <strong>" + formatDecimal(averageScore(workout)) + "</strong> von 5" +
        " (Intensität " + workout.intensity + " – " + INTENSITY_LABELS[workout.intensity] + ")";
    function countText(n) { return n === 1 ? "1 Übung ist" : n + " Übungen sind"; }
    if (easier) text += "<br>" + countText(easier) + " leichter als die bei dieser Intensität erlaubte Schwierigkeit (" + poolText + ").";
    if (harder) text += "<br>" + countText(harder) + " schwerer als die bei dieser Intensität erlaubte Schwierigkeit (" + poolText + ").";
    return text;
}

function refreshLiveEstimate() {
    var counts = getCategoryCounts();
    var mainCount = totalCategoryCount(counts);
    var blockedCategory = mainCount > 0 ? findEquipmentBlockedCategory(counts, getEnabledEquipment()) : null;
    updateDurationDisplay(blockedCategory ? 0 : estimateDurationMinutesLive());
    if (blockedCategory) {
        durationMetaEl.innerHTML = "Für „" + CATEGORY_META[blockedCategory].label + "“ ist mit den gewählten Geräten, Filtern und gesperrten Übungen keine Übung möglich.";
    } else {
        var intensity = trainingIntensity;
        durationMetaEl.innerHTML = mainCount > 0
            ? formatDurationMeta(mainCount, intensity, plannedTotalSets(mainCount, intensity))
            : "Bitte mindestens eine Muskelgruppe auswählen";
    }
}

function updateGroupChips() {
    CATEGORY_ORDER.forEach(function (cat) {
        var state = groupStates[cat];
        groupChipEls[cat].setAttribute("aria-pressed", String(state !== "off"));
        focusChipEls[cat].setAttribute("aria-pressed", String(state === "focus"));
        focusChipEls[cat].disabled = state === "off";
    });
}

// Zeile 1: an/aus. Beim Ausschalten geht ein Schwerpunkt mit verloren.
function toggleGroup(cat) {
    groupStates[cat] = groupStates[cat] === "off" ? "normal" : "off";
    handleControlChange();
    generateWorkout();
}

// Zeile 2: Schwerpunkt an/aus (nur für eingeschaltete Gruppen).
function toggleFocus(cat) {
    if (groupStates[cat] === "off") return;
    groupStates[cat] = groupStates[cat] === "focus" ? "normal" : "focus";
    handleControlChange();
    generateWorkout();
}

// Nächsthöhere Intensität, wenn jede aktive Gruppe bereit dafür ist,
// sonst null. Bereit heißt: genug anhebbare Übungen (im Pool der
// aktuellen Intensität und noch nicht von Haus aus auf der höchsten
// Stufe) sind angehoben, und es sind mehr angehoben als abgesenkt.
// Gezählt wird anteilig, weil mit steigender Intensität immer weniger
// Übungen anhebbar sind. Gruppen, die dafür zu wenige anhebbare
// Übungen haben (z. B. wegen fehlender Geräte), zählen nicht mit.
function recommendedIntensity() {
    var target = trainingIntensity + 1;
    if (!INTENSITY_CONFIG[target]) return null;
    var equipment = getEnabledEquipment();
    var counted = 0;
    var ready = CATEGORY_ORDER.every(function (cat) {
        if (groupStates[cat] === "off") return true;
        var candidates = categoryCandidates(cat, trainingIntensity, equipment);
        var raisable = candidates.filter(function (e) { return INTENSITY_CONFIG[balancedLevel(trainingIntensity, e.difficulty) + 1]; });
        if (raisable.length < RECOMMEND_RAISED_MIN) return true;
        counted++;
        var raised = raisable.filter(function (e) { return levelOffsets[e.name] > 0; }).length;
        var lowered = candidates.filter(function (e) { return levelOffsets[e.name] < 0; }).length;
        return raised >= Math.max(RECOMMEND_RAISED_MIN, Math.ceil(raisable.length * RECOMMEND_RAISED_SHARE)) && raised > lowered;
    });
    return ready && counted > 0 ? target : null;
}

function updateLabels() {
    updateGroupChips();
    intensityValue.textContent = trainingIntensity;
    intensityLabelEl.textContent = INTENSITY_LABELS[trainingIntensity];
    intensityDownBtn.disabled = !INTENSITY_CONFIG[trainingIntensity - 1];
    intensityUpBtn.disabled = !INTENSITY_CONFIG[trainingIntensity + 1];
    volumeValueEl.textContent = volumeRange.value + " %";
}

// Einzeilige Kurzfassung aller Eingaben für den eingeklappten
// Einstellungsbereich, z. B. "8 Übungen · Schwerpunkt Beine ·
// Intensität 3 · Aufwärmen + Cool-down · 5/5 Geräte · mit Springen · 100 %".
function updateSettingsSummary() {
    var recommended = recommendedIntensity();
    intensityHintEl.hidden = !recommended;
    intensityHintEl.textContent = recommended
        ? "Du hast in allen Gruppen Übungen angehoben. Vielleicht ist es Zeit für Intensität " + recommended + "."
        : "";
    var phases = [];
    if (toggleAufwaermen.checked) phases.push("Aufwärmen");
    if (toggleCooldown.checked) phases.push("Cool-down");
    var checkboxes = document.querySelectorAll(".equipment-checkbox");
    var focus = CATEGORY_ORDER.filter(function (cat) { return groupStates[cat] === "focus"; })
        .map(function (cat) { return groupChipEls[cat].firstChild.textContent; });
    var parts = [totalCategoryCount(getCategoryCounts()) + " Übungen"];
    if (focus.length) parts.push("Schwerpunkt " + focus.join(", "));
    parts = parts.concat([
        "Intensität " + trainingIntensity,
        phases.length ? phases.join(" + ") : "ohne Auf-/Abwärmen",
        getEnabledEquipment().size + "/" + checkboxes.length + " Geräte",
        toggleJump.checked ? "mit Springen" : "ohne Springen",
        (muted ? "stumm " + SPEAKER_ICON_OFF : volumeRange.value + " % " + SPEAKER_ICON_ON)
    ]);
    // Ganz vorne, weil die Zeile auf schmalen Displays abgeschnitten wird.
    if (recommended) parts.unshift("Intensität " + recommended + " empfohlen");
    settingsSummaryEl.innerHTML = parts.join(" · ");
}

function handleControlChange() {
    updateLabels();
    refreshLiveEstimate();
    saveSettings();
}
