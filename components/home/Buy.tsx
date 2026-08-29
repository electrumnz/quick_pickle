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
 * Everything here resolves today. The shop link renders only when `routes.ts`
 * says the catalogue is deployed — see that file — and the two mail routes are
 * plain `mailto:` anchors, which work in every browser, on a phone, and with
 * scripting switched off. There is deliberately no `<input type="email">`:
 * there is no list service behind it yet, and a field that silently discards
 * the address it was given is a worse thing to ship than an honest address.
 * The copy says so rather than pretending otherwise, which is the house style
 * for the unglamorous moment (`brand/brand-guide.md` §5.5).
 *
 * Each route is a 48px control sitting under the reason to use it, rather than
 * a row of buttons at the top with the reasons somewhere else.
 */
export function Buy() {
  const shopLive = isLive({ href: BUY.shop.href, label: BUY.shop.label });

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
            <h3 className="text-heading-3 text-primary">{BUY.list.heading}</h3>
            <p className="text-body-sm text-muted mt-stack max-w-prose">
              {BUY.list.line}
            </p>
            <a
              href={BUY.list.href}
              className={cx(
                styles.button,
                shopLive ? styles.buttonSecondary : styles.buttonPrimary,
                "mt-block w-fit",
              )}
              data-cursor="link"
              data-cursor-label="One a month"
            >
              {BUY.list.label}
            </a>
          </div>

          <div className="border-hairline border-t pt-6" data-reveal>
            <h3 className="text-heading-3 text-primary">{BUY.trade.heading}</h3>
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
              data-cursor-label="Two days"
            >
              {BUY.trade.label}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
