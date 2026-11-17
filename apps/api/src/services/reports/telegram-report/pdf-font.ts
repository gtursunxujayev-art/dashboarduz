import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

/**
 * Minimal TrueType reader for the PDF report: maps Unicode code points to glyph IDs and advance widths,
 * so text can be drawn with an embedded font (Identity-H) instead of the Latin-only standard fonts.
 *
 * The fonts are DejaVu Sans subsets (Latin, Latin Extended, ʻ ʼ, Cyrillic, common punctuation) kept in
 * apps/api/assets/fonts. This file sits at the same depth under src/ and dist/, so one relative path works for both.
 */
const FONT_DIR = path.resolve(__dirname, '../../../../assets/fonts');

export type PdfFontKey = 'F1' | 'F2';

const FONT_FILES: Record<PdfFontKey, { file: string; baseName: string }> = {
  F1: { file: 'DejaVuSans.ttf', baseName: 'DejaVuSans' },
  F2: { file: 'DejaVuSans-Bold.ttf', baseName: 'DejaVuSans-Bold' },
};

export type TrueTypeFont = {
  baseName: string;
  data: Buffer;
  /** Flate-compressed font program, ready for a /FontFile2 stream. */
  compressed: Buffer;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  bbox: [number, number, number, number];
  glyphForCodePoint: (codePoint: number) => number;
  /** The text a glyph stands for (first code point mapped to it), for ToUnicode maps and tests. */
  textForGlyph: (glyphId: number) => string | undefined;
  /** Advance width in 1/1000 em (PDF glyph space). */
  advanceWidth: (glyphId: number) => number;
  missingGlyphId: number;
};

function readTables(data: Buffer): Map<string, { offset: number; length: number }> {
  const numTables = data.readUInt16BE(4);
  const tables = new Map<string, { offset: number; length: number }>();

  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;

    tables.set(data.toString('latin1', record, record + 4), {
      offset: data.readUInt32BE(record + 8),
      length: data.readUInt32BE(record + 12),
    });
  }

  return tables;
}

function parseCmap(data: Buffer, cmapOffset: number): Map<number, number> {
  const map = new Map<number, number>();
  const numSubtables = data.readUInt16BE(cmapOffset + 2);
  let format4Offset: number | null = null;
  let format12Offset: number | null = null;

  for (let index = 0; index < numSubtables; index += 1) {
    const record = cmapOffset + 4 + index * 8;
    const platformId = data.readUInt16BE(record);
    const encodingId = data.readUInt16BE(record + 2);
    const offset = cmapOffset + data.readUInt32BE(record + 4);
    const format = data.readUInt16BE(offset);
    const isUnicode = platformId === 0 || (platformId === 3 && (encodingId === 1 || encodingId === 10));

    if (!isUnicode) continue;
    if (format === 12) format12Offset = offset;
    if (format === 4) format4Offset = offset;
  }

  if (format12Offset !== null) {
    const groups = data.readUInt32BE(format12Offset + 12);

    for (let index = 0; index < groups; index += 1) {
      const group = format12Offset + 16 + index * 12;
      const start = data.readUInt32BE(group);
      const end = data.readUInt32BE(group + 4);
      const startGlyph = data.readUInt32BE(group + 8);

      for (let codePoint = start; codePoint <= end; codePoint += 1) {
        map.set(codePoint, startGlyph + (codePoint - start));
      }
    }

    return map;
  }

  if (format4Offset === null) {
    throw new Error('Report font has no Unicode cmap');
  }

  const segCount = data.readUInt16BE(format4Offset + 6) / 2;
  const endCodes = format4Offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;

  for (let segment = 0; segment < segCount; segment += 1) {
    const end = data.readUInt16BE(endCodes + segment * 2);
    const start = data.readUInt16BE(startCodes + segment * 2);
    const delta = data.readInt16BE(idDeltas + segment * 2);
    const rangeOffsetPosition = idRangeOffsets + segment * 2;
    const rangeOffset = data.readUInt16BE(rangeOffsetPosition);

    for (let codePoint = start; codePoint <= end && codePoint !== 0xffff; codePoint += 1) {
      let glyphId: number;

      if (rangeOffset === 0) {
        glyphId = (codePoint + delta) & 0xffff;
      } else {
        const glyphPosition = rangeOffsetPosition + rangeOffset + (codePoint - start) * 2;
        const raw = data.readUInt16BE(glyphPosition);

        glyphId = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyphId !== 0) {
        map.set(codePoint, glyphId);
      }
    }
  }

  return map;
}

export function parseTrueTypeFont(data: Buffer, baseName: string): TrueTypeFont {
  const tables = readTables(data);
  const table = (tag: string) => {
    const entry = tables.get(tag);

    if (!entry) {
      throw new Error(`Report font ${baseName} is missing the ${tag} table`);
    }

    return entry.offset;
  };

  const head = table('head');
  const hhea = table('hhea');
  const hmtx = table('hmtx');
  const unitsPerEm = data.readUInt16BE(head + 18);
  const scale = 1000 / unitsPerEm;
  const numberOfHMetrics = data.readUInt16BE(hhea + 34);
  const cmap = parseCmap(data, table('cmap'));
  const lastAdvance = data.readUInt16BE(hmtx + (numberOfHMetrics - 1) * 4);
  const missingGlyphId = cmap.get(0x3f) ?? 0; // '?'
  const textByGlyph = new Map<number, string>();

  for (const [codePoint, glyphId] of cmap.entries()) {
    if (!textByGlyph.has(glyphId)) {
      textByGlyph.set(glyphId, String.fromCodePoint(codePoint));
    }
  }

  return {
    baseName,
    data,
    compressed: deflateSync(data),
    unitsPerEm,
    ascent: Math.round(data.readInt16BE(hhea + 4) * scale),
    descent: Math.round(data.readInt16BE(hhea + 6) * scale),
    bbox: [
      Math.round(data.readInt16BE(head + 36) * scale),
      Math.round(data.readInt16BE(head + 38) * scale),
      Math.round(data.readInt16BE(head + 40) * scale),
      Math.round(data.readInt16BE(head + 42) * scale),
    ],
    glyphForCodePoint: (codePoint) => cmap.get(codePoint) ?? missingGlyphId,
    textForGlyph: (glyphId) => textByGlyph.get(glyphId),
    advanceWidth: (glyphId) => {
      const advance = glyphId < numberOfHMetrics ? data.readUInt16BE(hmtx + glyphId * 4) : lastAdvance;

      return Math.round(advance * scale);
    },
    missingGlyphId,
  };
}

const loadedFonts = new Map<PdfFontKey, TrueTypeFont>();

export function getPdfFont(key: PdfFontKey): TrueTypeFont {
  const cached = loadedFonts.get(key);

  if (cached) {
    return cached;
  }
  const { file, baseName } = FONT_FILES[key];
  const font = parseTrueTypeFont(readFileSync(path.join(FONT_DIR, file)), baseName);

  loadedFonts.set(key, font);

  return font;
}
