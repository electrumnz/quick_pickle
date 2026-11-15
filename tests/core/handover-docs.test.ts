import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { STARTER_DOCS_DIR } from "@/lib/backstage/plans/starter/export";
import { STARTER_HOW_TOS } from "@/lib/backstage/plans/starter/how-tos";
import { STARTER_QUESTIONS } from "@/lib/backstage/plans/starter/questions";

/**
 * The documents a new owner is handed: HANDOVER.md, the accounts guide, the
 * to-do list and the two indexes.
 *
 * They are written by hand, so nothing stops them going stale but this. It
 * holds three things: a link in one of them leads to a file that is there,
 * the handover names every how-to sheet the back end starts with, and none
 * of them carries anything shaped like a key. The accounts guide promises
 * that it only names things.
 *
 * docs/starter has its own test (tests/backstage/starter-docs.test.ts).
 */

const ROOT = process.cwd();
const DOCUMENTS = [
  "README.md",
  "HANDOVER.md",
  "TODO.md",
  "docs/README.md",
  "docs/ACCOUNTS.md",
] as const;

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Where every Markdown link in a document points. */
function linksIn(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]!);
}

const leavesTheRepository = (link: string) => /^(https?:|mailto:|#)/.test(link);

/** What a secret from each provider this project uses looks like. */
const KEY_SHAPES: readonly (readonly [string, RegExp])[] = [
  ["a Stripe key", /\b[sprk]{2}_(test|live)_[A-Za-z0-9]{8,}/],
  ["a webhook signing secret", /\bwhsec_[A-Za-z0-9+/=]{8,}/],
  ["a Supabase access token", /\bsbp_[A-Za-z0-9]{16,}/],
  ["a Resend key", /\bre_[A-Za-z0-9]{12,}_[A-Za-z0-9]{8,}/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["a signed token", /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  [
    "a database address with its password",
    /postgres(ql)?:\/\/[^\s:/]+:[^\s@]+@/,
  ],
];

describe("the handover documents", () => {
  it.each(DOCUMENTS)("%s is there", (file) => {
    expect(existsSync(join(ROOT, file))).toBe(true);
  });

  it.each(DOCUMENTS)("%s links only to files that are there", (file) => {
    const from = dirname(join(ROOT, file));
    const dead = linksIn(read(file))
      .filter((link) => !leavesTheRepository(link))
      .map((link) => link.split("#")[0] ?? "")
      .filter((link) => link !== "" && !existsSync(resolve(from, link)));
    expect(dead).toEqual([]);
  });

  it.each(DOCUMENTS)("%s carries nothing shaped like a key", (file) => {
    const text = read(file);
    const found = KEY_SHAPES.filter(([, shape]) => shape.test(text)).map(
      ([name]) => name,
    );
    expect(found).toEqual([]);
  });

  it("can tell a key when it sees one", () => {
    // Made up here, in pieces, so this file does not trip the check itself
    // or anybody else's scanner.
    const samples = [
      ["sk", "test", "4eC39HqLyjWDarjtT1zdp7dc"].join("_"),
      ["whsec", "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"].join("_"),
      ["sbp", "0123456789abcdef0123456789abcdef"].join("_"),
      `postgres://${"qp_app"}:${"not-a-real-password"}@db.example.co.nz:5432/x`,
    ];
    for (const sample of samples) {
      expect(
        KEY_SHAPES.some(([, shape]) => shape.test(`as in ${sample} here`)),
        sample.slice(0, 8),
      ).toBe(true);
    }
  });

  it("the handover names every how-to sheet", () => {
    const handover = read("HANDOVER.md");
    const missing = STARTER_HOW_TOS.map(
      (sheet) => `${STARTER_DOCS_DIR}/how-to/${sheet.slug}.md`,
    ).filter((file) => !handover.includes(`](${file})`));
    expect(missing).toEqual([]);
  });

  it("the handover says how many questions there are", () => {
    expect(read("HANDOVER.md")).toContain(
      `${String(STARTER_QUESTIONS.length)} questions`,
    );
  });

  it("the handover and the accounts guide say what they are for at the top", () => {
    expect(read("HANDOVER.md").split("\n")[0]).toBe(
      "# Quick Pickle: the handover",
    );
    expect(read("docs/ACCOUNTS.md")).toContain(
      "Nothing in this file is a password or a key.",
    );
  });
});
