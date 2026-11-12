import type { Metadata } from "next";
import Link from "next/link";

import { ShopLink } from "@/components/backstage/ShopLink";
import { Notice, PageHeader, Panel } from "@/components/backstage/ui";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { shipDateStanding } from "@/lib/backstage/orders/ship-date";
import { shopOffer, whatChanged } from "@/lib/backstage/shop/ops";
import { mailConnection } from "@/lib/mail";

import { tellShipDateAction } from "./actions";
import { ShopForm } from "./forms";
import { shopFormValues } from "./values";

export const metadata: Metadata = { title: "The shop" };

/** "1 person has", "12 people have". */
const people = (count: number) =>
  `${String(count)} ${count === 1 ? "person has" : "people have"}`;

/**
 * The shop's settings: what a pack costs, what delivery costs, when a
 * pre-order ships, pre-order or live, and whether orders are being taken.
 * Changed here with no deploy. What a pack IS (its name, how many shots)
 * stays in the catalogue file.
 */
export default async function ShopSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff("/backstage/settings/shop");
  const params = await searchParams;
  const caller = await staffCaller();
  const shop = await execute(shopOffer, {}, caller);
  // People with a pre-order, and whether they have been told when it ships.
  const waiting = await execute(shipDateStanding, {}, caller);
  const mail = mailConnection();
  const canChange = staff.role !== "viewer";
  const tellable = waiting.owed.filter((one) => !one.blocked);
  const blocked = waiting.owed.filter((one) => one.blocked);
  const { offer, file } = shop;
  // What has been changed here from what the catalogue file says.
  const moved = whatChanged(file, offer);
  const open = offer.unconfirmed.length;

  return (
    <>
      <PageHeader
        title="The shop"
        back={{ href: "/backstage/settings", label: "Settings" }}
        lead={
          offer.open
            ? "What a pack costs, what delivery costs, when it ships, and whether orders are being taken. Change it here and the site follows within a minute."
            : "The shop is not taking orders right now. The page says so, and the checkout takes nothing."
        }
      />

      {shop.unreadable ? (
        <Notice tone="bad">
          What was saved here could not be read, so the shop is on the catalogue
          file&apos;s own prices. Check every figure below, then change the shop
          to put it right.
        </Notice>
      ) : null}

      <Panel>
        <ShopForm
          packs={offer.packs.map((pack) => ({
            sku: pack.sku,
            name: pack.name,
            shots: pack.shots,
          }))}
          start={shopFormValues(offer)}
          canChange={canChange}
        />
      </Panel>

      {/* Only while somebody has a pre-order that has not been sent. With
          none, there is nobody to tell and nothing here. */}
      {waiting.waiting === 0 ? null : (
        <section id="pre-orders" className="mt-8 scroll-mt-24">
          <Panel>
            <h2 className="bk-h2">
              <span className="cap-trim">Pre-orders and the ship date</span>
            </h2>
            {params.notice ? (
              <div className="mt-3">
                <Notice tone={params.tone === "bad" ? "bad" : "good"}>
                  {params.notice}
                </Notice>
              </div>
            ) : null}
            <p className="mt-3 leading-snug" data-testid="ship-date-standing">
              {waiting.cannot !== null
                ? `${people(waiting.waiting)} a pre-order that has not been sent. The site promised each an email with the ship date. ${waiting.cannot === "No ship date is set." ? "Set the date above and they can be told it from here." : waiting.cannot}`
                : waiting.owed.length === 0
                  ? `${people(waiting.waiting)} a pre-order that has not been sent, and all of them have been told it ships from ${waiting.dateSaid ?? ""}.`
                  : `${String(waiting.owed.length)}${waiting.more ? " or more" : ""} of the ${String(waiting.waiting)} with a pre-order ${waiting.owed.length === 1 && !waiting.more ? "has" : "have"} not been told it ships from ${waiting.dateSaid ?? ""}. The site promised them an email with the date.`}
            </p>
            {waiting.cannot === null && waiting.owed.length > 0 ? (
              mail.delivers ? (
                canChange && tellable.length > 0 ? (
                  <form action={tellShipDateAction} className="mt-4">
                    <input
                      type="hidden"
                      name="date"
                      value={waiting.date ?? ""}
                    />
                    <SubmitButton pending="Writing to them">
                      {`Email the ${String(tellable.length)} of them`}
                    </SubmitButton>
                    <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
                      Each gets one email saying it ships from{" "}
                      {waiting.dateSaid}. It cannot be called back. Change the
                      date later and they can be told the new one.
                    </p>
                  </form>
                ) : null
              ) : (
                <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
                  Order emails are not being sent, so they cannot be told from
                  here yet. {mail.problem ?? mail.held ?? ""} Until then, tell
                  them yourself: each order has its customer&apos;s address on
                  it.
                </p>
              )
            ) : null}
            {blocked.length === 0 ? null : (
              <p className="mt-3 text-[0.9375rem] leading-snug">
                {blocked.length === 1 ? "One" : String(blocked.length)} cannot
                be emailed, because the address is on the do-not-email list.
                Tell them another way:{" "}
                {blocked.map((one, index) => (
                  <span key={one.number}>
                    {index === 0 ? "" : ", "}
                    <Link
                      href={`/backstage/orders/${one.number}`}
                      className="underline decoration-2 underline-offset-4"
                    >
                      {one.number}
                    </Link>
                  </span>
                ))}
                .
              </p>
            )}
            {waiting.cannot === null &&
            waiting.owed.length > 0 &&
            !mail.delivers ? (
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.9375rem]">
                {waiting.owed.slice(0, 40).map((one) => (
                  <li key={one.number}>
                    <Link
                      href={`/backstage/orders/${one.number}`}
                      className="underline decoration-2 underline-offset-4"
                    >
                      {one.number}
                    </Link>{" "}
                    {one.name}
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        </section>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel>
          <h2 className="bk-h2">
            <span className="cap-trim">Changed from the catalogue</span>
          </h2>
          {moved.length === 0 ? (
            <p className="bk-muted mt-3 leading-snug">
              Nothing. The shop is selling exactly what the catalogue file says.
            </p>
          ) : (
            <ul
              data-testid="shop-moved"
              className="mt-3 list-disc pl-5 leading-relaxed"
            >
              {moved.map((line) => (
                <li key={line}>
                  {line.charAt(0).toUpperCase() + line.slice(1)}
                </li>
              ))}
            </ul>
          )}
          <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
            A pack&apos;s name and how many shots are in it are not changed
            here. Those are in the catalogue file.
          </p>
        </Panel>
        <Panel>
          <h2 className="bk-h2">
            <span className="cap-trim">Still to confirm</span>
          </h2>
          <p className="mt-3 leading-snug">
            {open === 0
              ? "Every fact about the shop is confirmed, so search engines can find it."
              : `${String(open)} fact${open === 1 ? " is" : "s are"} still a stand-in, so the site stays out of search engines. Changing a figure here does not confirm it.`}
          </p>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
            <Link
              href="/backstage/settings/go-live"
              className="underline decoration-2 underline-offset-4"
            >
              The go-live list
            </Link>
            <ShopLink
              href="/"
              className="underline decoration-2 underline-offset-4"
            >
              See the shop
            </ShopLink>
          </p>
        </Panel>
      </div>
    </>
  );
}
