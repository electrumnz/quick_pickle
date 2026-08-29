#!/usr/bin/env node
// copy-audit-ignore-file
/**
 * Self-test for audit-copy.mjs. Run from the repo root:
 *
 *   node legal/scripts/test-audit.mjs
 *
 * Asserts:
 *   1. the dirty fixture produces findings and exits 1
 *   2. the dirty fixture trips a named set of high-risk rules
 *   3. the clean fixture produces no findings and exits 0
 *   4. an inline copy-audit-approved marker clears a restricted finding
 *   5. a banned finding is NOT clearable by an approval marker
 *   6. bad usage exits 2
 *   7. the culinary sense of "cure" passes and the therapeutic sense fails
 *   8. block markers and the exemption registry work
 *   9. SCOPE — the surface model, the parse and the FTA-04 terms of art:
 *      identifiers and internal admin labels do not fire; "Best before" (the
 *      Standard 1.2.5 date mark) does not fire; and a genuine superiority claim
 *      and a genuine health claim still do, on consumer AND internal surfaces.
 *
 * Exit: 0 all assertions pass, 1 otherwise.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(here, "audit-copy.mjs");
const FIXTURES = join(here, "..", "test-fixtures");

let failures = 0;
function check(name, cond, detail) {
  process.stdout.write(`${cond ? "ok  " : "FAIL"}  ${name}\n`);
  if (!cond) {
    failures++;
    if (detail) process.stdout.write(`      ${detail}\n`);
  }
}

function run(args) {
  const p = spawnSync(process.execPath, [AUDIT, ...args], { encoding: "utf8" });
  return { code: p.status, out: p.stdout || "", err: p.stderr || "" };
}

// 1 + 2 — dirty fixture
const dirty = run([
  "--include-legal",
  "--no-exemptions",
  "--json",
  join(FIXTURES, "dirty-copy.md"),
]);
check("dirty fixture exits 1", dirty.code === 1, `exit was ${dirty.code}`);
let dirtyJson = null;
try {
  dirtyJson = JSON.parse(dirty.out);
} catch (e) {
  check("dirty fixture emits valid JSON", false, e.message);
}
if (dirtyJson) {
  check("dirty fixture reports findings", dirtyJson.findings.length > 0);
  check("dirty fixture reports banned findings", dirtyJson.banned > 0);
  const ids = new Set(dirtyJson.findings.map((f) => f.id));
  const mustCatch = [
    "EL-01", // electrolytes
    "EL-02", // hydrated
    "EL-04", // recovery / workout
    "TH-01", // hangover
    "TH-04", // cramp
    "HC-01", // gut health
    "HC-02", // probiotics
    "HC-06", // immune
    "HC-07", // detox
    "HC-14", // healthy / good for you
    "NCC-01", // low in sugar
    "NCC-02", // sugar-free
    "NCC-07", // low sodium
    "NCC-13", // excellent source of
    "NCC-15", // gluten free
    "FTA-02", // 100% natural
    "FTA-09", // organic
    "WILD-01", // rongoa
    "PROV-04", // named place
    "PROV-05", // TODO next to provenance
  ];
  for (const id of mustCatch) {
    check(`dirty fixture trips ${id}`, ids.has(id));
  }
  const hasLineCols = dirtyJson.findings.every(
    (f) =>
      Number.isInteger(f.line) &&
      f.line > 0 &&
      Number.isInteger(f.column) &&
      f.column > 0,
  );
  check("every finding carries file:line:column", hasLineCols);
}

// 3 — clean fixture
const clean = run([
  "--include-legal",
  "--json",
  join(FIXTURES, "clean-copy.md"),
]);
check(
  "clean fixture exits 0",
  clean.code === 0,
  `exit was ${clean.code}\n${clean.out}`,
);
try {
  const j = JSON.parse(clean.out);
  check(
    "clean fixture reports zero findings",
    j.findings.length === 0,
    JSON.stringify(j.findings),
  );
} catch (e) {
  check("clean fixture emits valid JSON", false, e.message);
}

// 4 + 5 — markers
const tmp = mkdtempSync(join(tmpdir(), "halfsour-audit-"));
try {
  const approvedRestricted = join(tmp, "approved.md");
  writeFileSync(
    approvedRestricted,
    "A splash in a martini. copy-audit-approved: R-13\n",
  );
  const a = run([approvedRestricted]);
  check("approval marker clears a RESTRICTED finding", a.code === 0, a.out);

  const approvedBanned = join(tmp, "not-approved.md");
  writeFileSync(
    approvedBanned,
    "Cures your hangover. copy-audit-approved: TH-01\n",
  );
  const b = run([approvedBanned]);
  check("approval marker does NOT clear a BANNED finding", b.code === 1, b.out);

  const ignored = join(tmp, "ignored.md");
  writeFileSync(
    ignored,
    "copy-audit-ignore-file\nCures your hangover, hydrates you, high in electrolytes.\n",
  );
  const c = run([ignored]);
  check("copy-audit-ignore-file skips the whole file", c.code === 0, c.out);

  const ignoreLine = join(tmp, "ignore-line.md");
  writeFileSync(
    ignoreLine,
    "Cures your hangover. copy-audit-ignore\nA clean, dill-forward brine. copy-audit-ignore\n",
  );
  const d = run([ignoreLine]);
  check("copy-audit-ignore skips a single line", d.code === 0, d.out);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// 7 — TH-02 must not fire on the culinary sense of "cure"
const culinary = join(tmpdir(), `halfsour-cure-${process.pid}.md`);
writeFileSync(
  culinary,
  [
    "A cucumber cured in salt brine rather than vinegar.",
    "A three-week cure.",
    "Cure time is printed on every bottle.",
    "Curing salt is not used.",
    "Batch sizes, cure times, salinity, stock counts.",
  ].join("\n") + "\n",
);
const cul = run([culinary]);
check(
  "culinary 'cure' vocabulary passes (TH-02 not over-broad)",
  cul.code === 0,
  cul.out,
);
rmSync(culinary, { force: true });

const medical = join(tmpdir(), `halfsour-cure-bad-${process.pid}.md`);
writeFileSync(
  medical,
  "It cures cramp. A cure for hangovers. Curative properties.\n",
);
const med = run(["--json", medical]);
let medIds = new Set();
try {
  medIds = new Set(JSON.parse(med.out).findings.map((f) => f.id));
} catch {}
check(
  "therapeutic 'cure' still fails",
  med.code === 1 && medIds.has("TH-02"),
  med.out,
);
rmSync(medical, { force: true });

// 8 — block markers and the exemption registry
const blocked = join(tmpdir(), `halfsour-block-${process.pid}.md`);
writeFileSync(
  blocked,
  [
    "A dill-forward brine.",
    "<!-- copy-audit-ignore-start: this section enumerates what we never say -->",
    "Never: electrolytes, hydration, cramps, probiotics, gut health.",
    "<!-- copy-audit-ignore-end -->",
    "Bottled in 375 ml.",
  ].join("\n") + "\n",
);
const bl = run([blocked]);
check("copy-audit-ignore-start/end suppresses a block", bl.code === 0, bl.out);
rmSync(blocked, { force: true });

const exFile = run([
  "--include-legal",
  "--json",
  join(FIXTURES, "dirty-copy.md"),
]);
try {
  const j = JSON.parse(exFile.out);
  check(
    "registered exemption skips the dirty fixture",
    exFile.code === 0 && j.filesExempted === 1,
    exFile.out,
  );
} catch (e) {
  check("registered exemption skips the dirty fixture", false, e.message);
}

/* ------------------------------------------------------------------------ *
 * 9 — the surface model, the parse, and the FTA-04 terms of art
 *
 * Four fixtures, run with --include-legal --no-exemptions so the registry cannot
 * hide them. Each one is a claim about the scanner's SCOPE rather than its terms:
 * the terms are right, and none of these tests weakens one.
 * ------------------------------------------------------------------------ */

