/**
 * A small Markdown reader for the documents in Plans.
 *
 * It turns text into a tree of plain objects and nothing else. The screen
 * (app/backstage/(app)/plans/Markdown.tsx) builds React elements from that
 * tree, so nothing a writer types is ever handed to a browser as HTML:
 *
 *   - raw HTML is not understood at all. `<script>` is five letters between
 *     two angle brackets, and comes out as exactly that;
 *   - a link is only a link if its address is http, https, mailto or a path
 *     on this site. Anything else (`javascript:`, `data:`, `//elsewhere`)
 *     stays on the page as the characters that were typed.
 *
 * What it reads: headings, paragraphs, bold, italic, strike-through, code,
 * links, ordered and unordered lists (nested, and with task boxes), tables,
 * block quotes, fenced code and horizontal rules.
 *
 * Where it differs from the Markdown a programmer expects, on purpose:
 *
 *   - one line break is a line break. The people writing here type into a
 *     text box on a phone; pressing return and getting no new line reads as
 *     a fault. So paragraphs are not hard-wrapped in the source;
 *   - text indented by four spaces is still text, not code;
 *   - there is no setext heading (`Title` over `=====`), no reference-style
 *     link, no image and no footnote.
 *
 * It never throws and never hangs: nesting has a ceiling, and the work done
 * looking for the end of a bold or italic run is capped per paragraph.
 */

export type LinkKind =
  /** A path inside the back end: followed without a full page load. */
  | "backstage"
  /** A path on the shop: a full page load (see ShopLink). */
  | "site"
  /** Another website. Opens in a new tab. */
  | "external"
  | "mail";

export type Inline =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "strong"; readonly children: readonly Inline[] }
  | { readonly type: "em"; readonly children: readonly Inline[] }
  | { readonly type: "del"; readonly children: readonly Inline[] }
  | { readonly type: "code"; readonly text: string }
  | {
      readonly type: "link";
      readonly href: string;
      readonly kind: LinkKind;
      readonly children: readonly Inline[];
    }
  | { readonly type: "break" };

export type Align = "left" | "center" | "right" | null;

export type ListItem = {
  /** Null for an ordinary item; true or false for a task box. */
  readonly checked: boolean | null;
  readonly children: readonly Block[];
};

export type Block =
  | {
      readonly type: "heading";
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly children: readonly Inline[];
    }
  | { readonly type: "paragraph"; readonly children: readonly Inline[] }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly start: number;
      /** No blank lines between items: render without paragraph gaps. */
      readonly tight: boolean;
      readonly items: readonly ListItem[];
    }
  | { readonly type: "quote"; readonly children: readonly Block[] }
  | { readonly type: "code"; readonly lang: string; readonly text: string }
  | {
      readonly type: "table";
      readonly align: readonly Align[];
      readonly head: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    }
  | { readonly type: "rule" };

/** Lists inside quotes inside lists: this deep and no deeper. */
const MAX_BLOCK_DEPTH = 8;
/** Bold inside italic inside a link label: this deep and no deeper. */
const MAX_INLINE_DEPTH = 6;
/** Longer than any document the back end will save. */
const MAX_SOURCE = 400_000;
const MAX_URL = 2000;
const MAX_TABLE_COLUMNS = 24;

/* ------------------------------------------------------------------ links */

export type SafeLink = { readonly href: string; readonly kind: LinkKind };

/**
 * A browser strips tabs and line breaks out of an address before reading it,
 * which is how `java\nscript:` becomes a script. Nothing below a space, no
 * space, no delete or C1 control, and no backslash (which browsers read as a
 * forward slash, turning `/\elsewhere` into `//elsewhere`).
 */
function hasUnsafeCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x5c) {
      return true;
    }
  }
  return false;
}

/**
 * The address a link may point at, or null if it may not be a link.
 *
 * A short list of what is allowed, not a list of what is banned: a web
 * address (http or https, with a host), an email address (mailto), or a path
 * on this site (one leading slash).
 */
