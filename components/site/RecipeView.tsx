import Link from "next/link";

import { brineLabel, productHref } from "@/content/brines";
import {
  humanDuration,
  totalMinutes,
  type Measure,
  type Recipe,
} from "@/content/types";
import { cx } from "@/components/product/cx";
import shop from "@/components/product/shop.module.css";
import { StoreFooter, StoreHeader } from "@/components/product/StoreChrome";

import { DIFFICULTY_WORD, RECIPES, RECIPES_HREF } from "./copy";
import styles from "./site.module.css";

/**
 * One recipe, on a page of its own.
 *
 * Individually addressable, because that is what a recipe is for: somebody
 * sends it to somebody else. The URL is the slug from `content/recipes/`, and
 * `app/(site)/recipes/[slug]/page.tsx` generates one page per record.
 *
 * The page renders the record and nothing else — no headline written here, no
 * sentence about the drink that is not in the data. Every word a visitor reads
 * has already been through `legal/scripts/audit-copy.mjs` where it was
 * authored, and the only strings this file owns are the section headings in
 * `copy.ts`.
 *
 * Ingredients sit beside the method on a wide screen and stick while the method
 * scrolls, because a cook glances back at the measures and not at step four.
 * Under `prefers-reduced-motion` the stick is dropped: a panel that moves
 * relative to the page is motion the reader did not ask for.
 */

function MeasureRow({ measure }: { measure: Measure }) {
  return (
    <li className={cx(styles.measure)}>
      <span className={cx(shop.figure, "text-body-sm text-primary")}>
        {measure.amount}
      </span>
      <span>
        <span className="text-body-sm text-primary block">{measure.item}</span>
        {measure.note === undefined ? null : (
          <span className="text-caption text-muted mt-1 block">
            {measure.note}
          </span>
        )}
      </span>
    </li>
  );
}

