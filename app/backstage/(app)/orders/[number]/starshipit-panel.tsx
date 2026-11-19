import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Panel } from "@/components/backstage/ui";
import type { Handoff } from "@/lib/backstage/orders/starshipit";
import type { OrderStatus } from "@/db/schema";
import { formatNzDateTime } from "@/lib/time";

import { starshipitAction, starshipitDealtAction } from "../actions";

/**
 * Where one order stands with Starshipit, and the one or two buttons that
 * go with it. Only drawn while Starshipit is connected, or once the order
 * has been there.
 */
export function StarshipitPanel({
  number,
  status,
  isTest,
  handoff,
  connected,
  canWrite,
}: {
  readonly number: string;
  readonly status: OrderStatus;
  readonly isTest: boolean;
  readonly handoff: Handoff | null;
  /** Both keys are set on the host. */
  readonly connected: boolean;
  readonly canWrite: boolean;
}) {
  const packed = status === "packed";
  const state = handoff?.state ?? null;
  const canSend =
    canWrite &&
    connected &&
    packed &&
    (state === null ||
      state === "withdrawn" ||
      state === "failed" ||
      state === "trying");
  const canClear =
    canWrite &&
    (state === "failed" ||
      state === "stranded" ||
      state === "trying" ||
      (state === "sent" && handoff?.trouble !== null));

  const says = ((): string => {
    switch (state) {
      case null:
        return packed
          ? isTest
            ? "Not in Starshipit. A test order only goes when you send it, because a label costs money."
            : "Not in Starshipit. Packed orders go there by themselves: this one was packed before it was connected, or has not gone yet."
          : "Once it is packed it goes to Starshipit by itself, ready for a label.";
      case "trying":
        return "Sent to Starshipit, and no clear answer has come back yet. It is tried again by itself, after looking to see whether the last try landed.";
      case "sent":
        return `In Starshipit since ${handoff?.sentAt ? formatNzDateTime(handoff.sentAt) : "it was packed"}, waiting for a label. Once one is printed there, this order is shipped here by itself within a few minutes, and the customer is told.`;
      case "failed":
        return "Starshipit would not take it.";
      case "shipped":
        return "Starshipit printed the label, and the order was shipped here from what it said.";
      case "withdrawn":
        return "Taken back out of Starshipit.";
      case "stranded":
        return "Starshipit has it, and should not.";
    }
  })();

  return (
    <Panel title="Starshipit">
      <div className="flex flex-col gap-3" data-testid="starshipit">
        <p className="leading-snug">{says}</p>
        {handoff?.trouble ? (
          <p className="leading-snug" role="status">
            {handoff.trouble}
          </p>
        ) : null}
        {handoff?.reference ? (
          <p className="bk-muted text-sm leading-snug">
            Starshipit&apos;s number for it: {handoff.reference}
          </p>
        ) : null}
        {canSend ? (
          <form action={starshipitAction}>
            <input type="hidden" name="number" value={number} />
            <SubmitButton pending="Sending" className="bk-btn bk-btn-quiet">
              {state === null || state === "withdrawn"
                ? "Send to Starshipit"
                : "Send to Starshipit again"}
            </SubmitButton>
          </form>
        ) : null}
        {canClear ? (
          <form action={starshipitDealtAction}>
            <input type="hidden" name="number" value={number} />
            <SubmitButton pending="Saving" className="bk-btn bk-btn-quiet">
              I have dealt with it in Starshipit
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </Panel>
  );
}
