/**
 * Showing a stranger's HTML without letting it do anything.
 *
 * Anyone can email us anything. The HTML of a message is hostile until shown
 * otherwise, and no cleaner is trusted to be the thing that stops it:
 * sanitize-html, which this file uses, had nine security advisories in one
 * year. So there are three layers, and the cleaner is the least of them.
 *
 *   1. THE WALL: how the body is served. A message's HTML is only ever sent
 *      from its own route, with a Content-Security-Policy that sandboxes the
 *      document (its own origin, no scripts, even if opened in a tab of its
 *      own) and lets it load nothing at all; pictures only when the reader
 *      has asked. `emailBodyHeaders` below is that policy. The page shows it
 *      in an `<iframe sandbox>` on top.
 *   2. Cleaned when shown. `renderEmailBody` runs on the way to the screen,
 *      every time, from the original the message arrived with, so a hole
 *      found in the cleaner tomorrow is closed for every email already here.
 *   3. Cleaned when kept. `sanitiseForStorage` makes the copy that sits in
 *      the database, so that column is never a place hostile markup lives.
 *
 * One rule runs through all of it: nothing edits HTML after it has been
 * cleaned. Every rewrite (where a link opens, which pictures show) happens
 * inside the cleaner, on parsed tags, never with a pattern over its output.
 * That is the mistake behind the best-known webmail holes of recent years.
 */

import { createHash } from "node:crypto";

import sanitizeHtml from "sanitize-html";

import { hexOf } from "@/lib/brand/colours";

/** Bigger than this is not shown as HTML. The plain text still is. */
export const MAX_HTML_CHARS = 800_000;

const MAX_DATA_IMAGE_CHARS = 2_000_000;
const MAX_URL_CHARS = 2000;

const TAGS = [
  // text
  "p",
  "br",
  "hr",
  "div",
  "span",
  "blockquote",
  "pre",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "del",
  "ins",
  "small",
  "big",
  "sub",
  "sup",
  "mark",
  "abbr",
  "cite",
  "q",
  "kbd",
  "samp",
  "var",
  "tt",
  "center",
  "font",
  // links
  "a",
  // lists
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  // tables
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "colgroup",
  "col",
  // pictures
  "img",
];

/** Tags whose insides are thrown away with them, text and all. */
const DISCARD_WHOLE = [
  "style",
  "script",
  "noscript",
  "template",
  "title",
  "textarea",
  "button",
  "select",
  "option",
  "optgroup",
  "datalist",
  "xmp",
  "svg",
  "math",
  "object",
  "applet",
  "iframe",
  "frameset",
  "noframes",
  "noembed",
  "audio",
  "video",
  "canvas",
];

const ATTRIBUTES: Record<string, string[]> = {
  "*": ["style", "title", "dir", "lang", "align", "valign"],
  a: ["href", "target", "rel"],
  img: ["src", "data-src", "alt", "width", "height"],
  table: ["width", "border", "cellpadding", "cellspacing", "bgcolor"],
  tr: ["bgcolor", "height"],
  td: ["colspan", "rowspan", "width", "height", "bgcolor", "nowrap"],
  th: ["colspan", "rowspan", "width", "height", "bgcolor", "nowrap", "scope"],
  col: ["span", "width"],
  colgroup: ["span", "width"],
  font: ["color", "size", "face"],
  ol: ["start", "type"],
  li: ["value"],
};

