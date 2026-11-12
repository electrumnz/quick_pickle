import type { Metadata } from "next";
import Link from "next/link";

import { CheckIcon } from "@/components/brand/Icons";
import { PACKS, PRODUCT, SHIPPING, STORE, UNCONFIRMED } from "@/content/offer";
import { formatNzd } from "@/lib/shop/money";
import { getPaymentProvider } from "@/lib/shop/payments";
import { getStore } from "@/lib/shop/store";

export const metadata: Metadata = { title: "Go-live list" };

/**
 * The go-live list: everything between this build and taking real money,
 * read from the same modules the site runs on, so it cannot be out of date.
 * `npm run prelaunch` checks the same things from the command line.
 */
export default function BackstagePage() {
  const payments = (() => {
    try {
      const provider = getPaymentProvider();
      return { name: provider.name, live: !provider.isTest };
    } catch {
      return { name: "misconfigured", live: false };
    }
  })();
  const store = (() => {
    try {
      const current = getStore();
      return { name: current.name, durable: current.durable };
    } catch {
      return { name: "misconfigured", durable: false };
    }
  })();

  const systems = [
    {
      ok: payments.live,
      label: "Payments",
      detail: payments.live
        ? `Live, through ${payments.name}.`
        : "Test mode. The checkout records an order and charges nobody.",
    },
    {
      ok: store.durable && store.name !== "file",
      label: "Order storage",
      detail:
        store.name === "log"
          ? "No database yet. A deployed order is written to the server log and nowhere else."
          : store.name === "file"
            ? "Writing to a local file. Fine for development, not for a deployment."
            : `Saving to ${store.name}.`,
    },
  ];

  const open = UNCONFIRMED.length + systems.filter((item) => !item.ok).length;

  return (
    <div className="max-w-page px-gutter mx-auto py-10 md:py-14">
      <p className="label text-pink-deep text-[1.15rem]">Backstage</p>
      <h1 className="varsity mt-1 text-[clamp(2.5rem,11vw,4rem)] leading-[0.95]">
        Go-live list
      </h1>
      <p className="mt-4 max-w-[40rem] text-[1.0625rem] leading-relaxed">
        {open === 0
          ? "Everything is confirmed. The site is ready to take real orders."
          : `${String(open)} thing${open === 1 ? "" : "s"} to sort before this takes real money. Until then the public site stays out of search and the checkout is in test mode.`}
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <section aria-labelledby="facts-title">
          <h2 id="facts-title" className="varsity text-[1.75rem] leading-none">
            Facts to confirm
          </h2>
          <p className="text-navy-muted mt-2 text-[0.9375rem]">
            Each one has a stand-in on the site. Put the real value in{" "}
            <code>content/offer.ts</code> and delete its line from{" "}
            <code>UNCONFIRMED</code>.
          </p>
          <ul className="mt-5 flex flex-col gap-3">
            {UNCONFIRMED.map((item) => (
              <li key={item.key} className="card-flat flex gap-4 p-4">
                <span
                  aria-hidden="true"
                  className="border-navy mt-0.5 size-6 shrink-0 rounded-md border-[3px]"
                />
                <div>
                  <p className="leading-snug font-semibold">{item.what}</p>
                  <p className="text-navy-muted mt-1 text-[0.9375rem]">
                    Ask: {item.ask}
                  </p>
                </div>
              </li>
            ))}
            {systems.map((item) => (
              <li key={item.label} className="card-flat flex gap-4 p-4">
                {item.ok ? (
                  <CheckIcon className="text-olive-deep mt-0.5 size-6 shrink-0" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="border-navy mt-0.5 size-6 shrink-0 rounded-md border-[3px]"
                  />
                )}
                <div>
                  <p className="leading-snug font-semibold">{item.label}</p>
                  <p className="text-navy-muted mt-1 text-[0.9375rem]">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="offer-title">
          <h2 id="offer-title" className="varsity text-[1.75rem] leading-none">
            What the site is selling
          </h2>
          <div className="card mt-5 p-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[0.9688rem]">
              <dt className="label text-[1.05rem]">Mode</dt>
              <dd>
                {STORE.launchMode === "preorder"
                  ? `Pre-order (${STORE.batchName})`
                  : "Live, in stock"}
              </dd>
              <dt className="label text-[1.05rem]">Ships</dt>
              <dd>{STORE.preorderShipsFrom ?? "Date not set"}</dd>
              <dt className="label text-[1.05rem]">Bottle</dt>
              <dd>
                {PRODUCT.shotVolumeMl === null
                  ? "Volume not set"
                  : `${String(PRODUCT.shotVolumeMl)} ml`}
              </dd>
              {PACKS.map((pack) => (
                <div key={pack.sku} className="contents">
                  <dt className="label text-[1.05rem]">{pack.name}</dt>
                  <dd>
                    {pack.shots} shots, {formatNzd(pack.priceCents)}{" "}
                    <span className="text-navy-muted">({pack.sku})</span>
                  </dd>
                </div>
              ))}
              <dt className="label text-[1.05rem]">Delivery</dt>
              <dd>
                {formatNzd(SHIPPING.standardCents)}, free over{" "}
                {formatNzd(SHIPPING.freeOverCents)}, rural +
                {formatNzd(SHIPPING.ruralSurchargeCents)}
              </dd>
              <dt className="label text-[1.05rem]">Email</dt>
              <dd>{STORE.contactEmail ?? "Not set"}</dd>
            </dl>
          </div>
          <p className="mt-6">
            <Link href="/backstage/brand" className="btn">
              <span className="cap-trim">Open the brand guide</span>
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