export function safeLink(raw: string): SafeLink | null {
  const href = raw.trim();
  if (href === "" || href.length > MAX_URL) return null;
  if (hasUnsafeCharacter(href)) return null;

  if (href.startsWith("/")) {
    // `//host` leaves the site while looking like a path.
    if (href.startsWith("//")) return null;
    const backstage =
      href === "/backstage" ||
      href.startsWith("/backstage/") ||
      href.startsWith("/backstage?") ||
      href.startsWith("/backstage#");
    return { href, kind: backstage ? "backstage" : "site" };
  }

  const lower = href.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname === "") return null;
    // `https://bank.example@elsewhere.example` shows one name and goes to
    // another. Nobody writing a plan needs a password in a link.
    if (url.username !== "" || url.password !== "") return null;
    return { href: url.href, kind: "external" };
  }

  if (lower.startsWith("mailto:")) {
    const address = href.slice("mailto:".length).split("?")[0] ?? "";
    const at = address.indexOf("@");
    if (at <= 0 || at !== address.lastIndexOf("@") || at === address.length - 1)
      return null;
    return { href, kind: "mail" };
  }

  return null;
}

/* ------------------------------------------------------- small predicates */

const ASCII_PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

function isPunctuation(char: string): boolean {
  return ASCII_PUNCTUATION.includes(char);
}

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\n" || char === "\t";
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function isWordCharacter(char: string | undefined): boolean {
  return char !== undefined && WORD_CHARACTER.test(char);
}

function runLength(text: string, from: number, char: string): number {
  let length = 0;
  while (text[from + length] === char) length += 1;
  return length;
}

/**
 * A row of three or more underscores is a blank on a form ("Name: ____"),
 * and four or more stars are a row of stars. Neither is ever bold or italic,
 * however the words around them fall.
 */
function isLiteralRun(mark: string, run: number): boolean {
  return mark === "_" ? run >= 3 : run >= 4;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function indentOf(line: string): number {
  let count = 0;
  while (line[count] === " ") count += 1;
  return count;
}

/* ----------------------------------------------------------------- inline */

type InlineOptions = { readonly links: boolean };

/**
 * For every `[`, where its matching `]` is. Worked out once per run of text
 * so that a page of unmatched brackets costs one pass, not one pass each.
 */
function matchBrackets(text: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "[") {
      open.push(index);
    } else if (char === "]") {
      const start = open.pop();
      if (start !== undefined) pairs.set(start, index);
    }
  }
  return pairs;
}

function unescape(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1];
    if (char === "\\" && next !== undefined && isPunctuation(next)) {
      out += next;
      index += 1;
    } else {
      out += char;
    }
  }
  return out;
}

/** `[label](address "title")` starting at `open`, if that is what is there. */
function linkAt(
  text: string,
  open: number,
  brackets: ReadonlyMap<number, number>,
): { labelEnd: number; end: number; safe: SafeLink } | null {
  const labelEnd = brackets.get(open);
  if (labelEnd === undefined || text[labelEnd + 1] !== "(") return null;

  const limit = Math.min(text.length, labelEnd + 2 + MAX_URL + 200);
  let index = labelEnd + 2;
  while (index < limit && text[index] === " ") index += 1;

  let address: string;
  if (text[index] === "<") {
    const close = text.indexOf(">", index + 1);
    if (close === -1 || close >= limit) return null;
    address = text.slice(index + 1, close);
    index = close + 1;
  } else {
    const start = index;
    let depth = 0;
    while (index < limit) {
      const char = text[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === " " || char === "\n") break;
      if (char === "(") depth += 1;
      if (char === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      index += 1;
    }
    address = unescape(text.slice(start, Math.min(index, limit)));
  }

  while (index < limit && text[index] === " ") index += 1;
  // An optional title in quotes. It is read past and not used.
  const quote = text[index];
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, index + 1);
    if (close === -1 || close >= limit) return null;
    index = close + 1;
    while (index < limit && text[index] === " ") index += 1;
  }
  if (text[index] !== ")") return null;

  const safe = safeLink(address);
  if (safe === null) return null;
  return { labelEnd, end: index + 1, safe };
}

/** The end of a run of backticks that closes a code span, or -1. */
function findCodeClose(text: string, from: number, run: number): number {
  let index = from;
  while (index < text.length) {
    const at = text.indexOf("`", index);
    if (at === -1) return -1;
    const length = runLength(text, at, "`");
    if (length === run) return at;
    index = at + length;
  }
  return -1;
}

