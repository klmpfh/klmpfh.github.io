/* Geldkugel – Szenario aus Kontoumsätzen per KI.
 *
 * aiPrompt() schreibt einen Prompt, der einer KI (ChatGPT, Claude, Gemini …)
 * erklärt, wie sie aus angehängten Kontoumsätzen ein Monatsbudget im
 * Import-Format dieser Seite macht. Die Antwort wird hier eingefügt oder als
 * .json-Datei über „Import“ eingelesen – beides über readImport() in state.js,
 * das auch Text um den JSON-Block herum verträgt.
 * Im Prompt stehen nur die Namen der vorhandenen Kategorien, keine Beträge.
 */
'use strict';

const AI_DEFAULT_NAME = 'Aus den Kontoauszügen';

function aiExample(name) {
    return {
        app: 'geldkugel',
        version: 1,
        categories: [
            { id: 'c1', name: 'Einkommen', kind: 'income' },
            { id: 'c2', name: 'Wohnen', kind: 'expense' },
            { id: 'c3', name: 'Lebensmittel', kind: 'expense' },
            { id: 'c4', name: 'Versicherungen', kind: 'expense' }
        ],
        scenarios: [{
            id: 's1',
            name: name,
            payments: [
                { id: 'p1', categoryId: 'c1', name: 'Gehalt', amount: 2450.00, interval: 'month' },
                { id: 'p2', categoryId: 'c2', name: 'Miete an Vermieter', amount: 780.00, interval: 'month' },
                { id: 'p3', categoryId: 'c3', name: 'Supermarkt (Ø)', amount: 312.40, interval: 'month' },
                { id: 'p4', categoryId: 'c4', name: 'Kfz-Versicherung', amount: 486.20, interval: 'year' }
            ]
        }]
    };
}

