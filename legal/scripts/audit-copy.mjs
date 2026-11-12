#!/usr/bin/env node
// copy-audit-ignore-file
/**
 * QUICK PICKLE - copy auditor.
 *
 * Scans files for language QUICK PICKLE may not lawfully publish about its product.
 * The reasoning behind every rule is in legal/COPY-RULES.md; the rule IDs match.
 *
 *   node legal/scripts/audit-copy.mjs <path> [<path>...]
 *   node legal/scripts/audit-copy.mjs --list
 *   node legal/scripts/audit-copy.mjs --json app/ content/
 *
 * Exit codes:  0 clean   1 findings   2 usage/IO error
 *
 * No dependencies. Node >= 16.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, extname, sep, dirname } from "node:path";

import {
  BANNED,
  CONSUMER_ONLY,
  EVERY_SURFACE,
  RESTRICTED,
  RULES,
  TERMS_OF_ART,
  termSpansFor,
} from "./rules.mjs";

/* --------------------------------------------------------------- surfaces */

/**
 * SURFACES — where a piece of text is published, and therefore which law reaches it.
 * The long-form reasoning is legal/COPY-RULES.md §8A; keep the two in step.
 *
 *   consumer  a representation made in trade to a customer. Everything applies.
 *   internal  password-gated business tooling, libraries and tests. Not advertising,
 *             so the rules that regulate how an offer, a price, a right, a provenance
 *             story or a process is PRESENTED TO A CUSTOMER do not reach it.
 *
 * Every rule declares which of the two it belongs to:
 *
 *   EVERY_SURFACE   the matched phrase is a claim about what the product IS or DOES —
 *                   health, therapeutic, hydration/sport, nutrition-content,
 *                   certification, absolute-composition. Lifted verbatim out of an
 *                   admin screen into a caption it is a regulated claim on arrival,
 *                   so it is caught wherever it is written.
 *   CONSUMER_ONLY   the rule judges a representation in its selling context —
 *                   superiority, price, guarantees, endorsement, provenance, process
 *                   descriptors. A private dashboard has no selling context, so the
 *                   rule has nothing to bite on there.
 */

const CONSUMER = "consumer";
const INTERNAL = "internal";

const SURFACES = {
  [CONSUMER]: {
    id: CONSUMER,
    blurb: "published to customers — a representation in trade",
    enforces: new Set([EVERY_SURFACE, CONSUMER_ONLY]),
  },
  [INTERNAL]: {
    id: INTERNAL,
    blurb: "private business tooling — not advertising",
    enforces: new Set([EVERY_SURFACE]),
  },
};

/**
 * SURFACE_MAP — the classification itself, as data. Longest matching prefix wins,
 * so a narrower path can correct a broader one without touching the scanner.
 * Paths are repository-relative and use forward slashes.
 *
 * Anything unlisted defaults to CONSUMER. That is deliberate: a new directory is
 * policed strictly until somebody decides, in writing, that it is not advertising.
 */
const DEFAULT_SURFACE = CONSUMER;

const SURFACE_MAP = [
  { prefix: "app/", surface: CONSUMER, note: "public pages" },
  {
    prefix: "app/backstage/",
    surface: INTERNAL,
    note: "the back end: brand guide and go-live list",
  },
  { prefix: "components/", surface: CONSUMER, note: "storefront components" },
  {
    prefix: "components/backstage/",
    surface: INTERNAL,
    note: "back-end components",
  },
  { prefix: "content/", surface: CONSUMER, note: "the copy library itself" },
  {
    prefix: "content/brand-guide.ts",
    surface: INTERNAL,
    note: "the brand guide, shown only in the back end",
  },
  { prefix: "public/", surface: CONSUMER, note: "served verbatim to browsers" },
  { prefix: "lib/", surface: INTERNAL, note: "libraries and adapters" },
  { prefix: "scripts/", surface: INTERNAL, note: "build tooling" },
  { prefix: "tests/", surface: INTERNAL, note: "unit tests" },
  { prefix: "e2e/", surface: INTERNAL, note: "end-to-end tests" },
  {
    prefix: "legal/scripts/",
    surface: INTERNAL,
    note: "this scanner and its self-test",
  },
  // Fixtures for the self-test. They exist to prove both branches of the model,
  // so they are classified here rather than inheriting legal/'s default.
  {
    prefix: "legal/test-fixtures/consumer/",
    surface: CONSUMER,
    note: "fixture: consumer surface",
  },
  {
    prefix: "legal/test-fixtures/internal/",
    surface: INTERNAL,
    note: "fixture: internal surface",
  },
];

