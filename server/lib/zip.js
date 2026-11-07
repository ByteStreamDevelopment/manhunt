'use strict';
/**
 * Minimaler ZIP-Schreiber ohne Abhängigkeiten (Methode "stored" – JPEGs lassen sich ohnehin kaum packen).
 * Schreibt Datei für Datei direkt in einen Stream, damit auch viele Fotos wenig Speicher brauchen.
 */
const zlib = require('node:zlib');

function dosTime(ts) {
  const d = new Date(ts);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

class ZipWriter {
  constructor(out) { this.out = out; this.offset = 0; this.entries = []; }

  write(buf) {
    this.offset += buf.length;
    return this.out.write(buf) ? Promise.resolve() : new Promise((r) => this.out.once('drain', r));
  }

  /** Fügt eine Datei hinzu. name: Pfad im ZIP (UTF-8), data: Buffer, ts: Änderungszeit */
  async add(name, data, ts = Date.now()) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const { time, date } = dosTime(ts);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); // UTF-8-Namen
    h.writeUInt16LE(0, 8); h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    this.entries.push({ nameBuf, crc, size: data.length, time, date, offset: this.offset });
    await this.write(h); await this.write(nameBuf); await this.write(data);
  }

  async finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(0, 10); c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.size, 20); c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nameBuf.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32);
      c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(e.offset, 42);
      await this.write(c); await this.write(e.nameBuf);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12); end.writeUInt32LE(start, 16); end.writeUInt16LE(0, 20);
    await this.write(end);
    this.out.end();
  }
}

/** Dateinamen-tauglich machen (Umlaute bleiben, Sonderzeichen werden zu _) */
const safeName = (s) => String(s).replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\s+/g, '_').slice(0, 60) || 'foto';

module.exports = { ZipWriter, safeName };
