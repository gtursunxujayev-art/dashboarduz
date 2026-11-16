function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

export type PdfColor = [number, number, number];

type PdfFont = 'F1' | 'F2';

export class PdfCanvas {
  private readonly pageWidth = 595;
  private readonly pageHeight = 842;
  private readonly pages: string[][] = [[]];
  private currentPageIndex = 0;

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
  } = {}) {
    const font = options.font || 'F1';
    const size = options.size || 10;
    const color = options.color || ([0.11, 0.16, 0.24] as PdfColor);
    const escaped = escapePdfText(text);
    const baselineY = this.toPdfY(top) - size;

    this.commands.push('BT');
    this.commands.push(`${font === 'F2' ? '/F2' : '/F1'} ${this.fmt(size)} Tf`);
    this.commands.push(`${this.fmt(color[0])} ${this.fmt(color[1])} ${this.fmt(color[2])} rg`);
    this.commands.push(`${this.fmt(left)} ${this.fmt(baselineY)} Td`);
    this.commands.push(`(${escaped}) Tj`);
    this.commands.push('ET');
  }

  build(): Buffer {
    const pageObjectIds = this.pages.map((_, index) => 5 + index * 2);
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${this.pages.length} >>\nendobj\n`,
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    ];

    for (const [index, pageCommands] of this.pages.entries()) {
      const pageObjectId = pageObjectIds[index] as number;
      const contentObjectId = pageObjectId + 1;
      const contentStream = pageCommands.join('\n');

      objects.push(
        `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>\nendobj\n`,
        `${contentObjectId} 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
      );
    }

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];

    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += object;
    }

    const xrefOffset = Buffer.byteLength(pdf, 'utf8');

    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let index = 1; index < offsets.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, 'utf8');
  }
}
