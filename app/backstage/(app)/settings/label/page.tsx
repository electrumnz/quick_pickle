import type { Metadata } from "next";
import Link from "next/link";

import { ShopLink } from "@/components/backstage/ShopLink";
import { Notice, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { shopOffer } from "@/lib/backstage/shop/ops";

import { LabelForm } from "./forms";
import { labelFormValues } from "./values";

export const metadata: Metadata = { title: "The label and the company" };

/**
 * What the label says (the ingredients list, the allergen line, the storage
 * line) and who is behind the shop (the legal name, the NZBN, the address,
 * GST). Typed here by somebody with the printed label and the company's
 * papers in hand, read back before it is saved, and on the site within a
 * minute. Nothing here is ever guessed, and nothing a bot wrote can be
 * confirmed against a label.
 */
export default async function LabelSettingsPage() {
  const staff = await requireStaff("/backstage/settings/label");
  const shop = await execute(shopOffer, {}, await staffCaller());
  const { offer } = shop;
  const open = offer.unconfirmed.filter(
    (fact) => fact.key === "ingredients" || fact.key === "legal-entity",
  ).length;

  return (
    <>
      <PageHeader
        title="The label and the company"
        back={{ href: "/backstage/settings", label: "Settings" }}
        lead="What is printed on the label and who is behind the shop. Type it here with the label in your hand, and the site follows within a minute."
      />

      {shop.unreadable ? (
        <Notice tone="bad">
          What was saved for the shop could not be read, so the site is on the
          catalogue file&apos;s own words. Check every line below, then change
          the site to put it right.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <LabelForm
            start={labelFormValues(offer)}
            canChange={staff.role !== "viewer"}
          />
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel>
            <h2 className="bk-h2">
              <span className="cap-trim">Where it shows</span>
            </h2>
            <ul className="mt-3 list-disc pl-5 leading-relaxed">
              <li>
                The label&apos;s lines: on the shop, under the question about
                what is in it.
              </li>
              <li>
                The company: in the terms of sale, on a receipt and on a
                purchase order.
              </li>
              <li>
                The GST number: on a receipt, with how much of the total is GST.
              </li>
            </ul>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
              <ShopLink
                href="/#faq"
                className="underline decoration-2 underline-offset-4"
              >
                See the questions
              </ShopLink>
              <ShopLink
                href="/terms"
                className="underline decoration-2 underline-offset-4"
              >
                See the terms
              </ShopLink>
            </p>
          </Panel>
          <Panel>
            <h2 className="bk-h2">
              <span className="cap-trim">Still to confirm</span>
            </h2>
            <p className="mt-3 leading-snug">
              {open === 0
                ? "Both of these are confirmed."
                : "Putting the words in does not confirm them. Once they are right, an owner says so on the go-live list."}
            </p>
            <p className="mt-3">
              <Link
                href="/backstage/settings/go-live"
                className="underline decoration-2 underline-offset-4"
              >
                The go-live list
              </Link>
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
