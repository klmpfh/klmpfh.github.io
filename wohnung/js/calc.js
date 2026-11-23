/* Wohnung (Kauf oder Miete) – Rechenlogik ohne DOM-Zugriff.
   Alle Beträge in Euro, Prozentwerte als "3.5" (= 3,5 %), Zeiträume in Jahren.
   Leere Eingaben sind null und zählen als 0 (bzw. als Wert aus "Meine Finanzen",
   wo eine Wohnung ein Feld davon überschreiben kann).
   flat.kind = 'rent' → Mietwohnung (analyzeRent), sonst Kaufwohnung (analyzeBuy). */
var WK = (function () {
    'use strict';

    // Grunderwerbsteuer je Bundesland in % (Stand 2025 – vor dem Kauf prüfen,
    // die Länder ändern die Sätze gelegentlich). Der Satz ist je Wohnung frei
    // überschreibbar, die Tabelle liefert nur den Vorschlag.
    var STATES = [
        ['BW', 'Baden-Württemberg', 5.0],
        ['BY', 'Bayern', 3.5],
        ['BE', 'Berlin', 6.0],
        ['BB', 'Brandenburg', 6.5],
        ['HB', 'Bremen', 5.5],
        ['HH', 'Hamburg', 5.5],
        ['HE', 'Hessen', 6.0],
        ['MV', 'Mecklenburg-Vorpommern', 6.0],
        ['NI', 'Niedersachsen', 5.0],
        ['NW', 'Nordrhein-Westfalen', 6.5],
        ['RP', 'Rheinland-Pfalz', 5.0],
        ['SL', 'Saarland', 6.5],
        ['SN', 'Sachsen', 5.5],
        ['ST', 'Sachsen-Anhalt', 5.0],
        ['SH', 'Schleswig-Holstein', 6.5],
        ['TH', 'Thüringen', 5.0]
    ];

    function transferTaxFor(code) {
        for (var i = 0; i < STATES.length; i++) if (STATES[i][0] === code) return STATES[i][2];
        return 6.5;
    }

    function n(x) {
        var v = Number(x);
        return isFinite(v) ? v : 0;
    }

    function isSet(x) {
        return x !== null && x !== undefined && x !== '' && isFinite(Number(x));
    }

    /* ---------- Darlehen ---------- */

    /** Monatliche Anfangsrate (Zins + Tilgung) eines Annuitätendarlehens. */
    function loanPayment(loan, amount) {
        var r = n(loan.rate) / 100;
        var i = r / 12;
        if (loan.mode === 'term') {
            var months = Math.max(1, Math.round(n(loan.term) * 12));
            return i > 0 ? amount * i / (1 - Math.pow(1 + i, -months)) : amount / months;
        }
        if (loan.mode === 'payment') return n(loan.payment);
        return amount * (r + n(loan.repay) / 100) / 12;
    }

    /** Simuliert ein Annuitätendarlehen Monat für Monat.
     *  Nach Ablauf der Zinsbindung gilt der Anschlusszins bei gleicher Rate;
     *  reicht die Rate dafür nicht für mindestens 1 % Tilgung, wird sie
     *  entsprechend angehoben (raised). Sondertilgung jeweils zum Jahresende. */
    function simulateLoan(loan, amount, maxYears) {
        var res = {
            amount: amount, payment: 0, followPayment: null, years: [],
            months: 0, payoffYears: null, balanceAtFixed: 0, interestUntilFixed: 0,
            totalInterest: 0, stuck: false, raised: false
        };
        if (amount <= 0.005) { res.payoffYears = 0; return res; }

        var fixed = Math.max(0, Math.round(n(loan.fixedYears)));
        var follow = isSet(loan.followRate) ? n(loan.followRate) : n(loan.rate);
        var i = n(loan.rate) / 100 / 12;
        var P = loanPayment(loan, amount);
        res.payment = P;
        res.balanceAtFixed = fixed > 0 ? null : amount;

        if (P <= amount * i + 0.005) {
            // Rate deckt nicht einmal die Zinsen – das Darlehen würde nie getilgt.
            res.stuck = true;
            res.balanceAtFixed = amount;
            return res;
        }

        var bal = amount;
        for (var y = 1; y <= maxYears && bal > 0.005; y++) {
            if (fixed > 0 && y === fixed + 1) {
                i = follow / 100 / 12;
                var minP = bal * (i + 0.01 / 12);
                if (P < minP) { P = minP; res.raised = true; }
                res.followPayment = P;
            }
            var yi = 0, yp = 0;
            for (var m = 0; m < 12 && bal > 0.005; m++) {
                var interest = bal * i;
                var princ = Math.min(P - interest, bal);
                bal -= princ;
                yi += interest;
                yp += princ;
                res.months++;
            }
            var ex = Math.min(n(loan.extra), bal);
            bal -= ex;
            if (bal < 0.005) bal = 0;
            res.years.push({ year: y, interest: yi, principal: yp, extra: ex, balance: bal });
            res.totalInterest += yi;
            if (y <= fixed) res.interestUntilFixed += yi;
            if (y === fixed) res.balanceAtFixed = bal;
        }
        if (res.balanceAtFixed === null) res.balanceAtFixed = 0;
        if (bal <= 0.005) res.payoffYears = res.months / 12;
        return res;
    }

    function balanceInYear(sim, y) {
        if (y <= 0) return sim.amount;
        if (sim.stuck) return sim.amount;
        if (y <= sim.years.length) return sim.years[y - 1].balance;
        return sim.payoffYears === null ? sim.years.length ? sim.years[sim.years.length - 1].balance : sim.amount : 0;
    }

    /* ---------- WG / Untervermietung ---------- */

    /** WG-Einnahmen. Steuer auf die Untermiete ist bewusst nicht eingerechnet. */
    function sublet(a, flat) {
        var wg = flat.wg || {};
        var rooms = wg.rooms || [];
        a.roomsRented = rooms.filter(function (r) { return !r.self; }).length;
        a.persons = rooms.length;
        a.rentGross = rooms.reduce(function (s, r) { return s + (r.self ? 0 : n(r.rent)); }, 0);
        a.rentEff = a.rentGross * (1 - Math.min(100, n(wg.vacancyPct)) / 100);
    }

    /* ---------- Private Nebenkosten ----------
       In "Meine Finanzen" gepflegt (Strom, Internet, Rundfunkbeitrag …) und
       für jede Wohnung gültig. Eine Wohnung kann einzelne Posten abwählen,
       wenn sie dort schon in Warmmiete oder Hausgeld enthalten sind
       (flat.coveredCosts = { costId: true }).

       Jeder Posten = Betrag + Zeitraum (every: alle so viele Monate) +
       Aufteilung (split) und wird auf zwei Monatswerte zurückgeführt:
       gross = für die ganze Wohnung, mine = mein Anteil. In die Wohnkosten
       geht nur mine ein.
         equal   Betrag für die Wohnung, gleichmäßig durch alle Personen
         percent Betrag für die Wohnung, mein Anteil in % (leer = gleichmäßig)
         person  Betrag gilt je Person
         all     zahle ich komplett – auch wenn Mitbewohner ihren Teil schon
                 mit der Warmmiete zahlen (die zählt ja als Einnahme) */

    // [Monate, Beschriftung]
    var COST_EVERY = [[1, 'pro Monat'], [2, 'alle 2 Monate'], [3, 'pro Quartal'], [6, 'pro Halbjahr'], [12, 'pro Jahr']];
    var COST_SPLIT = [['equal', 'gleichmäßig geteilt'], ['percent', 'mein Anteil in %'], ['person', 'Betrag je Person'], ['all', 'zahle ich komplett']];

    /** Personen, die sich die Kosten teilen. Je Wohnung überschreibbar, sonst
     *  ich + vermietete Zimmer; ohne Zimmer bzw. ohne Wohnung (= heute) der
     *  Wert aus "Meine Finanzen". */
    function personCount(p, flat) {
        var rooms = (flat && flat.wg && flat.wg.rooms) || [];
        var v = flat && isSet(flat.persons) ? n(flat.persons)
            : rooms.length ? 1 + rooms.filter(function (r) { return !r.self; }).length
            : n(p.persons);
        return Math.max(1, Math.round(v));
    }

    /** Ein Posten pro Monat bei so vielen Personen. */
    function costMonthly(c, count) {
        var base = n(c.amount) / (n(c.every) > 0 ? n(c.every) : 1);
        if (c.split === 'person') return { gross: base * count, mine: base, share: 1 / count };
        var share = c.split === 'all' ? 1
            : c.split === 'percent' && isSet(c.sharePct) ? pct100(c.sharePct) / 100
            : 1 / count;
        return { gross: base, mine: base * share, share: share };
    }

    function privateCosts(p, flat) {
        var covered = (flat && flat.coveredCosts) || {};
        var count = personCount(p, flat);
        var items = (p.privateCosts || []).map(function (c) {
            var m = costMonthly(c, count);
            return { id: c.id, name: c.name, gross: m.gross, mine: m.mine, covered: !!covered[c.id] };
        });
        function sum(key, test) {
            return items.reduce(function (s, c) { return s + (!test || test(c) ? c[key] : 0); }, 0);
        }
        function counts(c) { return !c.covered; }
        return {
            items: items,
            persons: count,
            total: sum('mine', counts),      // mein Anteil, der hier zählt
            gross: sum('gross', counts),     // dasselbe für die ganze Wohnung
            all: sum('mine')                 // mein Anteil inkl. abgewählter Posten
        };
    }

    /** Heutige Wohnkosten als Vergleichswert: Warmmiete + alle privaten
     *  Nebenkosten (die zahlt man heute ja auch). 0 = kein Vergleich möglich. */
    function currentHousing(p) {
        return n(p.currentRent) > 0 ? n(p.currentRent) + privateCosts(p, null).all : 0;
    }

    /* ---------- Mietentwicklung ---------- */

    /** Kaltmiete im Mietjahr y (1 = erstes Jahr) je nach Mietart:
     *  fest, Staffelmiete (Stufen "ab Mietjahr X: Betrag") oder Indexmiete
     *  (jährliche Anpassung um die angenommene Inflation). */
    function coldRentInYear(flat, y) {
        var base = n(flat.coldRent);
        if (flat.rentType === 'index') return base * Math.pow(1 + n(flat.indexPct) / 100, Math.max(0, y - 1));
        if (flat.rentType === 'staffel') {
            var cur = base, from = 1;
            (flat.steps || []).forEach(function (s) {
                var sy = Math.round(n(s.year));
                if (isSet(s.rent) && sy > 1 && sy <= y && sy >= from) { cur = n(s.rent); from = sy; }
            });
            return cur;
        }
        return base;
    }

    /* ---------- Gesamtanalyse einer Wohnung ---------- */

    function analyze(flat, profile, peers) {
        return flat && flat.kind === 'rent' ? analyzeRent(flat, profile, peers) : analyzeBuy(flat, profile, peers);
    }

    function analyzeRent(flat, profile, peers) {
        var p = profile;
        var a = { flat: flat, kind: 'rent', warnings: [] };
        a.area = n(flat.area);
        a.coldRent = n(flat.coldRent);
        a.serviceCharges = n(flat.serviceCharges);
        a.heating = n(flat.heatingCosts);
        a.warmRent = a.coldRent + a.serviceCharges + a.heating;
        a.coldPerSqm = a.area > 0 && a.coldRent > 0 ? a.coldRent / a.area : null;
        a.warmPerSqm = a.area > 0 && a.warmRent > 0 ? a.warmRent / a.area : null;
        a.extrasPerSqm = a.area > 0 && a.serviceCharges + a.heating > 0 ? (a.serviceCharges + a.heating) / a.area : null;

        a.privateInfo = privateCosts(p, flat);
        a.private = a.privateInfo.total;
        a.utilities = n(flat.utilities);
        a.runningCosts = a.serviceCharges + a.heating + a.private + a.utilities;
        a.outflow = a.warmRent + a.private + a.utilities;

        // Einzug
        a.deposit = n(flat.deposit);
        a.oneOff = n(flat.otherOneOff);
        a.moveIn = a.deposit + a.oneOff;
        a.cashAfter = n(p.cash) - a.moveIn;

        sublet(a, flat);

        a.netHousing = a.outflow - a.rentEff;
        a.currentRent = n(p.currentRent);
        a.currentHousing = currentHousing(p);
        a.vsRent = a.currentHousing > 0 ? a.netHousing - a.currentHousing : null;
        a.wealthBuild = 0;
        // Kaution bringt keine Rendite (Mietkautionskonto) – entgangene Rendite zählt mit
        a.opportunity = a.deposit * n(p.altReturn) / 100 / 12;
        a.trueCost = a.netHousing + a.opportunity;
        a.trueVsRent = a.currentHousing > 0 ? a.trueCost - a.currentHousing : null;

        a.netIncome = n(p.netIncome);
        a.available = a.netIncome - n(p.livingCosts) - n(p.otherDebt) - a.netHousing;
        a.burden = null;
        a.rentRatio = a.netIncome > 0 ? a.warmRent / a.netIncome : null;
        a.burdenNet = a.netIncome > 0 ? (a.netHousing + n(p.otherDebt)) / a.netIncome : null;

        // Mietentwicklung über 10 Jahre (Nebenkosten, WG-Mieten und private Kosten konstant)
        a.rentTimeline = [];
        var sum = 0;
        for (var y = 1; y <= 10; y++) {
            var cold = coldRentInYear(flat, y);
            var net = a.netHousing + cold - a.coldRent;
            a.rentTimeline.push({ year: y, cold: cold, warm: cold + a.serviceCharges + a.heating, net: net });
            sum += net;
        }
        a.coldIn5 = coldRentInYear(flat, 6);
        a.avgNet10 = sum / 10;
        a.rentIncrease5 = a.coldRent > 0 ? a.coldIn5 / a.coldRent - 1 : null;

        checksRent(a, p, flat);
        assessRent(a, flat, peers);
        a.documents = DOCUMENTS_RENT;
        return a;
    }

    function checksRent(a, p, flat) {
        if (a.coldRent <= 0) { warn(a, 'info', 'Kaltmiete eingeben, um die Wohnung durchzurechnen.'); return; }
        if (a.netIncome > 0) {
            if (a.rentRatio <= 0.3) warn(a, 'ok', 'Warmmiete bei ' + pct(a.rentRatio) + ' des Nettoeinkommens – im Rahmen der 30-%-Faustregel (max. ' + eur(0.3 * a.netIncome) + ').');
            else if (a.rentRatio <= 0.4) warn(a, 'warn', 'Warmmiete bei ' + pct(a.rentRatio) + ' des Nettoeinkommens – über der 30-%-Faustregel (max. ' + eur(0.3 * a.netIncome) + ')' + (a.rentEff > 0 ? ', mit WG-Einnahmen ' + pct(a.burdenNet) + '.' : '.'));
            else warn(a, a.rentEff > 0 && a.burdenNet <= 0.35 ? 'warn' : 'bad', 'Warmmiete bei ' + pct(a.rentRatio) + ' des Nettoeinkommens' + (a.rentEff > 0 ? ' (mit WG-Einnahmen ' + pct(a.burdenNet) + ')' : '') + ' – Faustregel: max. 30–35 % (' + eurRange(0.3 * a.netIncome, 0.35 * a.netIncome) + ').');
            if (a.available < 0) warn(a, 'bad', 'Haushalt geht nicht auf: monatlich fehlen ' + eur(-a.available) + '.');
            if (a.roomsRented > 0 && a.netIncome - n(p.livingCosts) - n(p.otherDebt) - a.outflow < 0) {
                warn(a, 'warn', 'Ohne Untermieter geht der Haushalt nicht auf (Leerstand / Auszug einplanen).');
            }
        }
        if (a.deposit > 3 * a.coldRent + 0.5) warn(a, 'bad', 'Kaution über drei Nettokaltmieten (' + eur(3 * a.coldRent) + ') – das ist gesetzlich nicht zulässig (§ 551 BGB).');
        if (n(p.reserve) > 0 || n(p.cash) > 0) {
            if (a.cashAfter < n(p.reserve)) warn(a, a.cashAfter < 0 ? 'bad' : 'warn', 'Nach Kaution und Einzug bleiben ' + eur(a.cashAfter) + ' – weniger als deine Notreserve von ' + eur(n(p.reserve)) + '.');
            else warn(a, 'ok', 'Notreserve bleibt erhalten (' + eur(a.cashAfter) + ' Cash nach dem Einzug).');
        }
        if (flat.rentType === 'staffel') {
            var steps = (flat.steps || []).filter(function (s) { return isSet(s.rent) && Math.round(n(s.year)) > 1; });
            if (!steps.length) warn(a, 'info', 'Staffelmiete ohne Stufen – „+ Staffel“ ergänzen, sonst rechnet die Seite mit gleichbleibender Miete.');
            if (a.rentIncrease5 !== null && a.rentIncrease5 > 0) warn(a, a.rentIncrease5 > 0.15 ? 'warn' : 'info', 'Staffelmiete: Kaltmiete steigt in 5 Jahren um ' + pct(a.rentIncrease5) + ' auf ' + eur(a.coldIn5) + '.');
        } else if (flat.rentType === 'index') {
            warn(a, 'info', 'Indexmiete: Bei ' + String(n(flat.indexPct)).replace('.', ',') + ' % Inflation pro Jahr liegt die Kaltmiete in 5 Jahren bei ' + eur(a.coldIn5) + '. Die Inflation kann auch deutlich höher ausfallen.');
        }
    }

    function assessRent(a, flat, peers) {
        a.review = [];
        var area = a.area;
        if (a.coldRent <= 0) return;

        if (area <= 0) {
            review(a, 'info', 'Wohnfläche fehlt', 'Ohne Wohnfläche lassen sich Miete und Nebenkosten pro m² nicht einordnen.', []);
        }

        // Nebenkosten + Heizung pro m²
        var ncQuestions = [
            'Letzte Betriebskostenabrechnung zeigen lassen – passen die Vorauszahlungen zum tatsächlichen Verbrauch?',
            'Was ist in den Nebenkosten enthalten (Wasser, Müll, Hausmeister, Aufzug, Garten …)?',
            'Wie wird geheizt, und wie alt ist die Heizung? Energieausweis zeigen lassen.'
        ];
        if (a.extrasPerSqm !== null) {
            var q = fmt2(a.extrasPerSqm) + ' €/m²';
            if (a.extrasPerSqm > 4.5) review(a, 'warn', 'Nebenkosten & Heizung hoch (' + q + ')',
                'Üblich sind etwa 2,50–4,00 €/m² im Monat inkl. Heizung' + forArea(a, 2.5, 4) + '. Hohe Vorauszahlungen können an teurer Heizung, Aufzug oder Hausmeisterdienst liegen.', ncQuestions);
            else if (a.extrasPerSqm < 1.8) review(a, 'warn', 'Nebenkosten & Heizung auffällig niedrig (' + q + ')',
                'Niedrige Vorauszahlungen sehen gut aus, führen aber oft zu hohen Nachzahlungen mit der ersten Abrechnung.', ncQuestions);
            else review(a, 'ok', 'Nebenkosten & Heizung im üblichen Rahmen (' + q + ')', 'Liegt im typischen Bereich von etwa 2,00–4,00 €/m² inkl. Heizung' + forArea(a, 2, 4) + '.', [ncQuestions[0]]);
        } else if (a.serviceCharges + a.heating <= 0) {
            review(a, 'info', 'Nebenkosten fehlen', 'Ohne Nebenkosten und Heizung ist die Monatsbilanz zu optimistisch – üblich sind rund 2,50–4,00 €/m²' + forArea(a, 2.5, 4) + '.', ncQuestions.slice(0, 2));
        }

        // Kaltmiete pro m² im Vergleich zu den anderen Mietwohnungen
        if (a.coldPerSqm && peers && peers.length) {
            var others = peers.filter(function (f) { return f.id !== flat.id && f.kind === 'rent' && n(f.coldRent) > 0 && n(f.area) > 0; })
                .map(function (f) { return n(f.coldRent) / n(f.area); });
            if (others.length) {
                var avg = others.reduce(function (s, v) { return s + v; }, 0) / others.length;
                var diff = a.coldPerSqm / avg - 1;
                if (diff > 0.15) review(a, 'info', 'Kaltmiete pro m² über deinen anderen Mietwohnungen',
                    fmt2(a.coldPerSqm) + ' €/m² liegt ' + Math.round(diff * 100) + ' % über dem Schnitt deiner anderen Mietwohnungen (' + fmt2(avg) + ' €/m²).', []);
            }
        }

        review(a, 'info', 'Mietpreisbremse prüfen',
            'In vielen Städten darf die Miete bei Wiedervermietung höchstens 10 % über der ortsüblichen Vergleichsmiete liegen (Ausnahmen: Neubau, umfassende Modernisierung, Vormiete).',
            ['Wie hoch war die Vormiete?', 'Gilt am Ort die Mietpreisbremse, und was sagt der Mietspiegel für die Wohnung?']);

        if (flat.rentType === 'staffel') {
            review(a, 'info', 'Staffelmiete',
                'Die Erhöhungen stehen fest im Vertrag – jede Stufe muss mindestens ein Jahr gelten und als Betrag in € angegeben sein. Zusätzliche Erhöhungen auf die Vergleichsmiete sind während der Staffel ausgeschlossen.',
                ['Sind alle Stufen mit Datum und Betrag im Vertrag genannt?', 'Gibt es einen Kündigungsverzicht, und wie lange (max. 4 Jahre)?']);
        } else if (flat.rentType === 'index') {
            review(a, 'warn', 'Indexmiete',
                'Die Kaltmiete folgt dem Verbraucherpreisindex – höchstens einmal im Jahr, schriftlich angekündigt. Bei hoher Inflation steigt sie deutlich schneller als eine normale Miete.',
                ['Welcher Basismonat des Verbraucherpreisindex gilt?', 'Gibt es einen Kündigungsverzicht?']);
        }

        if (a.roomsRented > 0) {
            if (area > 0 && a.persons && area / a.persons < 15) {
                review(a, 'info', 'Eng für eine WG (' + fmt1.format(area / a.persons) + ' m² pro Person)',
                    'Unter etwa 15 m² pro Person (' + 15 * a.persons + ' m² bei ' + a.persons + (a.persons === 1 ? ' Person' : ' Personen') + ') wird es schwer, Mitbewohner:innen lange zu halten – das erhöht den Leerstand.', []);
            }
            review(a, 'info', 'Untervermietung absichern',
                'Als Hauptmieter brauchst du die Erlaubnis des Vermieters zur Untervermietung (§ 553 BGB) – bei berechtigtem Interesse muss er sie meist geben.',
                ['Ist die Untervermietung im Mietvertrag erlaubt oder schriftlich genehmigt?', 'Dürfen Mitbewohner:innen wechseln, ohne dass jedes Mal neu gefragt werden muss?']);
            if (n((flat.wg || {}).vacancyPct) <= 0) {
                review(a, 'info', 'Kein Leerstand eingeplant', 'Auch in begehrten Lagen gibt es Wechsel und Suchzeiten – 3–8 % sind realistisch' + (a.rentGross > 0 ? ' (' + eurRange(0.03 * a.rentGross, 0.08 * a.rentGross) + ' im Monat)' : '') + '.', []);
            }
        }
    }

    function analyzeBuy(flat, profile, peers) {
        var p = profile;
        var a = { flat: flat, kind: 'buy', warnings: [] };

        // Kaufkosten
        a.price = n(flat.price);
        a.area = n(flat.area);
        a.pricePerSqm = a.area > 0 ? a.price / a.area : null;
        a.inventory = Math.min(n(flat.inventory), a.price);
        a.transferTax = Math.max(0, a.price - a.inventory) * n(flat.transferTaxPct) / 100;
        a.notary = a.price * n(flat.notaryPct) / 100;
        a.broker = a.price * n(flat.brokerPct) / 100;
        a.closing = a.transferTax + a.notary + a.broker;
        a.oneOff = n(flat.renovation) + n(flat.otherOneOff);
        a.total = a.price + a.closing + a.oneOff;

        // Eigenkapital & Darlehensbedarf
        a.equityPlanned = isSet(flat.equity) ? n(flat.equity) : n(p.equity);
        a.equity = Math.min(a.equityPlanned, a.total);
        a.need = Math.max(0, a.total - a.equity);
        a.cashAfter = n(p.cash) - a.equity;

        var loans = flat.loans || [];
        var fixedSum = 0;
        loans.forEach(function (l, idx) { if (idx > 0) fixedSum += n(l.amount); });
        a.loanAmounts = loans.map(function (l, idx) {
            return idx === 0 ? Math.max(0, a.need - fixedSum) : n(l.amount);
        });
        a.loanTotal = a.loanAmounts.reduce(function (s, v) { return s + v; }, 0);
        a.overFinanced = Math.max(0, a.loanTotal - a.need);
        a.ltv = a.price > 0 ? a.loanTotal / a.price : null;
        a.equityRatio = a.total > 0 ? a.equity / a.total : null;

        var MAX_YEARS = 60;
        a.sims = loans.map(function (l, idx) { return simulateLoan(l, a.loanAmounts[idx], MAX_YEARS); });
        a.payment = a.sims.reduce(function (s, x) { return s + x.payment; }, 0);
        a.anyStuck = a.sims.some(function (x) { return x.stuck; });
        a.payoffYears = a.anyStuck ? null : a.sims.reduce(function (m, x) { return Math.max(m, x.payoffYears || 0); }, 0);
        a.totalInterest = a.sims.reduce(function (s, x) { return s + x.totalInterest; }, 0);
        a.fixedYears = loans.length ? Math.round(n(loans[0].fixedYears)) : 0;
        a.balanceAtFixed = a.sims.reduce(function (s, x, idx) {
            // Restschuld aller Darlehen zum Ende der Zinsbindung des Hauptdarlehens
            return s + (idx === 0 ? x.balanceAtFixed : balanceInYear(x, a.fixedYears));
        }, 0);
        a.interestYear1 = a.sims.reduce(function (s, x, idx) {
            if (x.years[0]) return s + x.years[0].interest;
            return s + (x.stuck ? x.amount * n(loans[idx].rate) / 100 : 0);
        }, 0);
        a.principalYear1 = a.sims.reduce(function (s, x) { return s + (x.years[0] ? x.years[0].principal + x.years[0].extra : 0); }, 0);

        // Laufende Kosten (monatlich)
        a.hoa = n(flat.hoa);
        a.propertyTax = n(flat.propertyTax) / 12;
        a.maintenance = n(flat.maintenance);
        a.utilities = n(flat.utilities);
        a.privateInfo = privateCosts(p, flat);
        a.private = a.privateInfo.total;
        a.runningCosts = a.hoa + a.propertyTax + a.maintenance + a.utilities + a.private;
        a.outflow = a.payment + a.runningCosts;

        sublet(a, flat);

        // Monatsbilanz
        a.netHousing = a.outflow - a.rentEff;
        a.currentRent = n(p.currentRent);
        a.currentHousing = currentHousing(p);
        a.vsRent = a.currentHousing > 0 ? a.netHousing - a.currentHousing : null;
        a.wealthBuild = a.principalYear1 / 12;
        a.opportunity = a.equity * n(p.altReturn) / 100 / 12;
        // "Echte Kosten": was wirklich weg ist – Zinsen, Nebenkosten, entgangene
        // Rendite aufs Eigenkapital, abzüglich WG-Einnahmen. Tilgung ist Sparen.
        a.trueCost = a.interestYear1 / 12 + a.runningCosts + a.opportunity - a.rentEff;
        a.trueVsRent = a.currentHousing > 0 ? a.trueCost - a.currentHousing : null;

        // Haushalt
        a.netIncome = n(p.netIncome);
        a.available = a.netIncome - n(p.livingCosts) - n(p.otherDebt) - a.netHousing;
        a.burden = a.netIncome > 0 ? (a.payment + n(p.otherDebt)) / a.netIncome : null;
        a.burdenNet = a.netIncome > 0 ? (a.netHousing + n(p.otherDebt)) / a.netIncome : null;

        // Vermögensentwicklung
        a.appreciation = isSet(flat.appreciation) ? n(flat.appreciation) : n(p.appreciation);
        var horizon = a.payoffYears === null ? 30 : Math.ceil(a.payoffYears);
        horizon = Math.max(10, Math.min(50, Math.max(horizon, a.fixedYears)));
        a.timeline = [];
        var cumInterest = 0;
        for (var y = 0; y <= horizon; y++) {
            var yi = 0, yp = 0, ye = 0, bal = 0;
            a.sims.forEach(function (s) {
                var row = s.years[y - 1];
                if (row) { yi += row.interest; yp += row.principal; ye += row.extra; }
                else if (s.stuck && y > 0) yi += s.payment * 12;
                bal += balanceInYear(s, y);
            });
            cumInterest += yi;
            var value = a.price * Math.pow(1 + a.appreciation / 100, y);
            a.timeline.push({ year: y, interest: yi, principal: yp, extra: ye, balance: bal, value: value, net: value - bal, cumInterest: cumInterest });
        }
        var atFixed = a.timeline[Math.min(a.fixedYears, a.timeline.length - 1)];
        a.valueAtFixed = atFixed.value;
        a.netAtFixed = atFixed.value - a.balanceAtFixed;

        checks(a, p, flat);
        assess(a, flat, peers);
        a.documents = DOCUMENTS;
        return a;
    }

    /* ---------- Plausibilitätsprüfungen ---------- */

    function warn(a, level, text) { a.warnings.push({ level: level, text: text }); }

    function checks(a, p, flat) {
        if (a.price <= 0) { warn(a, 'info', 'Kaufpreis eingeben, um die Wohnung durchzurechnen.'); return; }

        if (n(p.bankMaxLoan) > 0) {
            if (a.loanTotal > n(p.bankMaxLoan)) warn(a, 'bad', 'Darlehen liegt ' + eur(a.loanTotal - n(p.bankMaxLoan)) + ' über deinem Kreditrahmen laut Bank.');
            else warn(a, 'ok', 'Darlehen passt in den Kreditrahmen (' + eur(n(p.bankMaxLoan) - a.loanTotal) + ' Luft).');
        }
        if (n(p.bankMaxRate) > 0) {
            if (a.payment > n(p.bankMaxRate)) warn(a, 'bad', 'Rate liegt ' + eur(a.payment - n(p.bankMaxRate)) + ' über der maximalen Rate laut Bank.');
            else warn(a, 'ok', 'Rate liegt unter der maximalen Rate laut Bank.');
        }
        if (a.anyStuck) warn(a, 'bad', 'Eine Darlehensrate deckt nicht einmal die Zinsen – das Darlehen würde nie getilgt.');
        if (a.equityPlanned > n(p.cash) && n(p.cash) > 0) warn(a, 'bad', 'Geplantes Eigenkapital ist höher als dein Cash.');
        if (n(p.reserve) > 0 || n(p.cash) > 0) {
            if (a.cashAfter < n(p.reserve)) warn(a, a.cashAfter < 0 ? 'bad' : 'warn', 'Nach dem Kauf bleiben ' + eur(a.cashAfter) + ' – weniger als deine Notreserve von ' + eur(n(p.reserve)) + '.');
            else warn(a, 'ok', 'Notreserve bleibt erhalten (' + eur(a.cashAfter) + ' Cash nach dem Kauf).');
        }
        if (a.equity < a.closing) warn(a, 'warn', 'Eigenkapital (' + eur(a.equity) + ') deckt die Kaufnebenkosten (' + eur(a.closing) + ') nicht – viele Banken erwarten das, sonst Zinsaufschlag oder Absage.');
        if (a.ltv !== null && a.ltv > 1) warn(a, 'warn', 'Beleihung über 100 % des Kaufpreises – nur mit Aufschlag üblich.');
        else if (a.ltv !== null && a.ltv > 0.8) warn(a, 'info', 'Beleihung über 80 % (mehr als ' + eur(0.8 * a.price) + ' Darlehen) – Banken verlangen ab hier oft höhere Zinsen; Konditionen prüfen.');
        if (a.overFinanced > 1) warn(a, 'warn', 'Zusätzliche Darlehen übersteigen den Bedarf um ' + eur(a.overFinanced) + '.');
        if (a.netIncome > 0) {
            // Banken rechnen Mieteinnahmen meist nur zu ~60–80 % an; hier 70 %.
            var incomeWg = a.netIncome + 0.7 * a.rentEff;
            var burdenWg = (a.payment + n(p.otherDebt)) / incomeWg;
            // Was die Faustregel für diese Wohnung als Rate übrig lässt
            var ruleRate = function (share) { return Math.max(0, share * incomeWg - n(p.otherDebt)); };
            var besides = n(p.otherDebt) > 0 ? ' neben deinen anderen Krediten' : '';
            if (a.burden <= 0.35) warn(a, 'ok', 'Kreditraten bei ' + pct(a.burden) + ' des Nettoeinkommens – schon ohne WG-Einnahmen.');
            else if (burdenWg <= 0.35) warn(a, 'warn', 'Kreditraten bei ' + pct(a.burden) + ' des Nettoeinkommens; erst mit 70 % der WG-Miete angerechnet ' + pct(burdenWg) + ' – hängt an den Untermietern.');
            else if (burdenWg <= 0.4) warn(a, 'warn', 'Kreditraten bei ' + pct(burdenWg) + ' von Netto + 70 % WG-Miete – knapp über der 35-%-Faustregel (max. ' + eur(ruleRate(0.35)) + ' Rate' + besides + ').');
            else warn(a, 'bad', 'Kreditraten bei ' + pct(burdenWg) + ' von Netto + 70 % WG-Miete (ohne WG ' + pct(a.burden) + ') – Faustregel: max. 35–40 % (' + eurRange(ruleRate(0.35), ruleRate(0.4)) + ' Rate' + besides + ').');
            if (a.available < 0) warn(a, 'bad', 'Haushalt geht nicht auf: monatlich fehlen ' + eur(-a.available) + '.');
        }
        if (a.roomsRented > 0 && a.netIncome > 0 && a.netIncome - n(p.livingCosts) - n(p.otherDebt) - a.outflow < 0) {
            warn(a, 'warn', 'Ohne Untermieter geht der Haushalt nicht auf (Leerstand / Auszug einplanen).');
        }
        a.sims.forEach(function (s, idx) {
            if (s.raised) warn(a, 'warn', (flat.loans[idx].name || 'Darlehen') + ': Rate steigt nach der Zinsbindung beim angenommenen Anschlusszins auf ' + eur(s.followPayment) + '.');
        });
        if (a.balanceAtFixed > 0 && a.fixedYears > 0 && !a.anyStuck) {
            warn(a, 'info', 'Nach ' + a.fixedYears + ' Jahren Zinsbindung sind noch ' + eur(a.balanceAtFixed) + ' offen – Zinsänderungsrisiko für die Anschlussfinanzierung.');
        }
        if (a.payoffYears !== null && a.payoffYears > 40) warn(a, 'warn', 'Volltilgung erst nach ' + years(a.payoffYears) + ' – höhere Tilgung erwägen.');
    }

    /* ---------- Objekt-Bewertung & Rückfragen ----------
       Prüft die Angaben zur Wohnung selbst gegen Faustwerte (Deutschland,
       Stand 2025) und sammelt Fragen an Makler, Verwalter oder Verkäufer.
       Faustwerte sind Orientierung, keine Grenzwerte – Lage, Baujahr und
       Ausstattung (Aufzug, Tiefgarage, Concierge) verschieben sie deutlich. */

    function review(a, level, title, text, questions) {
        a.review.push({ level: level, title: title, text: text, questions: questions || [] });
    }

    /** Faustwert pro m² auf die Wohnfläche umgerechnet, z. B. " (bei 80 m²: 200–320 €)". */
    function forArea(a, lo, hi) {
        if (!(a.area > 0)) return '';
        return ' (bei ' + fmtArea.format(a.area) + ' m²: ' + (hi === undefined ? eur(lo * a.area) : eurRange(lo * a.area, hi * a.area)) + ')';
    }
    var fmtArea = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

    function fmt2(v) { return fmt2f.format(v); }
    var fmt2f = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function assess(a, flat, peers) {
        a.review = [];
        var area = a.area;
        var year = isSet(flat.year) ? Math.round(n(flat.year)) : null;
        var now = new Date().getFullYear();
        var age = year !== null ? now - year : null;

        // Hausgeld pro m²
        a.hoaPerSqm = area > 0 && a.hoa > 0 ? a.hoa / area : null;
        var hoaQuestions = [
            'Wirtschaftsplan und die letzten 3 Hausgeldabrechnungen anfordern.',
            'Sind Heizung und Warmwasser im Hausgeld enthalten?',
            'Wie viel des Hausgelds geht in die Erhaltungsrücklage, und wie hoch ist die Rücklage der Gemeinschaft insgesamt?',
            'Welcher Anteil ist auf Mieter umlegbar (Betriebskosten) und welcher nicht (Verwaltung, Rücklage, Bankgebühren)?',
            'Gibt es Aufzug, Hausmeister, Concierge, Tiefgarage oder große Grünflächen, die das Hausgeld treiben?',
            'Sind Sonderumlagen beschlossen oder absehbar? Protokolle der letzten 3 Eigentümerversammlungen und Beschlusssammlung anfordern.',
            'Gibt es Hausgeldrückstände anderer Eigentümer?'
        ];
        if (a.hoa <= 0) {
            if (a.price > 0) review(a, 'info', 'Hausgeld fehlt', 'Ohne Hausgeld ist die Monatsbilanz zu optimistisch. Üblich sind rund 2,50–4,00 €/m² im Monat inkl. Heizung' + forArea(a, 2.5, 4) + '.', hoaQuestions.slice(0, 3));
        } else if (a.hoaPerSqm !== null) {
            var hq = fmt2(a.hoaPerSqm) + ' €/m²';
            if (a.hoaPerSqm > 5.5) {
                review(a, 'bad', 'Hausgeld sehr hoch (' + hq + ')',
                    'Deutlich über dem üblichen Rahmen von etwa 2,50–4,00 €/m² inkl. Heizung' + forArea(a, 2.5, 4) + '. Typische Ursachen: hohe Rücklagenzuführung wegen anstehender Sanierung, teure Heizung (z. B. Fernwärme, alte Anlage), Aufzug/Concierge, oder Hausgeld wurde wegen Rückständen erhöht. Hohe Rücklage kann gut sein – teure Betriebskosten sind dagegen dauerhaft verloren.', hoaQuestions);
            } else if (a.hoaPerSqm > 4.0) {
                review(a, 'warn', 'Hausgeld eher hoch (' + hq + ')',
                    'Über dem üblichen Rahmen von etwa 2,50–4,00 €/m² inkl. Heizung' + forArea(a, 2.5, 4) + '. Entscheidend ist, wofür: Ein hoher Anteil Erhaltungsrücklage ist Vorsorge, hohe Betriebs- und Verwaltungskosten nicht.', hoaQuestions);
            } else if (a.hoaPerSqm < 2.0) {
                review(a, 'warn', 'Hausgeld auffällig niedrig (' + hq + ')',
                    'Unter etwa 2 €/m²' + forArea(a, 2) + ' ist oft die Heizung nicht enthalten oder die Erhaltungsrücklage zu knapp – dann drohen später Sonderumlagen.', hoaQuestions.slice(0, 3).concat([hoaQuestions[5]]));
            } else {
                review(a, 'ok', 'Hausgeld im üblichen Rahmen (' + hq + ')',
                    'Liegt im typischen Bereich von etwa 2,00–4,00 €/m²' + forArea(a, 2, 4) + '. Trotzdem lohnt der Blick, wie viel davon in die Rücklage fließt.', [hoaQuestions[2], hoaQuestions[5]]);
            }
        } else if (a.price > 0) {
            review(a, 'info', 'Wohnfläche fehlt', 'Ohne Wohnfläche lassen sich Hausgeld und Kaufpreis pro m² nicht einordnen.', []);
        }

        // Wohnfläche & Zimmer
        var rooms = (flat.wg && flat.wg.rooms) || [];
        var roomSum = rooms.reduce(function (s, r) { return s + n(r.size); }, 0);
        if (area > 0 && roomSum > area) {
            review(a, 'warn', 'Zimmer größer als die Wohnfläche',
                'Die Zimmer zusammen (' + fmt1.format(roomSum) + ' m²) sind größer als die Wohnfläche (' + fmt1.format(area) + ' m²) – eine der Angaben stimmt nicht.',
                ['Grundriss mit Maßen und Wohnflächenberechnung anfordern.']);
        }
        if (area > 0 && a.price > 0) {
            review(a, 'info', 'Wohnfläche nachprüfen',
                'Kaufpreis, Hausgeld-Verteilung und Mieten hängen an der Fläche. Exposé-Angaben weichen oft ab, z. B. weil Balkon, Keller oder Dachschrägen großzügig mitgezählt wurden.',
                ['Ist die Wohnfläche nach Wohnflächenverordnung berechnet? Wie sind Balkon/Terrasse (25–50 %) und Dachschrägen angerechnet?',
                 'Wie groß ist der Miteigentumsanteil laut Teilungserklärung? Er bestimmt deinen Anteil an Kosten und Sonderumlagen.']);
        }

        // Kaufpreis pro m² im Vergleich zu den anderen Wohnungen
        if (a.pricePerSqm && peers && peers.length) {
            var others = peers.filter(function (f) { return f.id !== flat.id && f.kind !== 'rent' && n(f.price) > 0 && n(f.area) > 0; })
                .map(function (f) { return n(f.price) / n(f.area); });
            if (others.length) {
                var avg = others.reduce(function (s, v) { return s + v; }, 0) / others.length;
                var diff = a.pricePerSqm / avg - 1;
                if (diff > 0.15) review(a, 'info', 'Preis pro m² über deinen anderen Wohnungen',
                    eur(a.pricePerSqm) + '/m² liegt ' + Math.round(diff * 100) + ' % über dem Schnitt deiner anderen Wohnungen (' + eur(avg) + '/m²). Kann an Lage oder Zustand liegen – sollte sich aber begründen lassen.',
                    ['Welche Vergleichsverkäufe gibt es in der Lage (Gutachterausschuss, Bodenrichtwert)?', 'Was rechtfertigt den Preis (Zustand, Sanierungen, Stellplatz, Balkon)?']);
            }
        }

        // Baujahr
        var heating = 'Welche Heizung gibt es, wie alt ist sie, und ist ein Austausch (Gebäudeenergiegesetz) geplant?';
        var energy = 'Energieausweis anfordern: Verbrauch oder Bedarf, Energieklasse?';
        if (year === null) {
            if (a.price > 0) review(a, 'info', 'Baujahr fehlt', 'Das Baujahr verrät viel über anstehende Sanierungen.', ['Baujahr und Jahr der letzten größeren Sanierungen?']);
        } else if (year < 1949) {
            review(a, 'info', 'Altbau (' + year + ')',
                'Charme, aber typische Baustellen: alte Strom- und Wasserleitungen, Holzbalkendecken, Feuchte im Keller, eventuell Denkmalschutz (Auflagen, aber auch Steuervorteile).',
                ['Wann wurden Elektrik, Steigleitungen und Dach zuletzt erneuert?', 'Steht das Gebäude unter Denkmalschutz?', heating, energy]);
        } else if (year < 1979) {
            review(a, 'warn', 'Baujahr vor 1979 (' + year + ')',
                'Gebaut vor der ersten Wärmeschutzverordnung: oft schwache Dämmung und mögliche Schadstoffe (z. B. Asbest). Fassade, Dach, Fenster und Heizung stehen häufig zur Sanierung an – das zahlt die Gemeinschaft über Rücklage oder Sonderumlage.',
                ['Welche Sanierungen wurden schon gemacht, welche sind geplant (Fassade, Dach, Fenster, Leitungen)?', 'Reicht die Erhaltungsrücklage dafür, oder sind Sonderumlagen zu erwarten?', heating, energy]);
        } else if (year < 2000) {
            review(a, 'info', 'Baujahr ' + year,
                'Heizung, Fenster und Leitungen kommen in das Alter, in dem sie erneuert werden.',
                ['Wann wurden Heizung und Fenster zuletzt erneuert?', heating, energy]);
        } else if (age !== null && age <= 5) {
            review(a, 'info', 'Neubau / junges Gebäude (' + year + ')',
                'Die Gewährleistung des Bauträgers läuft meist 5 Jahre ab Abnahme – Mängel am Gemeinschaftseigentum sollten bis dahin gemeldet sein.',
                ['Wurde das Gemeinschaftseigentum abgenommen, gibt es eine Mängelliste?', 'Bis wann läuft die Gewährleistung?']);
        }

        // Eigene Rücklage
        var ownReserve = area > 0 ? a.maintenance / area : null;
        if (a.price > 0 && area > 0 && ownReserve < 0.5 && (age === null || age > 15)) {
            review(a, 'info', 'Wenig eigene Rücklage für die Wohnung',
                'Die Rücklage im Hausgeld deckt nur das Gemeinschaftseigentum. Bad, Küche, Böden, Innentüren und Fenster-Innenseiten zahlst du selbst – Faustregel 0,50–1,00 €/m² im Monat' + forArea(a, 0.5, 1) + ', bei älteren Wohnungen eher mehr.',
                ['Wie alt sind Bad, Küche und Böden?', 'Was gehört laut Teilungserklärung zum Sondereigentum (z. B. Fenster, Balkon)?']);
        }

        // Grundsteuer
        if (a.price > 0 && n(flat.propertyTax) <= 0) {
            review(a, 'info', 'Grundsteuer fehlt', 'Seit 2025 gilt die reformierte Grundsteuer – die Höhe hat sich für viele Wohnungen geändert.', ['Aktuellen Grundsteuerbescheid (ab 2025) anfordern.']);
        } else if (area > 0 && n(flat.propertyTax) / area > 8) {
            review(a, 'info', 'Grundsteuer auffällig hoch (' + fmt2(n(flat.propertyTax) / area) + ' €/m² im Jahr)',
                'Liegt über dem, was meist anfällt. Prüfen, ob der Wert jährlich (nicht quartalsweise oder für das ganze Haus) eingetragen ist.', ['Aktuellen Grundsteuerbescheid anfordern.']);
        }

        // Kaufnebenkosten
        if (n(flat.brokerPct) > 3.57) {
            review(a, 'warn', 'Maklerprovision über 3,57 %',
                'Seit Ende 2020 zahlt der Käufer höchstens die Hälfte der Provision, und nur, wenn der Verkäufer mindestens gleich viel zahlt. Mehr als 3,57 % inkl. MwSt.' + (a.price > 0 ? ' (' + eur(0.0357 * a.price) + ')' : '') + ' ist unüblich.',
                ['Wie ist die Provision zwischen Verkäufer und Käufer aufgeteilt?']);
        }
        if (a.price > 0 && n(flat.notaryPct) < 1.5) {
            review(a, 'info', 'Notar & Grundbuch knapp angesetzt', 'Realistisch sind etwa 1,5–2 % des Kaufpreises (' + eurRange(0.015 * a.price, 0.02 * a.price) + ', inkl. Grundschuld-Eintragung).', []);
        }
        if (a.price > 0 && a.inventory > a.price * 0.1) {
            review(a, 'warn', 'Hoher Inventaranteil (' + Math.round(a.inventory / a.price * 100) + ' % des Kaufpreises)',
                'Inventar spart Grunderwerbsteuer, aber das Finanzamt erkennt nur realistische Zeitwerte an, und Banken finanzieren Inventar meist nicht mit.',
                ['Inventarliste mit Zeitwerten (Alter, Neupreis) für den Kaufvertrag anfordern.']);
        }

        // WG
        var wg = flat.wg || {};
        if (a.roomsRented > 0) {
            if (area > 0 && rooms.length && area / rooms.length < 15) {
                review(a, 'info', 'Eng für eine WG (' + fmt1.format(area / rooms.length) + ' m² pro Person)',
                    'Unter etwa 15 m² pro Person (' + 15 * a.persons + ' m² bei ' + a.persons + (a.persons === 1 ? ' Person' : ' Personen') + ') wird es schwer, Mitbewohner:innen lange zu halten – das erhöht den Leerstand.', []);
            }
            review(a, 'info', 'Untervermietung absichern',
                'Für die WG-Rechnung sollte klar sein, dass Vermietung erlaubt ist und welche Miete realistisch ist.',
                ['Erlaubt die Gemeinschaftsordnung Vermietung ohne Zustimmung des Verwalters?',
                 'Gilt am Ort die Mietpreisbremse? Sie gilt auch für WG-Zimmer (möbliert: Zuschlag begründen).',
                 'Welcher Anteil des Hausgelds lässt sich als Nebenkosten in die Warmmiete einrechnen?']);
            if (n(wg.vacancyPct) <= 0) {
                review(a, 'info', 'Kein Leerstand eingeplant', 'Auch in begehrten Lagen gibt es Wechsel und Suchzeiten – 3–8 % sind realistisch' + (a.rentGross > 0 ? ' (' + eurRange(0.03 * a.rentGross, 0.08 * a.rentGross) + ' im Monat)' : '') + '.', []);
            }
            if (a.utilities <= 0 && a.private <= 0) {
                review(a, 'info', 'Strom & Internet fehlen', 'In einer WG zahlst du diese meist vor und legst sie über die Warmmiete um oder teilst sie auf – trag sie ein, sonst wirkt die Bilanz zu gut.', []);
            }
        }
    }

    /** Standard-Unterlagen, die man vor jedem Wohnungskauf sehen sollte. */
    var DOCUMENTS = [
        'Grundbuchauszug (Abteilung II: Wegerechte, Wohnrechte; Abteilung III: Grundschulden)',
        'Teilungserklärung mit Gemeinschaftsordnung und Aufteilungsplan',
        'Wirtschaftsplan, Jahresabrechnungen und Hausgeldabrechnungen der letzten 3 Jahre',
        'Protokolle der Eigentümerversammlungen (3 Jahre) und Beschlusssammlung',
        'Stand der Erhaltungsrücklage',
        'Energieausweis',
        'Grundriss mit Wohnflächenberechnung',
        'Aktueller Grundsteuerbescheid',
        'Falls vermietet: bestehender Mietvertrag'
    ];

    /** Unterlagen vor dem Unterschreiben eines Mietvertrags. */
    var DOCUMENTS_RENT = [
        'Mietvertrag (Entwurf) – Mietart, Kündigungsverzicht, Schönheitsreparaturen, Kleinreparaturen',
        'Letzte Betriebs- und Heizkostenabrechnung',
        'Energieausweis',
        'Hausordnung',
        'Übergabeprotokoll mit Zählerständen und Fotos beim Einzug',
        'Bei WG: schriftliche Erlaubnis zur Untervermietung'
    ];

    /* ---------- Wünsche & Bedingungen ----------
       Jede Person gewichtet jeden Wunsch (0–100 % wichtig) und bewertet in
       jeder Wohnung, wie gut er erfüllt ist (0–100 %). Passung einer Person =
       gewichteter Durchschnitt ihrer Bewertungen; Wünsche, die ihr egal sind
       (0 %) oder die sie noch nicht gewichtet hat, zählen für sie nicht.
       Gemeinsame Passung = Durchschnitt der Personen (jede zählt gleich).
       100 % Wichtigkeit = Muss-Kriterium: Ist es in einer Wohnung nicht voll
       erfüllt, ist die Passung dieser Person 0 % und die gemeinsame auch –
       die Wohnung kommt dann nicht in Frage (raw = Wert ohne K.-o.). */

    var MUST = 100;

    function pct100(x) { return Math.max(0, Math.min(100, n(x))); }

    function wishScore(flat, people, wishes) {
        var ratings = (flat && flat.ratings) || {};
        wishes = wishes || [];
        var ko = [];
        var persons = (people || []).map(function (p) {
            var sumW = 0, sumWR = 0, needed = 0, done = 0, unweighted = 0, failed = [];
            wishes.forEach(function (w) {
                var imp = w.weights ? w.weights[p.id] : null;
                if (!isSet(imp)) { unweighted++; return; }
                imp = pct100(imp);
                if (imp <= 0) return;
                needed++;
                var r = ratings[w.id] ? ratings[w.id][p.id] : null;
                if (!isSet(r)) return;
                done++;
                sumW += imp;
                sumWR += imp * pct100(r);
                if (imp >= MUST && pct100(r) < 100) {
                    failed.push(w.id);
                    ko.push({ personId: p.id, wishId: w.id });
                }
            });
            var raw = sumW > 0 ? sumWR / sumW / 100 : null;
            return { id: p.id, score: failed.length ? 0 : raw, raw: raw, ko: failed, needed: needed, done: done, open: needed - done, unweighted: unweighted };
        });
        var scored = persons.filter(function (x) { return x.raw !== null; });
        var open = persons.reduce(function (s, x) { return s + x.open; }, 0);
        var unweighted = persons.reduce(function (s, x) { return s + x.unweighted; }, 0);
        var raw = scored.length ? scored.reduce(function (s, x) { return s + x.raw; }, 0) / scored.length : null;
        return {
            persons: persons,
            overall: ko.length ? 0 : raw,
            raw: raw,
            ko: ko,
            open: open,
            unweighted: unweighted,
            complete: wishes.length > 0 && persons.length > 0 && open === 0 && unweighted === 0
        };
    }

    /* ---------- Budget aus "Meine Finanzen" ---------- */

    function budget(p) {
        var b = {};
        b.ruleRate = Math.max(0, 0.35 * n(p.netIncome) - n(p.otherDebt));
        b.maxRate = n(p.bankMaxRate) > 0 ? n(p.bankMaxRate) : b.ruleRate;
        var annuity = (n(p.defRate) + n(p.defRepay)) / 100;
        b.loanFromRate = annuity > 0 ? b.maxRate * 12 / annuity : 0;
        b.maxLoan = n(p.bankMaxLoan) > 0 ? Math.min(n(p.bankMaxLoan), b.loanFromRate || Infinity) : b.loanFromRate;
        b.closingPct = transferTaxFor(p.state) + n(p.notaryPct) + n(p.brokerPct);
        b.maxPrice = (n(p.equity) + b.maxLoan) / (1 + b.closingPct / 100);
        return b;
    }

    /* ---------- Formatierung ---------- */

    var fmt0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
    var fmt1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    function eur(v) {
        if (v === null || v === undefined || !isFinite(v)) return '–';
        var r = Math.round(v);
        return (r === 0 ? '0' : fmt0.format(r)) + ' €';
    }
    /** Spanne, z. B. "200–320 €". */
    function eurRange(lo, hi) {
        var a = Math.round(lo), b = Math.round(hi);
        return a === b ? eur(b) : fmt0.format(a) + '–' + eur(b);
    }
    function pct(v) {
        if (v === null || v === undefined || !isFinite(v)) return '–';
        return fmt1.format(v * 100) + ' %';
    }
    function years(v) {
        if (v === null || v === undefined || !isFinite(v)) return 'nie';
        var y = Math.floor(v + 1e-9);
        var m = Math.round((v - y) * 12);
        if (m === 12) { y++; m = 0; }
        return y + ' J.' + (m ? ' ' + m + ' M.' : '');
    }
    function short(v) {
        var abs = Math.abs(v);
        if (abs >= 1e6) return fmt1.format(v / 1e6).replace(/,0$/, '') + ' Mio.';
        if (abs >= 1e3) return fmt0.format(v / 1e3) + ' Tsd.';
        return fmt0.format(v);
    }

    return {
        STATES: STATES,
        DOCUMENTS: DOCUMENTS,
        transferTaxFor: transferTaxFor,
        COST_EVERY: COST_EVERY,
        COST_SPLIT: COST_SPLIT,
        personCount: personCount,
        costMonthly: costMonthly,
        privateCosts: privateCosts,
        coldRentInYear: coldRentInYear,
        analyze: analyze,
        wishScore: wishScore,
        MUST: MUST,
        budget: budget,
        loanPayment: loanPayment,
        n: n,
        isSet: isSet,
        eur: eur,
        eurRange: eurRange,
        pct: pct,
        years: years,
        short: short
    };
})();
