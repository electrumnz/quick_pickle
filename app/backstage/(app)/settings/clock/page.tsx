import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Empty,
  Notice,
  PageHeader,
  Panel,
  Pill,
  When,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { clockStatus } from "@/lib/backstage/clock/ops";
import { MAX_ATTEMPTS } from "@/lib/backstage/core/events";
import { execute } from "@/lib/backstage/core/op";
import { minutesSince } from "@/lib/time";

import { dropStepAction, retryStepAction, tickNowAction } from "./actions";

export const metadata: Metadata = { title: "Clock and failed steps" };

/** What each kind of step is, in the words a person would use. */
const WHAT: Readonly<Record<string, string>> = {
  "order.paid": "Write an order's receipt",
  "order.shipped": "Write the email saying an order is on the courier",
  "order.cancelled":
    "Close the payment page of a cancelled order, and write the email saying it is cancelled",
  "order.refunded": "Write the email saying a payment is on its way back",
  "order.refund_requested": "Send a refund back through Stripe",
  "mail.queued": "Send an email",
};

/**
 * The clock, and whatever it could not finish.
 *
 * Some things happen after a change rather than in it: money going back to
 * a card, a payment page being closed. Each is tried, then tried again with
 * a longer wait, and after eight tries left here for a person.
 */
export default async function ClockPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff("/backstage/settings/clock");
  const { notice, tone } = await searchParams;
  const { last, stuck } = await execute(clockStatus, {}, await staffCaller());
  const canWrite = staff.role !== "viewer";
  const isOwner = staff.role === "owner";
  const lastAt = last === null ? null : new Date(last.at);
  const ticking = lastAt !== null && minutesSince(lastAt) < 20;

  return (
    <>
      <PageHeader
        title="Clock and failed steps"
        lead="Some things happen just after a change: money going back to a card, a payment page being closed, an email being sent. Each is tried, tried again with a longer wait, and after eight tries left here for you."
        back={{ href: "/backstage/settings", label: "Settings" }}
      />

      {notice ? (
        <div className="mb-4">
          <Notice tone={tone === "bad" ? "bad" : "good"}>{notice}</Notice>
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <Panel
          title="The clock"
          aside={
            <Pill tone={ticking ? "done" : "todo"}>
              {ticking ? "Running" : lastAt === null ? "Never run" : "Stopped"}
            </Pill>
          }
        >
          <p className="leading-snug">
            {lastAt === null ? (
              "It has never run. Until it does, nothing tries a failed step again or closes an order nobody paid for."
            ) : (
              <>
                Last ran <When at={lastAt} />.{" "}
                {ticking
                  ? "It comes round every five minutes or so."
                  : "It should come round every five minutes or so, so something has stopped it."}
              </>
            )}
          </p>
          {last !== null ? (
            <dl className="bk-kv mt-4">
              <dt>Steps done</dt>
              <dd className="bk-num">{last.events.handled}</dd>
              <dt>Steps that failed</dt>
              <dd className="bk-num">
                {last.events.failed + last.events.gaveUp}
              </dd>
              <dt>Unpaid orders looked into</dt>
              <dd className="bk-num">{last.orders.looked}</dd>
              <dt>Found paid</dt>
              <dd className="bk-num">{last.orders.paid}</dd>
              <dt>Closed unpaid</dt>
              <dd className="bk-num">{last.orders.closed}</dd>
            </dl>
          ) : null}
          {canWrite ? (
            <form action={tickNowAction} className="mt-4">
              <SubmitButton pending="Running" className="bk-btn bk-btn-quiet">
                Run it now
              </SubmitButton>
            </form>
          ) : null}
        </Panel>

        <Panel title="Steps that failed" flush>
          {stuck.length === 0 ? (
            <Empty title="Nothing is stuck">
              Every step has gone through. If one fails it shows here with the
              reason.
            </Empty>
          ) : (
            <ul className="bk-rows">
              {stuck.map((step) => {
                const number =
                  typeof step.payload.number === "string"
                    ? step.payload.number
                    : null;
                return (
                  <li key={step.id} className="px-4 py-4 md:px-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">
                        {WHAT[step.type] ?? step.type}
                      </p>
                      <Pill tone={step.gaveUp ? "todo" : "doing"}>
                        {step.gaveUp
                          ? "Out of tries"
                          : `Try ${String(step.attempts)} of ${String(MAX_ATTEMPTS)}`}
                      </Pill>
                    </div>
                    <p className="bk-muted mt-1 text-[0.9375rem] leading-snug">
                      {number !== null && /^QP-[0-9A-Z]{6}$/.test(number) ? (
                        <>
                          Order{" "}
                          <Link
                            href={`/backstage/orders/${number}`}
                            className="link"
                          >
                            {number}
                          </Link>
                          .{" "}
                        </>
                      ) : null}
                      First tried <When at={step.at} />.{" "}
                      {step.nextTry !== null ? (
                        <>
                          Next try <When at={step.nextTry} />.
                        </>
                      ) : step.gaveUp ? (
                        "It will not be tried again by itself."
                      ) : null}
                    </p>
                    {step.lastError ? (
                      <p className="mt-2 text-[0.9375rem] leading-snug">
                        <span className="font-semibold">What went wrong:</span>{" "}
                        {step.lastError}
                      </p>
                    ) : null}
                    {canWrite ? (
                      <div className="mt-3 flex flex-wrap items-start gap-3">
                        <form action={retryStepAction}>
                          <input type="hidden" name="id" value={step.id} />
                          <SubmitButton
                            pending="Trying"
                            className="bk-btn bk-btn-quiet"
                          >
                            Try it again now
                          </SubmitButton>
                        </form>
                        {isOwner ? (
                          <details>
                            <summary className="label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
                              <span className="cap-trim">Give up on it</span>
                            </summary>
                            <form
                              action={dropStepAction}
                              className="mt-2 flex flex-col gap-3"
                            >
                              <input type="hidden" name="id" value={step.id} />
                              <div>
                                <label
                                  htmlFor={`why-${step.id}`}
                                  className="field-label"
                                >
                                  Why
                                </label>
                                <input
                                  id={`why-${step.id}`}
                                  name="reason"
                                  required
                                  maxLength={280}
                                  className="field"
                                />
                              </div>
                              <SubmitButton
                                pending="Stopping"
                                className="bk-btn bk-btn-pink"
                              >
                                Stop trying
                              </SubmitButton>
                              <p className="bk-muted text-[0.9375rem] leading-snug">
                                Whatever this step was meant to do will not
                                happen unless someone does it by hand.
                              </p>
                            </form>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