/** Classify a repository-relative path. Longest matching prefix wins. */
function classify(relPath) {
  let best = null;
  for (const entry of SURFACE_MAP) {
    if (!relPath.startsWith(entry.prefix)) continue;
    if (!best || entry.prefix.length > best.prefix.length) best = entry;
  }
  if (best)
    return { surface: best.surface, note: best.note, prefix: best.prefix };
  return {
    surface: DEFAULT_SURFACE,
    note: "unclassified — defaults to the strict consumer rule set",
    prefix: null,
  };
}

function surfaceOf(file) {
  const rel = relative(REPO_ROOT, resolve(file)).split(sep).join("/");
  return classify(rel);
}

/* --------------------------------------------------------------- scanning */

const SCAN_EXT = new Set([
  ".md",
  ".mdx",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".csv",
  ".tsv",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".svelte",
  ".vue",
  ".astro",
  ".svg",
  ".xml",
  ".rss",
]);

/** Source-code extensions. These are PARSED, not pattern-matched: only string
 *  literals, template-literal text and JSX text are scanned. Identifiers,
 *  property keys, import paths and comments are not text addressed to anyone —
 *  a shader uniform called `absorption`, a SHA `digest`, a reduce accumulator
 *  called `best`. Flagging those trains people to ignore the scanner, which is
 *  the real failure mode. */
const AST_EXT = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

/** Single-file component formats. No parser for these is in the dependency tree,
 *  so they fall back to the lexical mask (comments blanked, identifier-shaped
 *  matches skipped) rather than being scanned raw. */
const LEXICAL_EXT = new Set([".svelte", ".vue", ".astro"]);

/** Structured-data files: object KEYS are identifiers, string VALUES are text. */
const JSON_EXT = new Set([".json", ".jsonc"]);

/** Markdown: prose is scanned, fenced code blocks are not. */
const MARKDOWN_EXT = new Set([".md", ".mdx", ".markdown"]);

/** The character every non-scannable byte is replaced with. Not whitespace and
 *  not a word character, so it breaks both `\s+` and `\b` — a rule can never
 *  match across the gap where code used to be. Newlines are always preserved so
 *  file:line:column stays exact. */
const MASK = "\u0001";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".cache",
  ".vercel",
  ".netlify",
  "dist",
  "build",
  "out",
  "coverage",
  "test-results",
  "playwright-report",
  ".pnpm-store",
  "vendor",
  ".venv",
  "__pycache__",
]);

const IGNORE_FILE = "copy-audit-ignore-file";
const IGNORE_START = "copy-audit-ignore-start";
const IGNORE_END = "copy-audit-ignore-end";
const IGNORE_LINE = "copy-audit-ignore";
const APPROVE_RE = /copy-audit-approved:\s*([A-Za-z0-9_\-,\s]+)/i;
const NUL = String.fromCharCode(0);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const EXEMPT_FILE = join(HERE, "..", "copy-audit-exempt.json");

/**
 * Registered exemptions for META-DOCUMENTS: files whose job is to enumerate the
 * forbidden words (this ruleset, the brand guide's prohibition lists, the test
 * fixtures). Scanning those with the marketing ruleset produces noise that
 * trains people to ignore the scanner, which is the real failure mode.
 * Registered in legal/copy-audit-exempt.json so every exemption has a written
 * reason and a review date. `--no-exemptions` ignores the registry.
 */
function loadExemptions() {
  try {
    const raw = JSON.parse(readFileSync(EXEMPT_FILE, "utf8"));
    return Array.isArray(raw.exemptions) ? raw.exemptions : [];
  } catch {
    return [];
  }
}

function exemptionFor(file, exemptions) {
  const rel = relative(REPO_ROOT, resolve(file)).split(sep).join("/");
  return exemptions.find((e) => e.path === rel) || null;
}

