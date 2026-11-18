/**
 * Sport – Einstieg: Event-Listener verdrahten, Seite initialisieren, Service Worker registrieren.
 * Muss als letzte App-Datei geladen werden.
 */
'use strict';

/* =====================================================================
 * Event-Listener & Initialisierung
 * ===================================================================== */
CATEGORY_ORDER.forEach(function (cat) {
    groupChipEls[cat].addEventListener("click", function () { toggleGroup(cat); });
    focusChipEls[cat].addEventListener("click", function () { toggleFocus(cat); });
});
intensityDownBtn.addEventListener("click", function () { requestIntensityChange(-1); });
intensityUpBtn.addEventListener("click", function () { requestIntensityChange(1); });
intensityConfirmYesBtn.addEventListener("click", confirmIntensityChange);
intensityConfirmNoBtn.addEventListener("click", hideIntensityConfirm);
intensityConfirmEl.addEventListener("click", function (e) {
    if (e.target === intensityConfirmEl) hideIntensityConfirm();
});
toggleAufwaermen.addEventListener("change", handleControlChange);
toggleAufwaermen.addEventListener("change", generateWorkout);
toggleCooldown.addEventListener("change", handleControlChange);
toggleCooldown.addEventListener("change", generateWorkout);
toggleJump.addEventListener("change", handleControlChange);
toggleJump.addEventListener("change", generateWorkout);
settingsPanelEl.addEventListener("toggle", saveSettings);
document.querySelectorAll(".equipment-checkbox").forEach(function (cb) {
    cb.addEventListener("change", function () {
        saveSettings();
        generateWorkout();
    });
});

volumeRange.addEventListener("input", function () {
    volume = Number(volumeRange.value) / 100;
    volumeValueEl.textContent = volumeRange.value + " %";
    saveSettings();
});
volumeRange.addEventListener("change", function () {
    playTestBeep();
});
muteBtn.addEventListener("click", toggleMute);
sportMuteBtn.addEventListener("click", toggleMute);

generateBtn.addEventListener("click", generateWorkout);
sportModeBtn.addEventListener("click", enterSportMode);
sportExitBtn.addEventListener("click", requestExitSportMode);
sportExitConfirmYesBtn.addEventListener("click", function () {
    hideSportExitConfirm();
    exitSportMode();
});
sportExitConfirmNoBtn.addEventListener("click", hideSportExitConfirm);
sportExitConfirmEl.addEventListener("click", function (e) {
    if (e.target === sportExitConfirmEl) hideSportExitConfirm();
});
blockedShowBtn.addEventListener("click", showBlockedList);
blockedExitBtn.addEventListener("click", hideBlockedList);
libraryShowBtn.addEventListener("click", showLibrary);
libraryExitBtn.addEventListener("click", hideLibrary);
librarySearchEl.addEventListener("input", function () {
    libraryFilter.text = librarySearchEl.value;
    renderLibraryList();
});
libraryGroupFilterEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".library-filter-chip");
    if (!btn) return;
    libraryFilter.cat = btn.getAttribute("data-cat");
    renderLibraryList();
});
libraryOnlyAdjustedEl.addEventListener("change", function () {
    libraryFilter.onlyAdjusted = libraryOnlyAdjustedEl.checked;
    renderLibraryList();
});
resetDataBtn.addEventListener("click", function () { resetConfirmEl.hidden = false; });
resetConfirmNoBtn.addEventListener("click", function () { resetConfirmEl.hidden = true; });
resetConfirmYesBtn.addEventListener("click", resetAllData);
resetConfirmEl.addEventListener("click", function (e) {
    if (e.target === resetConfirmEl) resetConfirmEl.hidden = true;
});

restoreSettings();
updateBlockedCountBadge();
updateLibraryBadge();
updateLabels();
updateSettingsSummary();
syncMuteButtons();
refreshLiveEstimate();
generateWorkout();

// Registriert den Service Worker für Offline-/Installier-Unterstützung.
// Läuft nur unter HTTPS/localhost (Voraussetzung der Browser für
// Service Worker); unter file:// oder http:// ist navigator.serviceWorker
// gar nicht erst vorhanden bzw. register() schlägt fehl - dann bleibt
// die Seite einfach eine normale Seite ohne Offline-Funktion.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* kein sicherer Kontext - ignorieren */ });
    });
}
