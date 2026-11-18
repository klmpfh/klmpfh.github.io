/**
 * Sport – Signaltöne über die Web Audio API.
 */
'use strict';

/* =====================================================================
 * Signaltöne: letzte 5 Sekunden eines Timers piepen mit steigender
 * Tonhöhe/Lautstärke, bei 0 eine Piep-Folge. Übungen mit Seiten-/
 * Richtungswechsel zur Halbzeit bekommen dort einen Doppelpiep. Lautsprecher-Symbol
 * schaltet stumm, Lautstärkeregler löst beim Loslassen einen Testton
 * aus. Nutzt die Web Audio API, keine externen Audiodateien.
 * ===================================================================== */
var audioCtx = null;
var muted = false;
var volume = 1;

var SPEAKER_ICON_ON = "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" aria-hidden=\"true\"><polygon points=\"3,9 8,9 13,4 13,20 8,15 3,15\" fill=\"currentColor\"/><path d=\"M16,8 C18,10 18,14 16,16\" stroke=\"currentColor\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M18.5,5.5 C22,9 22,15 18.5,18.5\" stroke=\"currentColor\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"/></svg>";
var SPEAKER_ICON_OFF = "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" aria-hidden=\"true\"><polygon points=\"3,9 8,9 13,4 13,20 8,15 3,15\" fill=\"currentColor\"/><path d=\"M16,8 L21,16 M21,8 L16,16\" stroke=\"currentColor\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"/></svg>";

function ensureAudioContext() {
    if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(function () {});
    }
    return audioCtx;
}

function playTone(freq, durationMs, gainScale) {
    if (muted) return;
    var ctx = ensureAudioContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    var peak = Math.max(0, Math.min(1, volume)) * (gainScale || 1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
}

// secondsLeft in [1,5]: je näher an 0, desto höher und lauter.
function playCountdownBeep(secondsLeft) {
    var step = 6 - secondsLeft; // 1..5
    playTone(800 + step * (200/5), 400, 0.6 + step * 0.08);
}

function playCompletionBeep() {
    playTone(800, 80, 1);
    setTimeout(function () { playTone(800, 80, 1); }, 100);
    setTimeout(function () { playTone(800, 80, 1); }, 200);
    setTimeout(function () { playTone(800, 80, 1); }, 300);
    setTimeout(function () { playTone(800, 80, 1); }, 400);
}

// Halbzeit-Signal für Übungen mit "Zur Halbzeit ... wechseln.".
function playHalftimeBeep() {
    playTone(1000, 150, 1);
    setTimeout(function () { playTone(1000, 150, 1); }, 220);
}

function playTestBeep() {
    ensureAudioContext();
    playTone(800, 400, 1);
}

function vibrate(pattern) {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* nicht unterstützt - ignorieren */ }
}

function syncMuteButtons() {
    var icon = muted ? SPEAKER_ICON_OFF : SPEAKER_ICON_ON;
    var label = muted ? "Signaltöne einschalten" : "Signaltöne stummschalten";
    [muteBtn, sportMuteBtn].forEach(function (btn) {
        if (!btn) return;
        btn.innerHTML = icon;
        btn.setAttribute("aria-label", label);
        btn.setAttribute("aria-pressed", String(muted));
    });
}

function toggleMute() {
    muted = !muted;
    syncMuteButtons();
    saveSettings();
}
window.toggleMute = toggleMute;
