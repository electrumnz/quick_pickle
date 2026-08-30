/**
 * The recipe library, indexed.
 *
 * `content/recipes/` already holds twenty-five drinks and dishes as typed
 * records, each written against the ASA alcohol code and carrying its own copy
 * markers. This module is the only thing that knows the order they appear in
 * and how to find one by slug; it adds no words of its own, so the copy auditor
 * still scans the recipes exactly once, where they are authored.
 *
 * The slug is the URL. `assertUniqueSlugs` runs at module load rather than in a
 * test, because two recipes sharing a slug would silently make one of them
 * unreachable — a 200 that serves the wrong page is worse than a 404.
 */

import { DIRTY_RECIPES } from "@/content/recipes/dirty";
import { HOUSE_RECIPES } from "@/content/recipes/house";
import { SMOKE_RECIPES } from "@/content/recipes/smoke";
import { WILD_RECIPES } from "@/content/recipes/wild";
import type { BrineId, Recipe, RecipeKind } from "@/content/types";

/**
 * Range order, then the order each file lists them in — which is the order the
 * founder wrote them in, drinks before dishes within a bottle.
 */
export const ALL_RECIPES: readonly Recipe[] = [
  ...HOUSE_RECIPES,
  ...DIRTY_RECIPES,
  ...SMOKE_RECIPES,
  ...WILD_RECIPES,
];

function assertUniqueSlugs(recipes: readonly Recipe[]): void {
  const seen = new Set<string>();
  for (const recipe of recipes) {
    if (seen.has(recipe.slug)) {
      throw new Error(
        `Two recipes share the slug "${recipe.slug}", so one of them has no page.`,
      );
    }
    seen.add(recipe.slug);
  }
}

assertUniqueSlugs(ALL_RECIPES);

const BY_SLUG: ReadonlyMap<string, Recipe> = new Map(
  ALL_RECIPES.map((recipe) => [recipe.slug, recipe]),
);

export function recipeBySlug(slug: string): Recipe | null {
  return BY_SLUG.get(slug) ?? null;
}

export function recipeHref(slug: string): string {
  return `${RECIPES_PATH}/${slug}`;
}

export const RECIPES_PATH = "/recipes";

/** Every recipe built on one bottle, in library order. */
export function recipesForBrine(brine: BrineId): readonly Recipe[] {
  return ALL_RECIPES.filter((recipe) => recipe.brine === brine);
}

/** Recipes that name this bottle as an alternative rather than as the build. */
export function recipesAlsoUsing(brine: BrineId): readonly Recipe[] {
  return ALL_RECIPES.filter((recipe) => recipe.alsoWorksWith.includes(brine));
}

export function recipesOfKind(kind: RecipeKind): readonly Recipe[] {
  return ALL_RECIPES.filter((recipe) => recipe.kind === kind);
}

/**
 * The first lines of a recipe's build, as a bartender writes them on a spec
 * card: amount, then the ingredient trimmed to its first clause.
 *
 * The library index prints these on every tile instead of a picture. There is
 * no photograph of any of these drinks in this repository, and the tile artwork
 * has to be the same shape on every card — so what fills that shape is the one
 * thing that is both true and different on every card, and is also what a
 * person scanning a recipe library is actually looking for.
 */
export function buildLines(recipe: Recipe, limit = 3): readonly string[] {
  const group = recipe.ingredients[0];
  if (group === undefined) return [];
  return group.items
    .slice(0, limit)
    .map(
      (measure) =>
        `${measure.amount} ${measure.item.split(",")[0] ?? measure.item}`,
    );
}

/** How many recipes are in the library. A count, not an estimate. */
export function recipeCount(): number {
  return ALL_RECIPES.length;
}

/** The library, grouped by the bottle each one is built on. */
export interface BrineGroup {
  readonly brine: BrineId;
  readonly drinks: readonly Recipe[];
  readonly dishes: readonly Recipe[];
}

export function groupedByBrine(
  order: readonly BrineId[],
): readonly BrineGroup[] {
  return order.map((brine) => {
    const mine = recipesForBrine(brine);
    return {
      brine,
      drinks: mine.filter((recipe) => recipe.kind === "drink"),
      dishes: mine.filter((recipe) => recipe.kind === "dish"),
    };
  });
}