function scanFixture(...parts) {
  const res = run([
    "--include-legal",
    "--no-exemptions",
    "--json",
    join(FIXTURES, ...parts),
  ]);
  let json = null;
  try {
    json = JSON.parse(res.out);
  } catch {
    /* reported by the caller */
  }
  return { ...res, json };
}

const ids = (json) => new Set((json?.findings ?? []).map((f) => f.id));

// 9a — an internal admin screen: identifiers, panel headings, chart captions and
//      the mandatory date mark. None of it is advertising.
const adminLabels = scanFixture("internal", "must-pass-admin-labels.tsx");
check(
  'internal admin labels pass (identifier `best`, "Best customers", "Best day", "Best before")',
  adminLabels.code === 0,
  adminLabels.out,
);
check(
  "internal fixture is classified as an internal surface",
  adminLabels.json?.filesBySurface?.internal === 1,
  JSON.stringify(adminLabels.json?.filesBySurface),
);
check(
  "the identifier hits are recorded as not-raised, not silently dropped",
  (adminLabels.json?.notRaised?.surface ?? 0) > 0,
  JSON.stringify(adminLabels.json?.notRaised),
);

// 9b — the same words on a CONSUMER surface: still zero, but for a different
//      reason. "Best before" is the Standard 1.2.5 date mark everywhere.
const termsOfArt = scanFixture("consumer", "must-pass-terms-of-art.tsx");
check(
  'consumer date mark passes ("Best before", "Best-before", "Best before 12/2026")',
  termsOfArt.code === 0,
  termsOfArt.out,
);
check(
  "the date mark is recorded as a term of art, not as an absent match",
  (termsOfArt.json?.notRaised?.termOfArt ?? 0) >= 4,
  JSON.stringify(termsOfArt.json?.notRaised),
);

