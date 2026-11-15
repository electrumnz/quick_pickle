import type { Metadata } from "next";
import Link from "next/link";

import { CheckIcon } from "@/components/brand/Icons";
import { ShopLink } from "@/components/backstage/ShopLink";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Notice } from "@/components/backstage/ui";
import { PRODUCT } from "@/content/offer";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { lastTick } from "@/lib/backstage/clock/tick";
import { listStuckEvents } from "@/lib/backstage/core/events";
import { execute } from "@/lib/backstage/core/op";
import { resendWebhookSecretState } from "@/lib/backstage/mail/config";
import { backstageMode } from "@/lib/backstage/mode";
import { canConfirm, factNow, shopOffer } from "@/lib/backstage/shop/ops";
import { pinDoor } from "@/lib/backstage/staff/ops";
import { formatDateKey } from "@/lib/backstage/stock/dates";
import { getDb } from "@/lib/db/client";
import { mailConnection } from "@/lib/mail";
import { limitsState } from "@/lib/shop/caller";
import { LIMITS } from "@/lib/shop/limit";
import { formatNzd } from "@/lib/shop/money";
import { checkoutMode, getPaymentProvider } from "@/lib/shop/payments";
import { getStore } from "@/lib/shop/store";
import { formatNzDateTime, formatNzRelative, minutesSince } from "@/lib/time";

import { confirmFactAction } from "../shop/actions";

export const metadata: Metadata = { title: "Go-live list" };

/** The pages whose promises an owner agrees to. */
const FINE_PRINT = [
  { href: "/returns", label: "Returns" },
  { href: "/delivery", label: "Delivery" },
  { href: "/terms", label: "Terms" },
] as const;

/**
 * The go-live list: everything between this build and taking real money,
 * read from the same modules the site runs on, so it cannot be out of date.
 * `npm run prelaunch` checks the same things from the command line.
 *
 * The facts about the offer are confirmed here, by an owner, once the
 * figures and words are right (they are set in Settings: The shop, and The
 * label and the company). Confirming the last one opens the site to search
 * engines.
 */