function isLegalPath(p) {
  return resolve(p).split(sep).includes("legal");
}

function walk(target, opts, acc) {
  let st;
  try {
    st = statSync(target);
  } catch (e) {
    throw new Error(`cannot read ${target}: ${e.message}`);
  }
  if (st.isFile()) {
    acc.push(target);
    return acc;
  }
  if (!st.isDirectory()) return acc;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = join(target, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (!opts.includeLegal && isLegalPath(full)) continue;
      walk(full, opts, acc);
    } else if (entry.isFile()) {
      if (!SCAN_EXT.has(extname(entry.name).toLowerCase())) continue;
      if (!opts.includeLegal && isLegalPath(full)) continue;
      acc.push(full);
    }
  }
  return acc;
}

function approvedIds(line) {
  if (!line) return null;
  const m = line.match(APPROVE_RE);
  if (!m) return null;
  const ids = m[1]
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

/** Nearest preceding non-blank line — markdown formatters insert blank lines
 *  between an HTML-comment marker and the text it governs. */
function precedingSignificantLine(lines, i) {
  for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
    if (lines[j].trim() !== "") return lines[j];
  }
  return "";
}

/** Lines suppressed because they sit under an exempted markdown heading. */
function headingExemptedLines(lines, headings) {
  const skip = new Set();
  if (!headings || headings.length === 0) return skip;
  const wanted = headings.map((h) => h.toLowerCase());
  let activeLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const level = m[1].length;
      const text = m[2]
        .replace(/[*_`#]/g, "")
        .trim()
        .toLowerCase();
      if (activeLevel && level <= activeLevel) activeLevel = 0;
      if (!activeLevel && wanted.some((w) => text.includes(w))) {
        activeLevel = level;
        skip.add(i);
        continue;
      }
    }
    if (activeLevel) skip.add(i);
  }
  return skip;
}

/* ---------------------------------------------------- text extraction */

/**
 * Everything below turns a file into a MASK: a string the same length as the
 * original, in which every character that is not text-addressed-to-a-reader has
 * been replaced by MASK, and every newline preserved. Rules run against the mask,
 * so file:line:column stays exact and no rule can match through the gap where
 * code used to be.
 *
 * What counts as text:
 *   .ts .tsx .js .jsx .mjs .cjs   string literals, template-literal text, JSX text
 *   .json .jsonc                  string VALUES (keys are identifiers)
 *   .md .mdx .markdown            prose (fenced code blocks are code)
 *   everything else               the whole file
 */

function blankRun(n) {
  return MASK.repeat(n);
}

/** Build the mask from a keep-map: 1 = scan this character, 0 = blank it. */
function applyKeep(text, keep) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || c === "\r") out += c;
    else out += keep[i] ? c : MASK;
  }
  return out;
}

/* -- JavaScript / TypeScript, parsed ---------------------------------- */

let tsModule; // resolved once, lazily
let tsLoadAttempted = false;
let tsWarned = false;

async function loadTypeScript() {
  if (tsLoadAttempted) return tsModule;
  tsLoadAttempted = true;
  try {
    const mod = await import("typescript");
    tsModule = mod.default ?? mod;
  } catch {
    tsModule = null;
  }
  return tsModule;
}

/** A string literal that is a NAME, a PATH or a KEY is an identifier, not copy. */
function isIdentifierPosition(ts, node) {
  const p = node.parent;
  if (!p) return false;

  // import "x" / from "x" / export ... from "x" / import("x") / require("x")
  if (p.moduleSpecifier === node) return true;
  if (ts.isExternalModuleReference(p)) return true;
  if (ts.isImportTypeNode(p) && p.argument === node) return true;
  if (ts.isLiteralTypeNode(p) && p.parent && ts.isImportTypeNode(p.parent))
    return true;
  if (
    ts.isCallExpression(p) &&
    p.arguments[0] === node &&
    (p.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(p.expression) && p.expression.escapedText === "require"))
  ) {
    return true;
  }

  // { "a-key": value }, interface { "a-key": T }, enum { "A" = 1 }, class members
  if (p.name === node) {
    if (
      ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isImportSpecifier(p) ||
      ts.isExportSpecifier(p) ||
      ts.isImportAttribute?.(p)
    ) {
      return true;
    }
  }
  if (
    (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) &&
    p.propertyName === node
  ) {
    return true;
  }

  // obj["a-key"]
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node)
    return true;

  return false;
}

/**
 * Mark the inside of a quoted or templated literal, working out the delimiters
 * from the characters themselves so template heads (`` `x${ ``), middles
 * (`` }x${ ``) and tails (`` }x` ``) all land correctly.
 */
function markLiteralInterior(text, keep, start, end) {
  const raw = text.slice(start, end);
  let s = start;
  let e = end;
  if (/^["'`}]/.test(raw)) s += 1;
  if (/\$\{$/.test(raw)) e -= 2;
  else if (/["'`]$/.test(raw) && e - 1 >= s) e -= 1;
  for (let i = s; i < e && i < text.length; i++) keep[i] = 1;
}

function maskWithTypeScript(ts, file, text) {
  const ext = extname(file).toLowerCase();
  const kind =
    ext === ".tsx"
      ? ts.ScriptKind.TSX
      : ext === ".ts" || ext === ".mts" || ext === ".cts"
        ? ts.ScriptKind.TS
        : ext === ".jsx"
          ? ts.ScriptKind.JSX
          : ts.ScriptKind.JS;

  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const keep = new Uint8Array(text.length);

  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
        if (!isIdentifierPosition(ts, node)) {
          markLiteralInterior(text, keep, node.getStart(sf), node.getEnd());
        }
        break;
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        markLiteralInterior(text, keep, node.getStart(sf), node.getEnd());
        break;
      case ts.SyntaxKind.JsxText:
        for (let i = node.getStart(sf); i < node.getEnd(); i++) keep[i] = 1;
        break;
      default:
        break;
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);

  return applyKeep(text, keep);
}

/* -- lexical fallback (no parser available, and .svelte/.vue/.astro) --- */

/** Blank out comment text in a code line, preserving column positions so
 *  file:line:column stays accurate. Returns [maskedLine, nextBlockState]. */
function maskComments(line, inBlock) {
  let out = "";
  let i = 0;
  let block = inBlock;
  let quote = null;
  while (i < line.length) {
    const two = line.slice(i, i + 2);
    if (block) {
      if (two === "*/") {
        block = false;
        out += blankRun(2);
        i += 2;
        continue;
      }
      out += MASK;
      i += 1;
      continue;
    }
    if (quote) {
      out += line[i];
      if (line[i] === "\\") {
        out += line[i + 1] === undefined ? "" : line[i + 1];
        i += 2;
        continue;
      }
      if (line[i] === quote) quote = null;
      i += 1;
      continue;
    }
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      quote = line[i];
      out += line[i];
      i += 1;
      continue;
    }
    if (two === "//") {
      out += blankRun(line.length - i);
      break;
    }
    if (two === "/*") {
      block = true;
      out += blankRun(2);
      i += 2;
      continue;
    }
    out += line[i];
    i += 1;
  }
  if (out.length < line.length) out += blankRun(line.length - out.length);
  return [out, block];
}

