/**
 * Three things the founder reported, pinned so they cannot come back.
 *
 * 1. *"ask the team page seems to not load, freezes up the site requiring
 *    refresh to view other pages."*
 * 2. *"asking the team seems to need sign in, remove this."*
 * 3. *"move the two warnings, admin and model running, down to the footer
 *    warning"* — and *"dont make the footer any larger."*
 *
 * The first is a browser behaviour and its real proof is
 * `e2e/admin-overlays.spec.ts`, which opens the panel and taps outside it. What
 * is here instead is the shape that caused it, because the shape is what will be
 * copied into the fourth overlay somebody adds. The other two are decisions
 * about words and numbers, which is exactly what a unit test is for.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { canAsk } from "@/components/admin/chat/data";
import { OPEN_DEMO_ACTOR } from "@/components/admin/write/open-demo";
import { DEMO_ADMIN_OPEN, DEMO_BANNER } from "@/components/demo/copy";
import { rosterModelNotice } from "@/lib/agents";
import { FREE_WINDOW_ENDS_SHORT } from "@/lib/agents/model/roster-models";
import type { AdminAccess } from "@/lib/auth/server";
import { DEMO_ENV_VAR } from "@/lib/demo/mode";

const source = (relative: string): string =>
  readFileSync(path.resolve(process.cwd(), relative), "utf8");

/**
 * The same file with every comment taken out.
 *
 * The shapes asserted below are shapes of CODE. Several of these files now
 * carry a paragraph explaining the defect they used to have, quoting the very
 * expression this test refuses to find — and a test that cannot tell an
 * explanation from a relapse is a test that punishes writing the explanation
 * down.
 */
const code = (relative: string): string =>
  source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ------------------------------------------------------------ 1. the freeze */

/**
 * Every modal in the admin, and the element its dismissal hangs on.
 *
 * All three shipped with the handler on the wrapper and a backdrop that covers
 * the wrapper, so `event.target === event.currentTarget` was never true and
 * pressing outside did nothing at all. On a laptop that was a nuisance; on a
 * phone, where there is no Escape key, it left the founder inside a panel that
 * stopped the page scrolling and swallowed every click behind it — which is
 * what "freezes up the site requiring refresh" is.
 */
const OVERLAYS = [
  "components/admin/chat/ChatDock.tsx",
  "components/admin/shell/MobileNav.tsx",
  "components/admin/command/CommandPalette.tsx",
];

describe("a modal you can get out of", () => {
  it.each(OVERLAYS)("%s dismisses from the backdrop itself", (file) => {
    const text = code(file);
    // The dark layer is the element under the pointer, so it is the element
    // that has to carry the handler.
    const backdrop = /<div\s+aria-hidden="true"\s+onMouseDown=/.exec(text);
    expect(
      backdrop,
      `${file} has no onMouseDown on its aria-hidden backdrop, so pressing outside the dialog does nothing`,
    ).not.toBeNull();
  });

  it.each(OVERLAYS)("%s does not guard dismissal on the wrapper", (file) => {
    // The guard that could never be true. If this string comes back, the
    // click-outside is dead again and the phone is trapped again.
    expect(code(file)).not.toContain("event.target === event.currentTarget");
  });
});

/* ------------------------------------------------- 2. asking without a session */

const SESSION: AdminAccess = {
  kind: "session",
  // Shapes only. Nothing in `canAsk` reads either.
  session: {
    operatorId: "00000000-0000-4000-8000-000000000001",
  } as AdminAccess extends { kind: "session"; session: infer S } ? S : never,
  csrfToken: "not-checked-here",
};
const OPEN: AdminAccess = { kind: "open" };

/** The environment of a real deployment: no demo flag, a real database. */
function realDeployment(): void {
  vi.stubEnv(DEMO_ENV_VAR, undefined);
  vi.stubEnv("SUPABASE_DB_URL", "postgresql://user@example.invalid:5432/live");
}

/** The environment of the demonstration: the flag, and no database named. */
function openDemonstration(): void {
  vi.stubEnv(DEMO_ENV_VAR, "1");
  vi.stubEnv("SUPABASE_DB_URL", undefined);
}

describe("who may ask the team", () => {
  it("lets a signed-in founder ask, demo or not", () => {
    realDeployment();
    expect(canAsk(SESSION)).toBe(true);
    openDemonstration();
    expect(canAsk(SESSION)).toBe(true);
  });

  it("still refuses an unauthenticated ask with the variable unset", () => {
    realDeployment();
    expect(canAsk(OPEN)).toBe(false);
  });

  it("lets the open demonstration ask", () => {
    openDemonstration();
    expect(canAsk(OPEN)).toBe(true);
  });

  it("refuses when the demo flag is set over a real database", () => {
    // The narrowing that matters. `HALF_SOUR_DEMO=1` beside a real
    // `SUPABASE_DB_URL` is a real business's admin, and an anonymous POST must
    // not open runs or write rows in it.
    vi.stubEnv(DEMO_ENV_VAR, "1");
    vi.stubEnv(
      "SUPABASE_DB_URL",
      "postgresql://user@example.invalid:5432/live",
    );
    expect(canAsk(OPEN)).toBe(false);
  });
});

