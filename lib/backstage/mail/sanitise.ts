/**
 * A stranger's HTML, made safe to keep.
 *
 * Anyone can email us anything, and the HTML of a message is hostile until
 * shown otherwise. So the rule is simple: **an email's HTML is never shown
 * as HTML.** The inbox shows a message as plain text, which React escapes,
 * and there is no route that serves a message's markup at all. No cleaner
 * is trusted to be the thing that stops an attack: sanitize-html, which
 * this file uses, had nine security advisories in one year.
 *
 * What this file does is the one job that is left. When a message has no
 * plain-text part its words have to be read out of its HTML (parse.ts), and
 * a copy of that HTML is kept beside them. `sanitiseForStorage` makes that
 * copy, so the column it sits in is never a place hostile markup lives:
 * scripts, styles, forms, frames and every address that could load
 * something are gone before it is stored.
 *
 * One rule runs through it: nothing edits HTML after it has been cleaned.
 * Every rewrite happens inside the cleaner, on parsed tags, never with a
 * pattern over its output. That is the mistake behind the best-known webmail
 * holes of recent years.
 */

import sanitizeHtml from "sanitize-html";

/** Bigger than this is not kept as HTML. The plain text still is. */
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

function policy(seen: { count: number }): sanitizeHtml.IOptions {
  return {
    allowedTags: TAGS,
    nonTextTags: DISCARD_WHOLE,
    disallowedTagsMode: "discard",
    allowedAttributes: ATTRIBUTES,
    allowedStyles: { "*": STYLES },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    // A picture carried inside the message is the only kind with an address
    // left on it. One on somebody else's server has its address moved aside.
    allowedSchemesByTag: { img: ["data"] },
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
        const remote = httpUrl(attribs.src);
        if (cid !== null || inline !== null || remote !== null) {
          seen.count += 1;
        }
        // A remote picture's address goes to `data-src`, where nothing
        // loads it: fetching it would tell its sender the email was opened.
        if (inline !== null) out.src = inline;
        else if (remote !== null) out["data-src"] = remote;
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
 * nothing in it that loads. `pictures` is how many it asked for. It is kept
 * to read the words from and for the record. It is never sent to a browser
 * as markup.
 */
export function sanitiseForStorage(dirty: string): {
  readonly html: string;
  readonly pictures: number;
} {
  const seen = { count: 0 };
  const html = sanitizeHtml(dirty, policy(seen)).trim();
  return { html, pictures: seen.count };
}
