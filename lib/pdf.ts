import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { gradePct, LEGACY_ATTAINABLE } from "./score";
import type { Lead } from "./types";

// A call sheet, not a data dump.
//
// The CSV exists for putting leads into a CRM. This exists for the person who is
// about to pick up the phone: one block per business, the number large enough to read
// at arm's length, and the reason to call written underneath it.
//
// Built with pdf-lib rather than a headless browser because it is pure JavaScript
// with the standard fonts embedded, so it runs inside a serverless function without
// shipping a browser binary or any font files.

const A4 = { w: 595.28, h: 841.89 };
const M = 44;                       // page margin
const LINE = 13.5;

// Brand palette, matching app/globals.css so an exported sheet looks like the product.
const INK = rgb(0.137, 0.031, 0);
const MUTED = rgb(0.486, 0.424, 0.38);
const ACCENT = rgb(0.976, 0.388, 0.196);
const RULE = rgb(0.937, 0.891, 0.839);
const HOT = rgb(0.961, 0.325, 0.239);
const WARM = rgb(0.878, 0.541, 0.118);
const COOL = rgb(0.122, 0.62, 0.478);

const tierColor = (t: Lead["tier"]) => (t === "HOT" ? HOT : t === "WARM" ? WARM : COOL);

/** Strip anything the standard PDF fonts cannot draw, so one odd glyph cannot throw. */
const safe = (s: string) =>
  (s ?? "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7E]/g, "");

/** Greedy wrap to a pixel width, because PDF has no concept of a text box. */
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildLeadsPdf(
  leads: Lead[],
  meta: { brand: string; generatedAt: Date }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${meta.brand} lead sheet`);
  doc.setProducer(meta.brand);
  doc.setCreationDate(meta.generatedAt);

  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  let pageNo = 1;

  const text = (s: string, x: number, size: number, font: PDFFont, color = INK) =>
    page.drawText(safe(s), { x, y, size, font, color });

  const footer = (p: PDFPage, n: number) => {
    p.drawText(`${safe(meta.brand)}  ${meta.generatedAt.toISOString().slice(0, 10)}    page ${n}`, {
      x: M, y: 26, size: 8, font: reg, color: MUTED,
    });
  };

  /** Start a new page when the next block would not fit. */
  const need = (space: number) => {
    if (y - space > M + 30) return;
    footer(page, pageNo);
    page = doc.addPage([A4.w, A4.h]);
    pageNo++;
    y = A4.h - M;
  };

  // --- cover heading -------------------------------------------------------
  text(`${meta.brand} lead sheet`, M, 22, bold);
  y -= 20;
  text(
    `${leads.length} business${leads.length === 1 ? "" : "es"}, generated ${meta.generatedAt.toDateString()}`,
    M, 10, reg, MUTED
  );
  y -= 10;
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 1, color: RULE });
  y -= 22;

  const innerW = A4.w - M * 2;

  for (const lead of leads) {
    const pitchLines = wrap(lead.pitch || "", reg, 9.5, innerW - 12);
    const signalLines = wrap((lead.needSignals ?? []).join("  |  "), reg, 9, innerW - 12);
    // Rough height of this block, so it is never split across a page break.
    need(96 + pitchLines.length * LINE + signalLines.length * 11);

    const pct = gradePct(lead.score, lead.scoreMax || LEGACY_ATTAINABLE);

    // Grade chip
    page.drawRectangle({
      x: M, y: y - 4, width: 44, height: 26,
      color: tierColor(lead.tier), opacity: 0.14,
      borderColor: tierColor(lead.tier), borderWidth: 0.8,
    });
    page.drawText(String(pct), { x: M + 8, y: y + 8, size: 13, font: bold, color: tierColor(lead.tier) });
    page.drawText(safe(lead.tier), { x: M + 8, y: y - 1, size: 5.5, font: bold, color: tierColor(lead.tier) });

    text(lead.name, M + 56, 13.5, bold);
    y -= 14;
    text(
      [lead.category?.replace(/_/g, " "), lead.city].filter(Boolean).join("  |  "),
      M + 56, 9, reg, MUTED
    );
    y -= 16;

    // Contact block: the reason this page exists.
    const phone = lead.phone || "no phone";
    text(phone, M + 56, 12, bold, ACCENT);
    const phoneW = bold.widthOfTextAtSize(safe(phone), 12);
    if (lead.email) text(lead.email, M + 66 + phoneW, 9.5, reg, INK);
    y -= 14;

    if (lead.ownerName) {
      text(`Owner: ${lead.ownerName}${lead.ownerRole ? ` (${lead.ownerRole})` : ""}`, M + 56, 9.5, reg);
      y -= 12;
    }
    if (lead.website) {
      text(lead.website, M + 56, 8.5, reg, MUTED);
      y -= 12;
    }
    if (lead.address) {
      text(lead.address, M + 56, 8.5, reg, MUTED);
      y -= 12;
    }

    if (signalLines.length) {
      y -= 2;
      for (const l of signalLines) {
        text(l, M + 56, 9, reg, INK);
        y -= 11;
      }
    }

    if (pitchLines.length) {
      y -= 3;
      for (const l of pitchLines) {
        page.drawText(safe(l), { x: M + 56, y, size: 9.5, font: italic, color: MUTED });
        y -= LINE;
      }
    }

    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.6, color: RULE });
    y -= 20;
  }

  footer(page, pageNo);
  return doc.save();
}
