import type { Metadata } from "next";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { SPECIAL } from "@/content/site";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { promoCodeResults } from "@/lib/backstage/marketing/collabs";
import { restrictedIn } from "@/lib/backstage/marketing/copy-check";
import { dateInputValue } from "@/lib/backstage/marketing/dates";
import {
  listSpecials,
  SPECIAL_NAME_LENGTH,
  type SpecialRow,
} from "@/lib/backstage/marketing/specials";
import {
  PROMO_KIND_LABEL,
  PROMO_KINDS,
} from "@/lib/backstage/marketing/status";
import { formatNzdExact } from "@/lib/shop/money";
import { formatNzDate } from "@/lib/time";

import {
  CopyCheckResult,
  Flash,
  Fold,
  LookOnly,
  MarketingNav,
  PromoPill,
  ReadTheWarnings,
  SelectField,
  TextField,
} from "../../parts";
import {
  createSpecialAction,
  switchSpecialOffAction,
  switchSpecialOnAction,
  updateSpecialAction,
} from "./actions";

export const metadata: Metadata = { title: "Specials" };

/**
 * Specials: a saving that comes off by itself.
 *
 * The first thing on the screen is what is true right now, in a sentence,
 * because for most of the life of the business that sentence is "no special
 * is on" and there is nothing else to read.
 */

/** Cents as a form shows them: "5", "12.50". */
function dollars(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0
    ? String(whole)
    : `${String(whole)}.${String(rest).padStart(2, "0")}`;
}

/** What customers are shown, as near as this screen can draw it. */
function AsCustomersReadIt({ special }: { readonly special: SpecialRow }) {
  return (
    <figure className="mt-3">
      <figcaption className="bk-muted text-[0.9375rem]">
        What customers read while it is on:
      </figcaption>
      <blockquote className="border-navy bg-paper mt-1.5 rounded-[14px] border-2 p-3 leading-snug">
        <p className="label text-[1rem]">
          <span className="cap-trim">
            {SPECIAL.tag}
            {special.name === "" ? "" : ` · ${special.name}`}
          </span>
        </p>
        <p className="mt-1 font-semibold">{special.sentence}</p>
        <p className="mt-0.5 text-[0.9375rem]">
          {SPECIAL.noCode} {SPECIAL.comesOff}
        </p>
      </blockquote>
    </figure>
  );
}

function SpecialFields({
  id,
  values,
}: {
  readonly id: string;
  readonly values?: SpecialRow;
}) {
  const kindLocked = values !== undefined && values.uses > 0;
  return (
    <>
      <TextField
        id={`${id}-name`}
        name="name"
        label="What customers see it called"
        maxLength={SPECIAL_NAME_LENGTH}
        defaultValue={values?.name}
        placeholder="Launch week"
        hint="Optional. A few plain words. What it gives and its last day are written for you from the boxes below, so they are always right."
      />
      {kindLocked ? (
        <input type="hidden" name="kind" value={values.kind} />
      ) : (
        <SelectField
          id={`${id}-kind`}
          name="kind"
          label="What it gives"
          defaultValue={values?.kind ?? "percent"}
          options={PROMO_KINDS.map((kind) => ({
            value: kind,
            label: PROMO_KIND_LABEL[kind],
          }))}
          hint="Fill in the one box below that goes with it. Free delivery needs neither, and a rural extra still applies."
        />
      )}
      {kindLocked && values.kind !== "percent" ? null : (
        <TextField
          id={`${id}-percent`}
          name="percent"
          label="Percentage off"
          inputMode="numeric"
          maxLength={2}
          defaultValue={
            values?.kind === "percent" ? String(values.value) : undefined
          }
          hint="A whole number from 1 to 90, off every pack. Not off delivery."
        />
      )}
      {kindLocked && values.kind !== "amount" ? null : (
        <TextField
          id={`${id}-amount`}
          name="amount"
          label="Dollars off"
          inputMode="decimal"
          maxLength={10}
          defaultValue={
            values?.kind === "amount" ? dollars(values.value) : undefined
          }
          hint="For example 5. Dollars off needs a smallest order, below, that is bigger than this."
        />
      )}
      <TextField
        id={`${id}-min`}
        name="min"
        label="Smallest order it works on"
        inputMode="decimal"
        maxLength={10}
        defaultValue={
          values !== undefined && values.minSubtotalCents > 0
            ? dollars(values.minSubtotalCents)
            : undefined
        }
        hint="In dollars of packs, before delivery. Leave empty for any order."
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          id={`${id}-first`}
          name="firstDay"
          type="date"
          label="First day"
          defaultValue={
            values?.startsAt ? dateInputValue(values.startsAt) : undefined
          }
        />
        <TextField
          id={`${id}-last`}
          name="lastDay"
          type="date"
          label="Last day"
          defaultValue={
            values?.endsAt
              ? dateInputValue(new Date(values.endsAt.getTime() - 1))
              : undefined
          }
        />
      </div>
      <p className="bk-muted -mt-1 text-[0.9375rem] leading-snug">
        New Zealand days. It works to the end of the last day, and customers are
        told that day. Leave the first day empty to start as soon as it is
        switched on.
      </p>
      <TextField
        id={`${id}-max`}
        name="maxUses"
        label="Most orders that can have it"
        inputMode="numeric"
        maxLength={7}
        defaultValue={
          values?.maxUses == null ? undefined : String(values.maxUses)
        }
        hint="Leave empty for no limit. With a limit, customers are told it is for the first so many orders."
      />
      <TextField
        id={`${id}-note`}
        name="note"
        label="Note"
        maxLength={500}
        defaultValue={values?.note}
        hint="What it is for. Only staff see this."
      />
    </>
  );
}

