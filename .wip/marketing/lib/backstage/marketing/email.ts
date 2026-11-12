/**
 * A campaign as one person's email: subject, text, HTML and headers.
 *
 * This is what the mail pipeline calls for each recipient. It sends nothing
 * itself. Everything it puts in the HTML that it did not write (the body, the
 * subject, the person's name, the sender's details) goes through `escape`,
 * and the body is built from parsed nodes (markdown.ts), never pasted in.
 *
 * Every campaign email carries three things, because marketing email in New
 * Zealand has to (see the note at the top of lib/backstage/crew/ops.ts):
 * who it is from, how to reach them, and a way to leave that works without
 * signing in. That last one is in the body and in the List-Unsubscribe
 * headers, so a mail program can offer its own unsubscribe button.
 */

import { hexOf } from "@/lib/brand/colours";

import {
  blocksToText,
  hrefFor,
  mapText,
  parseMarkdown,
  type Block,
  type Inline,
} from "./markdown";

/** The part of a campaign an email is made from. */
export type CampaignForEmail = {
  readonly id: string;
  readonly subject: string;
  readonly preheader: string;
  /** Markdown. */
  readonly body: string;
};

export type EmailRecipient = {
  readonly email: string;
  /** Their first name if we know it. Typed by them, so never trusted. */
  readonly firstName?: string | null;
  /** From their crew_members row. Goes in the unsubscribe links. */
  readonly unsubscribeToken: string;
  /**
   * Our id for this one email to this one person, when it comes from a
   * campaign's queue. Put in a header so a bounce can be traced back to it.
   */
  readonly sendId?: string;
};

/**
 * Who the email is from. There is no setting for this yet, so the caller
 * passes it in.
 */
export type EmailSender = {
  /** The business, as a customer knows it: "Quick Pickle". */
  readonly businessName: string;
  /**
   * How to reach the sender: a postal address, or an inbox that somebody
   * reads. Printed at the foot of every email. An email with no way to reach
   * its sender must not be sent, so this may not be empty.
   */
  readonly contactLine: string;
  /** The shop's public address, no trailing slash: "https://quickpickle.co.nz". */
  readonly siteUrl: string;
};

export type RenderedEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Extra headers the pipeline must set as they are. */
  readonly headers: Readonly<Record<string, string>>;
};

/** The words this file adds to every email. Kept together so they can be checked. */
export const EMAIL_WORDS = {
  why: "You are getting this because you joined the Pickle Crew.",
  leave: "Had enough? Unsubscribe here",
  leaveAfter: "and we will stop straight away.",
  leaveText: "Had enough? Unsubscribe here and we will stop straight away:",
  /** Used where {{name}} is written and we do not know their name. */
  noName: "there",
} as const;

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** One line, for a header: no line ends, no control characters. */
function oneLine(text: string, max: number): string {
  return text
    .replace(/[\u0000-\u001F\u007F\u{2028}\u{2029}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function siteOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not the shop's web address.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(
      "The shop's web address has to be https, or the unsubscribe link will not be trusted.",
    );
  }
  return url.origin;
}

function tokenOf(recipient: EmailRecipient): string {
  const token = recipient.unsubscribeToken;
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(token)) {
    throw new Error(
      "This person has no unsubscribe token, so they cannot be emailed.",
    );
  }
  return token;
}

/**
 * The page a person lands on from the link in the email. It asks them to
 * press one button, so a mail scanner that follows links cannot unsubscribe
 * anybody by accident.
 */
export function unsubscribePageUrl(siteUrl: string, token: string): string {
  return `${siteOrigin(siteUrl)}/unsubscribe/${encodeURIComponent(token)}`;
}

/**
 * The address a mail program POSTs to for its own unsubscribe button (RFC
 * 8058, "one-click"). No page, no sign-in: the POST itself is the request.
 */
export function unsubscribeOneClickUrl(siteUrl: string, token: string): string {
  return `${unsubscribePageUrl(siteUrl, token)}/one-click`;
}

const NAME_SLOT = /\{\{\s*name\s*\}\}/gi;

/** Their first name, tidied, or the stand-in word. */
function nameFor(recipient: EmailRecipient): string {
  const name = oneLine(recipient.firstName ?? "", 40);
  return name === "" ? EMAIL_WORDS.noName : name;
}

/* ---- HTML ------------------------------------------------------------- */

type Look = {
  readonly navy: string;
  readonly muted: string;
  readonly cream: string;
  readonly paper: string;
  readonly line: string;
};

const FONT = "Helvetica, Arial, sans-serif";

function inlineHtml(
  nodes: readonly Inline[],
  siteUrl: string,
  look: Look,
): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return escape(node.text);
        case "strong":
          return `<strong>${inlineHtml(node.children, siteUrl, look)}</strong>`;
        case "em":
          return `<em>${inlineHtml(node.children, siteUrl, look)}</em>`;
        case "link":
          return `<a href="${escape(hrefFor(node.href, siteUrl))}" style="color:${look.navy};text-decoration:underline;">${inlineHtml(node.children, siteUrl, look)}</a>`;
        case "break":
          return "<br>";
      }
    })
    .join("");
}

