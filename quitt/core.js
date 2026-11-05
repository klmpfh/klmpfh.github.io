/**
 * Quitt – Rechen- und Datenlogik (ohne DOM, damit sie auch in Node testbar ist).
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
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.QuittCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var CATEGORIES = [
        { id: 'general',   emoji: '🧾', label: 'Allgemein' },
        { id: 'food',      emoji: '🍕', label: 'Essen & Trinken' },
        { id: 'groceries', emoji: '🛒', label: 'Einkauf' },
        { id: 'bar',       emoji: '🍻', label: 'Bar & Ausgehen' },
        { id: 'travel',    emoji: '✈️', label: 'Reise' },
        { id: 'transport', emoji: '🚗', label: 'Transport' },
        { id: 'lodging',   emoji: '🛏️', label: 'Unterkunft' },
        { id: 'home',      emoji: '🏠', label: 'Wohnen' },
        { id: 'utilities', emoji: '💡', label: 'Nebenkosten' },
        { id: 'fun',       emoji: '🎟️', label: 'Freizeit' },
        { id: 'gift',      emoji: '🎁', label: 'Geschenk' },
        { id: 'health',    emoji: '💊', label: 'Gesundheit' },
        { id: 'other',     emoji: '📦', label: 'Sonstiges' }
    ];

    var CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF',
        'TRY', 'JPY', 'CAD', 'AUD', 'THB'];

    var SPLIT_TYPES = ['equal', 'exact', 'percent', 'shares', 'adjust'];
    var REPEATS = ['none', 'weekly', 'biweekly', 'monthly', 'yearly'];

    var MAX_AMOUNT = 1e12;

    var RE_GROUP_ID = /^[0-9a-f]{32}$/;
    var RE_ID = /^[0-9a-f]{16}$/;
    var RE_EXPENSE_ID = /^[0-9a-f]{16}(~\d{4}-\d{2}-\d{2})?$/;
    var RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

            default:
                return null;
        }
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
            .filter(function (e) { return !e.del; });
    }
    function livePayments(doc) {
        return Object.keys(doc.payments).map(function (k) { return doc.payments[k]; })
            .filter(function (p) { return !p.del; });
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
            Object.keys(e.payers).forEach(function (id) { add(e.currency, id, e.payers[id]); });
            Object.keys(owed).forEach(function (id) { add(e.currency, id, -owed[id]); });
        });
        livePayments(doc).forEach(function (p) {
            add(p.currency, p.from, p.amount);
            add(p.currency, p.to, -p.amount);
        });
        return out;
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
            Object.keys(e.payers).forEach(function (id) { net[id] = (net[id] || 0) + e.payers[id]; });
            Object.keys(owed).forEach(function (id) { net[id] = (net[id] || 0) - owed[id]; });
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
        function member(id) {
            if (!members[id]) members[id] = { id: id, paid: 0, share: 0 };
            return members[id];
        }
        liveExpenses(doc).forEach(function (e) {
            if (e.currency !== cur) return;
            var owed = computeOwed(e);
            if (!owed) return;
            total += e.amount;
            count++;
            categories[e.category] = (categories[e.category] || 0) + e.amount;
            Object.keys(e.payers).forEach(function (id) { member(id).paid += e.payers[id]; });
            Object.keys(owed).forEach(function (id) { member(id).share += owed[id]; });
        });
        return {
            total: total,
            count: count,
            byCategory: Object.keys(categories)
                .map(function (id) { return { id: id, amount: categories[id] }; })
                .sort(byAmountDesc),
            byMember: Object.keys(members)
                .map(function (id) { return members[id]; })
                .sort(function (a, b) { return b.share - a.share || (a.id < b.id ? -1 : 1); })
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

    /**
     * Legt alle bis heute fälligen Wiederholungen an. Die ID ergibt sich aus
     * Vorlage + Datum und der Zeitstempel aus der Vorlage: So erzeugen zwei Geräte
     * denselben Datensatz, statt doppelt zu buchen, und eine gelöschte Wiederholung
     * (neuerer Zeitstempel) wird beim Abgleich nicht wieder lebendig.
     *
     * Gebucht wird nur nach der letzten vorhandenen Wiederholung: Ändert jemand
     * Datum oder Rhythmus der Vorlage, ergäben sich sonst neue IDs für schon
     * gebuchte Zeiträume und damit doppelte Buchungen.
     */
    function expandRecurring(doc, today) {
        var created = 0;
        var latest = {};
        Object.keys(doc.expenses).forEach(function (key) {
            var e = doc.expenses[key];
            if (e.parent && (!latest[e.parent] || e.date > latest[e.parent])) latest[e.parent] = e.date;
        });
        Object.keys(doc.expenses).forEach(function (key) {
            var parent = doc.expenses[key];
            if (parent.del || parent.parent || !parent.repeat || parent.repeat === 'none') return;
            for (var n = 1; n <= 520; n++) {
                var date = occurrence(parent.date, parent.repeat, n);
                if (date > today) break;
                var id = parent.id + '~' + date;
                if (doc.expenses[id] || (latest[parent.id] && date <= latest[parent.id])) continue;
                var copy = JSON.parse(JSON.stringify(parent));
                copy.id = id;
                copy.date = date;
                copy.repeat = 'none';
                copy.parent = parent.id;
                doc.expenses[id] = copy;
                created++;
            }
        });
        return created;
    }

    /* ---------- Gruppen-Dokument ---------- */

    var COLLECTIONS = ['members', 'expenses', 'payments', 'comments', 'activity'];

    function emptyGroup(id) {
        return {
            id: id,
            meta: { t: 0, name: '', emoji: '💸', currency: 'EUR', simplify: true },
            members: {}, expenses: {}, payments: {}, comments: {}, activity: {}
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
        return JSON.stringify(incoming) > JSON.stringify(current);
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
                if (!cur || isNewer(incoming[coll][id], cur)) {
                    target[coll][id] = incoming[coll][id];
                    changed = true;
                }
            });
        });
        return changed;
    }

    function clip(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
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
        var name = clip(m.name, 40).trim();
        if (!name) return null;
        return { id: m.id, t: m.t, name: name, left: !!m.left };
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
            desc: clip(e.desc, 120).trim() || 'Ausgabe',
            amount: e.amount,
            currency: e.currency,
            date: e.date,
            category: CATEGORIES.some(function (c) { return c.id === e.category; }) ? e.category : 'general',
            note: clip(e.note, 1000),
            payers: payers,
            split: { type: e.split.type, values: values },
            repeat: REPEATS.indexOf(e.repeat) !== -1 ? e.repeat : 'none',
            del: !!e.del
        };
        if (typeof e.parent === 'string' && RE_ID.test(e.parent)) out.parent = e.parent;
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
                name: clip(m.name, 60).trim(),
                emoji: clip(m.emoji, 12) || '💸',
                currency: isCurrency(m.currency) ? m.currency : 'EUR',
                simplify: m.simplify !== false
            },
            members: cleanMap(raw.members, cleanMember),
            expenses: cleanMap(raw.expenses, cleanExpense),
            payments: cleanMap(raw.payments, cleanPayment),
            comments: cleanMap(raw.comments, cleanComment),
            activity: cleanMap(raw.activity, cleanActivity)
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
            var category = CATEGORIES.filter(function (c) { return c.id === e.category; })[0];
            rows.push({
                date: e.date,
                cells: [e.date, 'Ausgabe', e.desc, category ? category.label : '', csvAmount(e.amount, e.currency), e.currency,
                    Object.keys(e.payers).filter(function (id) { return e.payers[id] > 0; }).map(name).join(', ')
                ].concat(memberIds.map(function (id) {
                    return owed[id] ? csvAmount(owed[id], e.currency) : '';
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
        CATEGORIES: CATEGORIES,
        CURRENCIES: CURRENCIES,
        SPLIT_TYPES: SPLIT_TYPES,
        REPEATS: REPEATS,
        RE_GROUP_ID: RE_GROUP_ID,
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
        emptyGroup: emptyGroup,
        lastT: lastT,
        nextT: nextT,
        mergeGroups: mergeGroups,
        sanitizeGroup: sanitizeGroup,
        snapshotForLink: snapshotForLink,
        toCsv: toCsv
    };
});