/** opts: { name, useCategories } */
function aiPrompt(opts) {
    const name = (opts.name || '').trim() || AI_DEFAULT_NAME;
    const cats = opts.useCategories ? store.categories.filter(c => c.name.trim()) : [];
    const catLines = cats.length
        ? ['- Nimm diese vorhandenen Kategorien mit genau diesem Namen und dieser Art, wo sie passen:']
            .concat(cats.map(c => '  - "' + c.name.trim() + '" (kind "' + c.kind + '")'),
                ['- Lege nur dann eine neue Kategorie an, wenn keine davon passt. Kurze deutsche Namen, insgesamt höchstens 14 Kategorien.'])
        : ['- Lege passende Kategorien an, z. B. Einkommen, Wohnen, Energie, Lebensmittel, Mobilität, Versicherungen, Abos & Verträge, Gesundheit, Freizeit, Kleidung, Sparen, Sonstiges. Kurze deutsche Namen, insgesamt höchstens 14.'];

    return [
        'Du hilfst mir, aus meinen Kontoumsätzen ein Monatsbudget für die Web-App „Geldkugel“ zu erstellen. Die Umsätze stehen am Ende dieser Nachricht oder hängen an (CSV-Export aus dem Online-Banking, PDF-Kontoauszug oder kopierter Text).',
        '',
        'So gehst du vor:',
        '1. Lies alle Umsätze und bestimme den Zeitraum (erstes bis letztes Buchungsdatum) und wie viele Monate er umfasst.',
        '2. Wiederkehrende Zahlungen (gleicher Empfänger oder Zweck, z. B. Gehalt, Miete, Strom, Versicherungen, Abos, Mitgliedsbeiträge, Daueraufträge) werden je eine Zahlung: Betrag der letzten Buchung, Intervall aus den Abständen der Buchungen.',
        '3. Unregelmäßige Ausgaben derselben Art (z. B. Supermarkt, Drogerie, Restaurants, Lieferdienste, Tanken, Onlinehandel, Bargeldabhebungen) fasst du je Art zu einer Zahlung zusammen: Summe im Zeitraum geteilt durch die Zahl der Monate, Intervall "month", Bezeichnung mit „(Ø)“, z. B. „Supermarkt (Ø)“.',
        '4. Zahlungen, die vierteljährlich, halbjährlich oder jährlich kommen (z. B. Kfz-Versicherung, Rundfunkbeitrag, Jahresabos), trägst du mit ihrem echten Betrag und Intervall ein. Rechne nichts selbst auf den Monat um, das macht die App.',
        '5. Weglassen: Umbuchungen zwischen meinen eigenen Konten; Kreditkarten-Sammelabbuchungen, wenn die einzelnen Kartenumsätze ebenfalls vorliegen; einmalige Anschaffungen, die sich nicht wiederholen. Erstattungen und Rückbuchungen verrechnest du mit der ursprünglichen Zahlung. Ein fester Dauerauftrag auf ein Sparkonto ist eine Ausgabe in der Kategorie „Sparen“.',
        '6. Einnahmen (Gehalt, Rente, Kindergeld, Nebenjob, regelmäßige Zuschüsse oder Unterhalt) kommen in Kategorien mit "kind": "income", alles andere in Kategorien mit "kind": "expense".',
        '',
        'Kategorien:'
    ].concat(catLines, [
        '',
        'Datenschutz – in deiner Antwort darf nicht stehen: IBAN, BIC, Konto- oder Kartennummern, Kunden-, Vertrags-, Mandats- oder Rechnungsnummern, Namen oder Adressen von Privatpersonen. Bezeichne Zahlungen von und an Privatpersonen nach ihrem Zweck (z. B. „Miete an Vermieter“, „Taschengeld“, „Unterhalt“). Namen von Firmen und Diensten sind in Ordnung (z. B. „Stadtwerke“, „Netflix“).',
        '',
        'Antwortformat:',
        '- Zuerst genau ein JSON-Block im Aufbau des Beispiels unten. Danach höchstens 10 kurze Stichpunkte: Zeitraum der Daten, was du weggelassen, geschätzt oder nicht sicher zuordnen konntest.',
        '- "scenarios" enthält genau ein Szenario mit dem Namen "' + name.replace(/"/g, '\'') + '".',
        '- "id": kurze Kennungen, frei wählbar (c1, c2 … für Kategorien, p1, p2 … für Zahlungen); "categoryId" ist die "id" einer Kategorie aus "categories".',
        '- "amount": positive Zahl in Euro mit Punkt als Dezimaltrennzeichen, auch bei Ausgaben ohne Minus.',
        '- "interval": einer von "week" (wöchentlich), "biweek" (alle 2 Wochen), "month" (monatlich), "quarter" (vierteljährlich), "halfyear" (halbjährlich), "year" (jährlich).',
        '- "name" einer Zahlung: kurz und verständlich, höchstens 40 Zeichen.',
        '',
        'Beispiel (nur der Aufbau, die Werte sind ausgedacht):',
        '```json',
        JSON.stringify(aiExample(name), null, 2),
        '```',
        '',
        'Hier sind meine Umsätze:',
        ''
    ]).join('\n');
}

/* ── Oberfläche ── */

function copyToClipboard(textValue, btn) {
    const done = ok => {
        const old = btn.textContent;
        btn.textContent = ok ? 'Kopiert ✓' : 'Nicht möglich';
        setTimeout(() => { if (btn.isConnected) btn.textContent = old; }, 1600);
    };
    const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = textValue;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        btn.closest('dialog').appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textValue).then(() => done(true), fallback);
    else fallback();
}

