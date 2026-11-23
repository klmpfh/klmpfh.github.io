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

    var MAX_YEARS = 60;

    /** Faktor, mit dem eine Zahlung im Monat m auf heute abgezinst wird: bis zum
     *  Ende der Zinsbindung mit dem Sollzins, danach mit dem Anschlusszins. */
    function discount(loan, m) {
        var fixed = Math.max(0, Math.round(n(loan.fixedYears))) * 12;
        var first = fixed > 0 ? Math.min(m, fixed) : m;
        var follow = isSet(loan.followRate) ? n(loan.followRate) : n(loan.rate);
        return Math.pow(1 + n(loan.rate) / 1200, -first) * Math.pow(1 + follow / 1200, first - m);
    }

    /** Darlehen, das 1 € Rate im Monat in so vielen Jahren abzahlt. */
    function loanPerRate(loan, term) {
        var months = Math.max(1, Math.round(term * 12)), s = 0;
        for (var m = 1; m <= months; m++) s += discount(loan, m);
        return s;
    }

    /** Monatsrate, mit der das Darlehen nach so vielen Jahren getilgt ist –
     *  mit Anschlusszins nach der Zinsbindung. */
    function rateForTerm(loan, amount, term) {
        // Etwas über dem Zins, sonst würde nie getilgt (Anschlusszins deutlich niedriger)
        return Math.max(amount / loanPerRate(loan, term), amount * n(loan.rate) / 1200 * 1.001 + 0.01);
    }

    /** Monatliche Anfangsrate (Zins + Tilgung) eines Annuitätendarlehens. */
    function loanPayment(loan, amount) {
        var r = n(loan.rate) / 100;
        if (loan.mode === 'term') return rateForTerm(loan, amount, n(loan.term));
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

    /* ---------- Vorgaben der Bank ----------
       "Finanzierung laut Bank" gilt für alle Wohnungen: Was in einem Darlehen leer
       ist, kommt von dort. Das Hauptdarlehen läuft normalerweise mit der Rate, die
       die Bank zusagt (mode 'max'). */

    // Feld im Darlehen → Vorgabe im Profil
    var LOAN_DEFAULTS = { rate: 'defRate', repay: 'defRepay', fixedYears: 'defFixed', followRate: 'defFollowRate' };

    function resolveLoan(loan, p) {
        var out = Object.assign({}, loan);
        Object.keys(LOAN_DEFAULTS).forEach(function (k) { if (!isSet(out[k])) out[k] = n(p[LOAN_DEFAULTS[k]]); });
        return out;
    }

    /** Rate des Hauptdarlehens bei mode 'max': max. Monatsrate der Bank ohne die
     *  Raten der weiteren Darlehen (others), mindestens Zins + Mindesttilgung
     *  (loan.repay). null = anders festgelegt oder die Bank hat noch nichts gesagt. */
    function bankPayment(loan, amount, others, p) {
        if (!loan || loan.mode !== 'max' || !(n(p.bankMaxRate) > 0) || !(amount > 0.005)) return null;
        return Math.max(loanPayment(loan, amount), n(p.bankMaxRate) - others);
    }

    /* ---------- WG / Untervermietung ---------- */

    function sum(list) {
        return list.reduce(function (s, v) { return s + v; }, 0);
    }

    /** Was eine Person über mich zahlt (p.personIncludes, abgewählt = false):
     *  running = Nebenkosten & Heizung bzw. umlegbares Hausgeld, sonst private
     *  Nebenkosten. Bei "jemand anderes" nur running. */
    function includes(p, id, key) {
        if (!id) return key === 'running';
        return ((p.personIncludes || {})[id] || {})[key] !== false;
    }

    function sumOther(items) {
        return sum(items.map(function (c) { return c.other; }));
    }

    /** Aufzählung, z. B. "Anna, Ben und Person 3". */
    function andList(names) {
        return names.length > 1 ? names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1] : names.join('');
    }

    /* ---------- Faire Miete ----------
       Kaltmiete der Wohnung (bei Kauf: Vergleichsmiete pro m² × Fläche, darin
       stecken Lage, Baujahr und Ausstattung der Wohnung), verteilt nach Zimmer-
       größe mit Zu-/Abschlägen für Lage und Ausstattung des Zimmers; die
       Gemeinschaftsfläche (Küche, Bad, Flur) zählt für alle gleich. Dazu
       Nebenkosten pro Kopf und der Anteil an den privaten Nebenkosten. */

    // [Schlüssel, Beschriftung, Zu-/Abschlag in %] – Orientierungswerte
    var FEATURES = [
        ['bath', 'Eigenes Bad', 10],
        ['balcony', 'Balkon / Terrasse', 5],
        ['furnished', 'Möbliert', 10],
        ['bright', 'Hell & ruhig', 5],
        ['dark', 'Dunkel oder laut', -5],
        ['pass', 'Durchgangszimmer', -10]
    ];

    /** Zu-/Abschlag eines Zimmers in %. */
    function roomExtra(r) {
        var f = r.features || {};
        return n(r.extra) + sum(FEATURES.map(function (x) { return f[x[0]] ? x[2] : 0; }));
    }

    /** Teil des Hausgelds, den Mitbewohner mittragen (ohne Rücklage & Verwaltung). */
    function hoaApportioned(flat) {
        return isSet(flat.hoaApport) ? Math.min(n(flat.hoaApport), n(flat.hoa)) : 0.65 * n(flat.hoa);
    }

    /** Wer wie viel zahlt. Eine Gruppe = alle Zimmer einer Person.
     *    due    fair, soweit über mich gezahlt; own: zahlt die Person selbst
     *    max    Maximum der Person für alles zusammen (null = keins)
     *    pay    damit wird gerechnet: eingetragene Miete, sonst die faire Miete
     *           bis zum Maximum; fehlen dafür Angaben, vorläufig gleichmäßig
     *           geteilt (source 'equal'), auch das höchstens bis zum Maximum.
     *           Beim Kauf ohne Vergleichsmiete sind das nur die Nebenkosten
     *    short  was zur fairen Miete fehlt, weil das Maximum greift */
    function rentPlan(flat, p) {
        var rooms = (flat.wg && flat.wg.rooms) || [];
        var isRent = flat.kind === 'rent';
        var info = privateCosts(p, flat);
        var names = p.personNames || {};
        var area = n(flat.area);
        var running = (isRent ? n(flat.serviceCharges) + n(flat.heatingCosts) : hoaApportioned(flat) + n(flat.propertyTax) / 12) / info.persons;

        var missing = [];
        if (!(area > 0)) missing.push('Wohnfläche');
        if (isRent && !(n(flat.coldRent) > 0)) missing.push('Kaltmiete');
        if (!isRent && !(n(flat.refRent) > 0)) missing.push('Vergleichsmiete pro m²');
        rooms.forEach(function (r) {
            if (!(n(r.size) > 0)) missing.push('Größe von „' + (r.name || 'Zimmer') + '“' + (names[r.person] ? ' (' + names[r.person] + ')' : ''));
        });

        var groups = [], byKey = {};
        rooms.forEach(function (r, i) {
            var key = r.person || '#' + i;
            var g = byKey[key];
            if (!g) {
                g = byKey[key] = { person: r.person || null, name: names[r.person] || '', self: !!r.self, rooms: [], entered: false, rent: 0, weight: 0 };
                groups.push(g);
            }
            g.rooms.push(i);
            if (isSet(r.rent)) { g.entered = true; g.rent += n(r.rent); }
            g.weight += n(r.size) * Math.max(0, 1 + roomExtra(r) / 100);
        });
        var common = Math.max(0, area - sum(rooms.map(function (r) { return n(r.size); }))) / (groups.length || 1);
        groups.forEach(function (g) { g.weight += common; });
        var weights = sum(groups.map(function (g) { return g.weight; }));
        var ready = !missing.length && weights > 0;
        var coldTotal = isRent ? n(flat.coldRent) : n(flat.refRent) * area;

        groups.forEach(function (g) {
            g.cold = !ready ? null : isRent ? n(flat.coldRent) * g.weight / weights : n(flat.refRent) * g.weight;
            if (g.self) { g.pay = 0; return; }
            var withRunning = includes(p, g.person, 'running');
            g.items = info.items.filter(function (c) { return c.other > 0 && includes(p, g.person, c.id); });
            g.running = withRunning ? running : 0;
            g.extra = withRunning ? 0 : running;   // zahlt den Anteil zusätzlich zur Miete
            g.priv = sumOther(g.items);
            g.own = g.person ? g.extra + sumOther(info.items) - g.priv : g.extra;
            g.max = g.person && isSet((p.personRents || {})[g.person]) ? n(p.personRents[g.person]) : null;
            var limit = g.max === null ? Infinity : Math.max(0, g.max - g.own);
            g.due = ready ? g.cold + g.running + g.priv : null;
            var equal = coldTotal / info.persons + g.running + g.priv;   // Kauf ohne Vergleichsmiete: nur die Nebenkosten
            g.over = g.entered && g.max !== null ? Math.max(0, g.rent - limit) : 0;
            g.short = !g.entered && ready ? Math.max(0, g.due - limit) : 0;
            g.source = g.entered ? 'entered' : !g.person ? 'none' : ready ? 'fair' : g.max === null ? 'none' : equal < limit ? 'equal' : 'max';
            g.pay = g.entered ? g.rent : g.source === 'fair' ? Math.min(g.due, limit) : g.source === 'equal' ? equal
                : g.source === 'max' ? limit : 0;
        });
        return { groups: groups, missing: missing, ready: ready, info: info, gross: sum(groups.map(function (g) { return g.pay; })) };
    }

    /** WG-Einnahmen. Steuer auf die Untermiete ist bewusst nicht eingerechnet.
     *  Von den privaten Nebenkosten zählt in den Wohnkosten nur mein Anteil –
     *  steckt der Anteil einer Person in ihrer Miete, geht er hier wieder ab.
     *    rentCash     gezahlte Mieten nach Leerstand
     *    rentPrivate  darin enthaltene private Nebenkosten
     *    rentRunning  darin enthaltener Anteil an Hausgeld bzw. Nebenkosten
     *    rentExtra    derselbe Anteil, wenn er zusätzlich zur Miete gezahlt wird
     *    rentEff      was die Wohnkosten senkt
     *    rentLeft     was für Kredit bzw. Kaltmiete übrig bleibt */
    function sublet(a, flat, p) {
        var wg = flat.wg || {};
        var rooms = wg.rooms || [];
        a.roomsRented = rooms.filter(function (r) { return !r.self; }).length;
        a.persons = rooms.length;
        a.rentPlan = rentPlan(flat, p);
        var keep = 1 - Math.min(100, n(wg.vacancyPct)) / 100;
        var names = {};
        a.rentGross = a.rentPlan.gross;
        a.rentCash = a.rentGross * keep;
        a.rentPrivate = a.rentRunning = a.rentExtra = 0;
        a.rentPlan.groups.forEach(function (g) {
            if (!(g.pay > 0)) return;
            a.rentPrivate += g.priv;
            a.rentRunning += g.running;
            a.rentExtra += g.extra * keep;
            g.items.forEach(function (c) { names[c.name] = true; });
        });
        a.rentPrivateNames = Object.keys(names);
        a.rentEff = a.rentCash - a.rentPrivate + a.rentExtra;
        a.rentLeft = a.rentCash - a.rentPrivate - a.rentRunning;
    }

    /* ---------- Private Nebenkosten ----------
       Auf der Übersicht gepflegt (Strom, Internet, Rundfunkbeitrag …) und
       für jede Wohnung gültig. Eine Wohnung kann einzelne Posten abwählen,
       wenn sie dort schon in Warmmiete oder Hausgeld enthalten sind
       (flat.coveredCosts = { costId: true }). Genau ein Posten ist die Heizung
       (heat: true); ob und was sie kostet, hängt an der Wohnung (heatingInfo).

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
     *  alle aus "Personen" (p.persons) – in einer Wohnung plus die Zimmer, in
     *  denen jemand anderes wohnt. */
    function personCount(p, flat) {
        var rooms = (flat && flat.wg && flat.wg.rooms) || [];
        var v = flat && isSet(flat.persons) ? n(flat.persons)
            : Math.max(1, n(p.persons)) + rooms.filter(function (r) { return !r.self && !r.person; }).length;
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

    // Wie die Heizung bezahlt wird (flat.heatPay), leer = automatisch
    var HEAT_PAY = [['self', 'extra, selbst an den Versorger'], ['incl', 'schon im Hausgeld, in Nebenkosten oder Warmmiete enthalten']];

    /** Heizung in einer Wohnung.
     *    pay     'self' oder 'incl', auto = daraus abgeleitet: Eine Heizkosten-
     *            Vorauszahlung oder zentrale Heizung ist enthalten, Etagenheizung,
     *            Elektroheizung und Öfen kommen extra. Ist die Art unbekannt, zählt
     *            sie vorsichtshalber extra, sobald auf der Übersicht ein Betrag steht.
     *    amount  pro Monat für die ganze Wohnung, source: 'own' eingetragen,
     *            'estimate' aus dem Energieverbrauch, 'today' von der Übersicht
     *            oder null = unbekannt */
    function heatingInfo(cost, flat) {
        var e = energyInfo(flat), today = !!cost && n(cost.amount) > 0;
        var auto = flat.kind === 'rent' && n(flat.heatingCosts) > 0 ? 'incl' : e.direct ? 'self' : e.type ? 'incl' : today ? 'self' : 'incl';
        var h = { auto: !flat.heatPay, pay: flat.heatPay || auto, type: e.type };
        h.source = isSet(flat.heatAmount) ? 'own' : e.cost !== null ? 'estimate' : today ? 'today' : null;
        h.amount = h.source === 'own' ? n(flat.heatAmount) : h.source === 'estimate' ? e.cost : today ? costMonthly(cost, 1).gross : 0;
        return h;
    }

    function privateCosts(p, flat) {
        var covered = Object.assign({}, flat && flat.coveredCosts);
        var heat = flat ? heatingInfo((p.privateCosts || []).find(function (c) { return c.heat; }), flat) : null;
        var count = personCount(p, flat);
        var items = (p.privateCosts || []).map(function (c) {
            if (c.heat && heat) {
                covered[c.id] = heat.pay === 'incl';
                // Der Betrag gilt für die ganze Wohnung, "je Person" passt nur zum Betrag der Übersicht
                if (heat.source !== 'today') c = Object.assign({}, c, { amount: heat.amount, every: 1, split: c.split === 'person' ? 'equal' : c.split });
            }
            var m = costMonthly(c, count);
            // other: was jede andere Person zahlt (0, wenn ich es komplett zahle
            // oder der Posten in dieser Wohnung schon enthalten ist)
            var other = count > 1 && !covered[c.id] ? (m.gross - m.mine) / (count - 1) : 0;
            return { id: c.id, name: (c.name || '').trim() || 'Ohne Namen', heat: !!c.heat, gross: m.gross, mine: m.mine, other: other, covered: !!covered[c.id] };
        });
        function sum(key, test) {
            return items.reduce(function (s, c) { return s + (!test || test(c) ? c[key] : 0); }, 0);
        }
        function counts(c) { return !c.covered; }
        function fixed(c) { return !c.covered && !c.heat; }
        return {
            items: items,
            heating: heat,
            heat: sum('mine', function (c) { return c.heat && !c.covered; }),   // mein Anteil der Heizung
            heatGross: sum('gross', function (c) { return c.heat && !c.covered; }),
            fixed: sum('mine', fixed),       // dasselbe ohne Heizung: feste Kosten
            fixedGross: sum('gross', fixed),
            fixedAll: sum('mine', function (c) { return !c.heat; }),
            persons: count,
            total: sum('mine', counts),      // mein Anteil, der hier zählt
            gross: sum('gross', counts)      // dasselbe für die ganze Wohnung
        };
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

    /* ---------- Energie & Heizung ----------
       Angaben aus Exposé oder Energieausweis. Heizkosten werden grob geschätzt:
       Kennwert × Wohnfläche × 1,2 (der Ausweis rechnet pro m² Gebäudenutzfläche,
       die etwa 20 % größer ist) × Preis. Der Kennwert gilt fürs ganze Haus. */

    var ENERGY_SOURCES = [['gas', 'Gas'], ['oel', 'Öl'], ['fern', 'Fernwärme'], ['strom', 'Strom / Umweltwärme'], ['pellets', 'Pellets / Holz'], ['andere', 'Andere / mehrere']];
    var HEATING_TYPES = [['zentral', 'Zentralheizung'], ['etage', 'Etagenheizung (Therme in der Wohnung)'], ['fern', 'Fernwärme'], ['wp', 'Wärmepumpe'], ['nacht', 'Nachtspeicher / Elektroheizung'], ['ofen', 'Einzelöfen']];
    var ENERGY_CERTS = [['verbrauch', 'Verbrauchsausweis'], ['bedarf', 'Bedarfsausweis']];

    // €/kWh inkl. Grundpreis, grobe Mittelwerte (Stand November 2026)
    var ENERGY_PRICE = { gas: 0.12, oel: 0.15, fern: 0.16, pellets: 0.09, andere: 0.12 };
    var PRICE_HEATPUMP = 0.25, PRICE_DIRECT = 0.30;
    var ENERGY_AREA = 1.2;

    // Obergrenzen der Effizienzklassen A+ bis G in kWh/(m²·a), darüber H
    var ENERGY_CLASSES = [['A+', 30], ['A', 50], ['B', 75], ['C', 100], ['D', 130], ['E', 160], ['F', 200], ['G', 250]];

    function energyInfo(flat) {
        var type = flat.heatingType || '';
        var source = type === 'fern' ? 'fern' : type === 'wp' || type === 'nacht' ? 'strom' : flat.energySource || '';
        // Heizung, die man meist selbst beim Versorger bezahlt
        var direct = type === 'etage' || type === 'nacht' || type === 'ofen';
        var price = source === 'strom' ? (direct ? PRICE_DIRECT : PRICE_HEATPUMP) : ENERGY_PRICE[source] || ENERGY_PRICE.gas;
        var use = n(flat.energyUse), area = n(flat.area);
        var cls = ENERGY_CLASSES.find(function (c) { return use <= c[1]; });
        return {
            use: use, type: type, source: source, direct: direct, price: price,
            need: flat.energyCert === 'bedarf',
            cls: use > 0 ? (cls ? cls[0] : 'H') : null,
            cost: use > 0 && area > 0 ? use * area * ENERGY_AREA * price / 12 : null   // geschätzt, pro Monat
        };
    }

    /* ---------- Gesamtanalyse einer Wohnung ---------- */

    function analyze(flat, profile, peers) {
        return flat && flat.kind === 'rent' ? analyzeRent(flat, profile, peers) : analyzeBuy(flat, profile, peers);
    }

    function analyzeRent(flat, profile, peers) {
        var p = profile;
        var a = { flat: flat, kind: 'rent', warnings: [] };
        a.area = n(flat.area);
        a.energy = energyInfo(flat);
        a.coldRent = n(flat.coldRent);
        a.serviceCharges = n(flat.serviceCharges);
        a.heating = n(flat.heatingCosts);
        a.warmRent = a.coldRent + a.serviceCharges + a.heating;
        a.coldPerSqm = a.area > 0 && a.coldRent > 0 ? a.coldRent / a.area : null;
        a.warmPerSqm = a.area > 0 && a.warmRent > 0 ? a.warmRent / a.area : null;

        a.privateInfo = privateCosts(p, flat);
        a.private = a.privateInfo.total;
        a.utilities = n(flat.utilities);
        // Nebenkosten & Heizung pro m², auch wenn die Heizung extra kommt
        a.extrasPerSqm = a.area > 0 && a.serviceCharges + a.heating > 0 ? (a.serviceCharges + a.heating + a.privateInfo.heatGross) / a.area : null;
        a.runningCosts = a.serviceCharges + a.heating + a.private + a.utilities;
        a.outflow = a.warmRent + a.private + a.utilities;

        // Einzug
        a.deposit = n(flat.deposit);
        a.oneOff = n(flat.otherOneOff);
        a.moveIn = a.deposit + a.oneOff;

        sublet(a, flat, p);

        a.netHousing = a.outflow - a.rentEff;
        a.wealthBuild = 0;
        a.trueCost = a.netHousing;

        // Mietentwicklung über 10 Jahre (Nebenkosten, WG-Mieten und private Kosten konstant)
        a.rentTimeline = [];
        var total = 0;
        for (var y = 1; y <= 10; y++) {
            var cold = coldRentInYear(flat, y);
            var net = a.netHousing + cold - a.coldRent;
            a.rentTimeline.push({ year: y, cold: cold, warm: cold + a.serviceCharges + a.heating, net: net });
            total += net;
        }
        a.coldIn5 = coldRentInYear(flat, 6);
        a.avgNet10 = total / 10;
        a.rentIncrease5 = a.coldRent > 0 ? a.coldIn5 / a.coldRent - 1 : null;

        checksRent(a, p, flat);
        assessRent(a, flat, peers);
        a.documents = DOCUMENTS_RENT;
        return a;
    }

    /** Mieten gegen das Maximum der Personen. */
    function checksFair(a) {
        a.rentPlan.groups.forEach(function (g) {
            if (g.self || !g.name) return;
            if (g.max === null) warn(a, 'info', g.name + ': Kein Maximum eingetragen (Übersicht, „Personen“).');
            else if (g.entered && g.over > 0.5) warn(a, 'warn', g.name + ': Die eingetragene Miete liegt ' + eur(g.over) + ' über dem Maximum von ' + eur(g.max) + '.');
            else if (g.short > 0.5) warn(a, 'warn', g.name + ': Fair wären ' + eur(g.due + g.own) + ' im Monat, das Maximum ist ' + eur(g.max) + ' – ' + eur(g.short) + ' trägst du.');
            else if (g.entered || g.source === 'fair') warn(a, 'ok', g.name + ': ' + eur(g.pay + g.own) + ' im Monat passen ins Maximum von ' + eur(g.max) + '.');
        });
    }

    /** Mein Teil einer Mietwohnung gegen mein Maximum (p.ownMax, "Personen"). */
    function checksOwn(a, p) {
        if (!isSet(p.ownMax)) {
            warn(a, 'info', 'Für dich ist kein Maximum eingetragen (Übersicht, „Personen“) – ob die Miete passt, lässt sich so nicht prüfen.');
            return;
        }
        var max = n(p.ownMax), text = 'Dein Teil mit allen Nebenkosten (' + eur(a.netHousing) + ')';
        if (a.netHousing > max + 0.5) warn(a, 'bad', text + ' liegt ' + eur(a.netHousing - max) + ' über deinem Maximum von ' + eur(max) + '.');
        else {
            warn(a, 'ok', text + ' passt in dein Maximum von ' + eur(max) + '.');
            if (a.netHousing + a.rentEff > max + 0.5) warn(a, 'info', 'Geht nur gemeinsam: Ohne die Mieten der anderen zahlst du ' + eur(a.netHousing + a.rentEff) + ' im Monat (Auszug einplanen).');
        }
    }

    function checksRent(a, p, flat) {
        if (a.coldRent <= 0) { warn(a, 'info', 'Kaltmiete eingeben, um die Wohnung durchzurechnen.'); return; }
        checksOwn(a, p);
        checksFair(a);
        if (a.deposit > 3 * a.coldRent + 0.5) warn(a, 'bad', 'Kaution über drei Nettokaltmieten (' + eur(3 * a.coldRent) + ') – das ist gesetzlich nicht zulässig (§ 551 BGB).');
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
            a.energy.type ? 'Wie alt ist die Heizung?' : 'Wie wird geheizt, und wie alt ist die Heizung?'
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

        assessEnergy(a, flat);

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
        a.energy = energyInfo(flat);
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

        var loans = (flat.loans || []).map(function (l) { return resolveLoan(l, p); });
        a.loans = loans;
        var fixedSum = 0;
        loans.forEach(function (l, idx) { if (idx > 0) fixedSum += n(l.amount); });
        a.loanAmounts = loans.map(function (l, idx) {
            return idx === 0 ? Math.max(0, a.need - fixedSum) : n(l.amount);
        });
        a.loanTotal = a.loanAmounts.reduce(function (s, v) { return s + v; }, 0);
        a.overFinanced = Math.max(0, a.loanTotal - a.need);
        a.ltv = a.price > 0 ? a.loanTotal / a.price : null;
        a.equityRatio = a.total > 0 ? a.equity / a.total : null;

        // Laufende Kosten (monatlich)
        a.hoa = n(flat.hoa);
        a.propertyTax = n(flat.propertyTax) / 12;
        a.maintenance = n(flat.maintenance);
        a.utilities = n(flat.utilities);
        a.privateInfo = privateCosts(p, flat);
        a.private = a.privateInfo.total;
        a.runningCosts = a.hoa + a.propertyTax + a.maintenance + a.utilities + a.private;

        sublet(a, flat, p);

        a.sims = loans.map(function (l, idx) { return simulateLoan(l, a.loanAmounts[idx], MAX_YEARS); });
        var bankRate = bankPayment(loans[0], a.loanAmounts[0], a.sims.slice(1).reduce(function (s, x) { return s + x.payment; }, 0), p);
        a.fromBank = bankRate !== null;
        // Ohne Rate der Bank ist nur die Mindesttilgung bekannt – Laufzeit und Zinsen sagen dann nichts aus
        a.rateMissing = !a.fromBank && !!loans[0] && loans[0].mode === 'max' && a.loanAmounts[0] > 0.005;
        if (a.fromBank) a.sims[0] = simulateLoan(Object.assign({}, loans[0], { mode: 'payment', payment: bankRate }), a.loanAmounts[0], MAX_YEARS);
        a.payment = a.sims.reduce(function (s, x) { return s + x.payment; }, 0);
        a.anyStuck = a.sims.some(function (x) { return x.stuck; });
        // null = nie (oder erst nach über MAX_YEARS Jahren)
        a.payoffYears = a.sims.some(function (x) { return x.payoffYears === null; }) ? null
            : a.sims.reduce(function (m, x) { return Math.max(m, x.payoffYears); }, 0);
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

        // Monatsbilanz
        a.outflow = a.payment + a.runningCosts;
        a.netHousing = a.outflow - a.rentEff;
        a.wealthBuild = a.principalYear1 / 12;
        // "Echte Kosten": was wirklich weg ist – Zinsen und laufende Kosten abzüglich
        // WG-Einnahmen. Tilgung ist Sparen.
        a.trueCost = a.interestYear1 / 12 + a.runningCosts - a.rentEff;

        // Schulden und Vermögen über die Zeit, ohne Wertsteigerung
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
            a.timeline.push({ year: y, interest: yi, principal: yp, extra: ye, balance: bal, value: a.price, net: a.price - bal, cumInterest: cumInterest });
        }
        a.netAtFixed = a.price - a.balanceAtFixed;

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
        checksRate(a, p);
        if (a.anyStuck) warn(a, 'bad', 'Eine Darlehensrate deckt nicht einmal die Zinsen – das Darlehen würde nie getilgt.');
        if (n(p.equity) > 0 && a.equityPlanned > n(p.equity) + 0.5) warn(a, 'warn', 'Eigenkapital ist hier ' + eur(a.equityPlanned - n(p.equity)) + ' höher als unter „Finanzierung laut Bank“ angegeben.');
        if (a.equity < a.closing) warn(a, 'warn', 'Eigenkapital (' + eur(a.equity) + ') deckt die Kaufnebenkosten (' + eur(a.closing) + ') nicht – viele Banken erwarten das, sonst Zinsaufschlag oder Absage.');
        if (a.ltv !== null && a.ltv > 1) warn(a, 'warn', 'Beleihung über 100 % des Kaufpreises – nur mit Aufschlag üblich.');
        else if (a.ltv !== null && a.ltv > 0.8) warn(a, 'info', 'Beleihung über 80 % (mehr als ' + eur(0.8 * a.price) + ' Darlehen) – Banken verlangen ab hier oft höhere Zinsen; Konditionen prüfen.');
        if (a.overFinanced > 1) warn(a, 'warn', 'Zusätzliche Darlehen übersteigen den Bedarf um ' + eur(a.overFinanced) + '.');
        checksFair(a);
        a.sims.forEach(function (s, idx) {
            if (s.raised) warn(a, 'warn', (flat.loans[idx].name || 'Darlehen') + ': Rate steigt nach der Zinsbindung beim angenommenen Anschlusszins auf ' + eur(s.followPayment) + '.');
        });
        if (a.balanceAtFixed > 0 && a.fixedYears > 0 && !a.anyStuck && !a.rateMissing) {
            warn(a, 'info', 'Nach ' + a.fixedYears + ' Jahren Zinsbindung sind noch ' + eur(a.balanceAtFixed) + ' offen – Zinsänderungsrisiko für die Anschlussfinanzierung.');
        }
        if (a.payoffYears !== null && a.payoffYears > 40 && !a.rateMissing) warn(a, 'warn', 'Volltilgung erst nach ' + years(a.payoffYears) + ' – höhere Tilgung erwägen.');
    }

    /** Rate gegen das, was die Bank zusagt. */
    function checksRate(a, p) {
        var max = n(p.bankMaxRate);
        if (!(a.loanTotal > 0)) return;
        if (a.rateMissing) warn(a, 'warn', 'Max. Monatsrate der Bank fehlt (Übersicht, „Finanzierung laut Bank“). Vorläufig ist die Rate nur mit der Mindesttilgung gerechnet (' + eur(a.payment) + ') – die Laufzeit steht erst mit der Rate der Bank fest.');
        if (!(max > 0)) return;
        if (a.payment > max + 0.5) warn(a, 'bad', 'Rate liegt ' + eur(a.payment - max) + ' über der maximalen Rate laut Bank' + (a.fromBank ? ', schon mit der Mindesttilgung. So wird die Bank das nicht finanzieren.' : '.'));
        else if (a.payment > max - 0.5) warn(a, 'ok', 'Rate von ' + eur(a.payment) + ' ist die maximale Rate laut Bank' + (a.payoffYears !== null ? ' (schuldenfrei nach ' + years(a.payoffYears) + ').' : '.'));
        else warn(a, 'ok', 'Rate liegt ' + eur(max - a.payment) + ' unter der maximalen Rate laut Bank.');
    }

    /* ---------- Objekt-Bewertung & Rückfragen ----------
       Prüft die Angaben zur Wohnung selbst gegen Faustwerte (Deutschland,
       Stand 2025, Energie 2026) und sammelt Fragen an Makler, Verwalter oder Verkäufer.
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
        var heating = (a.energy.type ? 'Wie alt ist die Heizung' : 'Welche Heizung gibt es, wie alt ist sie') + ', und ist ein Austausch geplant oder absehbar?';
        if (year === null) {
            if (a.price > 0) review(a, 'info', 'Baujahr fehlt', 'Das Baujahr verrät viel über anstehende Sanierungen.', ['Baujahr und Jahr der letzten größeren Sanierungen?']);
        } else if (year < 1949) {
            review(a, 'info', 'Altbau (' + year + ')',
                'Charme, aber typische Baustellen: alte Strom- und Wasserleitungen, Holzbalkendecken, Feuchte im Keller, eventuell Denkmalschutz (Auflagen, aber auch Steuervorteile).',
                ['Wann wurden Elektrik, Steigleitungen und Dach zuletzt erneuert?', 'Steht das Gebäude unter Denkmalschutz?', heating]);
        } else if (year < 1979) {
            review(a, 'warn', 'Baujahr vor 1979 (' + year + ')',
                'Gebaut vor der ersten Wärmeschutzverordnung: oft schwache Dämmung und mögliche Schadstoffe (z. B. Asbest). Fassade, Dach, Fenster und Heizung stehen häufig zur Sanierung an – das zahlt die Gemeinschaft über Rücklage oder Sonderumlage.',
                ['Welche Sanierungen wurden schon gemacht, welche sind geplant (Fassade, Dach, Fenster, Leitungen)?', 'Reicht die Erhaltungsrücklage dafür, oder sind Sonderumlagen zu erwarten?', heating]);
        } else if (year < 2000) {
            review(a, 'info', 'Baujahr ' + year,
                'Heizung, Fenster und Leitungen kommen in das Alter, in dem sie erneuert werden.',
                ['Wann wurden Heizung und Fenster zuletzt erneuert?', heating]);
        } else if (age !== null && age <= 5) {
            review(a, 'info', 'Neubau / junges Gebäude (' + year + ')',
                'Die Gewährleistung des Bauträgers läuft meist 5 Jahre ab Abnahme – Mängel am Gemeinschaftseigentum sollten bis dahin gemeldet sein.',
                ['Wurde das Gemeinschaftseigentum abgenommen, gibt es eine Mängelliste?', 'Bis wann läuft die Gewährleistung?']);
        }

        if (a.price > 0) assessEnergy(a, flat);

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
            if (a.utilities <= 0 && a.privateInfo.fixed <= 0) {
                review(a, 'info', 'Strom & Internet fehlen', 'In einer WG zahlst du diese meist vor und legst sie über die Warmmiete um oder teilst sie auf – trag sie ein, sonst wirkt die Bilanz zu gut.', []);
            }
        }
    }

    /** Energie & Heizung, für Kauf und Miete. */
    function assessEnergy(a, flat) {
        var e = a.energy, rent = a.kind === 'rent';
        var year = isSet(flat.year) ? Math.round(n(flat.year)) : null;
        var kwh = fmtArea.format(e.use) + ' kWh/m²';
        var validQ = 'Ist der Energieausweis noch gültig (10 Jahre ab Ausstellung)?';
        var certQ = flat.energyCert ? [] : ['Ist es ein Verbrauchs- oder ein Bedarfsausweis?'];
        var needNote = e.need && (year === null || year < 1979) ? ' Der Wert ist berechnet (Bedarfsausweis) – bei unsanierten Altbauten liegt der echte Verbrauch oft darunter.' : '';
        var estimate = e.cost === null ? '' : 'Geschätzt aus dem Energieausweis: etwa ' + eur(e.cost) + ' im Monat (' + kwh + ', ' + fmtArea.format(a.area) + ' m² × 1,2 Gebäudenutzfläche, ' +
            (e.source ? '' : 'angenommen ') + Math.round(e.price * 100) + ' ct/kWh).' + needNote;

        // Verbrauch
        if (e.use <= 0) {
            review(a, 'info', 'Energieverbrauch fehlt', 'Steht im Exposé oder Energieausweis in kWh/(m²·a). Damit schätzt die Seite die Heizkosten und warnt vor hohem Verbrauch.',
                ['Energieausweis zeigen lassen: Verbrauch oder Bedarf, wie viele kWh/m² im Jahr, welcher Energieträger?']);
        } else if (e.use > 160) {
            var high = e.use > 200;
            review(a, high ? 'warn' : 'info', (high ? 'Energieverbrauch hoch' : 'Energieverbrauch erhöht') + ' (' + kwh + ', Klasse ' + e.cls + ')',
                (rent ? 'Du zahlst das über die Heizkosten, und steigende Energiepreise treffen dich stärker. Wird das Haus saniert, kann der Vermieter einen Teil der Kosten auf die Miete umlegen.'
                    : 'Schwache Dämmung oder alte Heizung: Die Heizkosten sind hoch, und eine Sanierung von Fassade, Dach, Fenstern oder Heizung wird wahrscheinlicher – bezahlt aus Rücklage oder Sonderumlage.') + needNote,
                (rent ? ['Sind energetische Sanierungen geplant oder angekündigt (Mieterhöhung nach Modernisierung)?']
                    : ['Welche energetischen Sanierungen sind geplant oder beschlossen, und reicht die Erhaltungsrücklage dafür?']).concat([validQ], certQ));
        } else if (e.use < 90 && year !== null && year < 1979 && !e.need && e.source !== 'strom') {
            review(a, 'info', 'Verbrauch für den Altbau auffällig niedrig (' + kwh + ')',
                'Für Baujahr ' + year + ' ist das wenig. Entweder wurde saniert, oder der Ausweis bildet nur sparsame Bewohner oder Leerstand ab – dann zahlst du später mehr als geschätzt.',
                ['Wurde energetisch saniert (Dämmung, Fenster, Heizung), und wann?', validQ].concat(certQ));
        } else {
            review(a, 'ok', (e.use <= 100 ? 'Energieverbrauch niedrig' : 'Energieverbrauch im üblichen Rahmen') + ' (' + kwh + ', Klasse ' + e.cls + ')',
                'Unter 100 kWh/m² ist gut, bis etwa 160 kWh/m² üblich.' + needNote, [validQ].concat(certQ));
        }

        // Heizkosten in der Monatsrechnung
        var billQ = 'Letzte Heizkostenabrechnung (oder Rechnungen des Versorgers) der Wohnung zeigen lassen.';
        var heat = a.privateInfo.heating;
        if (heat.pay === 'self') {
            var entered = a.privateInfo.heatGross;
            if (entered <= 0) {
                review(a, 'warn', 'Heizkosten fehlen in der Rechnung',
                    'Die Heizung zahlst du hier zusätzlich ' + (rent ? 'zu Miete und Nebenkosten' : 'zum Hausgeld') + ', der Betrag ist aber unbekannt. Ohne ihn ist die Monatsbilanz zu optimistisch – trag Energieverbrauch und Wohnfläche ein oder den Betrag selbst unter „Laufende Kosten“.', [billQ]);
            } else if (e.cost !== null && e.cost > 1.4 * entered) {
                review(a, 'info', 'Heizkosten eher knapp angesetzt (' + eur(entered) + ' im Monat)',
                    estimate, [billQ]);
            } else if (heat.auto && !e.type) {
                review(a, 'info', 'Heizung vorsichtshalber extra gerechnet (' + eur(entered) + ')',
                    'Die Heizungsart ist unbekannt. Läuft die Heizung über ' + (rent ? 'die Nebenkosten' : 'das Hausgeld') + ', stell sie unter „Laufende Kosten“ auf „schon enthalten“.',
                    ['Wie wird die Heizung abgerechnet: über ' + (rent ? 'die Nebenkosten' : 'das Hausgeld') + ' oder direkt beim Versorger?', billQ]);
            }
        } else if (e.cost !== null && rent && a.heating > 0) {
            var gap = e.cost - a.heating;
            if (gap > 15 && e.cost > (e.need ? 1.6 : 1.25) * a.heating) {
                review(a, e.need ? 'info' : 'warn', 'Heizkosten-Vorauszahlung wohl zu niedrig (' + eur(a.heating) + ')',
                    estimate + ' Dann droht mit der Abrechnung eine Nachzahlung von rund ' + eur(gap * 12) + ' im Jahr. Sparsames Heizen oder eine gut gelegene Wohnung kann das ändern.', [billQ]);
            } else {
                review(a, 'ok', 'Heizkosten-Vorauszahlung plausibel (' + eur(a.heating) + ')', estimate, [billQ]);
            }
        } else if (e.cost !== null && rent && a.serviceCharges > 0) {
            var left = (a.serviceCharges - e.cost) / a.area;
            if (left < 1) review(a, left < 0 && !e.need ? 'warn' : 'info', 'Nebenkosten decken die Heizung wohl nicht (' + eur(a.serviceCharges) + ')',
                estimate + ' Für Wasser, Müll, Hausmeister und Co. ' + (left < 0 ? 'bleibt nichts übrig' : 'bleiben nur ' + fmt2(left) + ' €/m²') + ' (üblich etwa 1,20–2,00 €/m²). Entweder kommt die Heizung noch dazu, oder es droht eine Nachzahlung.',
                ['Ist die Heizung in der Nebenkosten-Vorauszahlung enthalten?', billQ]);
        } else if (e.cost !== null && !rent && a.hoa > 0 && e.cost > 0.5 * a.hoa) {
            review(a, 'info', 'Heizkosten im Hausgeld prüfen (geschätzt ' + eur(e.cost) + ')',
                estimate + ' Das wäre mehr als die Hälfte des Hausgelds von ' + eur(a.hoa) + '. Entweder ist die Heizung nicht enthalten, oder für die Rücklage bleibt wenig.',
                ['Sind Heizung und Warmwasser im Hausgeld enthalten?', billQ]);
        }

        // Heizungsart
        var fossil = e.source === 'gas' || e.source === 'oel';
        var fossilText = !fossil ? '' : rent
            ? ' Gas und Öl können durch den CO₂-Preis teurer werden. Einen Teil der CO₂-Kosten trägt der Vermieter, je schlechter das Gebäude, desto mehr' + (e.direct ? ' – mit eigenem Liefervertrag musst du ihn dir selbst erstatten lassen.' : '; das steht in der Heizkostenabrechnung.')
            : ' Gas und Öl können durch den CO₂-Preis teurer werden. Vorhandene Heizungen dürfen nach derzeitigem Stand weiterlaufen; für neu eingebaute Gas- und Ölheizungen ist ab 2029 ein Bio-Anteil vorgesehen (Stand November 2026, vor dem Kauf prüfen).';
        var ageQ = 'Wie alt ist die Heizung, und ist ein Austausch geplant oder absehbar?';
        if (e.type === 'nacht') {
            review(a, 'warn', 'Strom-Direktheizung', 'Heizen mit Nachtspeicher oder Elektroheizung gehört zu den teuersten Arten, und der Strompreis trifft dich voll.' +
                (rent ? '' : ' Ein Umbau auf ein anderes System ist in einer einzelnen Wohnung oft schwierig.'),
                ['Gibt es einen eigenen Zähler und einen Heizstrom-Tarif?', billQ].concat(rent ? [] : [ageQ]));
        } else if (e.source === 'fern') {
            review(a, 'info', 'Fernwärme', 'Wartungsarm, aber den Anbieter kannst du nicht wechseln – den Preis bestimmt der örtliche Versorger.',
                ['Welcher Versorger, welcher Preis pro kWh, und wie lange läuft der Liefervertrag?']);
        } else if (e.type === 'etage') {
            review(a, rent ? 'info' : 'warn', e.source === 'gas' ? 'Gasetagenheizung' : 'Etagenheizung',
                (rent ? 'Die Therme hängt in der Wohnung, du hast meist einen eigenen Liefervertrag. Reparaturen und Austausch zahlt der Vermieter, die Wartung wird oft umgelegt.'
                    : 'Die Therme gehört meist zur Wohnung: Wartung und Austausch zahlst du selbst, nicht die Gemeinschaft. Plane dafür Rücklage ein.') + fossilText,
                [rent ? 'Wie alt ist die Therme, und wer zahlt die jährliche Wartung?' : 'Wie alt ist die Therme, und gehört sie laut Teilungserklärung zum Sondereigentum?'].concat(
                    rent ? [] : ['Plant die Gemeinschaft eine Umstellung auf eine Zentralheizung?']));
        } else if (fossil) {
            review(a, 'info', e.source === 'gas' ? 'Gasheizung' : 'Ölheizung', 'Der Brennstoffpreis schwankt stark.' + fossilText, [ageQ]);
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

    /* ---------- Budget laut Bank ---------- */

    /** Was mit den Zusagen der Bank drin ist, null = noch keine da.
     *    maxLoan  Kreditrahmen oder was die Rate mit Zins + Mindesttilgung hergibt
     *    limit    was davon bremst: 'loan' (Kreditrahmen) oder 'rate' */
    function budget(p) {
        var annuity = (n(p.defRate) + n(p.defRepay)) / 100;
        var fromRate = n(p.bankMaxRate) > 0 && annuity > 0 ? n(p.bankMaxRate) * 12 / annuity : null;
        var fromLoan = n(p.bankMaxLoan) > 0 ? n(p.bankMaxLoan) : null;
        if (fromRate === null && fromLoan === null) return null;
        var b = { limit: fromRate === null || (fromLoan !== null && fromLoan <= fromRate) ? 'loan' : 'rate' };
        b.maxLoan = b.limit === 'loan' ? fromLoan : fromRate;
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
        andList: andList,
        FEATURES: FEATURES,
        roomExtra: roomExtra,
        rentPlan: rentPlan,
        sumOther: sumOther,
        privateCosts: privateCosts,
        HEAT_PAY: HEAT_PAY,
        coldRentInYear: coldRentInYear,
        ENERGY_SOURCES: ENERGY_SOURCES,
        HEATING_TYPES: HEATING_TYPES,
        ENERGY_CERTS: ENERGY_CERTS,
        energyInfo: energyInfo,
        analyze: analyze,
        wishScore: wishScore,
        MUST: MUST,
        budget: budget,
        LOAN_DEFAULTS: LOAN_DEFAULTS,
        n: n,
        isSet: isSet,
        eur: eur,
        eurRange: eurRange,
        pct: pct,
        years: years,
        short: short
    };
})();