/** Identifier-shaped matches in the lexical fallback: `params.absorption`,
 *  `absorption: number`, `--best-practice`, `foo_recovery`. */
function looksLikeIdentifier(line, index, match) {
  const before = index > 0 ? line[index - 1] : "";
  const after = line[index + match.length] || "";
  if (before === "." || before === "_" || before === "$" || before === "#")
    return true;
  if (after === ":" || after === "_" || after === "(" || after === "=")
    return true;
  return false;
}

function maskLexically(text) {
  const lines = text.split("\n");
  let block = false;
  const out = [];
  for (const line of lines) {
    const carriage = line.endsWith("\r");
    const body = carriage ? line.slice(0, -1) : line;
    const [masked, next] = maskComments(body, block);
    block = next;
    out.push(carriage ? masked + "\r" : masked);
  }
  return out.join("\n");
}

/* -- JSON -------------------------------------------------------------- */

/** Keep string VALUES, blank keys, punctuation, numbers and literals. */
function maskJson(text) {
  const keep = new Uint8Array(text.length);
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c !== '"') {
      i += 1;
      continue;
    }
    const start = i;
    i += 1;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i] === '"') break;
      i += 1;
    }
    const end = Math.min(i, text.length); // index of the closing quote
    let j = end + 1;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    const isKey = text[j] === ":";
    if (!isKey) for (let k = start + 1; k < end; k++) keep[k] = 1;
    i = end + 1;
  }
  return applyKeep(text, keep);
}