/** Where a web address typed straight into a sentence stops. */
function bareUrlEnd(text: string, from: number): number {
  let end = from;
  while (end < text.length) {
    const char = text[end] ?? "";
    if (isSpace(char) || char === "<" || char === ">" || char === '"') break;
    end += 1;
  }
  // The full stop at the end of the sentence is not part of the address.
  for (;;) {
    const last = text[end - 1] ?? "";
    if (".,;:!?'*_~".includes(last)) {
      end -= 1;
      continue;
    }
    if (last === ")") {
      const candidate = text.slice(from, end);
      const opens = candidate.split("(").length - 1;
      const closes = candidate.split(")").length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return end;
}

function parseInline(
  text: string,
  depth = 0,
  options: InlineOptions = { links: true },
): Inline[] {
  if (text === "") return [];
  if (depth > MAX_INLINE_DEPTH) return [{ type: "text", text }];

  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer !== "") {
      out.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  // Looking for the far end of a bold or italic run is the one place a
  // hostile paragraph could cost more than its length. It gets a budget.
  let budget = text.length * 20 + 2000;
  const spend = () => {
    budget -= 1;
    return budget > 0;
  };

  const skipCode = (index: number): number => {
    const run = runLength(text, index, "`");
    const close = findCodeClose(text, index + run, run);
    return close === -1 ? index + run : close + run;
  };

  /**
   * Whether a run of marks, starting at `index` and `run` long, can close
   * something whose words began at `from`: there must be words before it,
   * the last of them hard up against it, and for an underscore no word
   * running straight on after it.
   */
  const closes = (
    index: number,
    from: number,
    mark: string,
    run: number,
  ): boolean =>
    index > from &&
    !isSpace(text[index - 1]) &&
    (mark !== "_" || !isWordCharacter(text[index + run]));

  /**
   * The next run of `mark` after `from` that is at least `want` long and can
   * close, or -1. Returns where that run starts.
   */
  const closingRun = (from: number, mark: string, want: number): number => {
    let index = from;
    while (index < text.length) {
      if (!spend()) return -1;
      const char = text[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "`") {
        index = skipCode(index);
        continue;
      }
      if (char === mark) {
        const run = runLength(text, index, mark);
        if (
          run >= want &&
          !isLiteralRun(mark, run) &&
          closes(index, from, mark, run)
        ) {
          return index;
        }
        index += run;
        continue;
      }
      index += 1;
    }
    return -1;
  };

  /** The closing mark of an `*italic*` whose words start at `from`. */
  const emClose = (from: number, mark: string): number => {
    if (text[from] === undefined || text[from] === mark) return -1;
    let index = from;
    while (index < text.length) {
      if (!spend()) return -1;
      const char = text[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "`") {
        index = skipCode(index);
        continue;
      }
      if (char === mark) {
        const run = runLength(text, index, mark);
        if (run === 1) {
          if (closes(index, from, mark, 1)) return index;
          index += 1;
          continue;
        }
        if (isLiteralRun(mark, run)) {
          index += run;
          continue;
        }
        // Bold inside the italic: step over the whole of it. If the bold
        // ends in a longer run ("*a **b***"), the mark left over is ours.
        const inner = closingRun(index + run, mark, run);
        index = inner === -1 ? index + run : inner + run;
        continue;
      }
      index += 1;
    }
    return -1;
  };

  const brackets = options.links ? matchBrackets(text) : null;

  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    const next = text[index + 1];

    if (char === "\\") {
      if (next === "\n") {
        flush();
        out.push({ type: "break" });
        index += 2;
      } else if (next !== undefined && isPunctuation(next)) {
        buffer += next;
        index += 2;
      } else {
        buffer += char;
        index += 1;
      }
      continue;
    }

    if (char === "\n") {
      buffer = buffer.trimEnd();
      flush();
      out.push({ type: "break" });
      index += 1;
      continue;
    }

    if (char === "`") {
      const run = runLength(text, index, "`");
      const close = findCodeClose(text, index + run, run);
      if (close === -1) {
        buffer += text.slice(index, index + run);
        index += run;
        continue;
      }
      let code = text.slice(index + run, close).replace(/\n/g, " ");
      if (
        code.length > 2 &&
        code.startsWith(" ") &&
        code.endsWith(" ") &&
        code.trim() !== ""
      ) {
        code = code.slice(1, -1);
      }
      flush();
      out.push({ type: "code", text: code });
      index = close + run;
      continue;
    }

    if (brackets !== null && (char === "[" || (char === "!" && next === "["))) {
      // `![words](address)` is a picture in Markdown. Pictures are not
      // loaded here, so it reads as a link to the same address.
      const open = char === "!" ? index + 1 : index;
      const link = linkAt(text, open, brackets);
      if (link !== null) {
        const label = parseInline(
          text.slice(open + 1, link.labelEnd),
          depth + 1,
          { links: false },
        );
        flush();
        out.push({
          type: "link",
          href: link.safe.href,
          kind: link.safe.kind,
          children:
            label.length > 0 ? label : [{ type: "text", text: link.safe.href }],
        });
        index = link.end;
        continue;
      }
      // Not a link we will make: the characters stay as they were typed.
      buffer += char;
      index += 1;
      continue;
    }

    if (brackets !== null && char === "<") {
      const head = text.slice(index + 1, index + 9).toLowerCase();
      if (
        head.startsWith("http://") ||
        head.startsWith("https://") ||
        head.startsWith("mailto:")
      ) {
        const close = text.slice(index + 1, index + 2 + MAX_URL).indexOf(">");
        if (close !== -1) {
          const inner = text.slice(index + 1, index + 1 + close);
          const safe = safeLink(inner);
          if (safe !== null) {
            flush();
            out.push({
              type: "link",
              href: safe.href,
              kind: safe.kind,
              children: [
                { type: "text", text: inner.replace(/^mailto:/i, "") },
              ],
            });
            index += close + 2;
            continue;
          }
        }
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (
      brackets !== null &&
      (char === "h" || char === "H") &&
      !isWordCharacter(text[index - 1]) &&
      text[index - 1] !== "/"
    ) {
      const head = text.slice(index, index + 8).toLowerCase();
      if (head.startsWith("http://") || head.startsWith("https://")) {
        const end = bareUrlEnd(text, index);
        const raw = text.slice(index, end);
        const safe = safeLink(raw);
        if (safe !== null) {
          flush();
          out.push({
            type: "link",
            href: safe.href,
            kind: safe.kind,
            children: [{ type: "text", text: raw }],
          });
          index = end;
          continue;
        }
      }
    }

    if (char === "*" || char === "_") {
      const run = runLength(text, index, char);
      const after = text[index + run];
      // To open, a run of marks needs a word hard up against it on the far
      // side. A row of underscores is a blank to fill in, and an underscore
      // inside a word (snake_case) is just an underscore.
      const opens =
        !isLiteralRun(char, run) &&
        after !== undefined &&
        !isSpace(after) &&
        !(char === "_" && isWordCharacter(text[index - 1]));
      if (!opens) {
        buffer += text.slice(index, index + run);
        index += run;
        continue;
      }

      const inner = (from: number, to: number, levels: number): Inline[] =>
        parseInline(text.slice(from, to), depth + levels, options);

      if (run === 3) {
        const close = closingRun(index + 3, char, 3);
        if (close !== -1) {
          flush();
          out.push({
            type: "em",
            children: [
              { type: "strong", children: inner(index + 3, close, 2) },
            ],
          });
          index = close + 3;
          continue;
        }
      }
      if (run >= 2) {
        const close = closingRun(index + 2, char, 2);
        if (close !== -1) {
          flush();
          out.push({ type: "strong", children: inner(index + 2, close, 1) });
          index = close + 2;
          continue;
        }
      }
      if (run === 1) {
        const close = emClose(index + 1, char);
        if (close !== -1) {
          flush();
          out.push({ type: "em", children: inner(index + 1, close, 1) });
          index = close + 1;
          continue;
        }
      }
      // Nothing closes it: the first mark is just a mark. What is left of
      // the run gets its own turn.
      buffer += char;
      index += 1;
      continue;
    }

    if (char === "~" && next === "~" && !isSpace(text[index + 2])) {
      const close = text.indexOf("~~", index + 2);
      if (
        close > index + 2 &&
        close - index < 2000 &&
        !isSpace(text[close - 1])
      ) {
        flush();
        out.push({
          type: "del",
          children: parseInline(
            text.slice(index + 2, close),
            depth + 1,
            options,
          ),
        });
        index = close + 2;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }
  flush();
  return out;
}

/* ----------------------------------------------------------------- blocks */

type Fence = {
  readonly mark: string;
  readonly length: number;
  readonly indent: number;
  readonly lang: string;
};

function fenceOf(line: string): Fence | null {
  const indent = indentOf(line);
  if (indent > 3) return null;
  const mark = line[indent];
  if (mark !== "`" && mark !== "~") return null;
  const length = runLength(line, indent, mark);
  if (length < 3) return null;
  const info = line.slice(indent + length).trim();
  // A backtick fence cannot have a backtick in its label: that is a code
  // span in a sentence, not the start of a block.
  if (mark === "`" && info.includes("`")) return null;
  const lang = (info.split(/\s+/)[0] ?? "").slice(0, 40);
  return { mark, length, indent, lang };
}

function closesFence(line: string, fence: Fence): boolean {
  const indent = indentOf(line);
  if (indent > 3 || line[indent] !== fence.mark) return false;
  const length = runLength(line, indent, fence.mark);
  return length >= fence.length && line.slice(indent + length).trim() === "";
}

function headingOf(
  line: string,
): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const indent = indentOf(line);
  if (indent > 3 || line[indent] !== "#") return null;
  const level = runLength(line, indent, "#");
  if (level > 6) return null;
  const after = line[indent + level];
  // `#hashtag` is a hashtag. A heading has a space after its marks.
  if (after !== undefined && after !== " ") return null;
  let text = line.slice(indent + level).trim();
  // Closing marks ("## Title ##") are decoration.
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end < text.length && (end === 0 || text[end - 1] === " ")) {
    text = text.slice(0, end).trim();
  }
  // A row of marks with no words is not a heading anyone meant.
  if (text === "") return null;
  return { level: level as 1 | 2 | 3 | 4 | 5 | 6, text };
}

function isRule(line: string): boolean {
  if (indentOf(line) > 3) return false;
  const marks = line.replace(/ /g, "");
  if (marks.length < 3) return false;
  const first = marks[0];
  if (first !== "-" && first !== "*" && first !== "_") return false;
  for (const mark of marks) if (mark !== first) return false;
  return true;
}

function isQuote(line: string): boolean {
  const indent = indentOf(line);
  return indent <= 3 && line[indent] === ">";
}

function stripQuote(line: string): string {
  const rest = line.slice(indentOf(line) + 1);
  return rest.startsWith(" ") ? rest.slice(1) : rest;
}

type Marker = {
  readonly indent: number;
  readonly ordered: boolean;
  readonly start: number;
  /** `-`, `*` or `+`; for a numbered item, the `.` or `)` after the number. */
  readonly mark: string;
  /** How far in the item's own words start. */
  readonly width: number;
  readonly rest: string;
};

function markerOf(line: string): Marker | null {
  const indent = indentOf(line);
  let index = indent;
  let ordered = false;
  let start = 1;
  let mark: string;

  const char = line[index];
  if (char === "-" || char === "*" || char === "+") {
    mark = char;
    index += 1;
  } else if (char !== undefined && char >= "0" && char <= "9") {
    let end = index;
    while (
      end - index < 9 &&
      (line[end] ?? "") >= "0" &&
      (line[end] ?? "") <= "9"
    ) {
      end += 1;
    }
    const after = line[end];
    if (after !== "." && after !== ")") return null;
    ordered = true;
    start = Number(line.slice(index, end));
    mark = after;
    index = end + 1;
  } else {
    return null;
  }

  // "-5" and "1.5" are numbers, not list items: a marker ends in a space.
  if (index < line.length && line[index] !== " ") return null;
  const spaces = runLength(line, index, " ");
  const empty = index + spaces >= line.length;
  const pad = empty || spaces > 4 ? 1 : spaces;
  return {
    indent,
    ordered,
    start,
    mark,
    width: index + pad,
    rest: empty ? "" : line.slice(index + pad),
  };
}

function splitRow(line: string): string[] | null {
  let text = line.trim();
  if (!text.includes("|")) return null;
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "\\" && text[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

const DIVIDER_CELL = /^:?-+:?$/;

/**
 * A table starts with a row of headings and, under it, a row of dashes with
 * the same number of cells. Returns the headings and how each column lines
 * up, or null if these two lines are not that.
 */
function tableHead(
  lines: readonly string[],
  at: number,
): { head: string[]; align: Align[] } | null {
  const head = splitRow(lines[at] ?? "");
  const divider = splitRow(lines[at + 1] ?? "");
  if (head === null || divider === null) return null;
  if (head.length !== divider.length || head.length > MAX_TABLE_COLUMNS) {
    return null;
  }
  const align: Align[] = [];
  for (const cell of divider) {
    if (!DIVIDER_CELL.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    align.push(
      left && right ? "center" : right ? "right" : left ? "left" : null,
    );
  }
  return { head, align };
}

function tableAt(
  lines: readonly string[],
  at: number,
): { block: Block; next: number } | null {
  const shape = tableHead(lines, at);
  if (shape === null) return null;
  const { head, align } = shape;

  const rows: Inline[][][] = [];
  let index = at + 2;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isBlank(line)) break;
    const cells = splitRow(line);
    if (cells === null) break;
    const row: Inline[][] = [];
    for (let column = 0; column < head.length; column += 1) {
      row.push(parseInline(cells[column] ?? ""));
    }
    rows.push(row);
    index += 1;
  }
  return {
    block: {
      type: "table",
      align,
      head: head.map((cell) => parseInline(cell)),
      rows,
    },
    next: index,
  };
}

/** Whether a line would end the paragraph above it. */
function interruptsParagraph(lines: readonly string[], at: number): boolean {
  const line = lines[at] ?? "";
  if (fenceOf(line) !== null || headingOf(line) !== null) return true;
  if (isRule(line) || isQuote(line)) return true;
  const marker = markerOf(line);
  if (marker !== null && marker.indent <= 3 && marker.rest !== "") {
    // "2019. A good year" in the middle of a paragraph is not a list.
    if (!marker.ordered || marker.start === 1) return true;
  }
  return tableHead(lines, at) !== null;
}

function parseList(
  lines: readonly string[],
  from: number,
  depth: number,
): { block: Block; next: number } {
  const first = markerOf(lines[from] ?? "");
  const items: ListItem[] = [];
  let tight = true;
  let index = from;

  const sameList = (marker: Marker | null, line: string): marker is Marker =>
    marker !== null &&
    first !== null &&
    marker.indent <= 3 &&
    marker.ordered === first.ordered &&
    marker.mark === first.mark &&
    !isRule(line);

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const marker = markerOf(line);
    if (!sameList(marker, line)) break;

    const content: string[] = [marker.rest];
    index += 1;
    let blankAfter = false;

    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (isBlank(next)) {
        let after = index;
        while (after < lines.length && isBlank(lines[after] ?? "")) after += 1;
        const following = lines[after];
        if (following !== undefined && indentOf(following) >= marker.width) {
          // More of this item after a gap.
          for (let blank = index; blank < after; blank += 1) content.push("");
          tight = false;
          index = after;
          continue;
        }
        blankAfter = true;
        break;
      }

      const indent = indentOf(next);
      if (indent >= marker.width) {
        content.push(next.slice(marker.width));
        index += 1;
        continue;
      }
      const inner = markerOf(next);
      if (inner !== null) {
        // Indented a little, but not as far as the words above it: people
        // nest a bullet under "1." with two spaces. Take it as nested.
        if (inner.indent >= marker.indent + 2) {
          content.push(next.slice(indent));
          index += 1;
          continue;
        }
        break;
      }
      if (
        fenceOf(next) !== null ||
        headingOf(next) !== null ||
        isRule(next) ||
        isQuote(next)
      ) {
        break;
      }
      // The same sentence, carried on to the next line.
      content.push(next.trim());
      index += 1;
    }

    let checked: boolean | null = null;
    const head = content[0] ?? "";
    const box = /^\[([ xX])\](?: +|$)/.exec(head);
    if (box !== null) {
      checked = box[1] !== " ";
      content[0] = head.slice(box[0].length);
    }
    items.push({ checked, children: parseBlocks(content, depth + 1) });

    if (blankAfter) {
      let after = index;
      while (after < lines.length && isBlank(lines[after] ?? "")) after += 1;
      const following = lines[after] ?? "";
      if (after < lines.length && sameList(markerOf(following), following)) {
        tight = false;
        index = after;
        continue;
      }
      break;
    }
  }

  return {
    block: {
      type: "list",
      ordered: first?.ordered ?? false,
      start: first?.start ?? 1,
      tight,
      items,
    },
    next: Math.max(index, from + 1),
  };
}

function parseBlocks(lines: readonly string[], depth: number): Block[] {
  const out: Block[] = [];
  const nest = depth < MAX_BLOCK_DEPTH;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = fenceOf(line);
    if (fence !== null) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const inner = lines[index] ?? "";
        index += 1;
        if (closesFence(inner, fence)) break;
        body.push(inner.slice(Math.min(indentOf(inner), fence.indent)));
      }
      out.push({ type: "code", lang: fence.lang, text: body.join("\n") });
      continue;
    }

    const heading = headingOf(line);
    if (heading !== null) {
      out.push({
        type: "heading",
        level: heading.level,
        children: parseInline(heading.text),
      });
      index += 1;
      continue;
    }

    if (isRule(line)) {
      out.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (nest && isQuote(line)) {
      const inner: string[] = [];
      while (index < lines.length && isQuote(lines[index] ?? "")) {
        inner.push(stripQuote(lines[index] ?? ""));
        index += 1;
      }
      out.push({ type: "quote", children: parseBlocks(inner, depth + 1) });
      continue;
    }

    const marker = markerOf(line);
    if (nest && marker !== null && marker.indent <= 3) {
      const list = parseList(lines, index, depth);
      out.push(list.block);
      index = list.next;
      continue;
    }

    const table = tableAt(lines, index);
    if (table !== null) {
      out.push(table.block);
      index = table.next;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (isBlank(next)) break;
      if (nest && interruptsParagraph(lines, index)) break;
      paragraph.push(next.trim());
      index += 1;
    }
    out.push({
      type: "paragraph",
      children: parseInline(paragraph.join("\n")),
    });
  }
  return out;
}