const COLOUR = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(?:,\s*[\d.]{1,5}\s*)?\)$/i,
  /^[a-z]{3,24}$/i,
];
const LENGTH = /^(?:0|auto|\d{1,4}(?:\.\d{1,3})?(?:px|pt|em|rem|%)?)$/i;
const BOX = [
  /^(?:(?:0|auto|\d{1,4}(?:\.\d{1,3})?(?:px|pt|em|rem|%)?)\s*){1,4}$/i,
];
/** Up to four of: a width, a line style, a colour. No other brackets get in. */
const BORDER = [
  /^(?:\s*(?:\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem)?|[a-z]{3,24}|#[0-9a-f]{3,8}|rgba?\([\d\s.,%]{5,40}\))){1,4}\s*$/i,
];

/**
 * The inline styles that survive. A small set: enough for an email to read
 * the way it was written, nothing that can place content over the page
 * (no position, no z-index) or fetch anything (no background image, and no
 * value with an address in it).
 */
const STYLES: Record<string, RegExp[]> = {
  color: COLOUR,
  "background-color": COLOUR,
  "font-size": [
    /^\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%)$/i,
    /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i,
  ],
  "font-weight": [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
  "font-style": [/^(?:normal|italic|oblique)$/i],
  "font-family": [/^[\w\s,"'-]{1,200}$/],
  "text-align": [/^(?:left|right|center|justify|start|end)$/i],
  "text-decoration": [/^(?:none|underline|line-through|overline|\s)+$/i],
  "line-height": [/^(?:normal|\d{1,3}(?:\.\d{1,3})?(?:px|pt|em|rem|%)?)$/i],
  "vertical-align": [
    /^(?:top|middle|bottom|baseline|sub|super|text-top|text-bottom)$/i,
  ],
  "white-space": [/^(?:normal|nowrap|pre|pre-wrap|pre-line)$/i],
  display: [
    /^(?:none|block|inline|inline-block|table|table-row|table-cell|list-item)$/i,
  ],
  width: [LENGTH],
  "max-width": [LENGTH],
  height: [LENGTH],
  margin: BOX,
  "margin-top": [LENGTH],
  "margin-right": [LENGTH],
  "margin-bottom": [LENGTH],
  "margin-left": [LENGTH],
  padding: BOX,
  "padding-top": [LENGTH],
  "padding-right": [LENGTH],
  "padding-bottom": [LENGTH],
  "padding-left": [LENGTH],
  border: BORDER,
  "border-top": BORDER,
  "border-right": BORDER,
  "border-bottom": BORDER,
  "border-left": BORDER,
  "border-collapse": [/^(?:collapse|separate)$/i],
};

/** An absolute http or https address with no sign-in details tucked into it. */
function httpUrl(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length > MAX_URL_CHARS || !/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // "https://quickpickle.co.nz@elsewhere.example" is a trick, not a link.
    if (url.username !== "" || url.password !== "") return null;
    return url.href;
  } catch {
    return null;
  }
}

function linkUrl(value: string | undefined): string | null {
  const http = httpUrl(value);
  if (http !== null) return http;
  const trimmed = (value ?? "").trim();
  if (/^mailto:[^\s<>"']{3,300}$/i.test(trimmed)) return trimmed;
  if (/^tel:\+?[\d\s().-]{3,30}$/i.test(trimmed)) return trimmed;
  return null;
}

/** A picture carried inside the message itself. Never SVG: SVG is a document. */
function dataImage(value: string | undefined): string | null {
  const compact = (value ?? "").trim();
  if (compact.length > MAX_DATA_IMAGE_CHARS) return null;
  const match =
    /^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i.exec(compact);
  if (match === null) return null;
  return `data:image/${(match[1] ?? "").toLowerCase()};base64,${(match[2] ?? "").replace(/\s+/g, "")}`;
}

/** The Content-ID a `cid:` address points at, without its angle brackets. */
function cidOf(value: string | undefined): string | null {
  const match = /^cid:(.{1,250})$/i.exec((value ?? "").trim());
  if (match === null) return null;
  let id = match[1] ?? "";
  try {
    id = decodeURIComponent(id);
  } catch {
    // Not percent-encoded after all. Use it as it stands.
  }
  id = normaliseContentId(id);
  return id === "" || id.length > 200 ? null : id;
}

/** Content-IDs as they are compared: no brackets, lower case. */
export function normaliseContentId(contentId: string): string {
  return contentId.trim().replace(/^<|>$/g, "").trim().toLowerCase();
}

function sizeAttributes(attribs: sanitizeHtml.Attributes): {
  width?: string;
  height?: string;
} {
  const out: { width?: string; height?: string } = {};
  if (/^\d{1,4}%?$/.test(attribs.width ?? "")) out.width = attribs.width;
  if (/^\d{1,4}%?$/.test(attribs.height ?? "")) out.height = attribs.height;
  return out;
}

/**
 * What to do with pictures. Decided inside the cleaner, tag by tag:
 *
 *   keep  the copy for the database. A picture on someone else's server has
 *         its address moved aside, to `data-src`, where nothing loads it.
 *   show  the copy for the screen. With pictures off every picture loses its
 *         address and keeps its description. With them on, the message's own
 *         pictures are filled in from its attachments and the rest get their
 *         addresses back.
 */
type Pictures =
  | { readonly mode: "keep"; readonly seen: { count: number } }
  | {
      readonly mode: "show";
      readonly on: boolean;
      /** The message's own pictures as `data:` addresses, by Content-ID. */
      readonly own: Readonly<Record<string, string>>;
    };

function policy(pictures: Pictures): sanitizeHtml.IOptions {
  return {
    allowedTags: TAGS,
    nonTextTags: DISCARD_WHOLE,
    disallowedTagsMode: "discard",
    allowedAttributes: ATTRIBUTES,
    allowedStyles: { "*": STYLES },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img:
        pictures.mode === "keep"
          ? ["data"]
          : pictures.on
            ? ["data", "http", "https"]
            : [],
    },
    allowProtocolRelative: false,
    enforceHtmlBoundary: false,
    // Email tables nest deeply, but not this deeply.
    nestingLimit: 80,
    transformTags: {
      a: (_tagName, attribs) => {
        const href = linkUrl(attribs.href);
        const out: sanitizeHtml.Attributes = {};
        if (href !== null) {
          out.href = href;
          out.target = "_blank";
          out.rel = "noopener noreferrer nofollow";
        }
        if (attribs.title) out.title = attribs.title.slice(0, 300);
        return { tagName: "a", attribs: out };
      },
      img: (_tagName, attribs) => {
        const out: sanitizeHtml.Attributes = { ...sizeAttributes(attribs) };
        if (attribs.alt) out.alt = attribs.alt.slice(0, 300);

        const cid = cidOf(attribs.src);
        const inline = dataImage(attribs.src);
        // `data-src` is only ever our own doing, on a copy we kept.
        const remote = httpUrl(attribs.src) ?? httpUrl(attribs["data-src"]);

        if (pictures.mode === "keep") {
          if (cid !== null || inline !== null || remote !== null) {
            pictures.seen.count += 1;
          }
          if (inline !== null) out.src = inline;
          else if (remote !== null) out["data-src"] = remote;
          return { tagName: "img", attribs: out };
        }

        if (!pictures.on) return { tagName: "img", attribs: out };
        const own = cid === null ? null : dataImage(pictures.own[cid]);
        if (own !== null) out.src = own;
        else if (inline !== null) out.src = inline;
        else if (remote !== null) out.src = remote;
        return { tagName: "img", attribs: out };
      },
    },
    exclusiveFilter: (frame) => {
      // A link that goes nowhere keeps its words and loses its tag.
      if (frame.tag === "a" && !frame.attribs.href) return "excludeTag";
      // A picture with nothing to show and nothing to say is noise.
      if (frame.tag === "img") {
        const { src, alt } = frame.attribs;
        return !src && !frame.attribs["data-src"] && !alt;
      }
      return false;
    },
  };
}

/**
 * The copy of a message's HTML that is kept in the database: cleaned, with
 * nothing in it that loads. `pictures` is how many it asked for, so a screen
 * can offer to show them.
 */
export function sanitiseForStorage(dirty: string): {
  readonly html: string;
  readonly pictures: number;
} {
  const seen = { count: 0 };
  const html = sanitizeHtml(dirty, policy({ mode: "keep", seen })).trim();
  return { html, pictures: seen.count };
}

export type RenderOptions = {
  /** The reader pressed "Show pictures" for this message. */
  readonly showPictures: boolean;
  /** The message's own pictures as `data:` addresses, by Content-ID. */
  readonly ownPictures?: Readonly<Record<string, string>>;
};

/**
 * A message's HTML, cleaned for the screen. Give it the original the message
 * arrived with whenever that is to hand: cleaning from the original each time
 * is what lets a fix to the cleaner reach mail that is already here.
 */
export function renderEmailBody(html: string, options: RenderOptions): string {
  return sanitizeHtml(
    html,
    policy({
      mode: "show",
      on: options.showPictures,
      own: options.ownPictures ?? {},
    }),
  ).trim();
}

/** Is this really a picture of the kind it says it is? Read off its first bytes. */
export function looksLikeImage(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  switch (contentType) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    default:
      return false;
  }
}

/* ------------------------------------------------------------------------
   The document, and the headers it is served with
   --------------------------------------------------------------------- */

/**
 * The frame's own look. It cannot see the back end's stylesheet (it has an
 * origin of its own), so the few colours it needs are handed over by value.
 */
const FRAME_CSS = [
  "html{color-scheme:light}",
  `body{margin:0;padding:12px 14px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:${hexOf("navy")};background:${hexOf("white")};overflow-wrap:anywhere}`,
  "img{max-width:100%;height:auto}",
  "table{max-width:100%}",
  `a{color:${hexOf("pink-deep")}}`,
  `blockquote{margin:0.5em 0;padding-left:0.75em;border-left:3px solid ${hexOf("mist")}}`,
  "pre{white-space:pre-wrap;font:inherit;margin:0}",
].join("");

const FRAME_CSS_HASH = createHash("sha256").update(FRAME_CSS).digest("base64");

const escapeText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrap(body: string): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<base target="_blank">',
    `<style>${FRAME_CSS}</style>`,
    `</head><body>${body}</body></html>`,
  ].join("");
}

