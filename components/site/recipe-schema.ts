/**
 * schema.org `Recipe`, generated from the same record the page renders.
 *
 * Two things are deliberately absent, and both are absences rather than
 * oversights.
 *
 * **No `nutrition`.** schema.org offers `NutritionInformation` and search
 * engines reward it. Publishing a calorie or sodium figure we have not had
 * analysed would be an unsubstantiated representation under Fair Trading Act
 * 1986 s 12A, and lifting a figure out of the mandatory nutrition panel into
 * marketing turns it into a nutrition content claim (FSC Standard 1.1.2—9(3)).
 * There is no number here and there will not be one until there is a laboratory
 * analysis to cite.
 *
 * **No `image`.** Google wants one for a rich result. What this build has is
 * photography of the bottles, and a photograph of a bottle is not a photograph
 * of the drink — captioning it as the recipe would be a representation about
 * the goods that is not true. A missing image costs a rich result; a wrong one
 * costs more than that.
 *
 * Everything else is a direct transcription: the measures as they are written
 * to be read aloud, the steps in order, the yield, and ISO-8601 durations built
 * by `isoDuration` so `PT0M` — which is not valid — is never emitted.
 */

import { brineLabel } from "@/content/brines";
import { isoDuration, totalMinutes, type Recipe } from "@/content/types";
import { siteUrl } from "@/lib/site";

import { recipeHref, RECIPES_PATH } from "./recipes";

type Json = Record<string, unknown>;

const PUBLISHER: Json = {
  "@type": "Organization",
  name: "Half Sour",
};

/** "60 ml London dry gin, 47% or above" — the line as a cook reads it. */
export function ingredientLines(recipe: Recipe): readonly string[] {
  return recipe.ingredients.flatMap((group) =>
    group.items.map((measure) => `${measure.amount} ${measure.item}`),
  );
}

export function recipeJsonLd(recipe: Recipe): Json {
  const base = siteUrl();
  const url = `${base}${recipeHref(recipe.slug)}`;

  const node: Json = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    description: recipe.summary,
    url,
    mainEntityOfPage: url,
    author: PUBLISHER,
    publisher: PUBLISHER,
    datePublished: recipe.published,
    recipeCategory: recipe.kind === "drink" ? "Drink" : "Dish",
    recipeYield: recipe.yieldText,
    recipeIngredient: [...ingredientLines(recipe)],
    recipeInstructions: recipe.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      text: step.text,
      url: `${url}#step-${String(index + 1)}`,
    })),
    keywords: [...recipe.keywords, brineLabel(recipe.brine)].join(", "),
  };

  if (recipe.updated !== undefined) node.dateModified = recipe.updated;

  const prep = isoDuration(recipe.prepMinutes);
  if (prep !== undefined) node.prepTime = prep;
  const cook = isoDuration(recipe.cookMinutes);
  if (cook !== undefined) node.cookTime = cook;
  const total = isoDuration(totalMinutes(recipe));
  if (total !== undefined) node.totalTime = total;

  if (recipe.tools !== undefined && recipe.tools.length > 0) {
    node.tool = recipe.tools.map((tool) => ({
      "@type": "HowToTool",
      name: tool,
    }));
  }

  // The bottle the recipe is built on, named as what it is: a supply the cook
  // needs. `supply` is the schema.org counterpart to `tool` and is the honest
  // place for it — it is not an offer and it is not an endorsement.
  node.supply = [{ "@type": "HowToSupply", name: brineLabel(recipe.brine) }];

  return node;
}

/** The library index, as an ordered list a crawler can follow. */
export function recipeListJsonLd(recipes: readonly Recipe[]): Json {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Recipes",
    url: `${base}${RECIPES_PATH}`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: recipes.length,
      itemListElement: recipes.map((recipe, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: recipe.title,
        url: `${base}${recipeHref(recipe.slug)}`,
      })),
    },
  };
}
