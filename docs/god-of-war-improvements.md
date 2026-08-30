# god-of-war — improvements found in use

Notes from running the skill on a real multi-domain build (brand + storefront + admin +
AI agents). Written for copying into Cowork and implementing. Appended to as the run goes.

Run: HALF SOUR, 2026-08-27. Skill version: the one at `~/.claude/skills/synced/god-of-war/`.

---

## 1. Two literal bugs in SKILL.md

**Line ~42 — wrong variable name in prose.** The text says _"Set `COW` once"_ but the code
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
in practice the human _does_ say so, and mid-wave. In this run, three things landed after
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

The gap bites when a _new_ question arises mid-run, which is exactly when a long run is most
likely to go wrong quietly. Needs an explicit unattended mode:

- Before going unattended, agree the **decision budget**: which classes of decision the loop may
  make alone, and which must wait.
- When a blocking question arises with nobody present: pick the reversible option, log it to a
  `decisions.md` with the reasoning and the alternative not taken, and keep going. Surface the
  whole list at hand-back rather than one at a time.
- Never let an unattended run make an _irreversible_ decision (buying a domain, deleting data,
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

## 6. Answer-key bars need the evidence _command_, not just the check

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
- Worth stating that the orchestrator should commit _between_ waves as well as on unit PASS. A
  wave that dies mid-flight otherwise loses everything the builders wrote.

---

## 8. Concurrent builders make CI meaningless mid-wave, and the skill never says so

Observed repeatedly on this run. With 9 builders writing to one working tree, every checkpoint
commit captures several half-written units, so the shared gate fails on transient errors that
belong to nobody:

- `prettier --check` failed on files two builders were still writing.
- `tsc` failed on `lib/auth/store/types.ts` importing `../audit`, a module its own builder had
  not written yet.
- `lib/commerce/money.ts` failed mid-edit on an unrelated overload.

None of these are defects. All of them burn a CI run, a deploy, and orchestrator attention, and
on a watched PR they generate failure notifications that look like regressions.

The skill says to commit each unit as it passes, which is right, but says nothing about what to
do when an external gate (CI, a watched PR, a deploy pipeline) observes the tree _between_
passes. Worth stating explicitly:

> **A shared CI gate is only meaningful at wave boundaries.** Mid-wave the tree contains
> partial units by construction. Either keep checkpoint commits off the branch CI watches, or
> say once, publicly, that red is expected until the wave closes — and then actually hold
> yourself to green at the boundary.

Two concrete mitigations that worked:

1. Run the formatter across the tree as part of the checkpoint routine, not as a fix after the
   gate fails. Formatting is never a real failure and should never consume a cycle.
2. Scan for credential material on every checkpoint, since builders handling secrets are exactly
   the ones writing fastest.

## 9. `typecheck` passing is not `build` passing

`npm run typecheck` (`tsc --noEmit`) went green while `next build` failed on the same tree, on a
genuine error. Any builder that verified with typecheck alone had a false green and would have
declared done on broken code.

The answer key asked for both, which saved it. But the general lesson belongs in the skill's
guidance on evidence: **name the exact command whose output counts, and prefer the one that runs
the real production path.** A builder told to "make sure it typechecks" will do exactly that and
no more.

---

## 10. `git add -A` under concurrent agents destroys attribution

Two separate builders reported this independently, in near-identical words: *"concurrent
agents swept my in-progress work into their commits"* and *"one of them titled as if it were
this work"*.

The orchestrator was checkpointing with `git add -A` on a stop-hook cadence while six agents
wrote to one tree. Every checkpoint therefore captured whatever every other agent happened to
have on disk, under a message describing only one unit. The copy-scanner rewrite — a 200-line
parser change with its own fixtures — is committed under *"Fix the commerce enum divergence
and the 3D lint rules"*. `git log -- legal/scripts/audit-copy.mjs` now tells a reader something
false.

The cost is not tidiness. It is that the two things git history is for — finding when a
behaviour changed, and knowing what a change was *for* — both stop working precisely when the
build is at its most parallel and a reader most needs them.

The skill's git discipline section says to commit each unit as it passes, which is right and
which this violated. What it does not say, and should:

> **When several agents share one working tree, never `git add -A`.** Stage the directories the
> completing unit owns. A checkpoint that sweeps the tree is not a checkpoint of anything — it
> is a snapshot of a race. If a stop-hook or similar forces a whole-tree commit, say in the
> message that it is a sweep rather than naming one unit's work.

Corollary worth stating: unit briefs should name the directories a unit owns, which these did,
and the orchestrator should then *stage by those same directories*. The ownership map already
existed; it simply was not used at commit time.

## 11. Units keep working after their bar is met

The media unit produced its whole deliverable — four bottle stills, four per-SKU films, a range
shot, and the manifest wiring them into the product pages — in about an hour. It then ran a
Lighthouse check, captured evidence, and at the ninety-minute mark started a *new* piece of
work: widening the range shot into a page hero and generating a second video for it. That video
reached 10MB, twenty-three times the 425KB range film it had already encoded, and would have
failed the CI budget the unit itself had just finished checking against.

Nothing in the brief asked for it. Nothing in the brief forbade it either, and that is the gap.

A card says *Done when* and the critic checks *Done when*. Neither says **stop when**. A capable
builder that finishes early and still has budget will keep finding adjacent work, because
finding adjacent work is what a capable builder does. The result is a unit that reads as slow
when it was actually fast and then kept going, and — worse — a tree that cannot be verified or
pushed to main, because it never stops churning long enough to be green.

Two changes:

> **Every card names its deliverables as a closed list, and says to stop when the list is
> complete.** Not "product photography for the range" but the specific files. Anything the unit
> spots beyond the list goes in its report as a proposed follow-up for the orchestrator to
> triage, never into the tree.

> **Long-running external-API units split generation from integration.** The generation half is
> dominated by model wall-clock, blocks nothing, and cannot be made faster by adding agents. The
> integration half — manifests, alt text, placement, budget checks — is minutes of work and
> blocks other units. One agent doing both means the fast half waits on the slow half for no
> reason.

The tempting third change is wrong and worth recording as such: **do not split the generation
itself across agents.** Four bottles generated by four agents finish in the same wall-clock and
lose the single-shoot constraint — one seed, one lighting rig, one surface — that is the only
reason the four bottles read as one range rather than four unrelated products. Parallelism that
breaks a coherence constraint is not a speed-up.

## 12. Whole-tree git operations are unsafe under concurrent agents

Improvement 10 recorded that `git add -A` destroys attribution when several
agents share a tree. The rule is narrower than it should have been: **any git
operation whose scope is the whole working tree** is unsafe there, not only
staging.

Two incidents in one session. A builder ran `git checkout -- tsconfig.json` to
undo its own edit and silently discarded another agent's uncommitted change to
the same file — it noticed, restored the content byte-identically and said so,
which is the only reason anyone knows. Separately the orchestrator ran
`git stash` and `git stash pop` around a copy-audit baseline check, putting
three agents' in-progress work through a round trip for the sake of comparing
two numbers. It happened to survive. A conflict on the pop would have left
their work in a state none of them could reason about, and none of them would
have been told.

> **Under concurrent agents, never run `git stash`, `git checkout -- <path>`,
> `git reset`, `git clean`, or anything else that rewrites files the caller does
> not own.** To compare against a baseline, read the committed version directly
> — `git show HEAD:path > /tmp/baseline` — and never move the working tree to
> get there. To undo your own edit, rewrite the file with the content you
> intended, or use `git show HEAD:path` and write it back yourself.

The tell is the same in both incidents: the operation names a path or nothing at
all, and git resolves the rest. Under one agent that is convenience. Under six it
is an unannounced write to someone else's files.
