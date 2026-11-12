/**
 * A small Markdown reader for campaign emails.
 *
 * It turns what was typed into a tree of plain nodes and nothing else. The
 * email (HTML and text) and the preview on the campaign screen are each built
 * from that tree, so no character of what somebody typed is ever pasted into
 * HTML as it stands: a tag in the body is just text by the time it is a node.
 *
 * What it understands, which is what an email needs:
 *
 *   blank line          a new paragraph (a single line end is a line break)
 *   one to three hashes a heading, largest first
 *   - item or * item    a list
 *   1. item             a numbered list
 *   > words             a quote
 *   ---                 a line across
 *   **bold** *italic* _italic_
 *   [words](https://example.co.nz) and bare https:// addresses
 *
 * Anything else, HTML included, is text. A link may go to an https address, a
 * mailto address or a path on this site; anything else is left as the words
 * that were typed.
 */

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong" | "em"; readonly children: readonly Inline[] }
  | {
      readonly kind: "link";
      readonly href: SafeHref;
      readonly children: readonly Inline[];
    }
  | { readonly kind: "break" };

export type Block =
  | { readonly kind: "paragraph"; readonly children: readonly Inline[] }
  | {
      readonly kind: "heading";
      readonly level: 1 | 2 | 3;
      readonly children: readonly Inline[];
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly kind: "quote"; readonly children: readonly Inline[] }
  | { readonly kind: "rule" };

/**
 * Somewhere a link is allowed to go.
 *
 *   https   a full web address
 *   mailto  an email address
 *   path    a page on this site ("/checkout"); the sender's site address is
 *           put in front when the email is built
 */
export type SafeHref = {
  readonly kind: "https" | "mailto" | "path";
  readonly value: string;
};

/** Emphasis inside emphasis inside a link is as deep as anyone means to go. */
const MAX_DEPTH = 4;

/**
 * How far ahead a closing mark is looked for. Bold or italic that runs longer
 * than this was not meant as either, and not looking further keeps a body
 * full of stray stars quick to read.
 */
const MAX_SPAN = 1200;

const PLACEHOLDER_ORIGIN = "https://site.invalid";

/** True for a character that has no business in a web address. */
const UNSAFE_IN_ADDRESS = /[\s\\\u0000-\u001F\u007F]/;

/**
 * A path on this site, tidied, or null. It must start with exactly one
 * slash: two would be read by a browser as another site's address.
 */
export function safeSitePath(raw: string): string | null {
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (UNSAFE_IN_ADDRESS.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  const tidy = `${url.pathname}${url.search}${url.hash}`;
  // "/..//elsewhere" tidies to "//elsewhere". Check what will be used.
  if (!tidy.startsWith("/") || tidy.startsWith("//")) return null;
  return tidy;
}

/** A full https address with no sign-in details in it, tidied, or null. */
export function safeHttpsUrl(raw: string): string | null {
  if (!/^https:\/\//i.test(raw) || UNSAFE_IN_ADDRESS.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname === "") return null;
  // "https://ourshop.co.nz@elsewhere.example" goes to elsewhere.
  if (url.username !== "" || url.password !== "") return null;
  return url.href;
}

const MAILTO = /^mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})$/i;

export function safeHref(raw: string): SafeHref | null {
  const value = raw.trim();
  const https = safeHttpsUrl(value);
  if (https !== null) return { kind: "https", value: https };
  const mail = MAILTO.exec(value);
  if (mail !== null) return { kind: "mailto", value: `mailto:${mail[1]}` };
  const path = safeSitePath(value);
  if (path !== null) return { kind: "path", value: path };
  return null;
}

const isWordChar = (char: string | undefined) =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

function parseInline(
  source: string,
  depth: number,
  allowLinks = true,
): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer !== "") {
      out.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? "";
    const next = source[i + 1];

    // A backslash makes the next mark an ordinary character.
    if (char === "\\" && next !== undefined && /[\\*_[\]()>-]/.test(next)) {
      buffer += next;
      i += 2;
      continue;
    }

    if (char === "\n") {
      flush();
      out.push({ kind: "break" });
      i += 1;
      continue;
    }

    if (depth < MAX_DEPTH) {
      if (char === "*" && next === "*") {
        const end = source.indexOf("**", i + 2);
        if (end > i + 2 && end - i <= MAX_SPAN) {
          flush();
          out.push({
            kind: "strong",
            children: parseInline(
              source.slice(i + 2, end),
              depth + 1,
              allowLinks,
            ),
          });
          i = end + 2;
          continue;
        }
      }

      if (
        (char === "*" || char === "_") &&
        next !== undefined &&
        !/\s/.test(next) &&
        next !== char &&
        // An underscore inside a word (an email address, say) is a letter.
        !(char === "_" && isWordChar(source[i - 1]))
      ) {
        let end = source.indexOf(char, i + 1);
        while (
          end !== -1 &&
          end - i <= MAX_SPAN &&
          (/\s/.test(source[end - 1] ?? "") ||
            (char === "_" && isWordChar(source[end + 1])))
        ) {
          end = source.indexOf(char, end + 1);
        }
        if (end > i + 1 && end - i <= MAX_SPAN) {
          flush();
          out.push({
            kind: "em",
            children: parseInline(
              source.slice(i + 1, end),
              depth + 1,
              allowLinks,
            ),
          });
          i = end + 1;
          continue;
        }
      }

      if (allowLinks && char === "[") {
        const link = /^\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/.exec(
          source.slice(i, i + 2400),
        );
        if (link !== null) {
          const href = safeHref(link[2] ?? "");
          if (href !== null) {
            flush();
            out.push({
              kind: "link",
              href,
              // A link inside a link is not a thing.
              children: parseInline(link[1] ?? "", depth + 1, false),
            });
            i += link[0].length;
            continue;
          }
          // Not somewhere a link may go: leave the words as they were typed.
        }
      }

      if (
        allowLinks &&
        char === "h" &&
        source.startsWith("https://", i) &&
        !isWordChar(source[i - 1])
      ) {
        const bare = /^https:\/\/[^\s<>()[\]"']+/.exec(
          source.slice(i, i + 2000),
        );
        // A full stop or comma after an address ends the sentence, not the address.
        const typed = bare?.[0].replace(/[.,;:!?]+$/, "") ?? "";
        const href = safeHttpsUrl(typed);
        if (href !== null) {
          flush();
          out.push({
            kind: "link",
            href: { kind: "https", value: href },
            children: [{ kind: "text", text: typed }],
          });
          i += typed.length;
          continue;
        }
      }
    }

    buffer += char;
    i += 1;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const RULE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const BULLET = /^[ \t]*[-*][ \t]+(.*)$/;
const NUMBERED = /^[ \t]*\d{1,3}[.)][ \t]+(.*)$/;
const QUOTE = /^[ \t]*>[ \t]?(.*)$/;

