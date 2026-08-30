import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AXE_TAGS, DISABLED_RULES } from "@/e2e/support/axe-policy";
import {
  ADMIN_ROUTES,
  PRODUCT_HANDLES,
  PUBLIC_ROUTES,
  SAMPLE_RECIPE_SLUG,
  UNAUDITED_ROUTES,
} from "@/e2e/support/routes";
import { recipeBySlug } from "@/components/site/recipes";

/**
 * The audit's own guard rail.
 *
 * `e2e/a11y.spec.ts` and `e2e/a11y-admin.spec.ts` audit a LIST of routes, and a
 * list is the one kind of test coverage that rots without anybody noticing: a
 * new page ships, nobody adds it, and the suite stays green while the surface
 * it measures shrinks as a proportion of the site. So the list is checked
 * against the filesystem here, in the unit suite, which runs on every push.
 *
 * The same argument applies to axe's own configuration. A rule quietly turned
 * off is indistinguishable from a rule that passes, so a disabled rule has to
 * carry its reason with it and the tags have to stay the ones that were agreed.
 */

const ROOT = path.resolve(__dirname, "..", "..");

/** Every `page.tsx` under `app/`, as the route it serves. */
function routesUnderApp(): readonly string[] {
  const found: string[] = [];

  const walk = (dir: string, segments: readonly string[]): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        // `(group)` is an organisational folder and contributes no segment;
        // `@slot` and `_private` never become routes at all.
        if (entry.startsWith("_") || entry.startsWith("@")) continue;
        const next =
          entry.startsWith("(") && entry.endsWith(")")
            ? segments
            : [...segments, entry];
        walk(full, next);
        continue;
      }
      if (entry === "page.tsx" || entry === "page.ts") {
        found.push(`/${segments.join("/")}`);
      }
    }
  };

  walk(path.join(ROOT, "app"), []);
  return found;
}

/** A dynamic segment matches whatever an audited route put in its place. */
function isAudited(route: string, audited: readonly string[]): boolean {
  if (audited.includes(route)) return true;
  const pattern = new RegExp(
    `^${route
      .split("/")
      .map((segment) =>
        segment.startsWith("[") && segment.endsWith("]")
          ? "[^/]+"
          : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/")}$`,
  );
  return audited.some((candidate) =>
    pattern.test(candidate.split("?")[0] ?? ""),
  );
}

describe("the accessibility pass covers what ships", () => {
  const audited = [...PUBLIC_ROUTES, ...ADMIN_ROUTES].map(
    (route) => route.path,
  );

  it("audits, or names a reason for skipping, every page under app/", () => {
    const missing = routesUnderApp().filter(
      (route) =>
        !isAudited(route, audited) && UNAUDITED_ROUTES[route] === undefined,
    );

    expect(
      missing,
      `These routes ship and nothing audits them. Add each to e2e/support/routes.ts, or to UNAUDITED_ROUTES with the reason it does not need auditing:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("gives every unaudited route a reason worth reading", () => {
    for (const [route, reason] of Object.entries(UNAUDITED_ROUTES)) {
      expect(reason.length, `${route} has no reason`).toBeGreaterThan(40);
    }
  });

  it("names every route that ships when it lists an exclusion", () => {
    const live = routesUnderApp();
    const stale = Object.keys(UNAUDITED_ROUTES).filter(
      (route) => !live.includes(route),
    );
    expect(
      stale,
      `These routes are excluded from the audit and no longer exist. Delete them from UNAUDITED_ROUTES:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("audits a recipe slug that exists", () => {
    expect(
      recipeBySlug(SAMPLE_RECIPE_SLUG),
      `e2e/support/routes.ts audits /recipes/${SAMPLE_RECIPE_SLUG}, which is not in the library`,
    ).not.toBeNull();
  });

  it("audits every bottle the range sells", () => {
    // The product page is one template, but the four bottles put it in four
    // different states — sellable, sold out, unlisted for supply, and a box —
    // and it is the states that have the accessibility problems.
    const brines = readFileSync(
      path.join(ROOT, "content", "brines.ts"),
      "utf8",
    );
    const handles = [...brines.matchAll(/handle:\s*"([a-z0-9-]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    for (const handle of handles) {
      expect(
        PRODUCT_HANDLES,
        `${handle} is in the range and is not audited`,
      ).toContain(handle);
    }
  });
});

describe("the axe configuration stays honest", () => {
  it("measures WCAG A and AA across 2.0, 2.1 and 2.2, plus best practice", () => {
    expect(AXE_TAGS).toEqual([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
      "best-practice",
    ]);
  });

  it("makes a disabled rule say why it is disabled", () => {
    for (const [rule, reason] of Object.entries(DISABLED_RULES)) {
      expect(
        reason.length,
        `axe rule ${rule} is switched off with no reason given`,
      ).toBeGreaterThan(40);
    }
  });
});