/* -- Markdown ---------------------------------------------------------- */

/** Keep prose, blank fenced code blocks. A fenced block is a code sample, not
 *  copy — and this file's own ``` examples are the proof. */
function maskMarkdown(text) {
  const keep = new Uint8Array(text.length).fill(1);
  const lines = text.split("\n");
  let offset = 0;
  let fence = null;
  for (const line of lines) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence === null && m) {
      fence = m[1][0];
      for (let k = 0; k < line.length; k++) keep[offset + k] = 0;
    } else if (fence !== null) {
      for (let k = 0; k < line.length; k++) keep[offset + k] = 0;
      if (m && m[1][0] === fence) fence = null;
    }
    offset += line.length + 1;
  }
  return applyKeep(text, keep);
}

/* -- the dispatcher ---------------------------------------------------- */

/** Returns { masked, mode } for a file. `mode` is reported so a reader can see
 *  how a file was read. */
function maskFor(file, text, ts) {
  const ext = extname(file).toLowerCase();
  if (AST_EXT.has(ext)) {
    if (ts) {
      try {
        return { masked: maskWithTypeScript(ts, file, text), mode: "parsed" };
      } catch {
        return { masked: maskLexically(text), mode: "lexical (parse failed)" };
      }
    }
    if (!tsWarned) {
      tsWarned = true;
      process.stderr.write(
        "warn: typescript is not installed, so .ts/.tsx/.js files are read with the\n" +
          "      lexical fallback instead of being parsed. Run `npm ci` for exact results.\n",
      );
    }
    return { masked: maskLexically(text), mode: "lexical (no parser)" };
  }
  if (LEXICAL_EXT.has(ext))
    return { masked: maskLexically(text), mode: "lexical" };
  if (JSON_EXT.has(ext)) return { masked: maskJson(text), mode: "json values" };
  if (MARKDOWN_EXT.has(ext))
    return { masked: maskMarkdown(text), mode: "markdown prose" };
  return { masked: text, mode: "verbatim" };
}

/* --------------------------------------------------------------- scanning */

/** Byte offset -> 1-based line/column, via the original text's line starts. */
function makeLocator(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: index - starts[lo] + 1 };
  };
}

/**
 * Marker pre-pass over the ORIGINAL lines. Markers live in comments, which the
 * mask blanks out, so they are always read from the raw text.
 */
function markerPass(lines, ex) {
  const suppressed = new Set();
  const approvals = new Map();

  const headingSkip =
    ex && ex.sections ? headingExemptedLines(lines, ex.sections) : new Set();
  const literalSkips = (ex && ex.linePatterns) || [];

  let inIgnoreBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.includes(IGNORE_START)) {
      inIgnoreBlock = true;
      suppressed.add(i);
      continue;
    }
    if (raw.includes(IGNORE_END)) {
      inIgnoreBlock = false;
      suppressed.add(i);
      continue;
    }
    if (
      inIgnoreBlock ||
      headingSkip.has(i) ||
      literalSkips.some((p) => raw.includes(p))
    ) {
      suppressed.add(i);
      continue;
    }

    const prev = precedingSignificantLine(lines, i);
    const marked = (s) =>
      s.includes(IGNORE_LINE) &&
      !s.includes(IGNORE_FILE) &&
      !APPROVE_RE.test(s);
    if (marked(raw) || marked(prev)) {
      suppressed.add(i);
      continue;
    }

    const ids = approvedIds(raw) || approvedIds(prev);
    if (ids) approvals.set(i, ids);
  }
  return { suppressed, approvals };
}

/**
 * @returns {{skipped: boolean, reason?: string, surface?: string, mode?: string}}
 */
