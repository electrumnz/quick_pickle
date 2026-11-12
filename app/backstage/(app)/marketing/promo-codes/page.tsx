import type { Metadata } from "next";
import Link from "next/link";

import { Empty, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { listPromoCodes } from "@/lib/backstage/marketing/promo-codes";

import { Flash, MarketingNav, PromoPill } from "../parts";
import { promoSmallPrint } from "./fields";

export const metadata: Metadata = { title: "Promo codes" };

export default async function PromoCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone } = await searchParams;
  const rows = await execute(listPromoCodes, {}, await staffCaller());
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Promo codes"
        lead="Codes a customer types at the checkout for money off or free delivery. One code an order."
        actions={
          canWrite ? (
            <Link
              href="/backstage/marketing/promo-codes/new"
              className="bk-btn"
            >
              <span className="cap-trim">New code</span>
            </Link>
          ) : null
        }
      />
      <MarketingNav current="promo-codes" />
      <Flash notice={notice} tone={tone} />
      <Panel flush>
        {rows.length === 0 ? (
          <Empty title="No codes yet">
            Make one with New code. It is ready as soon as it is saved.
          </Empty>
        ) : (
          <ul className="bk-rows">
            {rows.map((promo) => (
              <li key={promo.id}>
                <Link
                  href={`/backstage/marketing/promo-codes/${promo.id}`}
                  className="bk-row grid-cols-[1fr_auto]"
                >
                  <span className="min-w-0">
                    <span className="block font-mono font-semibold [overflow-wrap:anywhere]">
                      {promo.code}
                    </span>
                    <span className="block">{promo.label}</span>
                    <span className="bk-muted block text-[0.9375rem]">
                      {promoSmallPrint(promo)}
                    </span>
                  </span>
                  <PromoPill state={promo.state} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