const startsBlock = (line: string) =>
  HEADING.test(line) ||
  RULE.test(line) ||
  BULLET.test(line) ||
  NUMBERED.test(line) ||
  QUOTE.test(line);

/** Read Markdown into blocks. Never throws: anything odd is just text. */
export function parseMarkdown(source: string): Block[] {
  const lines = source
    .replace(/\r\n?/g, "\n")
    // Control characters have no place in an email.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n");
  const blocks: Block[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = Math.min(3, (heading[1] ?? "").length) as 1 | 2 | 3;
      blocks.push({
        kind: "heading",
        level,
        children: parseInline(heading[2] ?? "", 0),
      });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const marker = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const item = marker.exec(lines[i] ?? "");
        if (item === null || RULE.test(lines[i] ?? "")) break;
        items.push(parseInline((item[1] ?? "").trim(), 0));
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const part = QUOTE.exec(lines[i] ?? "");
        if (part === null) break;
        quoted.push((part[1] ?? "").trim());
        i += 1;
      }
      blocks.push({
        kind: "quote",
        children: parseInline(quoted.join("\n").trim(), 0),
      });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const part = lines[i] ?? "";
      if (part.trim() === "") break;
      if (paragraph.length > 0 && startsBlock(part)) break;
      paragraph.push(part.trim());
      i += 1;
    }
    blocks.push({
      kind: "paragraph",
      children: parseInline(paragraph.join("\n"), 0),
    });
  }
  return blocks;
}

/** Change the words in every text node, leaving the shape alone. */
export function mapText(
  blocks: readonly Block[],
  change: (text: string) => string,
): Block[] {
  const inline = (nodes: readonly Inline[]): Inline[] =>
    nodes.map((node) => {
      switch (node.kind) {
        case "text":
          return { kind: "text", text: change(node.text) };
        case "strong":
        case "em":
          return { kind: node.kind, children: inline(node.children) };
        case "link":
          return {
            kind: "link",
            href: node.href,
            children: inline(node.children),
          };
        case "break":
          return node;
      }
    });
  return blocks.map((block) => {
    switch (block.kind) {
      case "paragraph":
      case "quote":
        return { kind: block.kind, children: inline(block.children) };
      case "heading":
        return {
          kind: "heading",
          level: block.level,
          children: inline(block.children),
        };
      case "list":
        return {
          kind: "list",
          ordered: block.ordered,
          items: block.items.map(inline),
        };
      case "rule":
        return block;
    }
  });
}

/** Where a link goes, in full. `siteUrl` has no trailing slash. */
export function hrefFor(href: SafeHref, siteUrl: string): string {
  return href.kind === "path" ? `${siteUrl}${href.value}` : href.value;
}

function inlineText(nodes: readonly Inline[], siteUrl: string): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return node.text;
        case "strong":
        case "em":
          return inlineText(node.children, siteUrl);
        case "link": {
          const words = inlineText(node.children, siteUrl).trim();
          const address = hrefFor(node.href, siteUrl).replace(/^mailto:/, "");
          return words === "" || words === address || words === node.href.value
            ? address
            : `${words} (${address})`;
        }
        case "break":
          return "\n";
      }
    })
    .join("");
}

/**
 * The blocks as plain text: what the text half of an email says, and what a
 * person reads once the stars and brackets are gone.
 */
export function blocksToText(
  blocks: readonly Block[],
  siteUrl: string,
): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
          return inlineText(block.children, siteUrl);
        case "heading":
          return inlineText(block.children, siteUrl);
        case "list":
          return block.items
            .map(
              (item, index) =>
                `${block.ordered ? `${String(index + 1)}.` : "-"} ${inlineText(item, siteUrl)}`,
            )
            .join("\n");
        case "quote":
          return inlineText(block.children, siteUrl)
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        case "rule":
          return "----------";
      }
    })
    .join("\n\n");
}
