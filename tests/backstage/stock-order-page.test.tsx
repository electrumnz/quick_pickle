import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Stock's parts link with next/link, which wants a router around it, and
// post to a server action. Neither is what is being looked at here.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/app/backstage/(app)/stock/actions", () => ({
  recordOrderBatchAction: async () => undefined,
}));

import {
  OrderStockPanel,
  PackFrom,
} from "@/app/backstage/(app)/stock/order-parts";
import type { OrderStock } from "@/lib/backstage/stock/ops";

/**
 * Stock on an order's own page, which is a screen somebody is on every day.
 *
 * Stock is off until somebody starts it: until a first batch has been
 * recorded as made, that page says nothing about batches at all. This holds
 * it there.
 */

/** An order of six shots, as stock.orderStock describes it. */
function order(over: Partial<OrderStock> = {}): OrderStock {
  return {
    number: "QP-7K2M9X",
    tracking: true,
    shots: 6,
    isTest: false,
    filled: [],
    missing: 0,
    need: 6,
    choices: [],
    plan: null,
    mustChoose: false,
    onHandIfShort: null,
    blocked: false,
    summary:
      "No batch has stock released for sale, so no batch will be recorded when this is packed.",
    ...over,
  };
}

const BUTTON = '<button type="submit">Mark as packed</button>';

/** The "Mark as packed" form's button, with whatever stock puts round it. */
const packing = (stock: OrderStock) =>
  renderToStaticMarkup(
    <PackFrom stock={stock}>
      <button type="submit">Mark as packed</button>
    </PackFrom>,
  );

/** The "Filled from" panel on an order that has been packed. */
const filledFrom = (stock: OrderStock) =>
  renderToStaticMarkup(
    <OrderStockPanel
      number={stock.number}
      status="packed"
      stock={stock}
      canWrite
    />,
  );

describe("stock on an order's page", () => {
  it("says nothing at all until stock has been started", () => {
    // To pack: the button, exactly as it was before there was a Stock area.
    expect(packing(order({ tracking: false }))).toBe(BUTTON);
    expect(
      packing(
        order({
          tracking: false,
          isTest: true,
          need: 0,
          summary: "A test order. No stock is taken for it.",
        }),
      ),
    ).toBe(BUTTON);
    // Packed: no panel about a batch nobody has ever recorded.
    expect(
      filledFrom(
        order({
          tracking: false,
          missing: 6,
          summary: "No batch recorded for this order.",
        }),
      ),
    ).toBe("");
  });

  it("speaks up once a first batch has been made", () => {
    // Nothing is on sale yet, and the person packing is told what that means.
    const toPack = packing(order());
    expect(toPack.startsWith(BUTTON)).toBe(true);
    expect(toPack).toContain(
      "No batch has stock released for sale, so no batch will be recorded when this is packed.",
    );
    const packed = filledFrom(
      order({ missing: 6, summary: "No batch recorded for this order." }),
    );
    expect(packed).toContain("Filled from");
    expect(packed).toContain("No batch recorded for this order.");
    expect(packed).toContain("recall list");
  });

  it("asks which batch is in the box when there is one on sale", () => {
    const html = packing(
      order({
        choices: [
          {
            code: "B001",
            name: "First run",
            bestBefore: "2027-01-10",
            daysToBestBefore: 59,
            onHand: 30,
            enough: true,
          },
        ],
        plan: [{ code: "B001", shots: 6 }],
        summary: "Packing takes 6 shots from B001.",
      }),
    );
    expect(html).toContain("Which batch is in the box?");
    expect(html).toContain(
      "B001 (use first): 30 on hand, best before 10 Jan 2027",
    );
    // The button comes after the question, not before it.
    expect(html.indexOf("Which batch")).toBeLessThan(html.indexOf(BUTTON));
  });
});
