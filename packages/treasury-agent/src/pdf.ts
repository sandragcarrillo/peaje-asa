/**
 * A plain-text PDF, no dependencies: Courier, Letter size, wrapped lines, as many pages as needed.
 * Dispute evidence must be PDF or JPG (Airwallex rejects PNG). Latin-1 covers Spanish accents;
 * anything outside it prints as "?".
 */
const COLS = 95;
const LINES_PER_PAGE = 64;

function wrap(line: string): string[] {
  if (line.length <= COLS) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > COLS) {
    const cut = rest.lastIndexOf(" ", COLS) > COLS / 2 ? rest.lastIndexOf(" ", COLS) : COLS;
    out.push(rest.slice(0, cut));
    rest = "  " + rest.slice(cut).trimStart();
  }
  return [...out, rest];
}

const latin1 = (s: string) => s.replace(/[^\x20-\xff]/g, (c) => (c === "\t" ? "  " : c === "’" ? "'" : "?"));
const escape = (s: string) => latin1(s).replace(/[\\()]/g, (c) => `\\${c}`);

export function textPdf(lines: string[]): Uint8Array {
  const wrapped = lines.flatMap((l) => l.split("\n")).flatMap(wrap);
  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length; i += LINES_PER_PAGE) pages.push(wrapped.slice(i, i + LINES_PER_PAGE));
  if (!pages.length) pages.push([""]);

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>";
  const kids: string[] = [];
  pages.forEach((page, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const text = page.map((l) => `(${escape(l)}) Tj T*`).join("\n");
    const stream = `BT /F1 9 Tf 11 TL 40 752 Td\n${text}\nET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is one Latin-1 byte, so string offsets are byte offsets.
  return Buffer.from(out, "latin1");
}
