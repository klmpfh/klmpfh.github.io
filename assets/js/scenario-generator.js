// Gemeinsame Engine für die W12-Szenario-Generatoren (Laser & Feelings,
// Zaubern & Kloppen). Seiten rufen initScenarioGenerator() mit ihren
// eigenen Wortlisten auf; Aussehen kommt weiterhin aus dem Seiten-CSS.
function initScenarioGenerator({ threats, wants, targets, consequences }) {
    const LOWER = 'abcdefghijklmnopqrstuvwxyzäöü';
    const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ';
    const DIGITS = '0123456789';

    const scenario = document.getElementById('scenario');
    const button = document.getElementById('roll-btn');
    const buttonLabel = button.innerHTML;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rolling = false;

    function d12() {
        return Math.floor(Math.random() * 12);
    }

    function pick(pool) {
        return pool[Math.floor(Math.random() * pool.length)];
    }

    // Buchstaben würfeln innerhalb ihrer Klasse, damit Groß-/Kleinschreibung
    // und Ziffern erhalten bleiben; Leer- und Satzzeichen bleiben stehen.
    function charPool(c) {
        if (DIGITS.includes(c)) return DIGITS;
        if (c !== c.toLowerCase()) return UPPER;
        if (c !== c.toUpperCase()) return LOWER;
        return null;
    }

    // Füllt el mit einem <span> pro würfelbarem Zeichen und gibt diese zurück.
    function splitChars(el, text) {
        el.textContent = '';
        const chars = [];
        for (const c of text) {
            const pool = charPool(c);
            if (!pool) {
                el.append(c);
                continue;
            }
            const span = document.createElement('span');
            span.className = 'ch rolling';
            span.textContent = pick(pool);
            el.append(span);
            chars.push({ span, final: c, pool, stop: 0, next: 0, settled: false });
        }
        return chars;
    }

    // Jedes Zeichen rollt bis zu seinem eigenen Stoppzeitpunkt und wird dabei
    // immer langsamer; das letzte bleibt nach 2–4 Sekunden stehen.
    function animate(chars, done) {
        const total = reduceMotion ? 0 : 2000 + Math.random() * 2000;
        chars.forEach(ch => { ch.stop = total * (0.4 + 0.6 * Math.random()); });
        if (chars.length) chars[Math.floor(Math.random() * chars.length)].stop = total;

        const start = performance.now();
        function frame(now) {
            const t = now - start;
            let running = false;
            for (const ch of chars) {
                if (ch.settled) continue;
                if (t >= ch.stop) {
                    ch.span.textContent = ch.final;
                    ch.span.classList.remove('rolling');
                    ch.settled = true;
                    continue;
                }
                running = true;
                if (t >= ch.next) {
                    ch.span.textContent = pick(ch.pool);
                    const p = t / ch.stop;
                    ch.next = t + 40 + 300 * p * p;
                }
            }
            if (running) requestAnimationFrame(frame);
            else done();
        }
        requestAnimationFrame(frame);
    }

    function roll() {
        if (rolling) return;
        const t = d12(), w = d12(), g = d12(), k = d12();

        scenario.classList.remove('done');
        scenario.innerHTML = `
            <span class="label">Bedrohung</span>
            <span class="value"></span>

            <span class="label">will</span>
            <span class="value"></span>

            <span class="label">…</span>
            <span class="value"></span>

            <span class="label">was</span>
            <span class="value"></span>

            <span class="dice" style="margin-top:18px;">
                [W12: <span class="num"></span>] [W12: <span class="num"></span>] [W12: <span class="num"></span>] [W12: <span class="num"></span>]
            </span>
        `;

        const texts = [
            threats[t], targets[g], wants[w], consequences[k],
            ...[t, w, g, k].map(n => (n + 1).toString().padStart(2, '0'))
        ];
        const els = scenario.querySelectorAll('.value, .num');
        const chars = texts.flatMap((text, i) => splitChars(els[i], text));

        rolling = true;
        button.disabled = true;
        button.textContent = 'Würfelt …';
        animate(chars, () => {
            rolling = false;
            button.disabled = false;
            button.innerHTML = buttonLabel;
            scenario.classList.add('done');
        });
    }

    window.roll = roll;
    roll();
}