function scanFile(file, out, exemptions, opts, ts) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { skipped: false };
  }
  if (text.indexOf(NUL) !== -1) return { skipped: false }; // binary

  const ex = opts.noExemptions ? null : exemptionFor(file, exemptions);
  if (ex && (ex.scope === "file" || !ex.scope))
    return { skipped: true, reason: ex.reason };

  const lines = text.split(/\r?\n/);
  if (lines.slice(0, 20).some((l) => l.includes(IGNORE_FILE)))
    return { skipped: true, reason: "copy-audit-ignore-file marker" };

  const place = surfaceOf(file);
  const surface = SURFACES[place.surface];
  const { masked, mode } = maskFor(file, text, ts);
  const locate = makeLocator(text);
  const { suppressed, approvals } = markerPass(lines, ex);
  const termCache = new Map();

  // Only the lexical fallback needs the identifier heuristic. A parsed file has
  // already had its identifiers removed, and guessing at them again there would
  // start hiding real copy that happens to sit next to a colon or a bracket.
  const lexical = mode.startsWith("lexical");
  const maskedLines = lexical ? masked.split(/\r?\n/) : null;

  for (const rule of RULES) {
    const enforced = surface.enforces.has(rule.applies);
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(masked)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      const { line, column } = locate(m.index);
      const i = line - 1;
      if (suppressed.has(i)) continue;
      if (
        lexical &&
        looksLikeIdentifier(maskedLines[i] ?? "", column - 1, m[0])
      )
        continue;

      const finding = {
        file,
        line,
        column,
        match: m[0],
        id: rule.id,
        severity: rule.severity,
        applies: rule.applies,
        surface: place.surface,
        surfaceNote: place.note,
        why: rule.why,
        source: rule.src,
        excerpt: (lines[i] || "").trim().slice(0, 160),
      };

      // 1. the rule does not reach this surface
      if (!enforced) {
        out.suppressed.push({
          ...finding,
          suppressedBy: "surface",
          suppressedWhy: `${rule.id} regulates a representation made to a consumer; ${place.note} is not advertising`,
        });
        continue;
      }
      // 2. the match is a fixed term of art, not the claim the rule catches
      const span = termSpansFor(rule.id, masked, termCache).find(
        (s) => m.index < s.end && m.index + m[0].length > s.start,
      );
      if (span) {
        out.suppressed.push({
          ...finding,
          suppressedBy: "term-of-art",
          suppressedWhy: `${span.term.id}: ${span.term.why}`,
        });
        continue;
      }
      // 3. a human has recorded that the condition was checked (RESTRICTED only)
      const approved = approvals.get(i);
      if (rule.severity === RESTRICTED && approved && approved.has(rule.id)) {
        out.suppressed.push({
          ...finding,
          suppressedBy: "approved",
          suppressedWhy: `copy-audit-approved: ${rule.id}`,
        });
        continue;
      }

      out.findings.push(finding);
    }
  }
  return { skipped: false, surface: place.surface, mode };
}
/* ------------------------------------------------------------------- main */

const USAGE = `QUICK PICKLE copy auditor

  node legal/scripts/audit-copy.mjs <path> [<path>...]   scan files or directories
  node legal/scripts/audit-copy.mjs --list               print every rule
  node legal/scripts/audit-copy.mjs --surfaces           print the surface model
  node legal/scripts/audit-copy.mjs --json <path>        machine-readable findings

Options
  --json             emit JSON instead of human-readable text
  --include-legal    also scan files under legal/ (excluded by default)
  --no-exemptions    ignore legal/copy-audit-exempt.json (see everything)
  --show-suppressed  list what was NOT raised, and why
  --quiet            print only the summary line

Surfaces
  Consumer surfaces are representations made in trade to customers and get the
  full rule set. Internal surfaces — the admin, libraries, tests — are not
  advertising, so rules about superiority, price, guarantees, provenance and
  process do not reach them. Rules about what the product IS or DOES (health,
  therapeutic, hydration, nutrition content, certification) apply everywhere,
  because such a sentence is a regulated claim the moment anything lifts it into
  a caption. --surfaces prints the classification; COPY-RULES.md §8A is the
  authority for it.

Text, not code
  .ts/.tsx/.js/.jsx/.mjs/.cjs are parsed: only string literals, template text and
  JSX text are scanned. Identifiers, property keys, import paths and comments are
  not. JSON keys are skipped and JSON string values scanned. Markdown prose is
  scanned; fenced code blocks are not.

Inline markers
  copy-audit-ignore-file            skip the whole file (must appear in the first 20 lines)
  copy-audit-ignore-start / -end    skip everything between the two markers
  copy-audit-ignore                 skip this line (or the line immediately below it)
  copy-audit-approved: <RULE-ID>    clear a RESTRICTED finding on this line (or the line below)

Meta-documents that must enumerate the banned words (this ruleset, the brand
guide's prohibition lists, the test fixtures) are registered with a written
reason in legal/copy-audit-exempt.json.

Exit: 0 clean, 1 findings, 2 usage error.
Rules and reasoning: legal/COPY-RULES.md
`;

