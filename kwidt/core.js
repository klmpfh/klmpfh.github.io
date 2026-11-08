/**
 * Kwidt – Rechen- und Datenlogik (ohne DOM, damit sie auch in Node testbar ist).
 *
 * Grundregeln:
 *  - Geldbeträge sind immer Ganzzahlen in der kleinsten Einheit (Cent), nie Floats.
 *  - Alles ist deterministisch: Jedes Gerät rechnet aus denselben Daten exakt
 *    dieselben Cent-Beträge aus (z. B. wer den übrigen Cent bekommt).
 *  - Eine Gruppe ist eine Sammlung einzelner Datensätze mit Zeitstempel `t`.
 *    Zusammengeführt wird pro Datensatz ("neuester gewinnt"), Löschen ist ein
 *    Marker (`del`) statt einer echten Entfernung. So können zwei Geräte
 *    unabhängig voneinander arbeiten und später beliebig oft in beliebiger
 *    Reihenfolge abgleichen, ohne dass etwas verloren geht oder wieder auftaucht.
 * 
 * sudo!2
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.QuittCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // 'general' ist der Standard und heißt: keine Kategorie. Die Vorgaben haben kein
    // Symbol, wer eins möchte, schreibt ein Emoji in den Namen einer Kategorie.
    var CATEGORIES = [
        { id: 'general',   emoji: '', label: 'Keine Kategorie' },
        { id: 'food',      emoji: '', label: 'Essen & Trinken' },
        { id: 'groceries', emoji: '', label: 'Einkauf' },
        { id: 'bar',       emoji: '', label: 'Bar & Ausgehen' },
        { id: 'travel',    emoji: '', label: 'Reise' },
        { id: 'transport', emoji: '', label: 'Transport' },
        { id: 'lodging',   emoji: '', label: 'Unterkunft' },
        { id: 'home',      emoji: '', label: 'Wohnen' },
        { id: 'utilities', emoji: '', label: 'Nebenkosten' },
        { id: 'fun',       emoji: '', label: 'Freizeit' },
        { id: 'gift',      emoji: '', label: 'Geschenk' },
        { id: 'health',    emoji: '', label: 'Gesundheit' },
        { id: 'other',     emoji: '', label: 'Sonstiges' }
    ];

    var CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF',
        'TRY', 'JPY', 'CAD', 'AUD', 'THB'];

    var SPLIT_TYPES = ['equal', 'exact', 'percent', 'shares', 'adjust', 'items'];
    var REPEATS = ['none', 'weekly', 'biweekly', 'monthly', 'yearly'];

    var MAX_AMOUNT = 1e12;
    var MAX_ITEMS = 200;

    var RE_GROUP_ID = /^[0-9a-f]{32}$/;
    var RE_ID = /^[0-9a-f]{16}$/;
    var RE_EXPENSE_ID = /^[0-9a-f]{16}(~\d{4}-\d{2}-\d{2})?$/;
    var RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
    var RE_CLAIM_KEY = /^\d{1,4}\|[0-9a-f]{16}$/;

    /* ---------- IDs & kleine Helfer ---------- */

    function randomHex(bytes) {
        var arr = new Uint8Array(bytes);
        (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto).getRandomValues(arr);
        var out = '';
        for (var i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, '0');
        return out;
    }
    function newId() { return randomHex(8); }
    function newGroupId() { return randomHex(16); }

    /** FNV-1a: reicht, um Restcents fair, aber auf allen Geräten gleich zu verteilen. */
    function hash(str) {
        var h = 0x811c9dc5;
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    function todayStr(d) {
        d = d || new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    /* ---------- Geld ---------- */

    var decimalsCache = {};
    function currencyDecimals(cur) {
        if (decimalsCache[cur] === undefined) {
            try {
                decimalsCache[cur] = new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur })
                    .resolvedOptions().maximumFractionDigits;
            } catch (e) {
                decimalsCache[cur] = 2;
            }
        }
        return decimalsCache[cur];
    }

    var formatCache = {};
    function formatMoney(minor, cur) {
        if (!formatCache[cur]) {
            try {
                formatCache[cur] = new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur });
            } catch (e) {
                formatCache[cur] = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
        }
        return formatCache[cur].format(minor / Math.pow(10, currencyDecimals(cur)));
    }

    /** Betrag als Eingabetext ohne Währungszeichen und Tausenderpunkte ("1234,50"). */
    function amountToInput(minor, cur) {
        var dec = currencyDecimals(cur);
        return (minor / Math.pow(10, dec)).toFixed(dec).replace('.', ',');
    }

    /** Liest "12,50", "12.50", "1.234,56" oder "1,234.56". Liefert null bei Unsinn. */
    function parseNumberText(text, decimals) {
        var s = String(text === undefined || text === null ? '' : text).replace(/[\s'’€$£]/g, '');
        var sign = 1;
        if (s.charAt(0) === '-' || s.charAt(0) === '−') { sign = -1; s = s.slice(1); }
        else if (s.charAt(0) === '+') { s = s.slice(1); }
        if (!s) return null;

        var comma = s.lastIndexOf(',');
        var dot = s.lastIndexOf('.');
        if (comma !== -1 && dot !== -1) {
            var decimalSep = comma > dot ? ',' : '.';
            var thousands = decimalSep === ',' ? '.' : ',';
            s = s.split(thousands).join('').replace(decimalSep, '.');
        } else if (comma !== -1) {
            if (s.indexOf(',') !== comma) s = s.split(',').join('');
            else s = s.replace(',', '.');
        } else if (dot !== -1) {
            var first = s.indexOf('.');
            var isThousands = first !== dot ||
                (/^\d{1,3}\.\d{3}$/.test(s) && decimals < 3);
            if (isThousands) s = s.split('.').join('');
        }
        if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
        return sign * parseFloat(s);
    }

    /** Text → kleinste Einheit. `allowNegative` nur für Korrektur-Beträge. */
    function parseAmount(text, cur, allowNegative) {
        var dec = currencyDecimals(cur);
        var n = parseNumberText(text, dec);
        if (n === null) return null;
        var minor = Math.round(n * Math.pow(10, dec));
        if (!allowNegative && minor < 0) return null;
        if (Math.abs(minor) > MAX_AMOUNT) return null;
        return minor;
    }

    /** Für Prozente und Anteile: "33,3" → 33.3. Hier ist ein Punkt nie ein Tausender. */
    function parseQuantity(text) {
        return parseNumberText(text, 9);
    }

    /**
     * Verteilt `total` ganzzahlig proportional zu `weights` (Hare-Verfahren): Jeder
     * bekommt das Abgerundete, die übrigen Cents gehen an die größten Nachkommareste.
     * Gleichstände entscheidet ein Hash aus seed+id: fair über viele Ausgaben, aber
     * auf jedem Gerät identisch.
     */
    function distribute(weights, total, seed) {
        var ids = Object.keys(weights).sort();
        var sum = 0;
        ids.forEach(function (id) { sum += weights[id]; });
        var result = {};
        if (!ids.length || sum <= 0) return result;

        var assigned = 0;
        var parts = ids.map(function (id) {
            var exact = total * weights[id] / sum;
            var whole = Math.floor(exact + 1e-9);
            result[id] = whole;
            assigned += whole;
            return { id: id, frac: exact - whole, tie: hash(seed + '|' + id) };
        });

        parts.sort(function (a, b) {
            if (Math.abs(b.frac - a.frac) > 1e-9) return b.frac - a.frac;
            return a.tie - b.tie || (a.id < b.id ? -1 : 1);
        });

        var rest = total - assigned;
        var candidates = parts.filter(function (p) { return weights[p.id] > 0; });
        for (var i = 0; rest !== 0 && candidates.length; i = (i + 1) % candidates.length) {
            var step = rest > 0 ? 1 : -1;
            result[candidates[i].id] += step;
            rest -= step;
        }
        return result;
    }

    /**
     * Wer trägt wie viel von dieser Ausgabe? Liefert {memberId: cent} mit exakter
     * Summe `amount`, oder null, wenn die Aufteilung nicht aufgeht.
     *
     * split.values je Typ:
     *   equal    id → 1 (nur beteiligte Personen)
     *   exact    id → Cent
     *   percent  id → Prozent (Summe 100)
     *   shares   id → Anteile (> 0)
     *   adjust   id → Korrektur in Cent (±), der Rest wird gleich geteilt
     *   items    id → 1 (wer die allgemeinen Kosten mitträgt, siehe itemShares)
     */
    function computeOwed(expense) {
        var split = expense.split || {};
        var values = split.values || {};
        var amount = expense.amount;
        var ids = Object.keys(values);
        var seed = expense.id || '';
        if (!ids.length || !Number.isSafeInteger(amount) || amount <= 0) return null;

        var weights = {};
        var sum = 0;
        var i, id;

        for (i = 0; i < ids.length; i++) {
            if (typeof values[ids[i]] !== 'number' || !isFinite(values[ids[i]])) return null;
        }

        switch (split.type) {
            case 'equal':
                ids.forEach(function (x) { weights[x] = 1; });
                return distribute(weights, amount, seed);

            case 'shares':
                for (i = 0; i < ids.length; i++) {
                    id = ids[i];
                    if (values[id] <= 0) return null;
                    weights[id] = values[id];
                }
                return distribute(weights, amount, seed);

            case 'percent':
                for (i = 0; i < ids.length; i++) {
                    id = ids[i];
                    if (values[id] < 0) return null;
                    weights[id] = values[id];
                    sum += values[id];
                }
                if (Math.abs(sum - 100) > 0.005) return null;
                return distribute(weights, amount, seed);

            case 'exact':
                var owed = {};
                for (i = 0; i < ids.length; i++) {
                    id = ids[i];
                    if (!Number.isSafeInteger(values[id]) || values[id] < 0) return null;
                    owed[id] = values[id];
                    sum += values[id];
                }
                return sum === amount ? owed : null;

            case 'adjust':
                for (i = 0; i < ids.length; i++) {
                    id = ids[i];
                    if (!Number.isSafeInteger(values[id])) return null;
                    sum += values[id];
                    weights[id] = 1;
                }
                if (sum > amount) return null;
                var base = distribute(weights, amount - sum, seed);
                var adjusted = {};
                for (i = 0; i < ids.length; i++) {
                    id = ids[i];
                    adjusted[id] = (base[id] || 0) + values[id];
                    if (adjusted[id] < 0) return null;
                }
                return adjusted;

            case 'items':
                var shares = itemShares(expense);
                if (!shares) return null;
                ids.forEach(function (x) { weights[x] = 1; });
                var general = distribute(weights, shares.general, seed);
                Object.keys(general).forEach(function (x) {
                    shares.owed[x] = (shares.owed[x] || 0) + general[x];
                });
                return shares.owed;

            default:
                return null;
        }
    }

    /* ---------- Positionen einer Rechnung ---------- */

    /**
     * Wer hatte diese Position? Eine Zuordnung ist ein eigener kleiner Datensatz
     * pro Position und Person (expense.claims["<position>|<person>"] = {t, on}).
     * Tippen zwei Personen gleichzeitig an, überlebt beides: Die Position wird
     * dann einfach geteilt, statt dass ein Gerät das andere überschreibt.
     */
    function claimantsOf(expense, itemId) {
        var claims = expense.claims || {};
        var prefix = itemId + '|';
        return Object.keys(claims)
            .filter(function (key) { return key.indexOf(prefix) === 0 && claims[key].on; })
            .map(function (key) { return key.slice(prefix.length); })
            .sort();
    }

    /** {owed, general}: Zugeordnetes pro Person, und was als allgemeine Kosten übrig bleibt. */
    function itemShares(expense) {
        var items = expense.items;
        if (!Array.isArray(items) || !items.length) return null;
        var owed = {};
        var sum = 0;
        var general = expense.amount;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!isMoney(item.amount)) return null;
            sum += item.amount;
            var ids = claimantsOf(expense, item.id);
            if (!ids.length) continue;
            general -= item.amount;
            var weights = {};
            ids.forEach(function (id) { weights[id] = 1; });
            var part = distribute(weights, item.amount, (expense.id || '') + '|' + item.id);
            ids.forEach(function (id) { owed[id] = (owed[id] || 0) + part[id]; });
        }
        // Hängt nur an den Positionen, nie an den Zuordnungen: Eine Zuordnung, die
        // erst beim Abgleich dazukommt, kann eine gültige Ausgabe nicht ungültig machen.
        return sum > expense.amount ? null : { owed: owed, general: general };
    }

    /** Zeitstempel je Zuordnung, damit ein Antippen nie an einem älteren Stand scheitert. */
    function setClaim(expense, itemId, memberId, on) {
        var key = itemId + '|' + memberId;
        var prev = expense.claims[key];
        expense.claims[key] = { t: Math.max(Date.now(), prev ? prev.t + 1 : 0), on: !!on };
    }

    function payersValid(expense) {
        var ids = Object.keys(expense.payers || {});
        if (!ids.length) return false;
        var sum = 0;
        for (var i = 0; i < ids.length; i++) {
            var v = expense.payers[ids[i]];
            if (!Number.isSafeInteger(v) || v < 0) return false;
            sum += v;
        }
        return sum === expense.amount;
    }

    /* ---------- Salden ---------- */

    function liveExpenses(doc) {
        return Object.keys(doc.expenses).map(function (k) { return doc.expenses[k]; })
            .filter(function (e) { return !e.del && !e.series; });
    }
    function livePayments(doc) {
        return Object.keys(doc.payments).map(function (k) { return doc.payments[k]; })
            .filter(function (p) { return !p.del; });
    }

    /**
     * Eine Rückzahlung (`refund`) ist eine Ausgabe mit umgekehrtem Vorzeichen: In `payers`
     * steht, wer das Geld bekommen hat, und die Aufteilung sagt, wem es zusteht.
     * Beispiel: A bekommt 300 € vom Stromversorger zurück, aufgeteilt auf A, B und C.
     * Dann schuldet A den anderen beiden je 100 €.
     */
    function expenseSign(e) {
        return e.refund ? -1 : 1;
    }

    /** {currency: {memberId: saldo}}; positiv = bekommt Geld, negativ = schuldet. */
    function computeBalances(doc) {
        var out = {};
        function add(cur, id, delta) {
            if (!out[cur]) out[cur] = {};
            out[cur][id] = (out[cur][id] || 0) + delta;
        }
        liveExpenses(doc).forEach(function (e) {
            var owed = computeOwed(e);
            if (!owed) return;
            var sign = expenseSign(e);
            Object.keys(e.payers).forEach(function (id) { add(e.currency, id, sign * e.payers[id]); });
            Object.keys(owed).forEach(function (id) { add(e.currency, id, -sign * owed[id]); });
        });
        livePayments(doc).forEach(function (p) {
            add(p.currency, p.from, p.amount);
            add(p.currency, p.to, -p.amount);
        });
        return out;
    }

    /* ---------- Kategorien ---------- */

    function isBuiltinCategory(id) {
        return CATEGORIES.some(function (c) { return c.id === id; });
    }

    /**
     * Die Vorgaben gelten für jede Gruppe. doc.categories hält nur die Abweichungen:
     * eigene Kategorien (ID wie alle Datensätze) und entfernte Vorgaben (Marker unter
     * deren ID). "Keine Kategorie" lässt sich nicht entfernen und steht immer vorne.
     */
    function groupCategories(doc) {
        var records = doc.categories || {};
        var builtin = CATEGORIES.filter(function (c) {
            return !(records[c.id] && records[c.id].del);
        }).map(function (c) {
            // Eine entfernte und mit Emoji wieder ergänzte Vorgabe behält dieses Symbol.
            return records[c.id] && records[c.id].emoji ? { id: c.id, label: c.label, emoji: records[c.id].emoji } : c;
        });
        var own = Object.keys(records)
            .map(function (id) { return records[id]; })
            .filter(function (c) { return !c.del && !isBuiltinCategory(c.id); })
            .sort(function (a, b) { return a.label.localeCompare(b.label, 'de'); });
        return builtin.concat(own);
    }

    /** Entfernte Kategorien zählen wie "keine", die Ausgabe behält trotzdem ihre Zuordnung. */
    function findCategory(doc, id) {
        return groupCategories(doc).filter(function (c) { return c.id === id; })[0] || CATEGORIES[0];
    }

    /** "🐶 Haustier" → Symbol und Name. Ohne Emoji gibt es kein Symbol. */
    function parseCategoryName(text) {
        var clean = tidyText(String(text), 200);
        var emoji = clean.match(RE_EMOJI);
        var label = emoji ? clean.replace(emoji[0], ' ') : clean;
        return { emoji: emoji ? emoji[0] : '', label: tidyText(label, 30) };
    }

    /** Vergleichsform eines Namens: ohne Groß/klein, Symbol und überzählige Leerzeichen. */
    function nameKey(text) {
        return parseCategoryName(text).label.toLocaleLowerCase('de');
    }

    /** Die Kategorie, die genauso heißt wie `name` (z. B. die Beschreibung einer Ausgabe), sonst null. */
    function categoryByName(doc, name) {
        var key = nameKey(name);
        if (!key) return null;
        return groupCategories(doc).filter(function (c) {
            return c.id !== CATEGORIES[0].id && c.label.toLocaleLowerCase('de') === key;
        })[0] || null;
    }

    /**
     * Legt eine Kategorie an oder holt eine entfernte zurück, dann gehören ihre alten
     * Ausgaben auch wieder dazu. Liefert {category}, {exists: true} oder null.
     */
    function addCategory(doc, text) {
        var parts = parseCategoryName(text);
        if (!parts.label) return null;
        function same(c) { return c.label.toLocaleLowerCase('de') === parts.label.toLocaleLowerCase('de'); }
        if (groupCategories(doc).some(same)) return { exists: true };

        var removedBuiltin = CATEGORIES.filter(same)[0];
        var removedOwn = Object.keys(doc.categories)
            .map(function (id) { return doc.categories[id]; })
            .filter(function (c) { return c.del && same(c); })[0];
        var id = removedBuiltin ? removedBuiltin.id : removedOwn ? removedOwn.id : newId();
        var record = {
            id: id, t: nextT(doc), label: removedBuiltin ? removedBuiltin.label : parts.label,
            emoji: parts.emoji || (removedOwn ? removedOwn.emoji : ''), del: false
        };
        doc.categories[id] = record;
        return { category: record };
    }

    function removeCategory(doc, id) {
        var current = findCategory(doc, id);
        if (current.id !== id || id === CATEGORIES[0].id) return;
        doc.categories[id] = { id: id, t: nextT(doc), label: current.label, emoji: current.emoji, del: true };
    }

    function byAmountDesc(a, b) {
        return b.amount - a.amount || (a.id < b.id ? -1 : 1);
    }

    /** Möglichst wenige Überweisungen: erst exakt passende Paare, dann gierig Größter an Größten. */
    function simplifyDebts(balance) {
        var creditors = [];
        var debtors = [];
        Object.keys(balance).forEach(function (id) {
            if (balance[id] > 0) creditors.push({ id: id, amount: balance[id] });
            else if (balance[id] < 0) debtors.push({ id: id, amount: -balance[id] });
        });
        var transfers = [];

        debtors.sort(byAmountDesc);
        creditors.sort(byAmountDesc);
        debtors = debtors.filter(function (d) {
            for (var i = 0; i < creditors.length; i++) {
                if (creditors[i].amount === d.amount) {
                    transfers.push({ from: d.id, to: creditors[i].id, amount: d.amount });
                    creditors.splice(i, 1);
                    return false;
                }
            }
            return true;
        });

        while (creditors.length && debtors.length) {
            creditors.sort(byAmountDesc);
            debtors.sort(byAmountDesc);
            var c = creditors[0];
            var d = debtors[0];
            var amount = Math.min(c.amount, d.amount);
            transfers.push({ from: d.id, to: c.id, amount: amount });
            c.amount -= amount;
            d.amount -= amount;
            if (!c.amount) creditors.shift();
            if (!d.amount) debtors.shift();
        }
        return transfers.sort(function (a, b) {
            return b.amount - a.amount || (a.from + a.to < b.from + b.to ? -1 : 1);
        });
    }

    /** Ohne Vereinfachung: Wer schuldet wem direkt, aus den einzelnen Ausgaben und Zahlungen. */
    function pairwiseDebts(doc, cur) {
        var matrix = {};
        function owe(a, b, amount) {
            if (a === b || !amount) return;
            var low = a < b ? a : b;
            var high = a < b ? b : a;
            var key = low + '|' + high;
            matrix[key] = (matrix[key] || 0) + (a === low ? amount : -amount);
        }
        liveExpenses(doc).forEach(function (e) {
            if (e.currency !== cur) return;
            var owed = computeOwed(e);
            if (!owed) return;
            var net = {};
            var sign = expenseSign(e);
            Object.keys(e.payers).forEach(function (id) { net[id] = (net[id] || 0) + sign * e.payers[id]; });
            Object.keys(owed).forEach(function (id) { net[id] = (net[id] || 0) - sign * owed[id]; });
            simplifyDebts(net).forEach(function (t) { owe(t.from, t.to, t.amount); });
        });
        livePayments(doc).forEach(function (p) {
            if (p.currency === cur) owe(p.from, p.to, -p.amount);
        });

        var transfers = [];
        Object.keys(matrix).forEach(function (key) {
            var pair = key.split('|');
            if (matrix[key] > 0) transfers.push({ from: pair[0], to: pair[1], amount: matrix[key] });
            else if (matrix[key] < 0) transfers.push({ from: pair[1], to: pair[0], amount: -matrix[key] });
        });
        return transfers.sort(function (a, b) {
            return b.amount - a.amount || (a.from + a.to < b.from + b.to ? -1 : 1);
        });
    }

    function settlements(doc, cur, balances) {
        balances = balances || computeBalances(doc);
        if (doc.meta.simplify) return simplifyDebts(balances[cur] || {});
        return pairwiseDebts(doc, cur);
    }

    function isSettled(balances) {
        return Object.keys(balances).every(function (cur) {
            return Object.keys(balances[cur]).every(function (id) { return balances[cur][id] === 0; });
        });
    }

    /* ---------- Statistik ---------- */

    function statistics(doc, cur) {
        var categories = {};
        var members = {};
        var total = 0;
        var count = 0;
        var spent = { amount: 0, count: 0 };
        var income = { amount: 0, count: 0 };
        var months = {};
        function member(id) {
            if (!members[id]) members[id] = { id: id, paid: 0, share: 0 };
            return members[id];
        }
        liveExpenses(doc).forEach(function (e) {
            if (e.currency !== cur) return;
            var owed = computeOwed(e);
            if (!owed) return;
            // Rückzahlungen mindern die Ausgaben, auch die ihrer Kategorie.
            var sign = expenseSign(e);
            total += sign * e.amount;
            count++;
            var bucket = e.refund ? income : spent;
            bucket.amount += e.amount;
            bucket.count++;
            var categoryId = findCategory(doc, e.category).id;
            categories[categoryId] = (categories[categoryId] || 0) + sign * e.amount;
            var month = months[e.date.slice(0, 7)] || (months[e.date.slice(0, 7)] = {});
            month[categoryId] = (month[categoryId] || 0) + sign * e.amount;
            Object.keys(e.payers).forEach(function (id) { member(id).paid += sign * e.payers[id]; });
            Object.keys(owed).forEach(function (id) { member(id).share += sign * owed[id]; });
        });
        var byCategory = Object.keys(categories)
            .map(function (id) { return { id: id, amount: categories[id] }; })
            .sort(byAmountDesc);
        return {
            total: total,
            count: count,
            // Ausgaben und Einnahmen (Rückzahlungen) getrennt, beide positiv.
            spent: spent,
            income: income,
            byCategory: byCategory,
            byMonth: monthTable(months, byCategory.map(function (row) { return row.id; })),
            byMember: Object.keys(members)
                .map(function (id) { return members[id]; })
                .sort(function (a, b) { return b.share - a.share || (a.id < b.id ? -1 : 1); })
        };
    }

    /**
     * Beträge pro Monat und Kategorie, neuester Monat zuerst. Monate ganz ohne Ausgaben
     * zwischen dem ersten und letzten sind dabei, damit auffällt, wenn etwas ausblieb.
     * Liefert {categories, rows: [{month, cells: {id: betrag}, total}]}.
     */
    function monthTable(months, categoryIds) {
        var keys = Object.keys(months).sort();
        if (!keys.length) return { categories: categoryIds, rows: [] };
        var all = [];
        var y = +keys[0].slice(0, 4);
        var m = +keys[0].slice(5, 7);
        var last = keys[keys.length - 1];
        for (var key = keys[0]; key <= last; key = y + '-' + pad2(m)) {
            all.push(key);
            if (++m > 12) { m = 1; y++; }
        }
        return {
            categories: categoryIds,
            rows: all.reverse().map(function (k) {
                var cells = months[k] || {};
                var total = Object.keys(cells).reduce(function (sum, id) { return sum + cells[id]; }, 0);
                return { month: k, cells: cells, total: total };
            })
        };
    }

    /** Alle Währungen, die in der Gruppe vorkommen; die Gruppenwährung zuerst. */
    function currenciesUsed(doc) {
        var set = {};
        liveExpenses(doc).forEach(function (e) { set[e.currency] = true; });
        livePayments(doc).forEach(function (p) { set[p.currency] = true; });
        var list = Object.keys(set).sort();
        var main = doc.meta.currency;
        list = list.filter(function (c) { return c !== main; });
        list.unshift(main);
        return list;
    }

    /* ---------- Wiederkehrende Ausgaben ---------- */

    function occurrence(dateStr, repeat, n) {
        var p = dateStr.split('-').map(Number);
        var d;
        if (repeat === 'weekly' || repeat === 'biweekly') {
            d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n * (repeat === 'weekly' ? 7 : 14)));
        } else {
            var months = (p[1] - 1) + n * (repeat === 'yearly' ? 12 : 1);
            var lastDay = new Date(Date.UTC(p[0], months + 1, 0)).getUTCDate();
            d = new Date(Date.UTC(p[0], months, Math.min(p[2], lastDay)));
        }
        return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }

    function latestOccurrences(doc) {
        var latest = {};
        Object.keys(doc.expenses).forEach(function (key) {
            var e = doc.expenses[key];
            if (e.parent && (!latest[e.parent] || e.date > latest[e.parent])) latest[e.parent] = e.date;
        });
        return latest;
    }

    function bookOccurrence(doc, series, date) {
        var copy = JSON.parse(JSON.stringify(series));
        copy.id = series.id + '~' + date;
        copy.date = date;
        copy.repeat = 'none';
        copy.parent = series.id;
        delete copy.series;
        doc.expenses[copy.id] = copy;
    }

    /**
     * Eine Serie ist nur eine Vorlage (`series`): Sie zählt nie selbst, sondern erzeugt
     * für jeden Termin einen eigenen Eintrag. Änderungen an der Vorlage gelten also nur
     * für künftige Termine, und jeder gebuchte Eintrag lässt sich einzeln bearbeiten.
     * Früher zählte die Vorlage als erster Termin. Solche Serien werden hier umgestellt.
     *
     * Die ID eines Eintrags ergibt sich aus Vorlage + Datum und der Zeitstempel aus der
     * Vorlage: So erzeugen zwei Geräte denselben Datensatz, statt doppelt zu buchen, und
     * ein gelöschter Eintrag (neuerer Zeitstempel) wird beim Abgleich nicht wieder lebendig.
     *
     * Gebucht wird nur nach dem letzten vorhandenen Eintrag: Ändert jemand Datum oder
     * Rhythmus der Vorlage, ergäben sich sonst neue IDs für schon gebuchte Zeiträume und
     * damit doppelte Buchungen.
     */
    function expandRecurring(doc, today) {
        var created = 0;
        var latest = latestOccurrences(doc);
        Object.keys(doc.expenses).forEach(function (key) {
            var series = doc.expenses[key];
            if (series.del || series.parent || !series.repeat || series.repeat === 'none') return;
            if (!series.series) {
                series = doc.expenses[key] = Object.assign({}, series, { series: true });
                created++;
                if (series.date <= today && !doc.expenses[series.id + '~' + series.date]) {
                    bookOccurrence(doc, series, series.date);
                }
            }
            for (var n = 0; n <= 520; n++) {
                var date = occurrence(series.date, series.repeat, n);
                if (date > today) break;
                if (doc.expenses[series.id + '~' + date] || (latest[series.id] && date <= latest[series.id])) continue;
                bookOccurrence(doc, series, date);
                created++;
            }
        });
        return created;
    }

    /** Laufende Serien, ohne beendete. */
    function liveSeries(doc) {
        return Object.keys(doc.expenses).map(function (k) { return doc.expenses[k]; })
            .filter(function (e) { return e.series && !e.del && e.repeat !== 'none'; });
    }

    /** Alle Einträge einer Serie, neueste zuerst, auch gelöschte. */
    function occurrencesOf(doc, seriesId) {
        return Object.keys(doc.expenses).map(function (k) { return doc.expenses[k]; })
            .filter(function (e) { return e.parent === seriesId; })
            .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    }

    /** Datum der nächsten Buchung, oder null. */
    function nextOccurrence(doc, series, today) {
        var latest = latestOccurrences(doc)[series.id];
        for (var n = 0; n <= 520; n++) {
            var date = occurrence(series.date, series.repeat, n);
            if (date > today && (!latest || date > latest)) return date;
        }
        return null;
    }

    /* ---------- Gruppen-Dokument ---------- */

    var COLLECTIONS = ['members', 'expenses', 'payments', 'comments', 'activity', 'categories'];

    function emptyGroup(id) {
        return {
            id: id,
            meta: { t: 0, name: '', currency: 'EUR', simplify: true },
            members: {}, expenses: {}, payments: {}, comments: {}, activity: {}, categories: {}
        };
    }

    function lastT(doc) {
        var max = doc.meta.t || 0;
        COLLECTIONS.forEach(function (coll) {
            Object.keys(doc[coll]).forEach(function (id) {
                if (doc[coll][id].t > max) max = doc[coll][id].t;
            });
        });
        return max;
    }

    /** Monoton steigender Zeitstempel: nie kleiner als alles, was das Dokument schon enthält. */
    function nextT(doc) {
        return Math.max(Date.now(), lastT(doc) + 1);
    }

    function isNewer(incoming, current) {
        if (incoming.t !== current.t) return incoming.t > current.t;
        // Dieselbe Serie, nur noch nicht umgestellt: Die Vorlage darf nicht zurückfallen.
        if (!!incoming.series !== !!current.series) return !!incoming.series;
        return JSON.stringify(incoming) > JSON.stringify(current);
    }

    function withoutClaims(record) {
        var copy = Object.assign({}, record);
        delete copy.claims;
        return copy;
    }

    /**
     * Sieger von zwei Ständen eines Datensatzes (`cur`, falls nichts Neues dabei ist).
     * Zuordnungen laufen quer dazu: Sie ändern nicht den Zeitstempel der Ausgabe und
     * werden einzeln zusammengeführt, so geht weder eine gleichzeitige Bearbeitung
     * der Ausgabe noch die Auswahl einer anderen Person verloren.
     */
    function mergeRecord(cur, incoming) {
        if (!cur.claims && !incoming.claims) return isNewer(incoming, cur) ? incoming : cur;
        var base = isNewer(withoutClaims(incoming), withoutClaims(cur)) ? incoming : cur;
        if (base.split.type !== 'items') return base;
        var claims = Object.assign({}, cur.claims);
        var changed = base !== cur;
        Object.keys(incoming.claims || {}).forEach(function (key) {
            var mine = claims[key];
            var theirs = incoming.claims[key];
            if (!mine || theirs.t > mine.t || (theirs.t === mine.t && theirs.on && !mine.on)) {
                claims[key] = theirs;
                changed = true;
            }
        });
        return changed ? Object.assign({}, base, { claims: claims }) : cur;
    }

    /** Führt `incoming` in `target` zusammen. Liefert, ob sich `target` geändert hat. */
    function mergeGroups(target, incoming) {
        var changed = false;
        if (isNewer(incoming.meta, target.meta)) {
            target.meta = incoming.meta;
            changed = true;
        }
        COLLECTIONS.forEach(function (coll) {
            Object.keys(incoming[coll]).forEach(function (id) {
                var cur = target[coll][id];
                var next = cur ? mergeRecord(cur, incoming[coll][id]) : incoming[coll][id];
                if (next !== cur) {
                    target[coll][id] = next;
                    changed = true;
                }
            });
        });
        return changed;
    }

    function clip(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

    /** Für Namen: Leerzeichen am Rand weg, auch nach dem Kürzen, mehrere innen werden eins. */
    var RE_EDGE_SPACE = /^[\s\u200B\uFEFF]+|[\s\u200B\uFEFF]+$/g;
    function tidyText(v, max) {
        if (typeof v !== 'string') return '';
        return v.replace(RE_EDGE_SPACE, '').replace(/\s+/g, ' ').slice(0, max).replace(RE_EDGE_SPACE, '');
    }
    function isT(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }
    function isMoney(v) { return Number.isSafeInteger(v) && v > 0 && v <= MAX_AMOUNT; }
    function isCurrency(v) { return typeof v === 'string' && /^[A-Z]{3}$/.test(v); }

    function cleanMap(raw, keep) {
        var out = {};
        if (!raw || typeof raw !== 'object') return out;
        Object.keys(raw).forEach(function (key) {
            var value = raw[key];
            if (!value || typeof value !== 'object' || value.id !== key) return;
            var cleaned = keep(value);
            if (cleaned) out[key] = cleaned;
        });
        return out;
    }

    function cleanNumberMap(raw) {
        var out = {};
        if (!raw || typeof raw !== 'object') return null;
        var keys = Object.keys(raw);
        for (var i = 0; i < keys.length; i++) {
            if (!RE_ID.test(keys[i]) || typeof raw[keys[i]] !== 'number' || !isFinite(raw[keys[i]])) return null;
            out[keys[i]] = raw[keys[i]];
        }
        return out;
    }

    function cleanMember(m) {
        if (!RE_ID.test(m.id) || !isT(m.t)) return null;
        var name = tidyText(m.name, 40);
        if (!name) return null;
        return { id: m.id, t: m.t, name: name, left: !!m.left };
    }

    function cleanItems(raw) {
        if (!Array.isArray(raw)) return [];
        var seen = {};
        return raw.slice(0, MAX_ITEMS).filter(function (item) {
            if (!item || !Number.isSafeInteger(item.id) || item.id < 0 || item.id > 9999) return false;
            if (seen[item.id] || !isMoney(item.amount)) return false;
            seen[item.id] = true;
            return true;
        }).map(function (item) {
            return { id: item.id, name: tidyText(item.name, 60) || 'Position', amount: item.amount };
        });
    }

    function cleanClaims(raw) {
        var out = {};
        if (!raw || typeof raw !== 'object') return out;
        Object.keys(raw).forEach(function (key) {
            var claim = raw[key];
            if (RE_CLAIM_KEY.test(key) && claim && isT(claim.t)) out[key] = { t: claim.t, on: !!claim.on };
        });
        return out;
    }

    function cleanExpense(e) {
        if (!RE_EXPENSE_ID.test(e.id) || !isT(e.t)) return null;
        if (!isMoney(e.amount) || !isCurrency(e.currency) || !RE_DATE.test(String(e.date))) return null;
        var payers = cleanNumberMap(e.payers);
        var values = cleanNumberMap(e.split && e.split.values);
        if (!payers || !values || SPLIT_TYPES.indexOf(e.split.type) === -1) return null;
        var out = {
            id: e.id,
            t: e.t,
            by: clip(e.by, 16),
            desc: tidyText(e.desc, 120) || 'Ausgabe',
            amount: e.amount,
            currency: e.currency,
            date: e.date,
            category: isBuiltinCategory(e.category) || RE_ID.test(String(e.category)) ? e.category : 'general',
            note: clip(e.note, 1000),
            payers: payers,
            split: { type: e.split.type, values: values },
            repeat: REPEATS.indexOf(e.repeat) !== -1 ? e.repeat : 'none',
            del: !!e.del
        };
        if (typeof e.parent === 'string' && RE_ID.test(e.parent)) out.parent = e.parent;
        if (out.split.type === 'items') {
            out.items = cleanItems(e.items);
            out.claims = cleanClaims(e.claims);
        }
        if (e.series === true) out.series = true;
        if (e.refund === true) out.refund = true;
        return payersValid(out) && computeOwed(out) ? out : null;
    }

    function cleanPayment(p) {
        if (!RE_ID.test(p.id) || !isT(p.t)) return null;
        if (!isMoney(p.amount) || !isCurrency(p.currency) || !RE_DATE.test(String(p.date))) return null;
        if (!RE_ID.test(String(p.from)) || !RE_ID.test(String(p.to)) || p.from === p.to) return null;
        return {
            id: p.id, t: p.t, by: clip(p.by, 16), from: p.from, to: p.to, amount: p.amount,
            currency: p.currency, date: p.date, note: clip(p.note, 300), del: !!p.del
        };
    }

    function cleanComment(c) {
        if (!RE_ID.test(c.id) || !isT(c.t) || !RE_EXPENSE_ID.test(String(c.expense))) return null;
        return { id: c.id, t: c.t, by: clip(c.by, 16), expense: c.expense, text: clip(c.text, 1000), del: !!c.del };
    }

    function cleanCategory(c) {
        if (!(RE_ID.test(c.id) || isBuiltinCategory(c.id)) || c.id === CATEGORIES[0].id || !isT(c.t)) return null;
        var label = tidyText(c.label, 30);
        if (!label && !c.del) return null;
        return { id: c.id, t: c.t, label: label, emoji: clip(c.emoji, 16), del: !!c.del };
    }

    function cleanActivity(a) {
        if (!RE_ID.test(a.id) || !isT(a.t)) return null;
        var out = { id: a.id, t: a.t, by: clip(a.by, 16), kind: clip(a.kind, 24), ref: clip(a.ref, 30), label: clip(a.label, 160) };
        if (isMoney(a.amount) && isCurrency(a.currency)) {
            out.amount = a.amount;
            out.currency = a.currency;
        }
        return out;
    }

    /**
     * Daten von außen (Link, Peer, Backup-Datei) sind nicht vertrauenswürdig: Hier
     * wird alles auf die bekannten Felder reduziert und geprüft. Kaputte Datensätze
     * fallen weg, statt später die Salden zu verfälschen.
     */
    function sanitizeGroup(raw) {
        if (!raw || typeof raw !== 'object' || !RE_GROUP_ID.test(String(raw.id))) return null;
        var m = raw.meta;
        if (!m || typeof m !== 'object' || !isT(m.t)) return null;
        return {
            id: raw.id,
            meta: {
                t: m.t,
                name: tidyText(m.name, 60),
                currency: isCurrency(m.currency) ? m.currency : 'EUR',
                simplify: m.simplify !== false
            },
            members: cleanMap(raw.members, cleanMember),
            expenses: cleanMap(raw.expenses, cleanExpense),
            payments: cleanMap(raw.payments, cleanPayment),
            comments: cleanMap(raw.comments, cleanComment),
            activity: cleanMap(raw.activity, cleanActivity),
            categories: cleanMap(raw.categories, cleanCategory)
        };
    }

    /** Kopie fürs Teilen per Link: nur die letzten Aktivitäten, damit der Link kurz bleibt. */
    function snapshotForLink(doc, activityLimit) {
        var copy = JSON.parse(JSON.stringify(doc));
        var ids = Object.keys(copy.activity).sort(function (a, b) {
            return copy.activity[b].t - copy.activity[a].t;
        });
        ids.slice(activityLimit).forEach(function (id) { delete copy.activity[id]; });
        return copy;
    }

    /* ---------- Stand der Daten ---------- */

    function sortedPairs(map) {
        return Object.keys(map || {}).sort().map(function (key) { return [key, map[key]]; });
    }

    /**
     * Vier Hex-Zeichen als Fingerabdruck der Eingaben: Sind sie auf zwei Geräten gleich,
     * ist der Stand gleich. Das sind 65.536 Möglichkeiten, zwei verschiedene Stände sehen
     * also nur mit etwa 1 : 65.000 gleich aus. Mehr Zeichen vergleicht niemand genau,
     * und ein Irrtum kostet wenig: Der nächste Abgleich führt ohnehin alles zusammen. Zählt nur, was die Daten ausmacht: Zeitstempel und Verlauf
     * nicht, gelöschte Einträge auch nicht, weil sie einem Gerät noch fehlen dürfen.
     */
    function dataFingerprint(doc) {
        var lines = [JSON.stringify(['meta', doc.meta.name, doc.meta.currency, doc.meta.simplify])];
        Object.keys(doc.members).forEach(function (id) {
            var m = doc.members[id];
            lines.push(JSON.stringify(['member', id, m.name, m.left]));
        });
        Object.keys(doc.expenses).forEach(function (id) {
            var e = doc.expenses[id];
            if (e.del) return;
            var claims = Object.keys(e.claims || {}).filter(function (key) { return e.claims[key].on; }).sort();
            lines.push(JSON.stringify(['expense', id, e.desc, e.amount, e.currency, e.date, e.category, e.note,
                sortedPairs(e.payers), e.split.type, sortedPairs(e.split.values), e.repeat, !!e.series, e.items || [], claims, !!e.refund]));
        });
        livePayments(doc).forEach(function (p) {
            lines.push(JSON.stringify(['payment', p.id, p.from, p.to, p.amount, p.currency, p.date, p.note]));
        });
        groupCategories(doc).forEach(function (c) {
            lines.push(JSON.stringify(['category', c.id, c.label, c.emoji]));
        });
        Object.keys(doc.comments).forEach(function (id) {
            var c = doc.comments[id];
            if (!c.del) lines.push(JSON.stringify(['comment', id, c.expense, c.text]));
        });

        // Nachmischen: Sonst würde eine kleine Änderung nur wenige Bits des Hashes treffen.
        var h = hash(lines.sort().join('\n'));
        h ^= h >>> 16;
        h = Math.imul(h, 0x85ebca6b);
        h ^= h >>> 13;
        h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16;
        return ((h >>> 0) + 0x100000000).toString(16).slice(1, 5).toUpperCase();
    }

    /* ---------- Gruppensymbol ---------- */

    var EMOJI_UNIT = '(?:\\p{RI}\\p{RI}|[0-9#*]\\uFE0F?\\u20E3|(?![©®™])\\p{Extended_Pictographic}' +
        '(?:\\p{EMod}|\\uFE0F)?(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})?)';
    var RE_EMOJI = new RegExp(EMOJI_UNIT + '(?:\\u200D' + EMOJI_UNIT + ')*', 'u');

    /**
     * Das erste Emoji im Namen, sonst die Anfangsbuchstaben der ersten zwei Wörter
     * ("Sommer in Lissabon" → SI) bzw. die ersten zwei Buchstaben eines einzelnen
     * Worts ("Mallorca" → MA).
     */
    function groupSymbol(name) {
        var text = String(name || '').normalize('NFC');
        var emoji = text.match(RE_EMOJI);
        if (emoji) return { text: emoji[0], emoji: true };
        var words = text.match(/[\p{L}\p{M}\p{N}]+/gu) || [];
        var letters = words.length > 1
            ? words.slice(0, 2).map(function (w) { return Array.from(w)[0]; }).join('')
            : Array.from(words[0] || '?').slice(0, 2).join('');
        return { text: Array.from(letters.toLocaleUpperCase('de')).slice(0, 2).join(''), emoji: false };
    }

    /* ---------- Excel-Dateien (.xls) lesen ---------- */

    var CFB_END = 0xFFFFFFFC;

    /**
     * Eine .xls-Datei ist ein kleines Dateisystem (Compound File) mit dem Datenstrom
     * "Workbook" darin. Liefert dessen Bytes, oder null, wenn es keine solche Datei ist.
     * Kaputte Dateien enden in einem RangeError, das fängt der Aufrufer ab.
     */
    function workbookStream(buffer) {
        var view = new DataView(buffer);
        if (buffer.byteLength < 512 || view.getUint32(0, true) !== 0xE011CFD0 || view.getUint32(4, true) !== 0xE11AB1A1) return null;
        var sectorSize = Math.pow(2, view.getUint16(30, true));
        var miniSize = Math.pow(2, view.getUint16(32, true));
        var total = Math.ceil(buffer.byteLength / sectorSize);
        var whole = new Uint8Array(buffer);

        function sectorAt(sector) { return (sector + 1) * sectorSize; }

        var fatSectors = [];
        var i;
        for (i = 0; i < 109; i++) fatSectors.push(view.getUint32(76 + i * 4, true));
        var difat = view.getUint32(68, true);
        for (var guard = 0; difat < CFB_END && guard < total; guard++) {
            for (i = 0; i < sectorSize / 4 - 1; i++) fatSectors.push(view.getUint32(sectorAt(difat) + i * 4, true));
            difat = view.getUint32(sectorAt(difat) + sectorSize - 4, true);
        }
        var fat = [];
        fatSectors.filter(function (sector) { return sector < CFB_END; }).forEach(function (sector) {
            for (var n = 0; n < sectorSize / 4; n++) fat.push(view.getUint32(sectorAt(sector) + n * 4, true));
        });

        function chain(start, next) {
            var out = [];
            for (var sector = start; sector < CFB_END && out.length < next.length; sector = next[sector]) out.push(sector);
            return out;
        }

        function readSectors(start) {
            var sectors = chain(start, fat);
            var out = new Uint8Array(sectors.length * sectorSize);
            sectors.forEach(function (sector, index) {
                out.set(whole.subarray(sectorAt(sector), sectorAt(sector) + sectorSize), index * sectorSize);
            });
            return out;
        }

        var directory = readSectors(view.getUint32(48, true));
        var dirView = new DataView(directory.buffer);
        var root = null;
        var entry = null;
        for (var at = 0; at + 128 <= directory.length; at += 128) {
            var nameLength = Math.max(0, dirView.getUint16(at + 64, true) - 2);
            var name = '';
            for (i = 0; i < nameLength; i += 2) name += String.fromCharCode(dirView.getUint16(at + i, true));
            var found = { start: dirView.getUint32(at + 116, true), size: dirView.getUint32(at + 120, true) };
            if (directory[at + 66] === 5) root = found;
            if (/^(workbook|book)$/i.test(name) && !entry) entry = found;
        }
        if (!entry) return null;
        if (entry.size >= view.getUint32(56, true)) return readSectors(entry.start).subarray(0, entry.size);

        // Kleine Datenströme liegen in eigenen, kürzeren Blöcken.
        var miniTable = readSectors(view.getUint32(60, true));
        var miniView = new DataView(miniTable.buffer);
        var miniFat = [];
        for (i = 0; i + 4 <= miniTable.length; i += 4) miniFat.push(miniView.getUint32(i, true));
        var miniStream = readSectors(root.start);
        var blocks = chain(entry.start, miniFat);
        var out = new Uint8Array(blocks.length * miniSize);
        blocks.forEach(function (block, index) {
            out.set(miniStream.subarray(block * miniSize, (block + 1) * miniSize), index * miniSize);
        });
        return out.subarray(0, entry.size);
    }

    /** Die Texte stehen zentral in einer Tabelle, die über mehrere Datensätze laufen darf. */
    function readSharedStrings(chunks) {
        var c = 0;
        var o = 0;
        function byte() {
            while (c < chunks.length && o >= chunks[c].length) { c++; o = 0; }
            if (c >= chunks.length) throw new RangeError('Texttabelle zu kurz');
            return chunks[c][o++];
        }
        function u16() { var low = byte(); return low | (byte() << 8); }
        function u32() { var low = u16(); return (low + u16() * 65536); }

        u32();
        var count = u32();
        var out = [];
        for (var n = 0; n < count; n++) {
            var length = u16();
            var flags = byte();
            var wide = flags & 1;
            var rich = flags & 8 ? u16() : 0;
            var extra = flags & 4 ? u32() : 0;
            var text = '';
            for (var i = 0; i < length; i++) {
                if (o >= chunks[c].length) {
                    // Mitten im Text beginnt ein neuer Datensatz mit eigener Zeichenbreite.
                    c++;
                    o = 0;
                    if (c >= chunks.length) throw new RangeError('Texttabelle zu kurz');
                    wide = chunks[c][o++] & 1;
                }
                text += String.fromCharCode(wide ? u16() : byte());
            }
            for (var skip = rich * 4 + extra; skip > 0; skip--) byte();
            out.push(text);
        }
        return out;
    }

    function rkNumber(view, at) {
        var raw = view.getUint32(at, true);
        var value;
        if (raw & 2) {
            value = (raw | 0) >> 2;
        } else {
            var bits = new DataView(new ArrayBuffer(8));
            bits.setUint32(4, raw & 0xFFFFFFFC, true);
            value = bits.getFloat64(0, true);
        }
        return raw & 1 ? value / 100 : value;
    }

    /**
     * Liest die Tabellenblätter einer .xls-Datei als [{name, rows}]. Das deckt Texte und
     * Zahlen ab, mehr steht in den Dateien aus Splid nicht. Liefert null bei anderen Dateien.
     */
    function readXls(buffer) {
        var bytes = workbookStream(buffer);
        if (!bytes) return null;
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        var strings = [];
        var sheetNames = {};
        var sheets = [];
        var current = null;
        var pendingText = null;
        var pos = 0;

        function chars(at, length, wide) {
            var text = '';
            for (var i = 0; i < length; i++) {
                text += String.fromCharCode(wide ? view.getUint16(at + i * 2, true) : view.getUint8(at + i));
            }
            return text;
        }
        function put(row, col, value) {
            if (!current) return;
            if (!current.cells[row]) current.cells[row] = [];
            current.cells[row][col] = value;
        }

        while (pos + 4 <= bytes.length) {
            var id = view.getUint16(pos, true);
            var size = view.getUint16(pos + 2, true);
            var data = pos + 4;
            var row = data + 4 <= bytes.length ? view.getUint16(data, true) : 0;
            var col = data + 4 <= bytes.length ? view.getUint16(data + 2, true) : 0;
            if (id === 0x0809) {
                current = view.getUint16(data + 2, true) === 0x0010 ? { name: sheetNames[pos] || 'Blatt', cells: [] } : null;
                if (current) sheets.push(current);
            } else if (id === 0x0085) {
                sheetNames[view.getUint32(data, true)] = chars(data + 8, view.getUint8(data + 6), view.getUint8(data + 7) & 1);
            } else if (id === 0x00FC) {
                var chunks = [bytes.subarray(data, data + size)];
                var next = data + size;
                while (next + 4 <= bytes.length && view.getUint16(next, true) === 0x003C) {
                    var chunkSize = view.getUint16(next + 2, true);
                    chunks.push(bytes.subarray(next + 4, next + 4 + chunkSize));
                    next += 4 + chunkSize;
                }
                strings = readSharedStrings(chunks);
                pos = next;
                continue;
            } else if (id === 0x00FD) {
                put(row, col, strings[view.getUint32(data + 6, true)]);
            } else if (id === 0x0204) {
                put(row, col, chars(data + 9, view.getUint16(data + 6, true), view.getUint8(data + 8) & 1));
            } else if (id === 0x0203) {
                put(row, col, view.getFloat64(data + 6, true));
            } else if (id === 0x027E) {
                put(row, col, rkNumber(view, data + 6));
            } else if (id === 0x00BD) {
                for (var at = data + 4, c = col; at + 6 <= data + size - 2; at += 6, c++) put(row, c, rkNumber(view, at + 2));
            } else if (id === 0x0006) {
                if (view.getUint16(data + 12, true) === 0xFFFF) pendingText = { row: row, col: col };
                else put(row, col, view.getFloat64(data + 6, true));
            } else if (id === 0x0207 && pendingText) {
                put(pendingText.row, pendingText.col, chars(data + 3, view.getUint16(data, true), view.getUint8(data + 2) & 1));
                pendingText = null;
            }
            pos = data + size;
        }

        return sheets.map(function (sheet) {
            return {
                name: sheet.name,
                rows: Array.from(sheet.cells, function (cells) {
                    return Array.from(cells || [], function (cell) { return cell === undefined ? '' : cell; });
                })
            };
        });
    }

    /* ---------- Import aus Splid ---------- */

    function cellNumber(value) {
        if (typeof value === 'number') return isFinite(value) ? value : null;
        return typeof value === 'string' && value.trim() ? parseNumberText(value, 2) : null;
    }

    function splidDate(value) {
        if (typeof value === 'number' && value > 30000 && value < 80000) {
            return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
        }
        var m = String(value).match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})\b/);
        if (!m) return null;
        var year = m[3].length === 2 ? '20' + m[3] : m[3];
        if (+m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31 || year < '2000') return null;
        return year + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
    }

    /**
     * Ein Splid-Export hat pro Person zwei Spalten: bezahlt und Anteil (negativ). Die
     * Anteile sind ungerundet, deshalb entscheiden sie nur über die Verteilung. Die Summen-
     * und Ausgleichszeilen bleiben draußen, die ergeben sich aus den Ausgaben von selbst.
     *
     * Eine direkte Zahlung ist im Export nicht markiert und heißt je nach Sprache und
     * Eingabe anders. Erkennbar ist sie am Aufbau: Eine Person zahlt, und nur eine andere
     * trägt den Anteil. Für die Salden macht das keinen Unterschied.
     * Liefert {name, currency, members, expenses, payments, skipped} oder null.
     */
    function parseSplid(sheets, today) {
        for (var s = 0; s < sheets.length; s++) {
            var rows = sheets[s].rows;
            var headerRow = -1;
            for (var r = 0; r < rows.length && headerRow === -1; r++) {
                if (rows[r][0] === 'Titel' && rows[r][1] === 'Betrag' && rows[r][3] === 'Von') headerRow = r;
            }
            if (headerRow !== -1) return parseSplidRows(rows, headerRow, today);
        }
        return null;
    }

    function parseSplidRows(rows, headerRow, today) {
        var header = rows[headerRow];
        var people = [];
        for (var c = 6; c < header.length; c++) {
            var name = String(header[c]).trim().slice(0, 40);
            if (!name) continue;
            var unique = name;
            for (var n = 2; people.some(function (p) { return p.name === unique; }); n++) unique = name + ' ' + n;
            people.push({ name: unique, col: c });
        }

        var expenses = [];
        var payments = [];
        var skipped = 0;
        var currencyCount = {};

        rows.slice(headerRow + 1).forEach(function (row, index) {
            var desc = String(row[0] === undefined ? '' : row[0]).trim();
            if (!desc) return;
            var currency = String(row[2]).trim();
            var value = cellNumber(row[1]);
            if (!isCurrency(currency) || !value || value <= 0) { skipped++; return; }
            var amount = Math.round(value * Math.pow(10, currencyDecimals(currency)));

            var payers = {};
            var paid = 0;
            var shares = {};
            var low = Infinity;
            var high = 0;
            people.forEach(function (person) {
                var factor = Math.pow(10, currencyDecimals(currency));
                var payment = Math.round((cellNumber(row[person.col]) || 0) * factor);
                if (payment > 0) {
                    payers[person.name] = payment;
                    paid += payment;
                }
                var share = Math.abs(cellNumber(row[person.col + 1]) || 0);
                if (share > 0) {
                    shares[person.name] = share;
                    low = Math.min(low, share);
                    high = Math.max(high, share);
                }
            });

            var from = String(row[3]).trim();
            if (!paid && people.some(function (p) { return p.name === from; })) {
                payers[from] = amount;
                paid = amount;
            }
            // Gerundete Teilbeträge dürfen ein paar Cent abweichen, mehr nicht.
            var payerNames = Object.keys(payers).sort(function (a, b) { return payers[b] - payers[a]; });
            if (!payerNames.length || !Object.keys(shares).length || Math.abs(paid - amount) > people.length) {
                skipped++;
                return;
            }
            payers[payerNames[0]] += amount - paid;

            var date = splidDate(row[4]) || splidDate(row[5]) || today;
            currencyCount[currency] = (currencyCount[currency] || 0) + 1;

            var shareNames = Object.keys(shares);
            if (payerNames.length === 1 && shareNames.length === 1 && payerNames[0] !== shareNames[0]) {
                payments.push({
                    from: payerNames[0], to: shareNames[0], amount: amount, currency: currency, date: date,
                    note: /^(zahlung|payment)$/i.test(desc) ? '' : desc.slice(0, 300)
                });
                return;
            }

            expenses.push({
                desc: desc.slice(0, 120),
                amount: amount,
                currency: currency,
                date: date,
                payers: payers,
                equal: high - low < 0.006,
                shares: high - low < 0.006 ? shares : distribute(shares, amount, desc + '|' + index)
            });
        });

        var main = Object.keys(currencyCount).sort(function (a, b) { return currencyCount[b] - currencyCount[a]; })[0];
        return {
            name: String(rows[0] && rows[0][0] || '').split(/\s+[—–]\s+/)[0].trim().slice(0, 60),
            currency: main || 'EUR',
            members: people.map(function (p) { return p.name; }),
            expenses: expenses,
            payments: payments,
            skipped: skipped
        };
    }

    /**
     * Kategorie-Vorschläge für einen Import: Titel, die mindestens zweimal vorkommen
     * (ohne Groß/klein), in der häufigsten Schreibweise. Vorgaben sind nicht dabei.
     * Liefert [{label, count}], häufigste zuerst.
     */
    function splidCategorySuggestions(data) {
        var groups = {};
        data.expenses.forEach(function (e) {
            var label = parseCategoryName(e.desc).label;
            var key = label.toLocaleLowerCase('de');
            if (!key) return;
            var g = groups[key] || (groups[key] = { count: 0, spellings: {} });
            g.count++;
            g.spellings[label] = (g.spellings[label] || 0) + 1;
        });
        var builtin = CATEGORIES.map(function (c) { return c.label.toLocaleLowerCase('de'); });
        return Object.keys(groups)
            .filter(function (key) { return groups[key].count >= 2 && builtin.indexOf(key) === -1; })
            .map(function (key) {
                var sp = groups[key].spellings;
                var label = Object.keys(sp).sort(function (a, b) { return sp[b] - sp[a] || (a < b ? -1 : 1); })[0];
                return { label: label, count: groups[key].count };
            })
            .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label, 'de'); });
    }

    /**
     * Trägt die gelesenen Ausgaben und Zahlungen in die Gruppe ein. `ids` ordnet Namen den Personen zu.
     * `data.categories` (Namen) legt fest, welche Kategorien es gibt: Nicht genannte Vorgaben
     * fallen weg. Ausgaben, die genauso heißen wie eine Kategorie, bekommen sie.
     */
    function importSplid(doc, data, ids, by) {
        if (data.categories) {
            var wanted = data.categories.map(nameKey);
            CATEGORIES.slice(1).forEach(function (c) {
                if (wanted.indexOf(c.label.toLocaleLowerCase('de')) === -1) removeCategory(doc, c.id);
            });
            data.categories.forEach(function (label) { addCategory(doc, label); });
        }
        function mapped(names, value) {
            var out = {};
            Object.keys(names).forEach(function (name) { out[ids[name]] = value(names[name]); });
            return out;
        }
        data.expenses.forEach(function (e) {
            var id = newId();
            doc.expenses[id] = {
                id: id, t: nextT(doc), by: by, desc: e.desc, amount: e.amount, currency: e.currency, date: e.date,
                category: (categoryByName(doc, e.desc) || CATEGORIES[0]).id, note: '',
                payers: mapped(e.payers, function (v) { return v; }),
                split: e.equal
                    ? { type: 'equal', values: mapped(e.shares, function () { return 1; }) }
                    : { type: 'exact', values: mapped(e.shares, function (v) { return v; }) },
                repeat: 'none', del: false
            };
        });
        data.payments.forEach(function (p) {
            var id = newId();
            doc.payments[id] = {
                id: id, t: nextT(doc), by: by, from: ids[p.from], to: ids[p.to], amount: p.amount,
                currency: p.currency, date: p.date, note: p.note, del: false
            };
        });
    }

    /* ---------- CSV ---------- */

    function csvCell(value) {
        var s = String(value);
        // Tabellenprogramme führen Zellen, die mit diesen Zeichen beginnen, als
        // Formel aus; Texte stammen aber von anderen Personen. Zahlen bleiben roh.
        if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function csvAmount(minor, cur) {
        return { toString: function () { return amountToInput(minor, cur); } };
    }

    function toCsv(doc) {
        var memberIds = Object.keys(doc.members).sort(function (a, b) {
            return doc.members[a].name.localeCompare(doc.members[b].name, 'de');
        });
        function name(id) { return doc.members[id] ? doc.members[id].name : 'Unbekannt'; }
        var header = ['Datum', 'Art', 'Beschreibung', 'Kategorie', 'Betrag', 'Währung', 'Bezahlt von']
            .concat(memberIds.map(function (id) { return 'Anteil ' + name(id); }));
        var rows = [];

        liveExpenses(doc).forEach(function (e) {
            var owed = computeOwed(e) || {};
            var category = findCategory(doc, e.category);
            var sign = expenseSign(e);
            rows.push({
                date: e.date,
                cells: [e.date, e.refund ? 'Rückzahlung' : 'Ausgabe', e.desc, category.id === 'general' ? '' : category.label,
                    csvAmount(sign * e.amount, e.currency), e.currency,
                    Object.keys(e.payers).filter(function (id) { return e.payers[id] > 0; }).map(name).join(', ')
                ].concat(memberIds.map(function (id) {
                    return owed[id] ? csvAmount(sign * owed[id], e.currency) : '';
                }))
            });
        });
        livePayments(doc).forEach(function (p) {
            rows.push({
                date: p.date,
                cells: [p.date, 'Zahlung', name(p.from) + ' an ' + name(p.to), '', csvAmount(p.amount, p.currency), p.currency, name(p.from)]
                    .concat(memberIds.map(function () { return ''; }))
            });
        });

        rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        return '﻿' + [header].concat(rows.map(function (r) { return r.cells; }))
            .map(function (cells) { return cells.map(csvCell).join(';'); })
            .join('\r\n') + '\r\n';
    }

    return {
        groupCategories: groupCategories,
        findCategory: findCategory,
        categoryByName: categoryByName,
        tidyText: tidyText,
        splidCategorySuggestions: splidCategorySuggestions,
        addCategory: addCategory,
        removeCategory: removeCategory,
        CURRENCIES: CURRENCIES,
        SPLIT_TYPES: SPLIT_TYPES,
        REPEATS: REPEATS,
        RE_GROUP_ID: RE_GROUP_ID,
        RE_EXPENSE_ID: RE_EXPENSE_ID,
        newId: newId,
        newGroupId: newGroupId,
        todayStr: todayStr,
        currencyDecimals: currencyDecimals,
        formatMoney: formatMoney,
        amountToInput: amountToInput,
        parseAmount: parseAmount,
        parseQuantity: parseQuantity,
        distribute: distribute,
        computeOwed: computeOwed,
        expenseSign: expenseSign,
        claimantsOf: claimantsOf,
        itemShares: itemShares,
        setClaim: setClaim,
        payersValid: payersValid,
        liveExpenses: liveExpenses,
        livePayments: livePayments,
        computeBalances: computeBalances,
        simplifyDebts: simplifyDebts,
        pairwiseDebts: pairwiseDebts,
        settlements: settlements,
        isSettled: isSettled,
        statistics: statistics,
        currenciesUsed: currenciesUsed,
        occurrence: occurrence,
        expandRecurring: expandRecurring,
        liveSeries: liveSeries,
        occurrencesOf: occurrencesOf,
        nextOccurrence: nextOccurrence,
        dataFingerprint: dataFingerprint,
        emptyGroup: emptyGroup,
        lastT: lastT,
        nextT: nextT,
        mergeGroups: mergeGroups,
        sanitizeGroup: sanitizeGroup,
        snapshotForLink: snapshotForLink,
        groupSymbol: groupSymbol,
        readXls: readXls,
        parseSplid: parseSplid,
        importSplid: importSplid,
        toCsv: toCsv
    };
});
