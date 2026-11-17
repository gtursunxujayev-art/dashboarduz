import { getPdfFont, type PdfFontKey, type TrueTypeFont } from './pdf-font';

export type PdfColor = [number, number, number];

type PdfFont = PdfFontKey;

const FONT_KEYS: PdfFont[] = ['F1', 'F2'];
const ELLIPSIS = '…';

function toHex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

function toUtf16Hex(text: string): string {
  let hex = '';

  for (let index = 0; index < text.length; index += 1) {
    hex += toHex4(text.charCodeAt(index));
  }

  return hex;
}

function buildToUnicodeCMap(font: TrueTypeFont, glyphIds: number[]): string {
  const entries = glyphIds
    .map((glyphId) => [glyphId, font.textForGlyph(glyphId)] as const)
    .filter((entry): entry is readonly [number, string] => typeof entry[1] === 'string');
  const lines = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
  ];

  for (let start = 0; start < entries.length; start += 100) {
    const chunk = entries.slice(start, start + 100);

    lines.push(`${chunk.length} beginbfchar`);
    for (const [glyphId, text] of chunk) {
      lines.push(`<${toHex4(glyphId)}> <${toUtf16Hex(text)}>`);
    }
    lines.push('endbfchar');
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');

  return lines.join('\n');
}

export class PdfCanvas {
  private readonly pageWidth = 595;
  private readonly pageHeight = 842;
  private readonly pages: string[][] = [[]];
  private currentPageIndex = 0;
  private readonly usedGlyphs: Record<PdfFont, Set<number>> = { F1: new Set(), F2: new Set() };

  get pageCount(): number {
    return this.pages.length;
  }

  private get commands(): string[] {
    const page = this.pages[this.currentPageIndex];

    if (!page) {
      throw new Error(`PDF page ${this.currentPageIndex} does not exist`);
    }

    return page;
  }

  addPage(): number {
    this.pages.push([]);
    this.currentPageIndex = this.pages.length - 1;

    return this.currentPageIndex;
  }

  private toPdfY(top: number, height = 0): number {
    return this.pageHeight - top - height;
  }

  private fmt(value: number): string {
    return Number(value.toFixed(3)).toString();
  }

  private glyphIds(text: string, font: PdfFont): number[] {
    const ttf = getPdfFont(font);

    return Array.from(text, (char) => ttf.glyphForCodePoint(char.codePointAt(0) ?? 0x3f));
  }

  /** Width of `text` in points at `size`. */
  measure(text: string, options: { size?: number; font?: PdfFont } = {}): number {
    const font = options.font || 'F1';
    const ttf = getPdfFont(font);
    const units = this.glyphIds(text, font).reduce((sum, glyphId) => sum + ttf.advanceWidth(glyphId), 0);

    return (units * (options.size || 10)) / 1000;
  }

  /** Shortens `text` with an ellipsis so it fits in `maxWidth` points. */
  fit(text: string, maxWidth: number, options: { size?: number; font?: PdfFont } = {}): string {
    if (this.measure(text, options) <= maxWidth) {
      return text;
    }
    const chars = Array.from(text);

    while (chars.length > 0 && this.measure(`${chars.join('').trimEnd()}${ELLIPSIS}`, options) > maxWidth) {
      chars.pop();
    }

    return `${chars.join('').trimEnd()}${ELLIPSIS}`;
  }

  /** Largest size from `size` down to `minSize` at which `text` fits in `maxWidth`. */
  fitSize(text: string, maxWidth: number, options: { size: number; minSize: number; font?: PdfFont }): number {
    let size = options.size;

    while (size > options.minSize && this.measure(text, { size, font: options.font }) > maxWidth) {
      size = Math.max(options.minSize, size - 0.5);
    }

    return size;
  }

  setFill(color: PdfColor) {
    this.commands.push(`${this.fmt(color[0])} ${this.fmt(color[1])} ${this.fmt(color[2])} rg`);
  }

  setStroke(color: PdfColor) {
    this.commands.push(`${this.fmt(color[0])} ${this.fmt(color[1])} ${this.fmt(color[2])} RG`);
  }

  setLineWidth(width: number) {
    this.commands.push(`${this.fmt(width)} w`);
  }

  rect(top: number, left: number, width: number, height: number, options: {
    fill?: PdfColor;
    stroke?: PdfColor;
    lineWidth?: number;
  } = {}) {
    if (options.fill) this.setFill(options.fill);
    if (options.stroke) this.setStroke(options.stroke);
    if (options.lineWidth !== undefined) this.setLineWidth(options.lineWidth);
    this.commands.push(
      `${this.fmt(left)} ${this.fmt(this.toPdfY(top, height))} ${this.fmt(width)} ${this.fmt(height)} re`,
    );
    if (options.fill && options.stroke) {
      this.commands.push('B');
    } else if (options.fill) {
      this.commands.push('f');
    } else {
      this.commands.push('S');
    }
  }