function blocksHtml(
  blocks: readonly Block[],
  siteUrl: string,
  look: Look,
): string {
  const inline = (nodes: readonly Inline[]) => inlineHtml(nodes, siteUrl, look);
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
          return `<p style="margin:0 0 16px;">${inline(block.children)}</p>`;
        case "heading": {
          const size = block.level === 1 ? 24 : block.level === 2 ? 20 : 17;
          const tag = `h${String(block.level)}`;
          return `<${tag} style="margin:24px 0 12px;font-size:${String(size)}px;line-height:1.25;font-weight:bold;">${inline(block.children)}</${tag}>`;
        }
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const items = block.items
            .map((item) => `<li style="margin:0 0 6px;">${inline(item)}</li>`)
            .join("");
          return `<${tag} style="margin:0 0 16px;padding:0 0 0 22px;">${items}</${tag}>`;
        }
        case "quote":
          return `<blockquote style="margin:0 0 16px;padding:0 0 0 14px;border-left:4px solid ${look.line};">${inline(block.children)}</blockquote>`;
        case "rule":
          return `<hr style="margin:24px 0;border:0;border-top:2px solid ${look.line};">`;
      }
    })
    .join("\n");
}

/**
 * Build one person's copy of a campaign.
 *
 * `{{name}}` in the subject or the body becomes their first name, or "there"
 * when we do not have one. It is swapped in after the body has been read into
 * nodes, so a name cannot bring formatting or markup of its own.
 *
 * Throws (a plain Error, for the pipeline to log and stop on) when the email
 * could not lawfully be sent: no way to reach the sender, or no way for this
 * person to unsubscribe.
 */
export function renderCampaignEmail(
  campaign: CampaignForEmail,
  recipient: EmailRecipient,
  sender: EmailSender,
): RenderedEmail {
  const businessName = oneLine(sender.businessName, 120);
  const contactLine = oneLine(sender.contactLine, 300);
  if (businessName === "") {
    throw new Error("A campaign email has to say who it is from.");
  }
  if (contactLine === "") {
    throw new Error(
      "A campaign email has to say how to reach the sender: a postal address or an inbox somebody reads.",
    );
  }
  const siteUrl = siteOrigin(sender.siteUrl);
  const token = tokenOf(recipient);
  const leaveUrl = unsubscribePageUrl(siteUrl, token);
  const oneClickUrl = unsubscribeOneClickUrl(siteUrl, token);

  const name = nameFor(recipient);
  const withName = (text: string) => text.replace(NAME_SLOT, name);

  const subject = oneLine(withName(campaign.subject), 200);
  if (subject === "") throw new Error("A campaign email needs a subject.");
  const preheader = oneLine(withName(campaign.preheader), 200);
  const blocks = mapText(parseMarkdown(campaign.body), withName);

  const look: Look = {
    navy: hexOf("navy"),
    muted: hexOf("navy-muted"),
    cream: hexOf("cream"),
    paper: hexOf("paper"),
    line: hexOf("mist"),
  };

  const text = [
    blocksToText(blocks, siteUrl),
    "",
    "--",
    EMAIL_WORDS.why,
    `${EMAIL_WORDS.leaveText} ${leaveUrl}`,
    "",
    businessName,
    contactLine,
    "",
  ].join("\n");

  const hidden =
    "display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;";
  const html = `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${look.cream};">
${preheader === "" ? "" : `<div style="${hidden}">${escape(preheader)}</div>\n`}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${look.cream};">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:${look.paper};border:2px solid ${look.navy};border-radius:14px;">
<tr>
<td style="padding:24px 24px 8px;font-family:${FONT};font-size:16px;line-height:1.6;color:${look.navy};">
<p style="margin:0 0 20px;font-size:22px;line-height:1.2;font-weight:bold;">${escape(businessName)}</p>
${blocksHtml(blocks, siteUrl, look)}
</td>
</tr>
<tr>
<td style="padding:16px 24px 24px;border-top:2px solid ${look.line};font-family:${FONT};font-size:13px;line-height:1.5;color:${look.muted};">
<p style="margin:0 0 8px;">${escape(EMAIL_WORDS.why)}</p>
<p style="margin:0 0 8px;"><a href="${escape(leaveUrl)}" style="color:${look.muted};text-decoration:underline;">${escape(EMAIL_WORDS.leave)}</a> ${escape(EMAIL_WORDS.leaveAfter)}</p>
<p style="margin:0;">${escape(businessName)}<br>${escape(contactLine)}</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;

  return {
    subject,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "X-QP-Campaign": oneLine(campaign.id, 60),
      ...(recipient.sendId
        ? { "X-QP-Send": oneLine(recipient.sendId, 60) }
        : {}),
    },
  };
}

/**
 * The body as a person will read it, with the stars and brackets gone. The
 * copy check reads this as well as what was typed, so a banned word split by
 * formatting marks is still found.
 */
export function campaignBodyText(body: string): string {
  return blocksToText(parseMarkdown(body), "");
}