// 9c — THE test that matters. The carve-out above must not have made FTA-04 soft.
const superiority = scanFixture("consumer", "must-fail-superiority.tsx");
check(
  "consumer superiority claim still FAILS",
  superiority.code === 1,
  superiority.out,
);
check(
  "consumer superiority claim trips FTA-04",
  ids(superiority.json).has("FTA-04"),
);
check(
  '"the best before you open it" is NOT excused by the date-mark carve-out',
  (superiority.json?.findings ?? []).some(
    (f) => f.id === "FTA-04" && /before you open it/.test(f.excerpt),
  ),
  superiority.out,
);
check(
  "a superiority finding names the surface it was found on",
  (superiority.json?.findings ?? []).every((f) => f.surface === "consumer"),
);

// 9d — parsing must not have become leniency: a health claim in a string literal,
//      a template literal and JSX text all still fail on a consumer surface.
const consumerHealth = scanFixture("consumer", "must-fail-health-claim.tsx");
check(
  "consumer health claim still FAILS",
  consumerHealth.code === 1,
  consumerHealth.out,
);
for (const id of [
  "HC-01",
  "HC-02",
  "HC-06",
  "TH-01",
  "TH-04",
  "EL-01",
  "EL-02",
  "EL-04",
]) {
  check(
    `consumer health-claim fixture trips ${id}`,
    ids(consumerHealth.json).has(id),
  );
}
// Matched on the excerpt rather than a line number: reformatting the fixture must
// not be able to quietly retire an assertion.
check(
  "the claim inside a STRING LITERAL is caught",
  (consumerHealth.json?.findings ?? []).some(
    (f) => f.id === "HC-01" && /Gut health in a bottle/.test(f.excerpt),
  ),
  consumerHealth.out,
);
check(
  "the claim inside a TEMPLATE LITERAL is caught",
  (consumerHealth.json?.findings ?? []).some(
    (f) => f.id === "EL-01" && /\$\{ml\} ml of electrolytes/.test(f.excerpt),
  ),
  consumerHealth.out,
);
check(
  "the claim inside JSX TEXT is caught",
  (consumerHealth.json?.findings ?? []).some(
    (f) => f.id === "TH-01" && /natural hangover cure/.test(f.excerpt),
  ),
  consumerHealth.out,
);

// 9e — the internal surface is a SCOPE, not a skip. Health claims still fire there.
const internalHealth = scanFixture("internal", "must-fail-health-claim.tsx");
check(
  "internal health claim still FAILS",
  internalHealth.code === 1,
  internalHealth.out,
);
for (const id of ["HC-01", "HC-02", "EL-01", "EL-02", "EL-04"]) {
  check(
    `internal health-claim fixture trips ${id}`,
    ids(internalHealth.json).has(id),
  );
}
check(
  "an internal finding names the surface it was found on",
  (internalHealth.json?.findings ?? []).every((f) => f.surface === "internal"),
);

// 9f — every rule declares which surfaces it reaches, and the split is real.
const listed = run(["--list"]);
check(
  "--list prints each rule's surface scope",
  /applies: /.test(listed.out),
  listed.out.slice(0, 200),
);
check(
  "the rule set is split, not wholesale-exempted",
  /(\d+) every-surface, (\d+) consumer-only/.test(listed.out) &&
    Number(RegExp.$1) > 0 &&
    Number(RegExp.$2) > 0,
  listed.out.slice(-200),
);
const surfaces = run(["--surfaces"]);
check(
  "--surfaces prints the classification",
  surfaces.code === 0 && /INTERNAL/.test(surfaces.out),
);

// 6 — usage
const usage = run([]);
check("no arguments exits 2", usage.code === 2, `exit was ${usage.code}`);

process.stdout.write(
  `\n${failures === 0 ? "ALL PASS" : failures + " ASSERTION(S) FAILED"}\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
