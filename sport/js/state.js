/**
 * Sport – DOM-Referenzen und globaler Zustand.
 */
'use strict';

/* =====================================================================
 * DOM-Referenzen & State
 * ===================================================================== */
var groupChipEls = {};
document.querySelectorAll(".toggle-chip").forEach(function (btn) {
    groupChipEls[btn.getAttribute("data-cat")] = btn;
});
var focusChipEls = {};
document.querySelectorAll(".focus-chip").forEach(function (btn) {
    focusChipEls[btn.getAttribute("data-cat")] = btn;
});
var groupStates = Object.assign({}, DEFAULT_GROUP_STATES);
var toggleAufwaermen = document.getElementById("toggleAufwaermen");
var toggleCooldown = document.getElementById("toggleCooldown");
var toggleJump = document.getElementById("toggleJump");
var settingsPanelEl = document.getElementById("settingsPanel");
var settingsSummaryEl = document.getElementById("settingsSummary");
var intensityDownBtn = document.getElementById("intensityDownBtn");
var intensityUpBtn = document.getElementById("intensityUpBtn");
var intensityHintEl = document.getElementById("intensityHint");
var intensityValue = document.getElementById("intensityValue");
var intensityLabelEl = document.getElementById("intensityLabel");
var volumeRange = document.getElementById("volumeRange");
var volumeValueEl = document.getElementById("volumeValue");
var muteBtn = document.getElementById("muteBtn");
var sportMuteBtn = document.getElementById("sportMuteBtn");
var generateBtn = document.getElementById("generateBtn");
var blockedShowBtn = document.getElementById("blockedShowBtn");
var blockedExitBtn = document.getElementById("blockedExitBtn");
var blockedOverlayEl = document.getElementById("blockedOverlay");
var blockedBodyEl = document.getElementById("blockedBody");
var blockedCountBadgeEl = document.getElementById("blockedCountBadge");
var libraryShowBtn = document.getElementById("libraryShowBtn");
var libraryExitBtn = document.getElementById("libraryExitBtn");
var libraryOverlayEl = document.getElementById("libraryOverlay");
var libraryAdjustedBadgeEl = document.getElementById("libraryAdjustedBadge");
var libraryHintEl = document.getElementById("libraryHint");
var librarySearchEl = document.getElementById("librarySearch");
var libraryGroupFilterEl = document.getElementById("libraryGroupFilter");
var libraryOnlyAdjustedEl = document.getElementById("libraryOnlyAdjusted");
var libraryListEl = document.getElementById("libraryList");
var resetDataBtn = document.getElementById("resetDataBtn");
var resetConfirmEl = document.getElementById("resetConfirm");
var resetConfirmYesBtn = document.getElementById("resetConfirmYesBtn");
var resetConfirmNoBtn = document.getElementById("resetConfirmNoBtn");
var durationNumberEl = document.getElementById("durationNumber");
var durationMetaEl = document.getElementById("durationMeta");
var outputEl = document.getElementById("output");
var equipmentSummaryEl = document.getElementById("equipmentSummary");
var intensitySummaryEl = document.getElementById("intensitySummary");
var warmupSectionEl = document.getElementById("warmupSection");
var warmupTimeLabelEl = document.getElementById("warmupTimeLabel");
var warmupListEl = document.getElementById("warmupList");
var cooldownSectionEl = document.getElementById("cooldownSection");
var exerciseListEl = document.getElementById("exerciseList");
var sportModeBtn = document.getElementById("sportModeBtn");
var sportOverlayEl = document.getElementById("sportOverlay");
var sportBodyEl = document.getElementById("sportBody");
var sportProgressFillEl = document.getElementById("sportProgressFill");
var sportProgressMarkersEl = document.getElementById("sportProgressMarkers");
var sportStepCounterEl = document.getElementById("sportStepCounter");
var sportElapsedTimerEl = document.getElementById("sportElapsedTimer");
var sportExitBtn = document.getElementById("sportExitBtn");
var sportExitConfirmEl = document.getElementById("sportExitConfirm");
var sportExitConfirmYesBtn = document.getElementById("sportExitConfirmYesBtn");
var sportExitConfirmNoBtn = document.getElementById("sportExitConfirmNoBtn");
var intensityConfirmEl = document.getElementById("intensityConfirm");
var intensityConfirmTextEl = document.getElementById("intensityConfirmText");
var intensityConfirmDetailEl = document.getElementById("intensityConfirmDetail");
var intensityConfirmYesBtn = document.getElementById("intensityConfirmYesBtn");
var intensityConfirmNoBtn = document.getElementById("intensityConfirmNoBtn");

var trainingIntensity = 2; // Intensität des ganzen Trainings (1-5), nur über requestIntensityChange() änderbar
var pendingIntensity = null; // wartet auf die Bestätigung in der Rückfrage
var currentWorkout = null; // { intensity, cfg, exercises: [...], pairStarts: [...], levels: [...], sets: [...], warmup: [...], aufwaermenEnabled, cooldownEnabled }
var lastSignature = "";    // Namen der zuletzt generierten Übungen, um Duplikate zu vermeiden