function list() {
  for (const rule of RULES) {
    const where =
      rule.applies === EVERY_SURFACE
        ? "every surface (consumer + internal)"
        : "consumer surfaces only";
    process.stdout.write(
      `${rule.id}\t${rule.severity.toUpperCase()}\n` +
        `\tapplies: ${where}\n` +
        `\tregex:  ${rule.re.source}\n` +
        `\twhy:    ${rule.why}\n` +
        `\tsource: ${rule.src}\n\n`,
    );
  }
  const banned = RULES.filter((x) => x.severity === BANNED).length;
  const every = RULES.filter((x) => x.applies === EVERY_SURFACE).length;
  process.stdout.write(
    `${RULES.length} rules (${banned} banned, ${RULES.length - banned} restricted; ` +
      `${every} every-surface, ${RULES.length - every} consumer-only).\n`,
  );
  return 0;
}

function listSurfaces() {
  process.stdout.write("Surface model — legal/COPY-RULES.md §8A\n\n");
  for (const id of [CONSUMER, INTERNAL]) {
    const s = SURFACES[id];
    const rules = RULES.filter((r2) => s.enforces.has(r2.applies));
    process.stdout.write(
      `${id.toUpperCase()}  ${s.blurb}\n` +
        `  enforces ${rules.length} of ${RULES.length} rules: ${[...s.enforces].join(", ")}\n`,
    );
    for (const e of SURFACE_MAP.filter((x) => x.surface === id)) {
      process.stdout.write(`    ${e.prefix.padEnd(34)} ${e.note}\n`);
    }
    process.stdout.write("\n");
  }
  process.stdout.write(
    `Anything unlisted is treated as ${DEFAULT_SURFACE.toUpperCase()} — a new directory is\n` +
      "policed strictly until somebody decides, in writing, that it is not advertising.\n\n" +
      "Terms of art (a fixed phrase excused for a named rule, never a bare word):\n",
  );
  for (const t of TERMS_OF_ART) {
    process.stdout.write(
      `  ${t.id.padEnd(26)} ${t.rules.join(", ")}  ${t.why}\n`,
    );
  }
  return 0;
}

