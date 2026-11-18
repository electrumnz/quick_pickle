"use server";

import {
  createPage,
  publishPage,
  setPageLive,
  updatePage,
} from "@/lib/backstage/pages/ops";
import {
  addPageRule,
  movePageRule,
  removePageRule,
  removePageTest,
  setPageRuleActive,
  setUpPageTest,
  startPageTest,
  stopPageTest,
} from "@/lib/backstage/pages/routing-ops";
import {
  publishTopLine,
  resetTopLine,
  saveTopLine,
} from "@/lib/backstage/shop/top-line";
import { formText, submit } from "@/lib/backstage/ui/submit";
import type { RuleKind } from "@/lib/shop/routing";
import { tidyTopLines } from "@/lib/shop/top-line";

/** Every button on a landing page. */

const LIST = "/backstage/marketing/pages";

const page = (form: FormData) =>
  `${LIST}/${encodeURIComponent(formText(form, "id"))}`;

/** A text box where line breaks matter: the headline. */
function formLines(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

const words = (form: FormData) => ({
  eyebrow: formText(form, "eyebrow"),
  headline: formLines(form, "headline"),
  lead: formText(form, "lead"),
});

export async function createPageAction(form: FormData): Promise<void> {
  await submit(
    createPage,
    {
      slug: formText(form, "slug"),
      name: formText(form, "name"),
      note: formText(form, "note"),
      ...words(form),
    },
    {
      back: `${LIST}#new`,
      done: (made) => `${made.path} is started as a draft.`,
      to: (made) => `${LIST}/${made.id}`,
    },
  );
}

export async function updatePageAction(form: FormData): Promise<void> {
  await submit(
    updatePage,
    {
      id: formText(form, "id"),
      name: formText(form, "name"),
      note: formText(form, "note"),
      ...words(form),
    },
    {
      back: page(form),
      done: (saved) =>
        saved.verdict === "banned"
          ? "Draft saved. The copy check found wording that cannot be published."
          : saved.verdict === "restricted"
            ? "Draft saved. The copy check wants a second look at some wording."
            : "Draft saved. Nothing a customer sees has changed.",
    },
  );
}

export async function publishPageAction(form: FormData): Promise<void> {
  await submit(
    publishPage,
    {
      id: formText(form, "id"),
      acknowledgeRestricted: form.get("acknowledge") === "on",
    },
    {
      back: `${page(form)}#publish`,
      done: (out) => `Published. It is live at ${out.path}.`,
    },
  );
}

export async function setPageLiveAction(form: FormData): Promise<void> {
  const live = formText(form, "live") === "true";
  await submit(
    setPageLive,
    { id: formText(form, "id"), live },
    {
      back: `${page(form)}#publish`,
      done: live
        ? "It is back up."
        : "Taken down. Its address shows the standard page now.",
    },
  );
}

/* ---- who sees which page -------------------------------------------------- */

const WHO = "/backstage/marketing/pages/who";

export async function addPageRuleAction(form: FormData): Promise<void> {
  await submit(
    addPageRule,
    {
      when: formText(form, "when") as RuleKind,
      value: formText(form, "value"),
      pageId: formText(form, "pageId"),
    },
    { back: `${WHO}#rules`, done: "Rule added. It is switched on." },
  );
}

export async function setPageRuleActiveAction(form: FormData): Promise<void> {
  const active = formText(form, "active") === "true";
  await submit(
    setPageRuleActive,
    { id: formText(form, "id"), active },
    {
      back: `${WHO}#rules`,
      done: active ? "Switched on." : "Switched off.",
    },
  );
}

export async function removePageRuleAction(form: FormData): Promise<void> {
  await submit(
    removePageRule,
    { id: formText(form, "id") },
    { back: `${WHO}#rules`, done: "Rule removed." },
  );
}

export async function movePageRuleAction(form: FormData): Promise<void> {
  await submit(
    movePageRule,
    {
      id: formText(form, "id"),
      direction: formText(form, "direction") === "up" ? "up" : "down",
    },
    { back: `${WHO}#rules`, done: "Moved." },
  );
}

export async function setUpPageTestAction(form: FormData): Promise<void> {
  const a = formText(form, "aPageId");
  await submit(
    setUpPageTest,
    {
      name: formText(form, "name"),
      aPageId: a === "" ? null : a,
      bPageId: formText(form, "bPageId"),
    },
    {
      back: `${WHO}#test`,
      done: "Set up. It is switched off until you start it.",
    },
  );
}

export async function startPageTestAction(form: FormData): Promise<void> {
  await submit(
    startPageTest,
    { id: formText(form, "id") },
    {
      back: `${WHO}#test`,
      done: "Started. It can take a few seconds to reach every visitor.",
    },
  );
}

export async function stopPageTestAction(form: FormData): Promise<void> {
  await submit(
    stopPageTest,
    { id: formText(form, "id") },
    {
      back: `${WHO}#test`,
      done: "Stopped. Everybody sees the standard page again.",
    },
  );
}

export async function removePageTestAction(form: FormData): Promise<void> {
  await submit(
    removePageTest,
    { id: formText(form, "id") },
    { back: `${WHO}#test`, done: "Removed." },
  );
}

/* ---- the line across the top of the shop ---------------------------------- */

const TOP_LINE = `${LIST}/top-line`;

export async function saveTopLineAction(form: FormData): Promise<void> {
  await submit(
    saveTopLine,
    // A row to a line. Tidied here as well, so that a paste with a lot of
    // empty rows in it is counted by its words and not by its rows.
    { lines: tidyTopLines(formLines(form, "lines")) },
    {
      back: TOP_LINE,
      done: (saved) =>
        !saved.changed
          ? "The draft is what the shop shows, so there is nothing to publish."
          : saved.problems[0] !== undefined
            ? `Draft saved. It does not fit yet. ${saved.problems[0]}`
            : saved.verdict === "banned"
              ? "Draft saved. The copy check found wording that cannot be published."
              : saved.verdict === "restricted"
                ? "Draft saved. The copy check wants a second look at some wording."
                : "Draft saved. Nothing a customer sees has changed.",
    },
  );
}

export async function publishTopLineAction(form: FormData): Promise<void> {
  await submit(
    publishTopLine,
    {
      // The words that were on the screen beside the button.
      lines: form
        .getAll("shown")
        .filter((line): line is string => typeof line === "string"),
      acknowledgeRestricted: form.get("acknowledge") === "on",
    },
    {
      back: `${TOP_LINE}#publish`,
      done: "Published. The shop shows it within a minute.",
    },
  );
}

export async function resetTopLineAction(): Promise<void> {
  await submit(
    resetTopLine,
    {},
    {
      back: `${TOP_LINE}#publish`,
      done: "The standard line is back, and shows within a minute. Your words are kept as the draft.",
    },
  );
}
