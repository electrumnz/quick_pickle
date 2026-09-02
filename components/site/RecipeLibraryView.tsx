import Link from "next/link";

import { BRINE_ORDER, brineLabel, productHref } from "@/content/brines";
import { humanDuration, totalMinutes, type Recipe } from "@/content/types";
import { SEAL_TONE, type SealTone } from "@/components/home/data";
import home from "@/components/home/home.module.css";
import { cx } from "@/components/product/cx";
import shop from "@/components/product/shop.module.css";
import { StoreFooter, StoreHeader } from "@/components/product/StoreChrome";

import { fill, RECIPES } from "./copy";
import { ALL_RECIPES, buildLines, groupedByBrine, recipeHref } from "./recipes";
import styles from "./site.module.css";

/**
 * The recipe library.
 *
 * Every product page counts the recipes for its bottle — "7 in the recipe
 * library" — and until this route existed that count sent nobody anywhere. It
 * was the site breaking a promise in the same sentence it made it, and it is
 * the BrandScript's transitional call: the low-risk yes, given away with
 * nothing asked in return.
 *
 * ## The tiles are all one tile
 *
 * A grid of cards whose heights are set by their titles reads as broken rather
 * than as editorial, so nothing here is allowed to set a tile's height:
 *
 *   * every tile opens with a fixed 5:4 head, the same ratio on all of them;
 *   * the head holds exactly three lines of the build, so it cannot grow;
 *   * the title is clamped to two lines, so a one-line and a two-line title
 *     occupy the same box and the metadata row under them lands on one baseline
 *     right across the grid;
 *   * the card is `height: 100%` inside a stretched grid item, so every card in
 *     a row is as tall as the tallest.
 *
 * ## Why the head is type and not a picture
 *
 * There is no photograph of any of these twenty-five drinks and dishes in this
 * repository, and a photograph of the BOTTLE captioned as the recipe would be a
 * representation about the goods that is not true. The drawn bottle plate was
 * tried and discarded for a plainer reason: the grid is grouped by bottle, so
 * it put the same picture on seven tiles in a row and told a reader nothing.
 *
 * What fills the head instead is the first three lines of the build — true,
 * different on every tile, and the thing somebody scanning a recipe library is
 * actually looking for.
 *
 * The count is `ALL_RECIPES.length`, read from the same index the product pages
 * count through. One list, so a published number cannot drift.
 */

const SEAL_CLASS: Readonly<Record<SealTone, string | undefined>> = {
  accent: home.toneAccent,
  inverse: home.toneInverse,
  danger: home.toneDanger,
  secondary: home.toneSecondary,
};

/**
 * One recipe on the shelf.
 *
 * Led by the name, because that is what a person scanning a library is
 * looking for; the build sits under it as a quiet mono list on the page
 * ground. The tile used to open with a black block carrying the build in
 * reversed type, and twenty-five of those in a grid read as a code listing
 * rather than a set of drinks. The one device that says which bottle is the
 * seal in that bottle's colour, the same mark the labels carry.
 */
function Tile({ recipe }: { recipe: Recipe }) {
  return (
    <article className={cx(styles.card)} data-tile="recipe">
      <div className="gap-inline flex items-center">
        <span
          className={cx(home.seal, SEAL_CLASS[SEAL_TONE[recipe.brine]])}
          aria-hidden="true"
        />
        <p className="text-eyebrow text-muted font-mono uppercase">
          {recipe.kicker}
        </p>
      </div>

      <h3 className={cx(styles.clamp2, "text-heading-2 text-primary mt-stack")}>
        <Link
          href={recipeHref(recipe.slug)}
          className={cx(styles.cardLink, "text-primary")}
        >
          {recipe.title}
        </Link>
      </h3>

      <p className={cx(styles.clamp3, "text-body-sm text-primary mt-2")}>
        {recipe.summary}
      </p>

      <ul className={cx(styles.tileBuild, "mt-stack")}>
        {buildLines(recipe).map((buildLine) => (
          <li key={buildLine} className={cx(shop.figure, "text-caption")}>
            {buildLine}
          </li>
        ))}
      </ul>

      <p
        className={cx(
          shop.figure,
          "text-caption text-muted border-hairline mt-auto flex flex-wrap items-baseline gap-2 border-t pt-3",
        )}
      >
        <span>{brineLabel(recipe.brine)}</span>
        <span aria-hidden="true">·</span>
        <span>{humanDuration(totalMinutes(recipe))}</span>
      </p>
    </article>
  );
}

function Group({
  heading,
  recipes,
}: {
  heading: string;
  recipes: readonly Recipe[];
}) {
  if (recipes.length === 0) return null;
  return (
    <>
      <h3 className="text-eyebrow text-muted border-hairline mt-block border-b pb-3 font-mono uppercase">
        {heading}
      </h3>
      <ul className={cx(styles.cards, "mt-stack")}>
        {recipes.map((recipe) => (
          <li key={recipe.slug}>
            <Tile recipe={recipe} />
          </li>
        ))}
      </ul>
    </>
  );
}

export function RecipeLibraryView() {
  const groups = groupedByBrine(BRINE_ORDER);

  return (
    <>
      <StoreHeader here="recipes" />

      <main id="top" className="flex-1">
        <section className="px-gutter pt-block pb-block" aria-labelledby="r-h1">
          <div className="max-w-page mx-auto">
            <p className="text-eyebrow text-muted font-mono uppercase">
              {RECIPES.eyebrow}
            </p>
            <h1 id="r-h1" className="text-display-2 text-primary mt-stack">
              {RECIPES.heading}
            </h1>
            <p className="text-lede text-primary mt-stack max-w-prose">
              {RECIPES.lede}
            </p>
            <p
              className={cx(
                shop.figure,
                "text-caption text-muted mt-block border-hairline border-t pt-3 uppercase",
              )}
            >
              {fill(RECIPES.countLine, { count: ALL_RECIPES.length })}
            </p>
            {/* Twenty-five recipes under four bottles: the four names are the
                index, and each one jumps to its group. */}
            <nav aria-label="Bottles" className="mt-stack">
              <ul className="gap-stack flex flex-wrap">
                {BRINE_ORDER.map((brine) => (
                  <li key={brine}>
                    <a
                      href={`#${brine}`}
                      className={cx(shop.tap, "text-body-sm text-primary")}
                    >
                      <span className={cx(shop.drawLink)}>
                        {brineLabel(brine)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </section>

        {groups.map((group) => (
          <section
            key={group.brine}
            className="px-gutter scroll-mt-24 pb-section"
            aria-labelledby={`r-${group.brine}`}
            id={group.brine}
          >
            <div className="max-w-page mx-auto">
              <div className="gap-stack flex flex-wrap items-baseline justify-between">
                <h2
                  id={`r-${group.brine}`}
                  className="text-display-3 text-primary"
                >
                  {brineLabel(group.brine)}
                </h2>
                <Link
                  href={productHref(group.brine)}
                  className={cx(shop.tap, "text-body-sm text-primary")}
                >
                  <span className={cx(shop.drawLink)}>{RECIPES.buyLine}</span>
                </Link>
              </div>

              <Group heading={RECIPES.drinksLabel} recipes={group.drinks} />
              <Group heading={RECIPES.dishesLabel} recipes={group.dishes} />
            </div>
          </section>
        ))}
      </main>

      <StoreFooter />
    </>
  );
}
