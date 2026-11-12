import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { promoCodeResults } from "@/lib/backstage/marketing/collabs";
import { listPartners } from "@/lib/backstage/marketing/partners";
import {
  getPromoCode,
  type PromoRow,
} from "@/lib/backstage/marketing/promo-codes";
import { formatNzd } from "@/lib/shop/money";
import { formatNzDate } from "@/lib/time";

import { SalesSmallPrint, TakingsList } from "../../collab-parts";
import { Flash, LookOnly, MarketingNav, PromoPill } from "../../parts";
import { setPromoCodeActiveAction, updatePromoCodeAction } from "../actions";
import { PromoFields } from "../fields";
import { setCrewWelcomeAction } from "../specials/actions";

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
  // A special is looked after on its own screen, where switching it on is
  // treated as the publishing it is.
  if (promo.automatic) {
    redirect(`/backstage/marketing/promo-codes/specials#${promo.id}`);
  }
  const [history, results, partners] = await Promise.all([
    execute(
      listActivity,
      { entityType: "promo", entityId: promo.id, limit: 50 },
      caller,
    ),
    execute(promoCodeResults, { id: promo.id }, caller),
    execute(listPartners, { status: "all", limit: 200 }, caller),
  ]);
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
        {promo.crewWelcome ? <Pill tone="done">Crew welcome code</Pill> : null}
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
                {promo.oncePerCustomer ? ". Once for each customer" : ""}
              </dd>
              <dt>Whose it is</dt>
              <dd>
                {promo.partnerId === null ? (
                  "Ours"
                ) : (
                  <Link
                    href={`/backstage/marketing/partners/${promo.partnerId}`}
                    className="underline"
                  >
                    {promo.partnerName}
                  </Link>
                )}
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

          {promo.partnerId !== null && !promo.crewWelcome ? null : (
            <Panel title="For joining the Pickle Crew">
              <p className="leading-snug">
                {promo.crewWelcome
                  ? promo.state === "live"
                    ? "This is the code people are given when they join the Pickle Crew on the site. It is saved for them and comes off at the checkout."
                    : "This is the Crew's welcome code, but nobody is being given it right now because it cannot be used. It is handed out again once it is live."
                  : "Give this code to everybody who joins the Pickle Crew on the site. They are shown it as they join, and it comes off at their checkout."}
              </p>
              <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
                There is one welcome code at a time. Choosing this one makes it
                work once for each customer.
              </p>
              {canWrite ? (
                <form action={setCrewWelcomeAction} className="mt-4">
                  <input type="hidden" name="id" value={promo.id} />
                  <input
                    type="hidden"
                    name="on"
                    value={promo.crewWelcome ? "false" : "true"}
                  />
                  <SubmitButton
                    pending="Saving"
                    className="bk-btn bk-btn-quiet"
                  >
                    {promo.crewWelcome
                      ? "Stop handing it out"
                      : "Make it the welcome code"}
                  </SubmitButton>
                </form>
              ) : null}
            </Panel>
          )}

          <Panel title="What it has brought in">
            <TakingsList
              takings={results}
              discountLabel="Taken off by this code"
            />
            <SalesSmallPrint>
              So the number of paid orders can be lower than the times the code
              has been used.
              {promo.partnerId === null
                ? ""
                : ` These count towards ${promo.partnerName ?? "its partner"}: their page has what the partnership has cost and what came back.`}
            </SalesSmallPrint>
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
              <PromoFields
                values={promo}
                kindLocked={promo.uses > 0}
                partners={partners}
              />
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
