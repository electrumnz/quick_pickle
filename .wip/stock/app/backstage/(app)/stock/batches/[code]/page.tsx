import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";

import { ActivityList } from "@/components/backstage/ActivityList";
import { OrderStatusPill } from "@/components/backstage/orders";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Empty,
  PageHeader,
  Panel,
  Stat,
  When,
} from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { daysAwayText, formatDateKey } from "@/lib/backstage/stock/dates";
import { getBatch, type BatchDetail } from "@/lib/backstage/stock/ops";
import { RECORD_FIELDS, recordIsEmpty } from "@/lib/backstage/stock/record";
import {
  BATCH_STATUS_MEANS,
  HAND_MOVEMENTS,
  MOVEMENT_LABEL,
  NEAR_BEST_BEFORE_DAYS,
} from "@/lib/backstage/stock/status";
import { formatNzd } from "@/lib/shop/money";
import { nzDateKey } from "@/lib/time";

import {
  closeBatchAction,
  countAction,
  recallBatchAction,
  recordMadeAction,
  releaseBatchAction,
  sampleAction,
  updateBatchAction,
  updateRecordAction,
  wasteAction,
} from "../../actions";
import {
  BatchStatusPill,
  BestBeforePill,
  Choice,
  count,
  DateText,
  dollars,
  Field,
  Fold,
  FormNotice,
  Hint,
  LookOnly,
  shots,
  TextArea,
} from "../../parts";

type Params = { code: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  return {
    title: `Batch ${decodeURIComponent((await params).code).toUpperCase()}`,
  };
}

function Code({ value }: { readonly value: string }) {
  return <input type="hidden" name="code" value={value} />;
}

/** The boxes of the production record, for the two forms that fill it in. */
function RecordFields({
  form,
  batch,
}: {
  readonly form: string;
  readonly batch: BatchDetail;
}) {
  return (
    <>
      {RECORD_FIELDS.map((field) =>
        field.long ? (
          <TextArea
            key={field.key}
            form={form}
            name={field.key}
            label={field.label}
            hint={field.hint}
            defaultValue={batch.record[field.key]}
            maxLength={4000}
          />
        ) : (
          <Field
            key={field.key}
            form={form}
            name={field.key}
            label={field.label}
            hint={field.hint}
            defaultValue={batch.record[field.key]}
            maxLength={200}
          />
        ),
      )}
    </>
  );
}

function RecallForm({ batch }: { readonly batch: BatchDetail }) {
  return (
    <Fold summary="Recall this batch" warn>
      <form action={recallBatchAction} className="flex flex-col gap-3">
        <Code value={batch.code} />
        <p className="leading-snug">
          Recalling stops {batch.code} being sold at once, and it can never be
          sold from again. It cannot be undone.
        </p>
        <TextArea
          form="recall"
          name="reason"
          label="Why it is being recalled"
          required
          maxLength={500}
          rows={2}
        />
        <SubmitButton pending="Recalling" className="bk-btn bk-btn-pink w-full">
          Recall the batch
        </SubmitButton>
        <Hint>
          This does not contact anyone. It takes you to the list of who has
          shots from this batch, so you can get hold of them yourself.
        </Hint>
      </form>
    </Fold>
  );
}

