// Gemeinsame Engine für die W12-Szenario-Generatoren (Laser & Feelings,
// Zaubern & Kloppen). Seiten rufen initScenarioGenerator() mit ihren
// eigenen Wortlisten auf; Aussehen kommt weiterhin aus dem Seiten-CSS.
function initScenarioGenerator({ threats, wants, targets, consequences }) {
    function d12() {
        return Math.floor(Math.random() * 12);
    }

    function roll() {
        const t = d12(), w = d12(), g = d12(), k = d12();

        document.getElementById('scenario').innerHTML = `
            <span class="label">Bedrohung</span>
            <span class="value">${threats[t]}</span>

            <span class="label">will</span>
            <span class="value">${wants[w]}</span>

            <span class="label">…</span>
            <span class="value">${targets[g]}</span>

            <span class="label">was</span>
            <span class="value">${consequences[k]}</span>

            <span class="dice" style="margin-top:18px;">
                [W12: ${(t+1).toString().padStart(2,'0')}] [W12: ${(w+1).toString().padStart(2,'0')}] [W12: ${(g+1).toString().padStart(2,'0')}] [W12: ${(k+1).toString().padStart(2,'0')}]
            </span>
        `;
    }

    window.roll = roll;
    roll();
}
