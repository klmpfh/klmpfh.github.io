/**
 * iCal Tools – Google-Kalender-Variante.
 * Liest die Google-Kalender der ausführenden Person und liefert die Termine
 * im gewählten Zeitraum als .ics- oder CSV-Text – ausschließlich Start- und
 * Endzeit, alle sonstigen Felder (Titel, Ort, Teilnehmer:innen usw.) werden
 * nie ausgelesen. Wiederkehrende Termine werden von der Calendar-API bereits
 * als einzelne Vorkommen im angefragten Zeitraum zurückgegeben, eine eigene
 * RRULE-Auflösung ist daher (anders als in der Browser-Variante) nicht nötig.
 * Sich überlappende oder direkt aneinanderstoßende Termine (auch über mehrere
 * ausgewählte Kalender hinweg) werden zu einem gemeinsamen Zeitblock zusammengefasst.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('icaltools_ui')
    .setTitle('iCal Tools – Google Kalender');
}

function listCalendars() {
  return CalendarApp.getAllCalendars().map(function (cal) {
    return { id: cal.getId(), name: cal.getName() };
  });
}

function processCalendars(input) {
  if (!input || !input.calendarIds || !input.calendarIds.length) {
    throw new Error('Bitte mindestens einen Kalender auswählen.');
  }
  if (!input.fromStr || !input.toStr) {
    throw new Error('Bitte Start- und Enddatum angeben.');
  }

  var rangeStart = parseDateInput(input.fromStr);
  var rangeEndExclusive = addDays(parseDateInput(input.toStr), 1);
  if (rangeStart.getTime() > rangeEndExclusive.getTime()) {
    throw new Error('Das Startdatum muss vor dem Enddatum liegen (oder mit ihm übereinstimmen).');
  }

  var blocks = [];
  input.calendarIds.forEach(function (calId) {
    var cal = CalendarApp.getCalendarById(calId);
    if (!cal) return;
    cal.getEvents(rangeStart, rangeEndExclusive).forEach(function (ev) {
      blocks.push(readEventInterval(ev));
    });
  });

  blocks.sort(function (a, b) { return a.start.getTime() - b.start.getTime(); });
  var events = mergeOverlappingEvents(blocks).map(buildOutputEvent);

  return {
    count: events.length,
    ics: buildIcs(events),
    csv: buildCsv(events),
  };
}

// ── AUSGABE-EVENT ─────────────────────────────────────────────────────────

/** Liest nur Start/Ende/Ganztägig eines Kalender-Events aus – alle sonstigen Felder werden nie berücksichtigt. */
function readEventInterval(ev) {
  var allDay = ev.isAllDayEvent();
  return {
    start: allDay ? ev.getAllDayStartDate() : ev.getStartTime(),
    end: allDay ? ev.getAllDayEndDate() : ev.getEndTime(),
    allDay: allDay,
  };
}

/**
 * Fasst sich überlappende oder direkt aneinanderstoßende Zeitblöcke zu einem einzigen Block zusammen
 * (Datenschutz: verhindert, dass sich aus der Anzahl oder den Grenzen einzelner Termine etwas über den
 * ursprünglichen Kalenderinhalt ablesen lässt). Erwartet nach Start aufsteigend sortierte Blöcke.
 * Ein zusammengefasster Block ist nur dann noch "ganztägig", wenn alle enthaltenen Termine es waren.
 */
function mergeOverlappingEvents(blocks) {
  if (!blocks.length) return [];
  var merged = [];
  var current = { start: blocks[0].start, end: blocks[0].end, allDay: blocks[0].allDay };
  for (var i = 1; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.start.getTime() <= current.end.getTime()) {
      if (b.end.getTime() > current.end.getTime()) current.end = b.end;
      if (!b.allDay) current.allDay = false;
    } else {
      merged.push(current);
      current = { start: b.start, end: b.end, allDay: b.allDay };
    }
  }
  merged.push(current);
  return merged;
}

/** Baut aus einem zusammengefassten Zeitblock das Ausgabe-Event: nur UID/Start/Ende/Ganztägig. Die UID wird immer neu zufällig vergeben. */
function buildOutputEvent(block) {
  return {
    uid: Utilities.getUuid(),
    start: block.start,
    end: block.end,
    allDay: block.allDay,
  };
}

// ── ICS-AUSGABE ──────────────────────────────────────────────────────────

function pad2(n) { return ('' + n).length < 2 ? '0' + n : '' + n; }

function buildIcsDateTimeLocal(d) {
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + 'T' +
    pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}
function buildIcsDateOnly(d) {
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
}
function buildIcsDateTimeUtc(d) {
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' +
    pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

/** Faltet eine ICS-Zeile gemäß RFC 5545 auf max. 75 Zeichen pro Zeile */
function foldLine(line) {
  var max = 75;
  if (line.length <= max) return line;
  var out = line.slice(0, max);
  var rest = line.slice(max);
  while (rest.length > 0) {
    out += '\r\n ' + rest.slice(0, max - 1);
    rest = rest.slice(max - 1);
  }
  return out;
}

function buildIcs(events) {
  var nowStamp = buildIcsDateTimeUtc(new Date());
  var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//klmpfh.github.io//icaltools-gcal//DE', 'CALSCALE:GREGORIAN'];
  events.forEach(function (ev) {
    lines.push('BEGIN:VEVENT');
    lines.push(foldLine('UID:' + ev.uid));
    lines.push('DTSTAMP:' + nowStamp);
    if (ev.allDay) {
      lines.push('DTSTART;VALUE=DATE:' + buildIcsDateOnly(ev.start));
      lines.push('DTEND;VALUE=DATE:' + buildIcsDateOnly(ev.end));
    } else {
      lines.push('DTSTART:' + buildIcsDateTimeLocal(ev.start));
      lines.push('DTEND:' + buildIcsDateTimeLocal(ev.end));
    }
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ── CSV-AUSGABE ──────────────────────────────────────────────────────────

var CSV_COLUMNS = ['start', 'end', 'all_day'];

function isoLocal(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function csvEscape(value) {
  var v = value == null ? '' : String(value);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function buildCsvRowObject(ev) {
  return {
    start: isoLocal(ev.start),
    end: isoLocal(ev.end),
    all_day: ev.allDay ? 'true' : 'false',
  };
}

function buildCsv(events) {
  var header = CSV_COLUMNS.join(',');
  if (!events.length) return header;
  var rows = events.map(function (ev) {
    var row = buildCsvRowObject(ev);
    return CSV_COLUMNS.map(function (col) { return csvEscape(row[col]); }).join(',');
  });
  return [header].concat(rows).join('\r\n');
}

// ── DATUM-HILFSFUNKTIONEN ─────────────────────────────────────────────────

/** "YYYY-MM-DD" → lokales Date um Mitternacht (in der Zeitzone des Skripts) */
function parseDateInput(str) {
  var parts = str.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays(d, n) {
  var r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
