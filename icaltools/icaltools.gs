/**
 * iCal Tools – Google-Kalender-Variante.
 * Liest die Google-Kalender der ausführenden Person, anonymisiert wählbare
 * Felder und liefert die Termine im gewählten Zeitraum als .ics- oder CSV-Text.
 * Wiederkehrende Termine werden von der Calendar-API bereits als einzelne
 * Vorkommen im angefragten Zeitraum zurückgegeben, eine eigene RRULE-Auflösung
 * ist daher (anders als in der Browser-Variante) nicht nötig.
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

  var events = [];
  input.calendarIds.forEach(function (calId) {
    var cal = CalendarApp.getCalendarById(calId);
    if (!cal) return;
    cal.getEvents(rangeStart, rangeEndExclusive).forEach(function (ev) {
      events.push(buildOutputEvent(ev, input));
    });
  });

  events.sort(function (a, b) { return a.start.getTime() - b.start.getTime(); });

  return {
    count: events.length,
    ics: buildIcs(events),
    csv: buildCsv(events),
  };
}

// ── ANONYMISIERUNG ──────────────────────────────────────────────────────

function buildOutputEvent(ev, input) {
  var fields = input.fields || {};
  var allDay = ev.isAllDayEvent();
  var start = allDay ? ev.getAllDayStartDate() : ev.getStartTime();
  var end = allDay ? ev.getAllDayEndDate() : ev.getEndTime();

  var creators = ev.getCreators();
  var organizer = creators.length ? { cn: creators[0], email: creators[0] } : null;

  var attendees = ev.getGuestList().map(function (g) {
    return { cn: g.getName() || g.getEmail(), email: g.getEmail() };
  });

  return {
    uid: input.uidRegenerate ? Utilities.getUuid() : ev.getId(),
    start: start,
    end: end,
    allDay: allDay,
    summary: applyTextMode(ev.getTitle(), fields.summary),
    description: applyTextMode(ev.getDescription(), fields.description),
    location: applyTextMode(ev.getLocation(), fields.location),
    organizer: applyOrganizerMode(organizer, fields.organizer),
    attendees: applyListMode(attendees, fields.attendees, function (text) {
      return { cn: text, email: 'anonym@example.invalid' };
    }),
  };
}

function applyTextMode(value, fieldSetting) {
  fieldSetting = fieldSetting || {};
  if (!value) return null;
  if (fieldSetting.mode === 'remove') return null;
  if (fieldSetting.mode === 'placeholder') return fieldSetting.placeholder || null;
  return value;
}

function applyOrganizerMode(organizer, fieldSetting) {
  fieldSetting = fieldSetting || {};
  if (!organizer) return null;
  if (fieldSetting.mode === 'remove') return null;
  if (fieldSetting.mode === 'placeholder') {
    return { cn: fieldSetting.placeholder || 'Organisator:in', email: 'anonym@example.invalid' };
  }
  return organizer;
}

function applyListMode(list, fieldSetting, makePlaceholderItem) {
  fieldSetting = fieldSetting || {};
  if (!list.length) return [];
  if (fieldSetting.mode === 'remove') return [];
  if (fieldSetting.mode === 'placeholder') return [makePlaceholderItem(fieldSetting.placeholder || 'ausgeblendet')];
  return list;
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

function escapeIcsText(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
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
    if (ev.summary) lines.push(foldLine('SUMMARY:' + escapeIcsText(ev.summary)));
    if (ev.description) lines.push(foldLine('DESCRIPTION:' + escapeIcsText(ev.description)));
    if (ev.location) lines.push(foldLine('LOCATION:' + escapeIcsText(ev.location)));
    if (ev.organizer) {
      lines.push(foldLine('ORGANIZER;CN="' + ev.organizer.cn.replace(/"/g, '') + '":mailto:' + (ev.organizer.email || 'anonym@example.invalid')));
    }
    ev.attendees.forEach(function (a) {
      lines.push(foldLine('ATTENDEE;CN="' + a.cn.replace(/"/g, '') + '":mailto:' + (a.email || 'anonym@example.invalid')));
    });
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ── CSV-AUSGABE ──────────────────────────────────────────────────────────

var CSV_COLUMNS = ['start', 'end', 'all_day', 'summary', 'location', 'description', 'organizer', 'attendees'];

function isoLocal(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function formatCalAddress(a) {
  return a.email ? a.cn + ' <' + a.email + '>' : a.cn;
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
    summary: ev.summary || '',
    location: ev.location || '',
    description: ev.description || '',
    organizer: ev.organizer ? formatCalAddress(ev.organizer) : '',
    attendees: ev.attendees.map(formatCalAddress).join('; '),
  };
}

/** Spalten, die in keiner Zeile einen Wert haben, fallen ganz weg */
function buildCsv(events) {
  if (!events.length) return CSV_COLUMNS.join(',');
  var rowObjects = events.map(buildCsvRowObject);
  var usedColumns = CSV_COLUMNS.filter(function (col) {
    return rowObjects.some(function (row) { return row[col] !== ''; });
  });
  var rows = [usedColumns].concat(rowObjects.map(function (row) {
    return usedColumns.map(function (col) { return row[col]; });
  }));
  return rows.map(function (row) { return row.map(csvEscape).join(','); }).join('\r\n');
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
