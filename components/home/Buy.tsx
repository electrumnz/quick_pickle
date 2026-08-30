import { LIST } from "@/components/site/copy";
import { JoinTheList, type SignupState } from "@/components/site/SignupForm";

import { BUY, FULL_SET, price } from "./data";
import { cx } from "./cx";
import styles from "./home.module.css";
import { isLive } from "./routes";

/**
 * The route to buy.
 *
 * A page that lists five prices and offers no way to act on any of them is not
 * a storefront, and until this section existed that is what this one was.
 *
 * ## What changed, and why the old note had to go
 *
 * This block used to carry two `mailto:` links and a paragraph explaining that
 * there was no form behind either of them. That was honest when it was written
 * and it is not true any more:
 *
 *   * The list is a real one-field form posting to a Server Action that writes
 *     to `public.list_signups`. The avatar audit's `reorder-without-an-inbox`
 *     check exists because two bottles a year is the whole direct plan, so the
 *     second order is half the revenue — and a list joined by composing an
 *     email is a list joined by nobody.
 *   * The trade route is `/wholesale`, which publishes the price rather than
 *     promising one inside two working days.
 *
 * Both still work with JavaScript switched off: the form posts, the action
 * runs, and the answer comes back as a redirect carrying a query parameter,
 * which is the same mechanism the buy path uses.
 */
export function Buy({ signup }: { signup: SignupState }) {
  const shopLive = isLive({ href: BUY.shop.href, label: BUY.shop.label });
  const tradeLive = isLive({ href: BUY.trade.href, label: BUY.trade.label });

  return (
    <section
      id="buy"
      aria-labelledby="buy-heading"
      data-reveal-group
      className="px-gutter py-section"
    >
      <div className="max-w-page gap-block mx-auto grid md:grid-cols-2">
        <div className="max-w-prose" data-reveal>
          <p className="text-eyebrow text-muted font-mono uppercase">
            {BUY.kicker}
          </p>
          <h2 id="buy-heading" className="text-display-2 text-primary mt-stack">
            {BUY.title}
          </h2>
          <p className="text-lede text-muted mt-block">{BUY.line}</p>

          {shopLive ? (
            <a
              href={BUY.shop.href}
              className={cx(
                styles.button,
                styles.buttonPrimary,
                "mt-block w-fit",
              )}
              data-cursor="link"
              data-cursor-label={BUY.shop.label}
            >
              {BUY.shop.label}
            </a>
          ) : (
            /*
              Not a fallback and not an apology: while the catalogue is still
              being built the address IS the route, and saying which door is
              open is more use to a reader than a button that 404s.
            */
            <p className="text-body-sm text-muted border-hairline mt-block max-w-prose border-l pl-4">
              The shop opens with the catalogue. Until then both routes below go
              to the same address, and an order placed there is filled by hand.
            </p>
          )}

          <p
            className={cx(
              styles.figure,
              "text-caption text-muted border-hairline mt-block border-t pt-6",
            )}
          >
            {FULL_SET.name} &mdash; {price(FULL_SET.priceNzd)} &middot; three
            bottles &middot; 500 ML each
          </p>
        </div>

        <div className="gap-block grid content-start">
          <div className="border-hairline border-t pt-6" data-reveal>
            <h3 className="text-heading-3 text-primary">{LIST.heading}</h3>
            <p className="text-body-sm text-muted mt-stack max-w-prose">
              {LIST.line}
            </p>
            <div className="mt-block">
              <JoinTheList state={signup} sourcePath="/" />
            </div>
          </div>

          {tradeLive ? (
            <div className="border-hairline border-t pt-6" data-reveal>
              <h3 className="text-heading-3 text-primary">
                {BUY.trade.heading}
              </h3>
              <p className="text-body-sm text-muted mt-stack max-w-prose">
                {BUY.trade.line}
              </p>
              <a
                href={BUY.trade.href}
                className={cx(
                  styles.button,
                  styles.buttonSecondary,
                  "mt-block w-fit",
                )}
                data-cursor="link"
                data-cursor-label={BUY.trade.label}
              >
                {BUY.trade.label}
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