export default async function GoLivePage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff("/backstage/settings/go-live");
  const params = await searchParams;
  const shop = await execute(shopOffer, {}, await staffCaller());
  const { offer } = shop;
  const isOwner = staff.role === "owner";
  // Every fact the catalogue file lists as open, and where each stands now.
  const facts = shop.file.unconfirmed.map((item) => {
    const said = shop.changes.confirmed?.[item.key];
    return {
      ...item,
      confirmed: said ?? null,
      now: factNow(item.key, offer),
      cannot: canConfirm(item.key, offer),
    };
  });
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

  const mode = checkoutMode();

  // Email: read from the same place the outbox reads it, so this cannot say
  // "connected" while receipts are being written down and not sent. Only
  // the names of what is missing are shown, never a value.
  const mail = mailConnection();
  const mailMissing =
    mail.missing.length === 0
      ? ""
      : ` Still to set: ${mail.missing.join(", ")}.`;
  // What Resend tells us afterwards: mail received for us, and what became
  // of mail we sent. Its calls are only let in with the signing secret.
  const hearing = resendWebhookSecretState() === "set";

  // The clock: the timed request that retries a step that failed and closes
  // an order nobody paid for. Quiet for 20 minutes means it has stopped.
  const db = await getDb();
  const pulse = await lastTick(db);
  const pulseAt = pulse === null ? null : new Date(pulse.at);
  const ticking = pulseAt !== null && minutesSince(pulseAt) < 20;
  const stuck = await listStuckEvents(db, 200);
  const gaveUp = stuck.filter((event) => event.gaveUp).length;

  const systems = [
    {
      ok: payments.live,
      label: "Payments",
      detail: payments.live
        ? `Live, through ${payments.name}.`
        : mode === "sandbox"
          ? `${payments.name === "stripe" ? "Stripe" : payments.name} in its test mode. Buyers reach the real payment page, and no real money moves.`
          : "Test mode. The checkout records an order and charges nobody.",
    },
    {
      ok: mail.delivers,
      label: "Order emails",
      detail: mail.delivers
        ? `Connected. Receipts and the emails that follow them are sent through Resend, from ${mail.from ?? "the address in MAIL_FROM"}.`
        : `Not being sent. ${mail.problem ?? mail.held ?? ""}${mailMissing} Until they are, the shop promises nobody a receipt, and what would have gone is written down on each order.`,
    },
    {
      ok: hearing,
      label: "Bounces and incoming mail",
      detail: hearing
        ? "Connected. Resend tells the back end when mail arrives for us and when an email of ours comes back or is marked as spam, and an address that does either is not written to again."
        : "Not connected. Mail does not arrive in the inbox by itself, and a bounce or a spam complaint is not heard, so nothing stops us writing to that address again. Still to set: RESEND_WEBHOOK_SECRET.",
    },
    {
      ok: ticking,
      label: "The clock",
      detail:
        pulseAt === null
          ? "Has never run. Until it does, nothing tries a failed step again or closes an order nobody paid for."
          : ticking
            ? `Running. Last ran ${formatNzRelative(pulseAt)}.`
            : `Stopped. It last ran ${formatNzDateTime(pulseAt)}.`,
    },
    {
      ok: stuck.length === 0,
      label: "Steps that failed",
      detail:
        stuck.length === 0
          ? "None waiting."
          : `${String(stuck.length)} waiting to be tried again${gaveUp > 0 ? `, ${String(gaveUp)} of them out of tries and needing a person` : ""}.`,
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

  // The ceiling on how often one internet address can ask the checkout
  // things. On whenever there is a database, unless switched off by hand.
  const limits = limitsState();
  systems.push({
    ok: limits === "on",
    label: "The checkout's limit",
    detail:
      limits === "on"
        ? `On. One internet address gets ${String(LIMITS.code.most)} wrong promo codes, ${String(LIMITS.order.most)} orders and ${String(LIMITS.crew.most)} Pickle Crew sign-ups every ten minutes. After that it is asked to wait. Visits and short-link clicks from one address stop being counted past ${String(LIMITS.seen.most)} and ${String(LIMITS.link.most)}, and nobody is turned away for those.`
        : limits === "off"
          ? "Switched off by hand (QP_LIMITS is off). Anybody can guess at promo codes and place orders as fast as they like, and pad out the visit and link counts."
          : "Not counting: there is no database, so no real records to protect.",
  });

  // The way in. A PIN is the door for now (lib/backstage/auth/pin.ts): one
  // short number is not what stands in front of real customers' details.
  const demo = backstageMode() === "demo";
  const pin = demo ? null : await pinDoor(db);
  systems.push({
    ok: pin === null,
    label: "Signing in",
    detail: demo
      ? "Nobody signs in: there is no database, so the records here are invented."
      : pin === null
        ? "Everybody signs in with their own email and password."
        : `The back end is opened with a PIN (${pin.name}'s). That is fine while the shop is being set up. Before real customers' details are in here, ${pin.name} swaps it for an email and a password in Settings, Staff, which takes the set-up code. Then look down the staff list for anybody you do not know.`,
  });

  const open =
    offer.unconfirmed.length + systems.filter((item) => !item.ok).length;

  return (
    <div>
      <Link
        href="/backstage/settings"
        className="label bk-muted mb-2 inline-flex min-h-11 items-center text-[1.05rem]"
      >
        <span className="cap-trim">&larr; Settings</span>
      </Link>
      <h1 className="bk-h1">Go-live list</h1>
      {params.notice ? (
        <div className="mt-4">
          <Notice tone={params.tone === "bad" ? "bad" : "good"}>
            {params.notice}
          </Notice>
        </div>
      ) : null}
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
          <p className="text-navy-muted mt-2 text-[0.9375rem] leading-snug">
            Each one started as a stand-in. Set the prices, delivery, the ship
            date and the contact address in{" "}
            <Link
              href="/backstage/settings/shop"
              className="underline decoration-2 underline-offset-4"
            >
              The shop
            </Link>
            , and what the label says and who the company is in{" "}
            <Link
              href="/backstage/settings/label"
              className="underline decoration-2 underline-offset-4"
            >
              The label and the company
            </Link>
            , then say here that each is right.{" "}
            {isOwner
              ? "Only say so when you know it is true: your name goes beside it."
              : "An owner does that."}
          </p>
          <ul className="mt-5 flex flex-col gap-3">
            {facts.map((item) => (
              <li
                key={item.key}
                data-testid={`fact-${item.key}`}
                className="card-flat flex gap-4 p-4"
              >
                {item.confirmed !== null ? (
                  <CheckIcon className="text-olive-deep mt-0.5 size-6 shrink-0" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="border-navy mt-0.5 size-6 shrink-0 rounded-md border-[3px]"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="leading-snug font-semibold">{item.what}</p>
                  {item.now === null ? null : (
                    <p className="mt-1 text-[0.9375rem] leading-snug">
                      Now: {item.now}.
                    </p>
                  )}
                  {/* Not a figure: the pages themselves are what is being
                      agreed to, so they are one press away. */}
                  {item.key === "returns-promises" ? (
                    <p className="mt-1 flex flex-wrap gap-x-4 text-[0.9375rem]">
                      Read them:
                      {FINE_PRINT.map((page) => (
                        <ShopLink
                          key={page.href}
                          href={page.href}
                          className="underline decoration-2 underline-offset-4"
                        >
                          {page.label}
                        </ShopLink>
                      ))}
                    </p>
                  ) : null}
                  {item.confirmed !== null ? (
                    <p className="text-navy-muted mt-1 text-[0.9375rem]">
                      Confirmed by {item.confirmed.by},{" "}
                      {formatNzDateTime(new Date(item.confirmed.at))}.
                    </p>
                  ) : (
                    <p className="text-navy-muted mt-1 text-[0.9375rem]">
                      Ask: {item.ask}
                    </p>
                  )}
                  {item.confirmed === null && item.cannot !== null ? (
                    <p className="text-navy-muted mt-1 text-[0.9375rem]">
                      {item.cannot}
                    </p>
                  ) : null}
                  {isOwner &&
                  (item.confirmed !== null || item.cannot === null) ? (
                    <form action={confirmFactAction} className="mt-3">
                      <input type="hidden" name="key" value={item.key} />
                      <input
                        type="hidden"
                        name="confirmed"
                        value={item.confirmed === null ? "yes" : "no"}
                      />
                      <SubmitButton
                        pending="Saving"
                        className={
                          item.confirmed === null
                            ? "bk-btn"
                            : "bk-btn bk-btn-quiet"
                        }
                      >
                        {item.confirmed === null
                          ? "This is right"
                          : "Not right after all"}
                      </SubmitButton>
                    </form>
                  ) : null}
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
          <p className="text-navy-muted mt-2 text-[0.9375rem]">
            <Link
              href="/backstage/settings/shop"
              className="underline decoration-2 underline-offset-4"
            >
              Change it in The shop
            </Link>
          </p>
          <div className="card mt-5 p-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[0.9688rem]">
              <dt className="label text-[1.05rem]">Mode</dt>
              <dd>
                {offer.launchMode === "preorder"
                  ? `Pre-order (${offer.batchName})`
                  : "Live, in stock"}
                {offer.open ? "" : ". Not taking orders right now"}
              </dd>
              <dt className="label text-[1.05rem]">Ships</dt>
              <dd>
                {offer.preorderShipsFrom === null
                  ? "Date not set"
                  : formatDateKey(offer.preorderShipsFrom)}
              </dd>
              <dt className="label text-[1.05rem]">Bottle</dt>
              <dd>
                {PRODUCT.shotVolumeMl === null
                  ? "Volume not set"
                  : `${String(PRODUCT.shotVolumeMl)} ml`}
              </dd>
              {offer.packs.map((pack) => (
                <div key={pack.sku} className="contents">
                  <dt className="label text-[1.05rem]">{pack.name}</dt>
                  <dd>
                    {pack.shots} shots, {formatNzd(pack.priceCents)}{" "}
                    <span className="text-navy-muted">({pack.sku})</span>
                  </dd>
                </div>
              ))}
              <dt className="label text-[1.05rem]">Delivery</dt>
              <dd>{factNow("shipping-rates", offer)}</dd>
              <dt className="label text-[1.05rem]">Email</dt>
              <dd>{offer.contactEmail ?? "Not set"}</dd>
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}
