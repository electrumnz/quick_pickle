import type { Metadata } from "next";
import Link from "next/link";

import { ShopLink } from "@/components/backstage/ShopLink";
import { Notice, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { shopOffer, whatChanged } from "@/lib/backstage/shop/ops";

import { ShopForm } from "./forms";
import { shopFormValues } from "./values";

export const metadata: Metadata = { title: "The shop" };

/**
 * The shop's settings: what a pack costs, what delivery costs, when a
 * pre-order ships, pre-order or live, and whether orders are being taken.
 * Changed here with no deploy. What a pack IS (its name, how many shots)
 * stays in the catalogue file.
 */
export default async function ShopSettingsPage() {
  const staff = await requireStaff("/backstage/settings/shop");
  const shop = await execute(shopOffer, {}, await staffCaller());
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
          canChange={staff.role !== "viewer"}
        />
      </Panel>

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