function openAiImport(anchor) {
    const box = el('div', 'ai');
    let closeFlyover = () => {};

    const steps = el('ol', 'ai-steps');
    [
        'Umsätze aus dem Online-Banking exportieren, am besten als CSV für 3 bis 12 Monate. Ein PDF-Kontoauszug oder kopierter Text geht auch.',
        'Prompt kopieren, in eine KI einfügen (z. B. ChatGPT, Claude, Gemini) und die Umsätze anhängen oder darunter einfügen.',
        'Die Antwort hier einfügen. Oder den JSON-Block als .json-Datei speichern und über „Import“ einlesen.'
    ].forEach(t => steps.appendChild(el('li', null, t)));
    box.appendChild(steps);

    const opts = el('div', 'ai-options');
    const nameField = el('div', 'field');
    const nameLabel = el('label', null, 'Name des neuen Szenarios');
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.id = 'aiName';
    nameLabel.htmlFor = nameInput.id;
    nameInput.value = AI_DEFAULT_NAME;
    nameInput.autocomplete = 'off';
    nameField.append(nameLabel, nameInput);

    const catLabel = el('label', 'ai-check');
    const catBox = el('input');
    catBox.type = 'checkbox';
    catBox.checked = store.categories.length > 0;
    catBox.disabled = !store.categories.length;
    catLabel.append(catBox, document.createTextNode('Meine Kategorien vorgeben (' + store.categories.length + ')'));
    opts.append(nameField, catLabel);
    box.appendChild(opts);

    const promptNow = () => aiPrompt({ name: nameInput.value, useCategories: catBox.checked });
    const preview = el('pre', 'ai-prompt');
    preview.tabIndex = 0;
    const refresh = () => { preview.textContent = promptNow(); };
    nameInput.addEventListener('input', refresh);
    catBox.addEventListener('change', refresh);
    refresh();

    const row = el('div', 'transfer-actions');
    const copy = el('button', 'btn btn-primary', 'Prompt kopieren');
    copy.type = 'button';
    copy.addEventListener('click', () => copyToClipboard(promptNow(), copy));
    row.appendChild(copy);
    box.appendChild(row);

    const details = el('details', 'ai-preview');
    details.append(el('summary', null, 'Prompt ansehen'), preview);
    box.appendChild(details);

    box.appendChild(el('p', 'transfer-text is-muted',
        'Kontoumsätze sind sensibel: Sie gehen an den Anbieter der KI. Der Prompt bittet die KI, IBAN, Vertragsnummern und Namen von Privatpersonen nicht in die Antwort zu übernehmen – wer sichergehen will, entfernt sie vorher aus der Datei. Die Geldkugel selbst schickt nichts irgendwohin.'));

    const answerField = el('div', 'field ai-answer');
    const answerLabel = el('label', null, 'Antwort der KI');
    const answer = el('textarea');
    answer.id = 'aiAnswer';
    answerLabel.htmlFor = answer.id;
    answer.rows = 7;
    answer.placeholder = 'Ganze Antwort einfügen – der JSON-Block wird herausgesucht.';
    answer.spellcheck = false;
    answerField.append(answerLabel, answer);
    box.appendChild(answerField);

    const error = el('p', 'transfer-text is-warn');
    error.setAttribute('role', 'alert');
    box.appendChild(error);

    const take = el('button', 'btn btn-primary', 'Als neues Szenario übernehmen');
    take.type = 'button';
    take.addEventListener('click', () => {
        error.textContent = '';
        let imp;
        try {
            if (!answer.value.trim()) throw new Error('Bitte zuerst die Antwort der KI einfügen.');
            imp = readImport(answer.value);
        } catch (err) {
            error.textContent = err.message;
            return;
        }
        const before = store.activeId;
        const catsBefore = store.categories.length;
        const added = addImported(imp);
        store.activeId = added[0].id;
        store.compare = { a: before, b: added[0].id };
        ensureCompare();
        saveStore();
        renderAll();
        closeFlyover();

        const payments = added.reduce((n, s) => n + s.payments.length, 0);
        const newCats = store.categories.length - catsBefore;
        const sc = added[0];
        alertFlyover({
            title: 'Szenario „' + scenarioName(sc) + '“ angelegt',
            message: payments + (payments === 1 ? ' Zahlung' : ' Zahlungen') + ', ' +
                (newCats ? newCats + (newCats === 1 ? ' neue Kategorie' : ' neue Kategorien') : 'keine neuen Kategorien') +
                (imp.skipped ? '. ' + imp.skipped + (imp.skipped === 1 ? ' Zahlung hatte' : ' Zahlungen hatten') + ' keine gültige Kategorie und fehlt' + (imp.skipped === 1 ? '' : 'en') : '') +
                '. Bitte kurz prüfen – vor allem die Durchschnittswerte (Ø). Unten in der Deutung steht es schon im Vergleich zum bisherigen Szenario.',
            anchor: anchor
        });
    });
    const takeRow = el('div', 'transfer-actions');
    takeRow.appendChild(take);
    box.appendChild(takeRow);

    openFlyover({
        title: 'Szenario aus Kontoumsätzen – mit KI',
        message: 'Eine KI liest deine Kontoumsätze und macht daraus Einnahmen und Ausgaben mit Intervall – als Datei, die die Geldkugel einlesen kann.',
        body: box,
        anchor: anchor,
        wide: true,
        onOpen: close => { closeFlyover = close; },
        buttons: [{ label: 'Schließen', value: null, kind: 'ghost' }]
    });
}

function initAiImport() {
    document.getElementById('btnAi').addEventListener('click', e => openAiImport(e.currentTarget));
}
