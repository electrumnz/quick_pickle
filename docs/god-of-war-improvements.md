# god-of-war — improvements found in use

Notes from running the skill on a real multi-domain build (brand + storefront + admin +
AI agents). Written for copying into Cowork and implementing. Appended to as the run goes.

Run: HALF SOUR, 2026-08-27. Skill version: the one at `~/.claude/skills/synced/god-of-war/`.

---

## 1. Two literal bugs in SKILL.md

**Line ~42 — wrong variable name in prose.** The text says *"Set `COW` once"* but the code
block sets `GOW`, and every later command uses `$GOW`. Anyone following the prose exports the
wrong variable and every script call fails.

```diff
-**1. Find the skill directory.** ... Set `COW` once:
+**1. Find the skill directory.** ... Set `GOW` once:
```

**Line ~162 — doubled path variable.** The Phase 8 example is unrunnable:

```diff
-python3 $GOW/$GOW/scripts/lessons.py add --scope domain:documents --text "..."
+python3 $GOW/scripts/lessons.py add --scope domain:documents --text "..."
```

Small, but they're in the two places a first-time user copies verbatim.

---

## 2. Parallel builders collide, and nothing warns you

This is the biggest practical gap. The skill says to dispatch batches of about five builders in
parallel, which is right, but says nothing about them sharing a filesystem. For code work that
is an immediate, predictable failure:

- Two agents both run `npm install` and race on `package-lock.json`.
- A scaffolder (`create-next-app`, `vite create`) refuses to run in a non-empty directory, or
  worse, offers to wipe it — destroying a sibling agent's finished work.
- Two agents both edit `package.json` and the second silently overwrites the first.

I had to invent the mitigation per-brief. It should be in the skill:

> **Give every builder in a wave an exclusive directory, and say so in its brief.** Name the
> directory it owns, state explicitly that siblings are working in the same repo right now, and
> forbid it from touching shared root files (`package.json`, lockfiles, config) unless it is the
> designated owner of those. Where a builder must run a scaffolder, have it scaffold into a temp
> directory and merge in, never in place.

Consider adding a `unit.owns` field to `units.md` so ownership is declared in the split rather
than remembered in each brief, and a pre-dispatch check that no two units in the same wave
declare overlapping paths.

---

## 3. No protocol for amending a run already in flight

The skill is firm that the mission doesn't change mid-run unless the human says so — good. But
in practice the human *does* say so, and mid-wave. In this run, three things landed after
builders were dispatched: a Shopify store appeared, the brand name was confirmed, and an
image-generation pipeline became available. Each materially changed a unit already being built.

There's no guidance on what to do. Killing and re-dispatching wastes the work; letting it finish
wrong wastes more. What worked:

1. Amend `mission.md` with a dated **Amendments** section — never edit the original text, so the
   record of what was true when each unit was judged survives.
2. Message the affected in-flight builders with the delta only, framed as "this changes X in your
   brief, everything else stands".
3. Re-check unit dependencies — an amendment can unblock a unit and move it to an earlier wave.

Worth a short "Phase 3.5 — amendments" section, plus a rule: **an amendment that changes the bar
invalidates verdicts already given against the old bar, and those units re-enter the loop.**

---

## 4. Intake assumes a human is awake

Phase 0 step 4 is "ask what is left, once". For an unattended or overnight run there is nobody to
ask, and the skill's own §7 (headless runs) actively encourages running for hours alone — but
never reconciles the two.

The gap bites when a *new* question arises mid-run, which is exactly when a long run is most
likely to go wrong quietly. Needs an explicit unattended mode:

- Before going unattended, agree the **decision budget**: which classes of decision the loop may
  make alone, and which must wait.
- When a blocking question arises with nobody present: pick the reversible option, log it to a
  `decisions.md` with the reasoning and the alternative not taken, and keep going. Surface the
  whole list at hand-back rather than one at a time.
- Never let an unattended run make an *irreversible* decision (buying a domain, deleting data,
  publishing, sending email) on its own. Those queue and wait.

---

## 5. Composite bars deserve top billing

`bar-design.md` mentions composite bars, but `SKILL.md` reads as though one run has one bar. Any
project spanning more than one discipline needs several, and which bar applies to which unit is a
Phase 1 decision, not a detail.

This run needed four: a reference brand for identity work, an Awwwards site for storefront motion,
Linear for admin UX, and a binary answer key for everything engineering. Grading a database schema
against a pickle brand's website is meaningless — but nothing in the main flow tells you to split
the bar, so the temptation is to pick one and stretch it.

Suggest: make `units.md` require a `bar` column, so every unit has to name which bar it is graded
against, and a mismatch becomes visible at split time.

---

## 6. Answer-key bars need the evidence *command*, not just the check

The engineering answer key worked far better once each check named how to produce its evidence
(`npm run typecheck`, an axe run, a contrast table) rather than just asserting the condition. A
check a critic cannot mechanically evidence degrades into an opinion, which §5 of
`critic-design.md` correctly says should count as FAIL — but then most checks fail for want of a
command, not for want of quality.

Suggest the answer-key template carry three columns: **id | check | how to evidence it**.

---

## 7. Minor

- The run directory uses `date +%Y%m%d-%H%M%S`, so two runs started in the same second collide.
  Unlikely, but a short random suffix costs nothing.
- `ledger.py init` accepts `--budget` as free text. If budget is a real stop condition (§6 exit 3),
  it needs to be machine-comparable, otherwise nothing can actually detect the stop.
- Worth stating that the orchestrator should commit *between* waves as well as on unit PASS. A
  wave that dies mid-flight otherwise loses everything the builders wrote.