function Facts({ recipe }: { recipe: Recipe }) {
  const rows: readonly { readonly label: string; readonly value: string }[] = [
    { label: RECIPES.yieldLabel, value: recipe.yieldText },
    { label: RECIPES.prepLabel, value: humanDuration(recipe.prepMinutes) },
    ...(recipe.cookMinutes > 0
      ? [{ label: RECIPES.cookLabel, value: humanDuration(recipe.cookMinutes) }]
      : []),
    ...(recipe.restMinutes > 0
      ? [{ label: RECIPES.restLabel, value: humanDuration(recipe.restMinutes) }]
      : []),
    { label: RECIPES.totalLabel, value: humanDuration(totalMinutes(recipe)) },
    {
      label: RECIPES.difficultyLabel,
      value: DIFFICULTY_WORD[recipe.difficulty] ?? recipe.difficulty,
    },
    ...(recipe.serveIn === undefined
      ? []
      : [{ label: RECIPES.serveInLabel, value: recipe.serveIn }]),
    ...(recipe.ice === undefined
      ? []
      : [{ label: RECIPES.iceLabel, value: recipe.ice }]),
    ...(recipe.garnish === undefined
      ? []
      : [{ label: RECIPES.garnishLabel, value: recipe.garnish }]),
  ];

  return (
    <dl className="border-hairline mt-block border-t">
      {rows.map((row) => (
        <div
          key={row.label}
          className="border-hairline flex flex-wrap items-baseline justify-between gap-4 border-b py-2"
        >
          <dt className="text-caption text-muted">{row.label}</dt>
          <dd className="text-body-sm text-primary max-w-prose text-right">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function List({
  heading,
  items,
}: {
  heading: string;
  items: readonly string[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-section">
      <h2 className="text-heading-2 text-primary">{heading}</h2>
      <ul className="mt-stack">
        {items.map((item) => (
          <li
            key={item}
            className="border-hairline text-body text-muted max-w-prose border-t py-3"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RecipeView({ recipe }: { recipe: Recipe }) {
  return (
    <>
      <StoreHeader here="recipes" />

      <main id="top" className="flex-1">
        <nav aria-label="Breadcrumb" className="px-gutter pt-stack">
          <ol className="max-w-page text-caption text-muted mx-auto flex flex-wrap items-center gap-2">
            <li>
              <Link href={RECIPES_HREF} className={cx(shop.tap, "pr-1")}>
                <span className={cx(shop.drawLink)}>
                  {RECIPES.backToLibrary}
                </span>
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className={cx(shop.figure, "uppercase")}>
              {recipe.title}
            </li>
          </ol>
        </nav>

        <header className="px-gutter pt-stack pb-block">
          <div className="max-w-page mx-auto">
            <div className="max-w-prose">
              <p className="text-eyebrow text-muted font-mono uppercase">
                {recipe.kicker}
              </p>
              <h1 className="text-display-2 text-primary mt-stack">
                {recipe.title}
              </h1>
              <p className="text-lede text-primary mt-stack">
                {recipe.summary}
              </p>

              <p className="text-body-sm text-muted mt-block">
                {RECIPES.builtOn}{" "}
                <Link
                  href={productHref(recipe.brine)}
                  className={cx(shop.tap, "text-primary")}
                >
                  <span className={cx(shop.drawLink)}>
                    {brineLabel(recipe.brine)}
                  </span>
                </Link>
                {recipe.alsoWorksWith.length === 0 ? null : (
                  <>
                    {" · "}
                    {RECIPES.alsoWorks}{" "}
                    {recipe.alsoWorksWith.map((other, index) => (
                      <span key={other}>
                        {index > 0 ? ", " : null}
                        <Link
                          href={productHref(other)}
                          className={cx(shop.tap, "text-primary")}
                        >
                          <span className={cx(shop.drawLink)}>
                            {brineLabel(other)}
                          </span>
                        </Link>
                      </span>
                    ))}
                  </>
                )}
              </p>
            </div>
          </div>
        </header>

        <div className="px-gutter pb-section">
          <div className={cx(styles.recipeBody, "max-w-page mx-auto")}>
            <div className={cx(styles.ingredients)}>
              <h2 className="text-heading-2 text-primary">
                {RECIPES.ingredientsHeading}
              </h2>
              {recipe.ingredients.map((group, index) => (
                <div key={group.heading ?? `group-${String(index)}`}>
                  {group.heading === undefined ? null : (
                    <h3 className="text-eyebrow text-muted mt-block font-mono uppercase">
                      {group.heading}
                    </h3>
                  )}
                  <ul className="mt-stack">
                    {group.items.map((measure) => (
                      <MeasureRow
                        key={`${measure.amount}-${measure.item}`}
                        measure={measure}
                      />
                    ))}
                  </ul>
                </div>
              ))}

              <Facts recipe={recipe} />
            </div>

            <div>
              <h2 className="text-heading-2 text-primary">
                {RECIPES.stepsHeading}
              </h2>
              <ol className={cx(styles.steps, "mt-stack")}>
                {recipe.steps.map((step, index) => (
                  <li
                    key={step.text}
                    className={cx(styles.step)}
                    id={`step-${String(index + 1)}`}
                  >
                    <span className="text-body text-primary max-w-prose">
                      {step.text}
                      {step.seconds === undefined ? null : (
                        <span
                          className={cx(
                            shop.figure,
                            "text-caption text-muted mt-1 block",
                          )}
                        >
                          {String(step.seconds)} seconds
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>

              <List heading={RECIPES.notesHeading} items={recipe.notes} />
              <List heading={RECIPES.swapsHeading} items={recipe.swaps ?? []} />
              <List heading={RECIPES.toolsHeading} items={recipe.tools ?? []} />

              {recipe.batch === undefined ? null : (
                <section className="mt-section">
                  <h2 className="text-heading-2 text-primary">
                    {RECIPES.batchHeading}
                  </h2>
                  <p className="text-body text-primary mt-stack max-w-prose">
                    {recipe.batch.headline}
                  </p>
                  <dl className="border-hairline mt-stack border-t">
                    {recipe.batch.rows.map((row) => (
                      <div
                        key={row.label}
                        className="border-hairline flex flex-wrap items-baseline justify-between gap-4 border-b py-2"
                      >
                        <dt className="text-caption text-muted">{row.label}</dt>
                        <dd
                          className={cx(
                            shop.figure,
                            "text-body-sm text-primary",
                          )}
                        >
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-body-sm text-muted mt-stack max-w-prose">
                    {recipe.batch.note}
                  </p>
                </section>
              )}

              {recipe.credit === undefined ? null : (
                <section className="mt-section">
                  <h2 className="text-heading-2 text-primary">
                    {RECIPES.creditHeading}
                  </h2>
                  <p className="text-body text-muted mt-stack max-w-prose">
                    {recipe.credit}
                  </p>
                </section>
              )}
            </div>
          </div>
        </div>
      </main>

      <StoreFooter />
    </>
  );
}