/** The mark some editors put at the very start of a file. Not text. */
const BYTE_ORDER_MARK = 0xfeff;

/** Read a document. Never throws: the worst case is one plain paragraph. */
export function parseMarkdown(source: string): Block[] {
  const start = source.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0;
  const text = source
    .slice(start, start + MAX_SOURCE)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ");
  try {
    return parseBlocks(text.split("\n"), 0);
  } catch {
    return text.trim() === ""
      ? []
      : [{ type: "paragraph", children: [{ type: "text", text }] }];
  }
}

/** The words of a run of inline nodes, with the formatting dropped. */
export function inlineText(nodes: readonly Inline[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "code") out += node.text;
    else if (node.type === "break") out += " ";
    else out += inlineText(node.children);
  }
  return out;
}

/**
 * Every link in a document, in reading order. Used to check that the starter
 * drafts point at pages that exist.
 */
export function listLinks(blocks: readonly Block[]): SafeLink[] {
  const found: SafeLink[] = [];
  const inInline = (nodes: readonly Inline[]): void => {
    for (const node of nodes) {
      if (node.type === "link") {
        found.push({ href: node.href, kind: node.kind });
      }
      if (
        node.type === "link" ||
        node.type === "strong" ||
        node.type === "em" ||
        node.type === "del"
      ) {
        inInline(node.children);
      }
    }
  };
  const inBlocks = (list: readonly Block[]): void => {
    for (const block of list) {
      if (block.type === "heading" || block.type === "paragraph") {
        inInline(block.children);
      } else if (block.type === "quote") {
        inBlocks(block.children);
      } else if (block.type === "list") {
        for (const item of block.items) inBlocks(item.children);
      } else if (block.type === "table") {
        for (const cell of block.head) inInline(cell);
        for (const row of block.rows) for (const cell of row) inInline(cell);
      }
    }
  };
  inBlocks(blocks);
  return found;
}
