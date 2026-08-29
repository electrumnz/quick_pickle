/**
 * "What it's for", read out of the recipe library rather than reinvented.
 *
 * `content/recipes/` already holds twenty-five drinks and dishes, each one
 * written against the ASA alcohol code and carrying its own audit markers. A
 * product page that wrote its own serve copy would be a second, unaudited
 * source of the same sentences. So this module indexes what is there and hands
 * the product page a short, ordered set: drinks first, because the bottle is a
 * bar ingredient before it is anything else, then the kitchen.
 *
 * Nothing here is a link. `/recipes` is another unit's route and does not exist
 * yet, and a product page full of dead links is worse than one that simply
 * prints the build.
 */

import { DIRTY_RECIPES } from "@/content/recipes/dirty";
import { HOUSE_RECIPES } from "@/content/recipes/house";
import { SMOKE_RECIPES } from "@/content/recipes/smoke";
import { WILD_RECIPES } from "@/content/recipes/wild";
import type { BrineId, Recipe } from "@/content/types";

const ALL: readonly Recipe[] = [
  ...HOUSE_RECIPES,
  ...DIRTY_RECIPES,
  ...SMOKE_RECIPES,
  ...WILD_RECIPES,
];

export type Serve = {
  readonly slug: string;
  readonly title: string;
  readonly kicker: string;
  readonly summary: string;
  readonly kind: Recipe["kind"];
  readonly yieldText: string;
  /**
   * The build, as a bartender writes it on a spec card: the measures from the
   * first ingredient group, amount then item, trimmed to the first clause so a
   * card stays a card. The full recipe lives in `content/recipes/`.
   */
  readonly build: readonly string[];
};

/** "45 ml Irish whiskey, at room temperature" -> "45 ml Irish whiskey" */
function line(amount: string, item: string): string {
  const head = item.split(",")[0] ?? item;
  return `${amount} ${head}`;
}

function toServe(recipe: Recipe, maxLines: number): Serve {
  const group = recipe.ingredients[0];
  const build =
    group === undefined
      ? []
      : group.items.slice(0, maxLines).map((m) => line(m.amount, m.item));
  return {
    slug: recipe.slug,
    title: recipe.title,
    kicker: recipe.kicker,
    summary: recipe.summary,
    kind: recipe.kind,
    yieldText: recipe.yieldText,
    build,
  };
}

/**
 * The serves for one bottle, drinks first.
 *
 * A recipe that merely *also works with* this bottle is deliberately excluded:
 * the page is answering "what is this bottle for", and a list padded with
 * near-misses answers it worse.
 */
export function servesFor(
  brine: BrineId,
  { drinks = 3, dishes = 3 }: { drinks?: number; dishes?: number } = {},
): { readonly drinks: readonly Serve[]; readonly dishes: readonly Serve[] } {
  const mine = ALL.filter((recipe) => recipe.brine === brine);
  return {
    drinks: mine
      .filter((recipe) => recipe.kind === "drink")
      .slice(0, drinks)
      .map((recipe) => toServe(recipe, 3)),
    dishes: mine
      .filter((recipe) => recipe.kind === "dish")
      .slice(0, dishes)
      .map((recipe) => toServe(recipe, 3)),
  };
}

/** How many recipes in the library are built on this bottle. A real count. */
export function serveCount(brine: BrineId): number {
  return ALL.filter((recipe) => recipe.brine === brine).length;
}

/**
 * How many drinks are in a bottle.
 *
 * Arithmetic, not a marketing figure: the divisor is the measure printed in the
 * recipe this bottle was built for, and both numbers are shown so the sum can
 * be checked on sight. That is the difference between "about thirty martinis to
 * a bottle" — a claim someone has to stand behind under the Fair Trading Act —
 * and "500 ml at 20 ml a drink", which is a division.
 *
 * Returns null when the bottle has no drink recipe, or when that recipe's
 * measure is not volumetric. A number that cannot be derived is not estimated.
 */
export function drinksPerBottle(
  brine: BrineId,
  bottleMl: number | null,
): {
  readonly count: number;
  readonly perServeMl: number;
  readonly title: string;
} | null {
  if (bottleMl === null || bottleMl <= 0) return null;

  const drink = ALL.find(
    (recipe) => recipe.brine === brine && recipe.kind === "drink",
  );
  if (drink === undefined) return null;

  // The brine's own line in the build. Matched on the label form the recipe
  // library uses for it — "No. 02 DIRTY" — rather than on position, because a
  // recipe is free to list the spirit first.
  const label = `No. ${brine.slice(3, 5)} `;
  for (const group of drink.ingredients) {
    for (const measure of group.items) {
      if (!measure.item.startsWith(label)) continue;
      const ml = measure.metricMl;
      if (ml === undefined || ml <= 0) return null;
      return {
        count: Math.floor(bottleMl / ml),
        perServeMl: ml,
        title: drink.title,
      };
    }
  }
  return null;
}
