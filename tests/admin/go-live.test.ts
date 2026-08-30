import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  GO_LIVE_TASKS,
  goLiveProgress,
  type GoLiveTask,
} from "@/content/go-live";

/**
 * The go-live list, and the one other place it is written down.
 *
 * `TODO.md` and `content/go-live.ts` say the same thing to two different
 * readers: the section "Needs the founder" is what an engineer opens, and
 * `/admin/go-live` is what the founder opens. Two copies of one truth diverge —
 * it has already happened three times in this build — and the failure is
 * silent: she works from a screen that has quietly stopped being the list.
 *
 * **Asserted rather than generated, deliberately.** Generating the markdown from
 * the data would also stop the drift, but it would make that section of TODO.md
 * machine-owned: hand-editing it, which is how it has been maintained all
 * along, would then be silently overwritten on the next build. Asserting keeps
 * both files hand-editable, and names exactly what disagreed when they do.
 *
 * So a session that finishes a task has to do two small things — set
 * `done: true` here, tick the box there — and this test is what makes forgetting
 * the second one loud.
 */

const ROOT = path.resolve(__dirname, "..", "..");

/** One checklist item as `TODO.md` writes it. */
type MarkdownItem = { readonly title: string; readonly done: boolean };

/**
 * The founder section of TODO.md, as items.
 *
 * Reads from the heading to the next one, so items added to a later section
 * cannot be mistaken for founder tasks, and an item moved out of this section
 * fails the comparison rather than being quietly ignored.
 */
function founderSection(): readonly MarkdownItem[] {
  const markdown = readFileSync(path.join(ROOT, "TODO.md"), "utf8");
  const start = markdown.indexOf("## Needs the founder");
  expect(
    start,
    "TODO.md no longer has a 'Needs the founder' heading. The go-live page reads against that section; rename it back or update this test.",
  ).toBeGreaterThan(-1);
  const rest = markdown.slice(start);
  const nextHeading = rest.indexOf("\n## ", 1);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  return [...section.matchAll(/^- \[([ x])\] \*\*(.+?)\*\*/gm)].map(
    (match) => ({
      title: (match[2] ?? "").replace(/\.$/, ""),
      done: match[1] === "x",
    }),
  );
}

function asItems(tasks: readonly GoLiveTask[]): readonly MarkdownItem[] {
  return tasks.map((task) => ({ title: task.title, done: task.done }));
}

describe("the go-live list and TODO.md cannot drift", () => {
  it("holds the same items, in the same order, in the same state", () => {
    expect(
      founderSection(),
      "TODO.md's 'Needs the founder' section and content/go-live.ts disagree. Every task exists in both, with the same title and the same tick, in the same order — change both or neither.",
    ).toEqual(asItems(GO_LIVE_TASKS));
  });

  it("counts the same number of things in both", () => {
    expect(founderSection().length).toBe(GO_LIVE_TASKS.length);
  });

  it("tells a Claude Code session how to mark a task done", () => {
    // Deliverable, not decoration: the page only stays true if a session that
    // finishes one of these can mark it done without being told how.
    const source = readFileSync(
      path.join(ROOT, "content", "go-live.ts"),
      "utf8",
    );
    const header = source.slice(0, source.indexOf("*/"));
    expect(header).toContain("done: true");
    expect(header).toContain("TODO.md");
  });
});

describe("every go-live task is usable by the person who has to do it", () => {
  it("gives each one an id nothing else uses", () => {
    const ids = GO_LIVE_TASKS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("says what it is, why it matters, and what stays broken", () => {
    for (const task of GO_LIVE_TASKS) {
      expect(task.what.length, `${task.id}: what`).toBeGreaterThan(20);
      expect(task.why.length, `${task.id}: why`).toBeGreaterThan(80);
      expect(task.until.length, `${task.id}: until`).toBeGreaterThan(20);
      expect(task.howLong.length, `${task.id}: howLong`).toBeGreaterThan(5);
    }
  });

  it("carries a message long enough to be worth pasting", () => {
    for (const task of GO_LIVE_TASKS) {
      expect(task.prompt.length, `${task.id}: prompt`).toBeGreaterThan(200);
    }
  });

  it("ends every message by telling the session to mark it done in both files", () => {
    for (const task of GO_LIVE_TASKS) {
      expect(task.prompt, `${task.id}`).toContain(task.id);
      expect(task.prompt, `${task.id}`).toContain("content/go-live.ts");
      expect(task.prompt, `${task.id}`).toContain("TODO.md");
    }
  });

  it("only links somewhere a browser can actually go", () => {
    for (const task of GO_LIVE_TASKS) {
      const href = task.place?.href;
      if (href === undefined || href === null) continue;
      expect(href, `${task.id}: href`).toMatch(/^https:\/\/[^\s]+$/);
    }
  });

  it("puts the item with legal exposure at the very top", () => {
    // Ordering is the page's whole argument. The one thing that is unlawful
    // while it sits there does not get to be sixth.
    const law = GO_LIVE_TASKS.filter((task) => task.urgency?.kind === "law");
    expect(law.length).toBe(1);
    expect(GO_LIVE_TASKS[0]?.urgency?.kind).toBe("law");
  });

  it("marks the things that hold up everything else before the rest", () => {
    const blocking = GO_LIVE_TASKS.filter(
      (task) => task.urgency?.kind === "blocks",
    ).map((task) => GO_LIVE_TASKS.indexOf(task));
    const plain = GO_LIVE_TASKS.filter((task) => task.urgency === null).map(
      (task) => GO_LIVE_TASKS.indexOf(task),
    );
    expect(Math.max(...blocking)).toBeLessThan(Math.min(...plain));
  });
});

describe("progress is counted honestly", () => {
  const sample: readonly GoLiveTask[] = [
    { ...(GO_LIVE_TASKS[0] as GoLiveTask), id: "a", done: true },
    { ...(GO_LIVE_TASKS[1] as GoLiveTask), id: "b", done: false },
    { ...(GO_LIVE_TASKS[2] as GoLiveTask), id: "c", done: false },
  ];

  it("counts what is done and hands back the next one to do", () => {
    const progress = goLiveProgress(sample);
    expect(progress.total).toBe(3);
    expect(progress.done).toBe(1);
    expect(progress.remaining.map((task) => task.id)).toEqual(["b", "c"]);
    expect(progress.next?.id).toBe("b");
  });

  it("has no next task when everything is done", () => {
    const all = sample.map((task) => ({ ...task, done: true }));
    const progress = goLiveProgress(all);
    expect(progress.next).toBeNull();
    expect(progress.done).toBe(3);
    expect(progress.remaining).toEqual([]);
  });
});