/**
 * The whole page for one message's body. `body` must have come out of
 * `renderEmailBody`: it is placed in the page as it stands.
 */
export function emailDocument(body: string): string {
  return wrap(body);
}

/** The same page for a message that only has plain text. */
export function textDocument(text: string): string {
  return wrap(`<pre>${escapeText(text)}</pre>`);
}

/**
 * The headers a message body is served with. This is the wall.
 *
 * `sandbox` in a Content-Security-Policy header gives the document an origin
 * of its own and no scripts, whether it is in our frame or opened directly:
 * it cannot read the back end's cookies or pages even if every other layer
 * failed. `default-src 'none'` means it loads nothing; pictures are let in
 * only when the reader asked. Links may open a new tab, and that tab is an
 * ordinary one (the two `allow-popups` words), or every site a link led to
 * would arrive broken. `frame-ancestors 'self'` lets only our own pages
 * frame it.
 */
export function emailBodyHeaders(
  showPictures: boolean,
): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": [
      "sandbox allow-popups allow-popups-to-escape-sandbox",
      "default-src 'none'",
      `img-src ${showPictures ? "data: https: http:" : "'none'"}`,
      "style-src 'unsafe-inline'",
      `style-src-elem 'sha256-${FRAME_CSS_HASH}'`,
      "style-src-attr 'unsafe-inline'",
      "form-action 'none'",
      "base-uri 'none'",
      "frame-ancestors 'self'",
    ].join("; "),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex",
  };
}
