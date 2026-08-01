// The house style for mail we send about somebody's account.
//
// Written the way email actually has to be written rather than the way a page is:
// tables for layout, every style inline, no shorthand a client will drop, no flexbox,
// no grid, no external stylesheet. Outlook renders with Word, and Gmail strips a
// <style> block on forwarded mail, so anything that matters lives on the element.
//
// It is typographic on purpose. Gmail hides images by default from a sender you have
// not written to, which is precisely the situation for a sign in code, so a design
// that leans on a logo image arrives broken exactly when it matters most. The mark
// here is drawn with a border and a background colour, which always render.

const ACCENT = "#f96332";
const DARK = "#230800";
const SAND = "#fffaf6";
const PANEL = "#ffffff";
const BORDER = "#efe3d6";
const MUTED = "#7c6c61";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type Shell = {
  /** The line Gmail shows next to the subject. Never leave this to chance. */
  preheader: string;
  /** Body, already marked up. Use the block helpers below. */
  body: string;
  /** Small print under the card. Defaults to the account line. */
  footnote?: string;
};

/**
 * Wrap content in the branded frame.
 *
 * The outer table paints the sand ground: some clients ignore a background on <body>,
 * and a white letterbox around a warm card looks like a broken image.
 */
export function shell({ preheader, body, footnote }: Shell): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Fresh Leads</title>
</head>
<body style="margin:0;padding:0;background:${SAND};">
<!-- Preview text. Hidden, then padded with zero width spaces so the client does not
     pull the first line of the body in after it. -->
<div style="display:none;font-size:1px;color:${SAND};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
  ${escapeHtml(preheader)}${"&#8204;&nbsp;".repeat(60)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SAND};">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">

        <!-- Wordmark -->
        <tr>
          <td align="left" style="padding:0 4px 18px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:10px;">
                  <div style="width:26px;height:26px;border-radius:50%;background:${ACCENT};"></div>
                </td>
                <td style="font-family:${FONT};font-size:17px;font-weight:700;color:${DARK};letter-spacing:-.01em;">
                  Fresh Leads
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:${PANEL};border:1px solid ${BORDER};border-radius:18px;padding:34px 32px;">
            ${body}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
            ${footnote ?? "This message was sent to you about your Fresh Leads account."}
            <br>
            <a href="https://www.fresh-leads.io" style="color:${MUTED};text-decoration:underline;">fresh-leads.io</a>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** A heading inside the card. */
export const heading = (text: string): string =>
  `<h1 style="margin:0 0 14px;font-family:${FONT};font-size:21px;line-height:1.3;font-weight:700;color:${DARK};letter-spacing:-.015em;">${escapeHtml(
    text
  )}</h1>`;

/** A paragraph. `muted` for the small explanatory lines. */
export const paragraph = (text: string, muted = false): string =>
  `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.65;color:${
    muted ? MUTED : DARK
  };">${text}</p>`;

/**
 * The code itself.
 *
 * Letter spaced and monospaced so a 0 cannot be read as an O, and left selectable as
 * plain text rather than drawn as an image, because most people copy it rather than
 * retype it.
 */
export const codeBlock = (code: string): string => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;">
  <tr>
    <td align="center" style="background:#fff5f0;border:1px solid #f9d2c1;border-radius:14px;padding:20px 12px;">
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:.22em;color:${DARK};text-indent:.22em;">
        ${escapeHtml(code)}
      </div>
    </td>
  </tr>
</table>`;

/** A hairline between the message and its small print. */
export const divider = (): string =>
  `<div style="height:1px;background:${BORDER};margin:22px 0 18px;line-height:1px;font-size:0;">&nbsp;</div>`;

/** A real button, built as a table so Outlook renders the whole shape. */
export const button = (label: string, href: string): string => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;">
  <tr>
    <td align="center" style="background:${ACCENT};border-radius:999px;">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(
        label
      )}</a>
    </td>
  </tr>
</table>`;

/**
 * Escape anything that came from outside.
 *
 * Applied to codes and addresses even though both are ours: a template that only
 * escapes when it looks necessary is one edit away from not escaping at all.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
