/**
 * An email the shop writes itself, as plain text and as simple HTML, from
 * one description of it.
 *
 * An email is made of pieces, and each piece says whose words it is:
 *
 *   a plain string   ours. Written by us, so the copy rules read it.
 *   { theirs }       the recipient's own: their name, their address. Said
 *                    back to them as they typed it. Not a claim about
 *                    anything, and somebody who lives in Nelson has to be
 *                    able to get a receipt.
 *   { data }         a number, a date, an order number, a link. Not prose.
 *
 * `compose` gives back the email twice over: the finished thing that is
 * sent, and `ours`, the same email with every piece that is not ours struck
 * out. `ours` is what the copy rules are run over, so what is checked can
 * never drift from what is sent: both come from the same pieces.
 *
 * The HTML is the same words in paragraphs and two-column tables. No
 * pictures, no colours, nothing fetched from anywhere, and every piece is
 * escaped on the way in.
 */

export type Piece =
  string | { readonly theirs: string } | { readonly data: string };

export type Line = readonly Piece[];

export type Row = {
  readonly label: Line;
  readonly value: Line;
  /** The line a reader is looking for: a total. */
  readonly strong?: boolean;
};

export type Block =
  /** A paragraph. Each line starts on a new line. A heading if it has one. */
  | {
      readonly kind: "text";
      readonly title?: Line;
      readonly lines: readonly Line[];
    }
  /** Labels and what goes with them, with a heading over them if it has one. */
  | {
      readonly kind: "rows";
      readonly title?: Line;
      readonly rows: readonly Row[];
    }
  /** A web address to follow. Only ever http or https. */
  | { readonly kind: "link"; readonly label: Line; readonly href: string };

export type EmailDoc = {
  readonly subject: Line;
  readonly blocks: readonly Block[];
};

export type Composed = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** The email with everything that is not our own words struck out. */
  readonly ours: { readonly subject: string; readonly body: string };
};

export const theirs = (text: string): Piece => ({ theirs: text });
export const data = (text: string): Piece => ({ data: text });

/**
 * What stands in for a piece that is not ours when the rules read the email:
 * the character the copy scanner itself puts between two strings, which no
 * rule can match across. Whoever hands `ours` to the rules says so
 * (`struckOut` in lib/backstage/core/copy.ts), because in text a person
 * typed the same character is something nobody can see, and is taken out.
 */
export const STRUCK_OUT = "\u0001";

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** One piece as it is shown: on one line, with nothing invisible in it. */
function shown(piece: Piece): string {
  const raw =
    typeof piece === "string"
      ? piece
      : "theirs" in piece
        ? piece.theirs
        : piece.data;
  return raw.replace(CONTROL, " ").replace(/\s*\n\s*/g, " ");
}

const asSent = (line: Line): string => line.map(shown).join("");

const asOurs = (line: Line): string =>
  line
    .map((piece) => (typeof piece === "string" ? shown(piece) : STRUCK_OUT))
    .join("");

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const asHtml = (line: Line): string => escapeHtml(asSent(line));

/** An absolute http or https address with no sign-in details tucked in. */
export function webAddress(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length > 2000 || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    return url.href;
  } catch {
    return null;
  }
}

function textOf(blocks: readonly Block[], say: (line: Line) => string): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind === "text") {
      parts.push(
        [
          ...(block.title === undefined ? [] : [say(block.title)]),
          ...block.lines.map(say),
        ].join("\n"),
      );
    } else if (block.kind === "rows") {
      parts.push(
        [
          ...(block.title === undefined ? [] : [say(block.title)]),
          ...block.rows.map((row) => `${say(row.label)}: ${say(row.value)}`),
        ].join("\n"),
      );
    } else {
      // The address itself is a link, not words: it is struck out for the
      // rules whichever way the email is being read.
      parts.push(`${say(block.label)}: ${say([data(block.href)])}`);
    }
  }
  return parts.join("\n\n");
}

const FONT =
  "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5";

function htmlOf(doc: EmailDoc): string {
  const parts: string[] = [];
  const heading = (title: Line | undefined) =>
    title === undefined
      ? ""
      : `<p style="margin:0 0 4px"><strong>${asHtml(title)}</strong></p>`;
  for (const block of doc.blocks) {
    if (block.kind === "text") {
      parts.push(
        `${heading(block.title)}<p style="margin:0 0 16px">${block.lines.map(asHtml).join("<br>")}</p>`,
      );
    } else if (block.kind === "rows") {
      const title = heading(block.title);
      const rows = block.rows
        .map((row) => {
          const weight = row.strong === true ? "font-weight:bold;" : "";
          return `<tr><td style="${weight}padding:2px 16px 2px 0;vertical-align:top">${asHtml(row.label)}</td><td style="${weight}padding:2px 0;vertical-align:top;text-align:right">${asHtml(row.value)}</td></tr>`;
        })
        .join("");
      parts.push(
        `${title}<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 16px;${FONT}">${rows}</table>`,
      );
    } else {
      const href = escapeHtml(block.href);
      parts.push(
        `<p style="margin:0 0 16px">${asHtml(block.label)}: <a href="${href}">${href}</a></p>`,
      );
    }
  }
  return [
    '<!doctype html><html lang="en-NZ"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${asHtml(doc.subject)}</title></head>`,
    `<body style="margin:0;padding:24px 16px;${FONT}">`,
    `<div style="max-width:560px;margin:0 auto">${parts.join("")}</div>`,
    "</body></html>",
  ].join("");
}

/**
 * Turn a description of an email into the email. A link that is not a plain
 * web address is a mistake in whoever built the description, and throws.
 */
export function compose(doc: EmailDoc): Composed {
  for (const block of doc.blocks) {
    if (block.kind === "link" && webAddress(block.href) !== block.href) {
      throw new Error("An email can only link to a plain web address.");
    }
  }
  return {
    subject: asSent(doc.subject).replace(/\s+/g, " ").trim(),
    text: textOf(doc.blocks, asSent),
    html: htmlOf(doc),
    ours: {
      subject: asOurs(doc.subject),
      body: textOf(doc.blocks, asOurs),
    },
  };
}
