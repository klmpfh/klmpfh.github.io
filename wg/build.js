// Erzeugt den codierten Inhalt für wg/index.html aus den lokalen *.private-Dateien.
// Aufruf: node wg/build.js
//
// Eingaben (alle per .gitignore ausgeblendet):
//   pass.private.txt      Schlüssel für den Link (?k=<Schlüssel>)
//   deutsch.private.md    Text Deutsch
//   english.private.md    Text Englisch
//   Bilder                beliebige Dateien, die im Text per ![…](datei.private.jpg) eingebunden sind
//
// Markdown-Format (bewusst klein gehalten):
//   # Titel                       Hauptüberschrift
//   a | b | c                     Eckdaten als Kacheln (auch mit "> " davor)
//   ## Abschnitt                  Zwischenüberschrift
//   - Punkt                       Aufzählung
//   ![Alt-Text](bild.jpg)         Bild (eigene Zeile); ![Alt](bild.jpg "Bildunterschrift") mit Unterschrift
//   Absätze                       durch Leerzeile getrennt; ein einfacher Zeilenumbruch bleibt ein Zeilenumbruch
//   letzter Block nach einer Leerzeile (ohne Überschrift) -> Grußformel
//   Im Fließtext: **fett**, *kursiv*, [Linktext](https://…), <adresse@mail.de>, <https://…>.
//   Automatisch verlinkt werden außerdem E-Mail-Adressen, URLs (https://…, www.…, t.me/…, wa.me/…)
//   und Telefonnummern im Format +49…
//
// Die Codierung ist bewusst simpel (XOR + Base64) und kein Sicherheitsfeature:
// Sie verhindert nur, dass Text und Bilder ohne ?k=<Schlüssel> direkt lesbar sind.

"use strict";
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const read = (name) => fs.readFileSync(path.join(dir, name), "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");

const MAGIC = "WG1";
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".avif": "image/avif" };
const IMAGE_WARN_BYTES = 400 * 1024;

const images = new Map(); // Dateipfad -> { id, mime, bytes }

function addImage(file) {
    const abs = path.resolve(dir, file);
    if (!images.has(abs)) {
        if (!fs.existsSync(abs)) throw new Error(`Bild nicht gefunden: ${file}`);
        const mime = MIME[path.extname(abs).toLowerCase()];
        if (!mime) throw new Error(`Unbekanntes Bildformat: ${file}`);
        const bytes = fs.readFileSync(abs);
        if (bytes.length > IMAGE_WARN_BYTES) {
            console.warn(`Hinweis: ${file} ist ${Math.round(bytes.length / 1024)} KB groß – für Handys besser verkleinern (z. B. 1200 px Breite, JPEG ~80 %).`);
        }
        images.set(abs, { id: "i" + images.size, mime, bytes });
    }
    return images.get(abs);
}

const EMAIL = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;

function link(text) {
    if (EMAIL.test(text)) return { a: text, h: "mailto:" + text };
    if (/^(https?:|mailto:|tel:)/i.test(text)) return { a: text.replace(/^mailto:/i, ""), h: text };
    return { a: text, h: "https://" + text };
}

// Inline-Markdown -> Liste aus Strings und {b}, {i}, {a, h}; ein reiner String, wenn nichts formatiert ist.
function inline(text) {
    const re = /<([^<>\s]+)>|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|((?:https?:\/\/|www\.|t\.me\/|wa\.me\/)[^\s)]*[^\s).,!?;:])|(\+\d[\d /-]{5,}\d)/g;
    const out = [];
    let last = 0, m;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        if (m[1] != null) out.push(link(m[1]));
        else if (m[2] != null) out.push({ b: m[2] });
        else if (m[3] != null) out.push({ i: m[3] });
        else if (m[4] != null) out.push({ a: m[4], h: m[5] });
        else if (m[6] != null) out.push(link(m[6]));
        else if (m[7] != null) out.push(link(m[7]));
        else out.push({ a: m[8], h: "tel:" + m[8].replace(/[ /-]/g, "") });
        last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out.length === 1 && typeof out[0] === "string" ? out[0] : out;
}