describe("the name the record gives an unauthenticated ask", () => {
  it("is not a person and does not pretend to be one", () => {
    expect(OPEN_DEMO_ACTOR.label).toMatch(/nobody/i);
    expect(OPEN_DEMO_ACTOR.fullName).toMatch(/demonstration/i);
    // RFC 2606 reserves `.invalid`, so this can never be somebody's address.
    expect(OPEN_DEMO_ACTOR.email.endsWith(".invalid")).toBe(true);
  });

  it("is written as a system row, never as an operator", () => {
    const actions = source("components/admin/chat/actions.ts");
    expect(actions).toContain("actorType");
    expect(actions).toContain("stampUnauthenticated");
    // And the stamp says so in the summary, not only in a column nobody reads.
    expect(source("components/admin/write/open-demo.ts")).toContain(
      "with nobody signed in",
    );
  });

  it("leaves every other write going through the one door", () => {
    // `authoriseAsk` is imported by the chat actions and by nothing else. A
    // second importer is a second surface that stopped asking for a password.
    const importers = [
      "app/(admin)/admin/team/actions.ts",
      "app/(admin)/admin/settings/actions.ts",
    ].filter((file) => {
      try {
        return source(file).includes("open-demo");
      } catch {
        return false;
      }
    });
    expect(importers).toEqual([]);
  });
});

/* --------------------------------------------- 3. the two warnings, folded */

describe("the demonstration bar carries both admin warnings", () => {
  it("says the admin is open, and that asking is part of that", () => {
    expect(DEMO_BANNER.admin).toMatch(/admin is open/i);
    expect(DEMO_BANNER.admin).toMatch(/no password/i);
    expect(DEMO_BANNER.admin).toMatch(/ask/i);
  });

  it("says what is actually true about changing something", () => {
    // The warning it replaced claimed a change "asks for the password first".
    // On a demonstration that is no longer true of asking, and a sentence that
    // is false is worse than no sentence.
    expect(DEMO_BANNER.reset).not.toMatch(/password/i);
    expect(DEMO_BANNER.reset).toMatch(/no name/i);
    expect(DEMO_BANNER.reset).toMatch(/deploy/i);
  });

  it("keeps the date the model warning existed to give", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "present-for-this-test");
    vi.stubEnv("HALF_SOUR_AGENT_MODEL", undefined);
    const notice = rosterModelNotice(process.env, new Date("2026-08-30"));
    expect(notice).not.toBeNull();
    expect(notice?.short).toContain(FREE_WINDOW_ENDS_SHORT);
    // Short enough to be one line of a bar, not a paragraph in it.
    expect(notice?.short.length).toBeLessThanOrEqual(40);
  });

  it("has a short form for every state the long one has", () => {
    const nothing = {
      AI_GATEWAY_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
    };
    for (const [label, env, now] of [
      ["no credential", nothing, new Date("2026-08-30")],
      ["window open", { AI_GATEWAY_API_KEY: "k" }, new Date("2026-08-30")],
      ["window closed", { AI_GATEWAY_API_KEY: "k" }, new Date("2026-09-30")],
    ] as const) {
      const notice = rosterModelNotice(env, now);
      expect(notice, label).not.toBeNull();
      expect(notice?.short.trim(), label).not.toBe("");
      expect(notice?.short.length, label).toBeLessThanOrEqual(40);
    }
  });

  it("sends anyone who wants the detail to the page that has it", () => {
    expect(DEMO_BANNER.modelHref).toBe("/admin/team");
    expect(source("app/(admin)/admin/team/page.tsx")).toContain(
      "rosterModelNotice",
    );
  });
});

describe("the admin no longer opens every screen with the same two notices", () => {
  const layout = () => source("app/(admin)/admin/layout.tsx");

  it("has dropped the open-demonstration callout", () => {
    expect(layout()).not.toContain("DEMO_ADMIN_OPEN");
  });

  it("keeps the model notice where there is no bar to carry it", () => {
    // Outside demo mode there is no bar at all, and this is the warning that
    // matters most on a real deployment. It moves; it never disappears.
    expect(layout()).toContain("isDemoMode() ? null : rosterModelNotice()");
  });

  it("still explains itself in full on the settings screen", () => {
    expect(DEMO_ADMIN_OPEN.body).toMatch(/asking the team/i);
    expect(DEMO_ADMIN_OPEN.body).toMatch(/password/i);
  });
});

/**
 * The bar's height reserve, and the floating panel that clears it.
 *
 * Three numbers in `app/layout.tsx` and three in `ChatDock.tsx`, and the second
 * set is the first plus one gutter. They are written as Tailwind steps in two
 * different files, so nothing but this test stops them drifting apart — and
 * when they drift the page either overlaps the bar or leaves a gap under it.
 */
describe("the bar's reserve and the dock stay in step", () => {
  const GUTTER = 4; // Tailwind steps, i.e. 16px.

  it("reserves the measured height at each of the three steps", () => {
    const body =
      /"flex min-h-full flex-col (pb-[\w-]+ sm:pb-[\w-]+ lg:pb-[\w-]+)"/.exec(
        source("app/layout.tsx"),
      );
    expect(body).not.toBeNull();
    // Measured against the built page at 320/360, 540/700 and 768 up:
    // 158px, 78px, 58-59px.
    expect(body?.[1]).toBe("pb-40 sm:pb-20 lg:pb-16");
  });

  it("anchors the floating panel one gutter above that reserve", () => {
    const dock = /const CLEAR_OF_BANNER = "(.+)";/.exec(
      source("components/admin/chat/ChatDock.tsx"),
    );
    expect(dock).not.toBeNull();
    const steps = (dock?.[1] ?? "")
      .split(" ")
      .map((token) => Number(token.replace(/^(sm:|lg:)?bottom-/, "")));
    expect(steps).toEqual([40 + GUTTER, 20 + GUTTER, 16 + GUTTER]);
  });
});