/** What to do with this batch now. Only what its state allows is offered. */
function NextStep({
  batch,
  canWrite,
  today,
}: {
  readonly batch: BatchDetail;
  readonly canWrite: boolean;
  readonly today: string;
}) {
  const recallListHref = `/backstage/stock/batches/${batch.code}/recall-list`;

  if (batch.status === "recalled") {
    return (
      <div className="flex flex-col gap-3">
        <p className="leading-snug">
          <span className="font-semibold">
            Recalled
            {batch.recall ? ` on ${formatDateKey(batch.recall.on)}` : ""}.
          </span>{" "}
          {batch.recall?.reason}
        </p>
        <p className="leading-snug">
          Nothing more is sold from it. The recall list shows who has shots from
          it.
          {batch.onHand > 0
            ? ` ${shots(batch.onHand)} still on hand: write them off under Movements as they are destroyed.`
            : ""}
        </p>
        <p>
          <Link href={recallListHref} className="bk-btn">
            <span className="cap-trim">Open the recall list</span>
          </Link>
        </p>
      </div>
    );
  }
  if (!canWrite) {
    return (
      <div className="flex flex-col gap-2">
        <p className="leading-snug">{BATCH_STATUS_MEANS[batch.status]}</p>
        <LookOnly />
      </div>
    );
  }

  if (batch.status === "planned") {
    return (
      <form action={recordMadeAction} className="flex flex-col gap-4">
        <Code value={batch.code} />
        <p className="leading-snug">
          Once it is made, count the shots and record it here. That puts them
          into stock. They are not for sale until you release the batch.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            form="made"
            name="shots"
            label="Shots counted"
            kind="count"
            required
            defaultValue={batch.shotsPlanned}
            hint="How many full, capped bottles there are."
          />
          <Field
            form="made"
            name="madeOn"
            label="Made on"
            kind="date"
            required
            defaultValue={today}
          />
          <Field
            form="made"
            name="bestBefore"
            label="Best before"
            kind="date"
            defaultValue={batch.bestBefore}
            hint="As printed on the bottles. The batch cannot be released for sale without it."
          />
          <Field
            form="made"
            name="cost"
            label="What it cost to make"
            kind="money"
            placeholder="If you know it"
            hint="Everything the batch cost, in dollars."
          />
        </div>
        <h3 className="bk-h2 mt-2">
          <span className="cap-trim">The record</span>
        </h3>
        <p className="bk-muted -mt-2 text-[0.9375rem] leading-snug">
          Write down what your food control plan asks for. Nothing here is
          checked, and all of it can be added to later.
        </p>
        <RecordFields form="made" batch={batch} />
        <SubmitButton pending="Saving" className="bk-btn w-full">
          Record it as made
        </SubmitButton>
      </form>
    );
  }

  if (batch.status === "made") {
    return (
      <div className="flex flex-col gap-4">
        <p className="leading-snug">
          Made and counted, and not yet for sale. Release it once it is cleared
          to sell. From then on it can be picked when an order is packed, and
          the batch with the earliest best-before date is put forward first.
        </p>
        {batch.bestBefore === null ? (
          // No date, no release: the date is what decides which stock goes
          // out first, and when this batch stops being sold.
          <form action={updateBatchAction} className="flex flex-col gap-3">
            <Code value={batch.code} />
            <Field
              form="date"
              name="bestBefore"
              label="Best before"
              kind="date"
              required
              hint="It needs a best-before date before it can be released: the one printed on the bottles."
            />
            <SubmitButton pending="Saving" className="bk-btn w-full">
              Save the date
            </SubmitButton>
          </form>
        ) : !batch.good ? (
          <p className="bk-notice bk-notice-bad">
            Its best-before date has passed, so it cannot be released for
            sale. If the date is wrong, correct it under Details.
          </p>
        ) : (
          <form action={releaseBatchAction}>
            <Code value={batch.code} />
            <SubmitButton pending="Releasing" className="bk-btn w-full">
              Release it for sale
            </SubmitButton>
          </form>
        )}
        <RecallForm batch={batch} />
      </div>
    );
  }

  if (batch.status === "released") {
    return (
      <div className="flex flex-col gap-4">
        {batch.good ? (
          <p className="leading-snug">
            On sale. Orders are filled from it as they are packed.
          </p>
        ) : (
          <p className="bk-notice bk-notice-bad">
            Its best-before date has passed, so nothing more is sold from it
            and its shots no longer count as ready to sell. Close it to write
            off what is left.
          </p>
        )}
        <Fold summary="Close this batch">
          <form action={closeBatchAction} className="flex flex-col gap-3">
            <Code value={batch.code} />
            {batch.onHand > 0 ? (
              <>
                <input type="hidden" name="writeOff" value="true" />
                <p className="leading-snug">
                  {shots(batch.onHand)} still on hand. Closing writes them off
                  as waste. If they were sold or given away, record that first.
                </p>
                <SubmitButton
                  pending="Closing"
                  className="bk-btn bk-btn-quiet w-full"
                >
                  Write off {count(batch.onHand)} and close
                </SubmitButton>
              </>
            ) : (
              <>
                <p className="leading-snug">Nothing is left in it.</p>
                <SubmitButton
                  pending="Closing"
                  className="bk-btn bk-btn-quiet w-full"
                >
                  Close the batch
                </SubmitButton>
              </>
            )}
            <Hint>A closed batch cannot be opened again.</Hint>
          </form>
        </Fold>
        <RecallForm batch={batch} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="leading-snug">
        Closed. Nothing more is sold from it. A recall can still be recorded if
        a problem turns up later.
      </p>
      <RecallForm batch={batch} />
    </div>
  );
}

export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { code: raw } = await params;
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const now = new Date();

  let batch: BatchDetail;
  try {
    batch = await execute(getBatch, { code: decodeURIComponent(raw) }, caller);
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
    { entityType: "batch", entityId: batch.id, limit: 100 },
    caller,
  );

  const canWrite = staff.role !== "viewer";
  const planned = batch.status === "planned";
  const recalled = batch.status === "recalled";
  const allowed = canWrite ? HAND_MOVEMENTS[batch.status] : [];
  const recallListHref = `/backstage/stock/batches/${batch.code}/recall-list`;
  const givenOrWasted = -(batch.totals.sample + batch.totals.waste);
  const extra = Object.entries(batch.record.more);

  return (
    <>
      <PageHeader
        title={batch.code}
        back={{ href: "/backstage/stock/batches", label: "Batches" }}
        lead={batch.name}
        actions={
          planned ? null : (
            <Link href={recallListHref} className="bk-btn bk-btn-quiet">
              <span className="cap-trim">Recall list</span>
            </Link>
          )
        }
      />

      <p className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
        <BatchStatusPill status={batch.status} />
        <BestBeforePill
          days={batch.onHand > 0 ? batch.daysToBestBefore : null}
          within={NEAR_BEST_BEFORE_DAYS}
        />
      </p>
      <FormNotice notice={notice} tone={tone} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        {planned ? (
          <>
            <Stat
              label="Planned for"
              value={
                <span className="text-[1.25rem]">
                  {batch.madeOn ? formatDateKey(batch.madeOn) : "No date yet"}
                </span>
              }
            />
            <Stat
              label="Shots planned"
              value={
                batch.shotsPlanned === null ? (
                  <span className="text-[1.25rem]">Not set</span>
                ) : (
                  count(batch.shotsPlanned)
                )
              }
            />
          </>
        ) : (
          <>
            <Stat
              label="On hand"
              value={count(batch.onHand)}
              note={BATCH_STATUS_MEANS[batch.status]}
            />
            <Stat
              label="Made"
              value={count(batch.totals.made)}
              note={
                batch.madeOn ? `On ${formatDateKey(batch.madeOn)}` : undefined
              }
            />
            <Stat
              label="Sold"
              value={count(batch.sold)}
              note={`On ${count(batch.orderCount)} ${batch.orderCount === 1 ? "order" : "orders"}`}
            />
            <Stat
              label="Given away or wasted"
              value={count(givenOrWasted)}
              note={
                batch.totals.adjust === 0
                  ? "No corrections to the count"
                  : `Corrections after a count: ${batch.totals.adjust > 0 ? "+" : "−"}${count(Math.abs(batch.totals.adjust))}`
              }
            />
          </>
        )}
      </div>

      <div className="mb-6">
        <Panel title="Next step">
          <div className="max-w-[44rem]">
            <NextStep
              batch={batch}
              canWrite={canWrite}
              today={nzDateKey(now)}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel title="Movements" flush>
            <div id="movements" className="scroll-mt-24">
              {allowed.length > 0 ? (
                <div className="border-navy-line flex flex-col gap-1 border-b px-4 py-3">
                  {allowed.includes("sample") ? (
                    <Fold summary="Give some away">
                      <form
                        action={sampleAction}
                        className="mb-3 flex flex-col gap-3"
                      >
                        <Code value={batch.code} />
                        <Field
                          form="sample"
                          name="shots"
                          label="How many shots"
                          kind="count"
                          required
                        />
                        <Field
                          form="sample"
                          name="note"
                          label="Who or what for"
                          maxLength={280}
                          hint="A sample has no order behind it. This note is all there is to go on if the batch is ever recalled. It is dated now: if it was another day, say so here."
                        />
                        <SubmitButton
                          pending="Saving"
                          className="bk-btn bk-btn-quiet w-full"
                        >
                          Record the samples
                        </SubmitButton>
                      </form>
                    </Fold>
                  ) : null}
                  {allowed.includes("waste") ? (
                    <Fold summary="Write some off">
                      <form
                        action={wasteAction}
                        className="mb-3 flex flex-col gap-3"
                      >
                        <Code value={batch.code} />
                        <Field
                          form="waste"
                          name="shots"
                          label="How many shots"
                          kind="count"
                          required
                        />
                        <Choice
                          form="waste"
                          name="why"
                          label="What happened"
                          defaultValue="damaged"
                          options={[
                            { value: "damaged", label: "Damaged" },
                            { value: "expired", label: "Past its date" },
                            { value: "other", label: "Something else" },
                          ]}
                        />
                        <Field
                          form="waste"
                          name="note"
                          label="A few words about it"
                          maxLength={280}
                          hint="Needed if it was something else. It is dated now: if it happened on another day, say so here."
                        />
                        <SubmitButton
                          pending="Saving"
                          className="bk-btn bk-btn-quiet w-full"
                        >
                          Write them off
                        </SubmitButton>
                      </form>
                    </Fold>
                  ) : null}
                  {allowed.includes("adjust") ? (
                    <Fold summary="Correct the count">
                      <form
                        action={countAction}
                        className="mb-3 flex flex-col gap-3"
                      >
                        <Code value={batch.code} />
                        {/* What the screen showed when the count was made.
                            Only the difference from it is applied, so an
                            order packed in the meantime is not undone. */}
                        <input
                          type="hidden"
                          name="expected"
                          value={batch.onHand}
                        />
                        <Field
                          form="count"
                          name="counted"
                          label="How many are really there"
                          kind="count"
                          required
                          hint={`The screen says ${count(batch.onHand)}. Type what you counted. Only the difference is recorded, so anything packed while you were counting still stands.`}
                        />
                        <Field
                          form="count"
                          name="reason"
                          label="Why it was out"
                          required
                          maxLength={280}
                        />
                        <SubmitButton
                          pending="Saving"
                          className="bk-btn bk-btn-quiet w-full"
                        >
                          Correct the count
                        </SubmitButton>
                      </form>
                    </Fold>
                  ) : null}
                </div>
              ) : null}

              {batch.movements.length === 0 ? (
                <Empty title="Nothing has moved">
                  {planned
                    ? "A planned batch has no shots yet. They are counted in when it is made."
                    : "No shots have gone in or out of this batch."}
                </Empty>
              ) : (
                <ul className="bk-rows">
                  {batch.movements.map((movement) => (
                    <li
                      key={movement.id}
                      className="bk-row grid-cols-[1fr_auto]"
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-x-2 leading-snug">
                          <span className="font-semibold">
                            {MOVEMENT_LABEL[movement.kind]}
                          </span>
                          {movement.orderNumber ? (
                            <Link
                              href={`/backstage/orders/${movement.orderNumber}`}
                              className="link tabular-nums"
                            >
                              {movement.orderNumber}
                            </Link>
                          ) : null}
                        </p>
                        <p className="bk-muted text-[0.9375rem] leading-snug [overflow-wrap:anywhere]">
                          {movement.orderNumber === null && movement.note
                            ? `${movement.note} · `
                            : ""}
                          {movement.by ? `${movement.by} · ` : ""}
                          <When at={movement.at} now={now} />
                        </p>
                      </div>
                      <p className="bk-num font-semibold">
                        {movement.shots > 0 ? "+" : "−"}
                        {count(Math.abs(movement.shots))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          {planned ? null : (
            <Panel title="Orders filled from it" flush>
              {batch.orders.length === 0 ? (
                <Empty title="No orders yet">
                  When an order is packed from this batch it shows up here, and
                  on the recall list.
                </Empty>
              ) : (
                <>
                  <ul className="bk-rows">
                    {batch.orders.map((order) => (
                      <li key={order.id}>
                        <Link
                          href={`/backstage/orders/${order.number}`}
                          className="bk-row grid-cols-[1fr_auto]"
                        >
                          <span className="min-w-0">
                            <span className="block font-semibold tabular-nums">
                              {order.number}
                            </span>
                            <span className="bk-muted block truncate text-[0.9375rem]">
                              {order.name}, {order.city}
                            </span>
                          </span>
                          <span className="flex flex-col items-end gap-1">
                            <span className="bk-num font-semibold">
                              {shots(order.shots)}
                            </span>
                            <OrderStatusPill status={order.status} />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="border-navy-line border-t px-4 py-3">
                    <Link href={recallListHref} className="link">
                      {batch.orderCount > batch.orders.length
                        ? `All ${count(batch.orderCount)} orders, with how to reach each customer`
                        : "The recall list, with how to reach each customer"}
                    </Link>
                  </p>
                </>
              )}
            </Panel>
          )}

          <Panel title="History" flush>
            <ActivityList
              lines={history}
              now={now}
              empty="Nothing has been done to this batch yet."
            />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="The record">
            <div id="record" className="scroll-mt-24">
              {recordIsEmpty(batch.record) ? (
                <p className="bk-muted leading-snug">
                  Nothing is written on this batch&apos;s record yet.
                </p>
              ) : (
                <dl className="bk-kv">
                  {RECORD_FIELDS.filter(
                    (field) => batch.record[field.key] !== "",
                  ).map((field) => (
                    <Fragment key={field.key}>
                      <dt>{field.label}</dt>
                      <dd className="whitespace-pre-wrap">
                        {batch.record[field.key]}
                      </dd>
                    </Fragment>
                  ))}
                  {extra.map(([label, value]) => (
                    <Fragment key={`more:${label}`}>
                      <dt>{label}</dt>
                      <dd className="whitespace-pre-wrap">{value}</dd>
                    </Fragment>
                  ))}
                </dl>
              )}
              <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
                What has to be written down for a batch is set by your food
                control plan, not by this screen.
              </p>
              {canWrite && !recalled ? (
                <div className="mt-2">
                  <Fold summary="Write on the record">
                    <form
                      action={updateRecordAction}
                      className="flex flex-col gap-3"
                    >
                      <Code value={batch.code} />
                      <RecordFields form="record" batch={batch} />
                      <SubmitButton
                        pending="Saving"
                        className="bk-btn bk-btn-quiet w-full"
                      >
                        Save the record
                      </SubmitButton>
                    </form>
                  </Fold>
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel title="Details">
            <dl className="bk-kv">
              <dt>Code</dt>
              <dd className="font-semibold tabular-nums">{batch.code}</dd>
              <dt>Name</dt>
              <dd>{batch.name}</dd>
              <dt>{planned ? "Planned for" : "Made on"}</dt>
              <dd>
                <DateText date={batch.madeOn} none="No date yet" />
              </dd>
              <dt>Best before</dt>
              <dd>
                <DateText date={batch.bestBefore} />
                {batch.daysToBestBefore === null
                  ? ""
                  : `, ${daysAwayText(batch.daysToBestBefore)}`}
              </dd>
              <dt>{planned ? "Shots planned" : "Shots counted"}</dt>
              <dd>
                {batch.shotsPlanned === null ? (
                  <span className="bk-muted">Not set</span>
                ) : (
                  count(batch.shotsPlanned)
                )}
              </dd>
              <dt>Cost</dt>
              <dd>
                {batch.costCents === null ? (
                  <span className="bk-muted">Not known</span>
                ) : (
                  <>
                    {formatNzd(batch.costCents)}
                    {batch.totals.made > 0
                      ? `, about ${formatNzd(Math.round(batch.costCents / batch.totals.made))} a shot`
                      : ""}
                  </>
                )}
              </dd>
              {batch.notes ? (
                <>
                  <dt>Notes</dt>
                  <dd className="whitespace-pre-wrap">{batch.notes}</dd>
                </>
              ) : null}
            </dl>

            {canWrite ? (
              <div className="mt-3">
                <Fold
                  summary={recalled ? "Change the notes" : "Change the details"}
                >
                  <form
                    action={updateBatchAction}
                    className="flex flex-col gap-3"
                  >
                    <Code value={batch.code} />
                    {recalled ? null : (
                      <>
                        {planned || batch.status === "made" ? (
                          <Field
                            form="details"
                            name="newCode"
                            label="Batch code"
                            required
                            maxLength={12}
                            defaultValue={batch.code}
                            hint="As printed on the bottle. It cannot be changed once the batch is released."
                          />
                        ) : null}
                        <Field
                          form="details"
                          name="name"
                          label="Name"
                          required
                          maxLength={80}
                          defaultValue={batch.name}
                        />
                        <Field
                          form="details"
                          name="madeOn"
                          label={planned ? "Planned for" : "Made on"}
                          kind="date"
                          required={!planned}
                          defaultValue={batch.madeOn}
                        />
                        <Field
                          form="details"
                          name="bestBefore"
                          label="Best before"
                          kind="date"
                          defaultValue={batch.bestBefore}
                        />
                        {planned ? (
                          <Field
                            form="details"
                            name="shotsPlanned"
                            label="Shots planned"
                            kind="count"
                            defaultValue={batch.shotsPlanned}
                          />
                        ) : null}
                        <Field
                          form="details"
                          name="cost"
                          label="What it cost to make"
                          kind="money"
                          defaultValue={dollars(batch.costCents)}
                          hint="Everything the batch cost, in dollars. Leave it blank if you do not know."
                        />
                      </>
                    )}
                    <TextArea
                      form="details"
                      name="notes"
                      label="Notes"
                      maxLength={4000}
                      defaultValue={batch.notes}
                    />
                    <SubmitButton
                      pending="Saving"
                      className="bk-btn bk-btn-quiet w-full"
                    >
                      Save
                    </SubmitButton>
                  </form>
                </Fold>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </>
  );
}
