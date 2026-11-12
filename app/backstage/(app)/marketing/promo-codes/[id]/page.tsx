import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel } from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  getPromoCode,
  type PromoRow,
} from "@/lib/backstage/marketing/promo-codes";
import { formatNzd } from "@/lib/shop/money";
import { formatNzDate } from "@/lib/time";

import { Flash, LookOnly, MarketingNav, PromoPill } from "../../parts";
import { setPromoCodeActiveAction, updatePromoCodeAction } from "../actions";
import { PromoFields } from "../fields";

export const metadata: Metadata = { title: "Promo code" };

const STATE_SENTENCE = {
  live: "A customer can use it at the checkout now.",
  "not-started": "Its first day has not come yet.",
  finished: "Its last day has gone.",
  "used-up": "It has been used as many times as it may be.",
  off: "Switched off. Nobody can use it.",
} as const;

export default async function PromoCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const now = new Date();

  let promo: PromoRow;
  try {
    promo = await execute(getPromoCode, { id: decodeURIComponent(id) }, caller);
  } catch (error) {
    if (
      error instanceof OpError &&
      (error.code === "not_found" || error.code === "invalid_input")
    ) {
      notFound();
    }
    throw error;
  }
  const history = await execute(
    listActivity,
    { entityType: "promo", entityId: promo.id, limit: 50 },
    caller,
  );
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title={promo.code}
        back={{
          href: "/backstage/marketing/promo-codes",
          label: "Promo codes",
        }}
        lead={promo.label}
      />
      <MarketingNav current="promo-codes" />
      <p className="-mt-1 mb-5 flex flex-wrap items-center gap-2">
        <PromoPill state={promo.state} />
      </p>
      <Flash notice={notice} tone={tone} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel title="Where it stands">
            <p className="leading-snug">{STATE_SENTENCE[promo.state]}</p>
            <dl className="bk-kv mt-4">
              <dt>Gives</dt>
              <dd>{promo.label}</dd>
              <dt>Smallest order</dt>
              <dd>
                {promo.minSubtotalCents > 0
                  ? `${formatNzd(promo.minSubtotalCents)}, before delivery`
                  : "Any order"}
              </dd>
              <dt>First day</dt>
              <dd>
                {promo.startsAt ? formatNzDate(promo.startsAt) : "No start"}
              </dd>
              <dt>Last day</dt>
              <dd>
                {promo.endsAt
                  ? formatNzDate(new Date(promo.endsAt.getTime() - 1))
                  : "No end"}
              </dd>
              <dt>Used</dt>
              <dd>
                {promo.maxUses === null
                  ? `${String(promo.uses)} ${promo.uses === 1 ? "time" : "times"}, no limit`
                  : `${String(promo.uses)} of ${String(promo.maxUses)}`}
              </dd>
              {promo.note === "" ? null : (
                <>
                  <dt>Note</dt>
                  <dd>{promo.note}</dd>
                </>
              )}
            </dl>
            {canWrite ? (
              <form action={setPromoCodeActiveAction} className="mt-5">
                <input type="hidden" name="id" value={promo.id} />
                <input
                  type="hidden"
                  name="active"
                  value={promo.active ? "false" : "true"}
                />
                <SubmitButton
                  pending="Saving"
                  className={`bk-btn w-full ${promo.active ? "bk-btn-quiet" : ""}`}
                >
                  {promo.active ? "Switch it off" : "Switch it on"}
                </SubmitButton>
              </form>
            ) : (
              <div className="mt-5">
                <LookOnly />
              </div>
            )}
          </Panel>

          <Panel title="History" flush>
            <ActivityList lines={history} now={now} />
          </Panel>
        </div>

        {canWrite ? (
          <Panel title="Change the terms">
            <form
              action={updatePromoCodeAction}
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="id" value={promo.id} />
              <PromoFields values={promo} kindLocked={promo.uses > 0} />
              <SubmitButton pending="Saving">Save the terms</SubmitButton>
              <p className="bk-muted text-[0.9375rem] leading-snug">
                {promo.uses > 0
                  ? "It has been used, so what kind of code it is can no longer change. Orders that already used it stay as they were."
                  : "Orders that already used a code are never changed by this."}
              </p>
            </form>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