async function main(argv) {
  const opts = {
    json: false,
    includeLegal: false,
    quiet: false,
    noExemptions: false,
    showSuppressed: false,
  };
  const paths = [];
  for (const a of argv) {
    if (a === "--json") opts.json = true;
    else if (a === "--include-legal") opts.includeLegal = true;
    else if (a === "--no-exemptions") opts.noExemptions = true;
    else if (a === "--show-suppressed") opts.showSuppressed = true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--list") return list();
    else if (a === "--surfaces") return listSurfaces();
    else if (a === "-h" || a === "--help") {
      process.stdout.write(USAGE);
      return 0;
    } else if (a.startsWith("-")) {
      process.stderr.write(`unknown option: ${a}\n`);
      process.stdout.write(USAGE);
      return 2;
    } else paths.push(a);
  }
  if (paths.length === 0) {
    process.stdout.write(USAGE);
    return 2;
  }

  let files = [];
  try {
    for (const p of paths) walk(resolve(p), opts, files);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    return 2;
  }
  files = [...new Set(files)].sort();

  const ts = await loadTypeScript();
  const exemptions = loadExemptions();
  const out = { findings: [], suppressed: [] };
  const exempted = [];
  const scannedBySurface = { [CONSUMER]: 0, [INTERNAL]: 0 };
  for (const f of files) {
    const res = scanFile(f, out, exemptions, opts, ts);
    if (res && res.skipped) exempted.push({ file: f, reason: res.reason });
    else if (res && res.surface) scannedBySurface[res.surface] += 1;
  }

  // Rules are evaluated one at a time over the whole file, so report in reading
  // order rather than rule order — a reader fixes a file top to bottom.
  const inReadingOrder = (a, b) =>
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.column - b.column ||
    a.id.localeCompare(b.id);
  out.findings.sort(inReadingOrder);
  out.suppressed.sort(inReadingOrder);

  const { findings, suppressed } = out;
  const banned = findings.filter((f) => f.severity === BANNED).length;
  const restricted = findings.length - banned;
  const bySurface = (id) => findings.filter((f) => f.surface === id).length;
  const bySuppressor = (k) =>
    suppressed.filter((f) => f.suppressedBy === k).length;
  const cwd = process.cwd();
  const rel = (f) => relative(cwd, f);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: findings.length === 0,
          filesScanned: files.length,
          filesExempted: exempted.length,
          filesBySurface: scannedBySurface,
          banned,
          restricted,
          findingsBySurface: {
            consumer: bySurface(CONSUMER),
            internal: bySurface(INTERNAL),
          },
          notRaised: {
            surface: bySuppressor("surface"),
            termOfArt: bySuppressor("term-of-art"),
            approved: bySuppressor("approved"),
          },
          exempted: exempted.map((e) => ({
            file: rel(e.file),
            reason: e.reason,
          })),
          findings: findings.map((f) => ({ ...f, file: rel(f.file) })),
          suppressed: opts.showSuppressed
            ? suppressed.map((f) => ({ ...f, file: rel(f.file) }))
            : undefined,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    if (!opts.quiet) {
      for (const f of findings) {
        const tag = f.severity === BANNED ? "BANNED    " : "RESTRICTED";
        const reach =
          f.applies === EVERY_SURFACE
            ? "enforced on every surface — a claim about what the product is or does"
            : "enforced here because this is a representation made to a consumer";
        process.stdout.write(
          `${rel(f.file)}:${f.line}:${f.column}  ${tag}  [${f.id}]  "${f.match}"\n` +
            `    surface: ${f.surface} (${f.surfaceNote})\n` +
            `    applies: ${reach}\n` +
            `    ${f.why}\n` +
            `    source:  ${f.source}\n` +
            `    line:    ${f.excerpt}\n\n`,
        );
      }
      if (opts.showSuppressed && suppressed.length) {
        process.stdout.write("Not raised\n");
        for (const f of suppressed) {
          process.stdout.write(
            `  ${rel(f.file)}:${f.line}:${f.column}  [${f.id}]  "${f.match}"  ` +
              `${f.suppressedBy}: ${f.suppressedWhy}\n`,
          );
        }
        process.stdout.write("\n");
      }
    }
    const verdict = findings.length === 0 ? "PASS" : "FAIL";
    process.stdout.write(
      `${verdict}  ${files.length} file(s) scanned ` +
        `(${scannedBySurface[CONSUMER]} consumer, ${scannedBySurface[INTERNAL]} internal), ` +
        `${exempted.length} exempted, ${findings.length} finding(s) ` +
        `(${banned} banned, ${restricted} restricted) — ` +
        `${bySurface(CONSUMER)} on consumer surfaces, ${bySurface(INTERNAL)} internal.\n`,
    );
    if (suppressed.length) {
      process.stdout.write(
        `      not raised: ${bySuppressor("surface")} consumer-only rule hit(s) on internal ` +
          `surfaces, ${bySuppressor("term-of-art")} term(s) of art, ` +
          `${bySuppressor("approved")} human-approved` +
          `${opts.showSuppressed ? "" : "  (--show-suppressed to list)"}\n`,
      );
    }
    if (findings.length) {
      process.stdout.write(
        "See legal/COPY-RULES.md. Restricted findings can be cleared with an inline\n" +
          "copy-audit-approved:<RULE-ID> marker once the condition has actually been checked.\n",
      );
    }
  }
  return findings.length ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