  text(top: number, left: number, text: string, options: {
    size?: number;
    color?: PdfColor;
    font?: PdfFont;
    /** When set, the text is shortened with an ellipsis to fit this many points. */
    maxWidth?: number;
  } = {}) {
    const font = options.font || 'F1';
    const size = options.size || 10;
    const color = options.color || ([0.11, 0.16, 0.24] as PdfColor);
    const value = options.maxWidth === undefined ? text : this.fit(text, options.maxWidth, { size, font });
    const glyphIds = this.glyphIds(value, font);
    const baselineY = this.toPdfY(top) - size;

    for (const glyphId of glyphIds) {
      this.usedGlyphs[font].add(glyphId);
    }

    this.commands.push('BT');
    this.commands.push(`/${font} ${this.fmt(size)} Tf`);
    this.commands.push(`${this.fmt(color[0])} ${this.fmt(color[1])} ${this.fmt(color[2])} rg`);
    this.commands.push(`${this.fmt(left)} ${this.fmt(baselineY)} Td`);
    this.commands.push(`<${glyphIds.map(toHex4).join('')}> Tj`);
    this.commands.push('ET');
  }

  build(): Buffer {
    const objects: Buffer[] = [];
    const addObject = (body: string | Buffer[]): number => {
      const id = objects.length + 1;
      const parts = typeof body === 'string' ? [Buffer.from(body, 'latin1')] : body;

      objects.push(Buffer.concat([Buffer.from(`${id} 0 obj\n`, 'latin1'), ...parts, Buffer.from('\nendobj\n', 'latin1')]));

      return id;
    };
    const addStream = (dict: string, data: Buffer): number => addObject([
      Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'),
      data,
      Buffer.from('\nendstream', 'latin1'),
    ]);

    // Fixed ids: 1 catalog, 2 page tree. Everything else is appended after them.
    objects.push(Buffer.alloc(0), Buffer.alloc(0));

    const fontRefs: string[] = [];

    for (const key of FONT_KEYS) {
      const ttf = getPdfFont(key);
      const glyphIds = Array.from(this.usedGlyphs[key]).sort((a, b) => a - b);
      const fontFileId = addStream(`/Filter /FlateDecode /Length1 ${ttf.data.length}`, ttf.compressed);
      const descriptorId = addObject(
        `<< /Type /FontDescriptor /FontName /${ttf.baseName} /Flags 32 /FontBBox [${ttf.bbox.join(' ')}] /ItalicAngle 0 `
        + `/Ascent ${ttf.ascent} /Descent ${ttf.descent} /CapHeight ${ttf.ascent} /StemV ${key === 'F2' ? 120 : 80} `
        + `/FontFile2 ${fontFileId} 0 R >>`,
      );
      const widths = glyphIds.map((glyphId) => `${glyphId} [${ttf.advanceWidth(glyphId)}]`).join(' ');
      const cidFontId = addObject(
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${ttf.baseName} `
        + '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> '
        + `/FontDescriptor ${descriptorId} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`,
      );
      const toUnicodeId = addStream('', Buffer.from(buildToUnicodeCMap(ttf, glyphIds), 'latin1'));
      const fontId = addObject(
        `<< /Type /Font /Subtype /Type0 /BaseFont /${ttf.baseName} /Encoding /Identity-H `
        + `/DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`,
      );

      fontRefs.push(`/${key} ${fontId} 0 R`);
    }

    const pageIds: number[] = [];

    for (const pageCommands of this.pages) {
      const contentId = addStream('', Buffer.from(pageCommands.join('\n'), 'latin1'));

      pageIds.push(addObject(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] `
        + `/Resources << /Font << ${fontRefs.join(' ')} >> >> /Contents ${contentId} 0 R >>`,
      ));
    }

    objects[0] = Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1');
    objects[1] = Buffer.from(
      `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>\nendobj\n`,
      'latin1',
    );

    const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
    const offsets: number[] = [];
    let position = header.length;

    for (const object of objects) {
      offsets.push(position);
      position += object.length;
    }

    let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

    for (const offset of offsets) {
      trailer += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF`;

    return Buffer.concat([header, ...objects, Buffer.from(trailer, 'latin1')]);
  }
}

/**
 * Decodes the text runs drawn on each page of a PDF built by PdfCanvas (tests and debugging).
 * Content streams are uncompressed and every run is `/F<n> <size> Tf ... <glyph ids> Tj`.
 */
export function extractPdfText(pdf: Buffer): string[] {
  const source = pdf.toString('latin1');
  const runs: string[] = [];
  const pattern = /\/(F1|F2) [\d.]+ Tf\n[^\n]* rg\n[^\n]* Td\n<([0-9A-F]*)> Tj/g;

  for (const match of source.matchAll(pattern)) {
    const ttf = getPdfFont(match[1] as PdfFont);
    const hex = match[2] || '';
    let text = '';

    for (let index = 0; index < hex.length; index += 4) {
      text += ttf.textForGlyph(Number.parseInt(hex.slice(index, index + 4), 16)) ?? '?';
    }
    runs.push(text);
  }

  return runs;
}