// Mehrere Zeilen eines Absatzes -> ein Inline-Inhalt mit {br} dazwischen.
function joinLines(lines) {
    if (lines.length === 1) return inline(lines[0]);
    const out = [];
    lines.forEach((line, i) => {
        if (i) out.push({ br: 1 });
        const x = inline(line);
        if (typeof x === "string") out.push(x); else out.push(...x);
    });
    return out;
}

function parseChunk(lines, blocks) {
    let para = [];
    const flush = () => { if (para.length) blocks.push({ t: "p", x: joinLines(para) }); para = []; };
    for (const raw of lines) {
        const line = raw.trim().replace(/^>\s?/, "");
        if (!line) continue;
        let m;
        if (line.startsWith("## ")) { flush(); blocks.push({ t: "h2", x: line.slice(3).trim() }); }
        else if (line.startsWith("# ")) { flush(); blocks.push({ t: "h1", x: line.slice(2).trim() }); }
        else if ((m = line.match(/^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)$/))) {
            flush();
            const img = addImage(m[2]);
            blocks.push({ t: "img", id: img.id, mime: img.mime, alt: m[1].trim(), cap: (m[3] || "").trim() });
        } else if ((m = line.match(/^[-*] +(.*)$/))) {
            flush();
            const prev = blocks[blocks.length - 1];
            if (prev && prev.t === "ul") prev.x.push(inline(m[1]));
            else blocks.push({ t: "ul", x: [inline(m[1])] });
        } else if (line.includes(" | ")) { flush(); blocks.push({ t: "facts", x: line.split("|").map((s) => s.trim()).filter(Boolean) }); }
        else para.push(line);
    }
    flush();
}

function parse(text) {
    const chunks = text.trim().split(/\n\s*\n/);
    const last = chunks[chunks.length - 1];
    const hasSig = chunks.length > 1 && !/^(#|!\[|[-*] |>)/m.test(last) && !last.includes(" | ");
    const body = hasSig ? chunks.slice(0, -1) : chunks;

    const blocks = [];
    for (const chunk of body) parseChunk(chunk.split("\n"), blocks);
    if (hasSig) blocks.push({ t: "sig", x: last.split("\n").map((s) => s.trim()).filter(Boolean) });
    return blocks;
}

// Muss exakt zu keystream() in index.html passen.
function keystream(key, length) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    let s = h >>> 0 || 1;
    const out = new Uint8Array(length);
    for (let j = 0; j < length; j++) {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        out[j] = (s ^ key.charCodeAt(j % key.length)) & 255;
    }
    return out;
}

function xorBase64(buffer, key) {
    const bytes = Buffer.from(buffer);
    const ks = keystream(key, bytes.length);
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= ks[i];
    return bytes.toString("base64");
}

const key = read("pass.private.txt").trim();
if (!key) throw new Error("pass.private.txt ist leer");

const content = {
    de: parse(read("deutsch.private.md")),
    en: parse(read("english.private.md")),
};

const data = xorBase64(Buffer.from(MAGIC + JSON.stringify(content), "utf8"), key);
const imageData = {};
for (const img of images.values()) imageData[img.id] = xorBase64(img.bytes, key + "#" + img.id);

const htmlPath = path.join(dir, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const re = /(\/\/ <data>)[\s\S]*?(\r?\n[ \t]*\/\/ <\/data>)/;
if (!re.test(html)) throw new Error("Datenmarker in index.html nicht gefunden");
const nl = html.includes("\r\n") ? "\r\n" : "\n";
const generated = `${nl}    var DATA = "${data}";${nl}    var IMAGES = ${JSON.stringify(imageData)};`;
fs.writeFileSync(htmlPath, html.replace(re, (_, start, end) => start + generated + end));

const kb = Math.round(Buffer.byteLength(fs.readFileSync(htmlPath)) / 1024);
console.log(`index.html aktualisiert: ${content.de.length} DE-/${content.en.length} EN-Blöcke, ${images.size} Bild(er), ${kb} KB.`);
console.log(`Link: https://klmpfh.github.io/wg/?k=${encodeURIComponent(key)}`);