const smallPrint = (special: SpecialRow): string => {
  const parts: string[] = [];
  if (special.startsAt) parts.push(`from ${formatNzDate(special.startsAt)}`);
  parts.push(
    special.maxUses === null
      ? `${String(special.uses)} ${special.uses === 1 ? "order has" : "orders have"} had it`
      : `${String(special.uses)} of ${String(special.maxUses)} orders have had it`,
  );
  return parts.join(" · ");
};

export default async function SpecialsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const rows = await execute(listSpecials, {}, caller);
  const canWrite = staff.role !== "viewer";

  const live = rows.find((row) => row.state === "live");
  const next = rows.find((row) => row.active && row.state === "not-started");
  const rightNow =
    live !== undefined
      ? `${live.code} is on. ${live.sentence}`
      : next !== undefined
        ? `Nothing is on yet. ${next.code} is switched on and starts on ${next.startsAt === null ? "its first day" : formatNzDate(next.startsAt)}.`
        : "No special is on. Everybody pays the usual prices.";

  // What each special that has been used has brought in. A handful of rows.
  const results = new Map(
    await Promise.all(
      rows
        .filter((row) => row.uses > 0)
        .map(
          async (row) =>
            [
              row.id,
              await execute(promoCodeResults, { id: row.id }, caller),
            ] as const,
        ),
    ),
  );

  return (
    <>
      <PageHeader
        title="Specials"
        lead="A saving that comes off by itself, with no code to type. The shop says it on the page while it is on. All of it is optional."
        back={{
          href: "/backstage/marketing/promo-codes",
          label: "Promo codes",
        }}
      />
      <MarketingNav current="promo-codes" />
      <Flash notice={notice} tone={tone} />

      <div className="flex flex-col gap-6">
        <Panel>
          <p className="leading-snug" data-testid="special-right-now">
            <strong>Right now:</strong> {rightNow}
          </p>
          <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
            One special at a time, and one saving an order: somebody who also
            types a code gets whichever takes more off.
          </p>
        </Panel>

        {rows.map((special) => {
          const restricted =
            special.nameCheck === null ? [] : restrictedIn(special.nameCheck);
          const rules = [...new Set(restricted.map((each) => each.rule))];
          const brought = results.get(special.id);
          return (
            <section
              key={special.id}
              id={special.id}
              aria-labelledby={`${special.id}-title`}
              className="scroll-mt-24"
            >
              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2
                    id={`${special.id}-title`}
                    className="min-w-0 text-[1.125rem] leading-snug font-semibold"
                  >
                    <span className="font-mono [overflow-wrap:anywhere]">
                      {special.code}
                    </span>
                    {special.name === "" ? "" : `: ${special.name}`}
                  </h2>
                  <span className="flex flex-wrap gap-2">
                    {special.active ? null : <Pill>Switched off</Pill>}
                    {special.active ? (
                      <PromoPill state={special.state} />
                    ) : null}
                  </span>
                </div>
                <p className="bk-muted mt-1 text-[0.9375rem]">
                  {smallPrint(special)}
                </p>
                <AsCustomersReadIt special={special} />

                {brought === undefined ? null : (
                  <p className="mt-3 leading-snug">
                    {String(brought.orders)} paid{" "}
                    {brought.orders === 1 ? "order" : "orders"} worth{" "}
                    {formatNzdExact(brought.salesCents)}, with{" "}
                    {formatNzdExact(brought.discountCents)} taken off by the
                    special.
                  </p>
                )}

                {special.nameVerdict === "banned" ||
                special.nameVerdict === "restricted" ? (
                  <div className="mt-4">
                    <CopyCheckResult
                      check={special.nameCheck}
                      verdict={special.nameVerdict}
                      what="special's name"
                    />
                  </div>
                ) : null}

                {canWrite ? (
                  <div className="mt-4 flex flex-col gap-3">
                    {special.active ? (
                      <form action={switchSpecialOffAction}>
                        <input type="hidden" name="id" value={special.id} />
                        <SubmitButton
                          pending="Switching off"
                          className="bk-btn bk-btn-quiet"
                        >
                          Switch it off
                        </SubmitButton>
                      </form>
                    ) : special.nameVerdict === "banned" ? null : (
                      <form
                        action={switchSpecialOnAction}
                        className="flex flex-col gap-3"
                      >
                        <input type="hidden" name="id" value={special.id} />
                        <ReadTheWarnings
                          id={`${special.id}-read`}
                          rules={rules}
                        />
                        <div>
                          <SubmitButton pending="Switching on">
                            Switch it on
                          </SubmitButton>
                        </div>
                        <p className="bk-muted text-[0.9375rem] leading-snug">
                          Switching it on tells every visitor about it and takes
                          it off their order at the checkout.
                        </p>
                      </form>
                    )}
                    {special.active ? (
                      <p className="bk-muted text-[0.9375rem] leading-snug">
                        To change it, switch it off first: customers are being
                        told what it gives.
                      </p>
                    ) : (
                      <Fold summary="Change it">
                        <form
                          action={updateSpecialAction}
                          className="flex max-w-[34rem] flex-col gap-4"
                        >
                          <input type="hidden" name="id" value={special.id} />
                          <SpecialFields id={special.id} values={special} />
                          <div>
                            <SubmitButton pending="Saving">Save</SubmitButton>
                          </div>
                        </form>
                      </Fold>
                    )}
                  </div>
                ) : null}
              </Panel>
            </section>
          );
        })}

        <section id="new" aria-labelledby="new-title" className="scroll-mt-24">
          <Panel>
            <h2 id="new-title" className="text-[1.125rem] font-semibold">
              Set up a special
            </h2>
            {canWrite ? (
              <>
                <p className="bk-muted mt-1 text-[0.9375rem] leading-snug">
                  It is saved switched off. Nothing changes for customers until
                  you switch it on.
                </p>
                <form
                  action={createSpecialAction}
                  className="mt-4 flex max-w-[34rem] flex-col gap-4"
                >
                  <TextField
                    id="new-code"
                    name="code"
                    label="A word for it"
                    maxLength={24}
                    required
                    placeholder="LAUNCH"
                    hint="How it shows on an order and in your numbers: 3 to 24 letters, numbers or hyphens. It cannot be changed later."
                  />
                  <SpecialFields id="new" />
                  <div>
                    <SubmitButton pending="Saving">
                      Save it, switched off
                    </SubmitButton>
                  </div>
                </form>
              </>
            ) : (
              <div className="mt-2">
                <LookOnly />
              </div>
            )}
          </Panel>
        </section>
      </div>
    </>
  );
}
