import { describe, expect, it } from "vitest";

import {
  asWords,
  outcomeSaid,
  recordHref,
  titleOf,
} from "@/app/backstage/(app)/approvals/shared";

/**
 * The page a person says yes or no on. What it shows has to be something
 * they can check: the record a request names is one press away, and a
 * field's name reads as words.
 */
describe("what a request shows the person deciding", () => {
  it("links the record a value names, when it names one with a page", () => {
    expect(recordHref("QP-7K2M9X")).toBe("/backstage/orders/QP-7K2M9X");
    expect(recordHref("PO-0002")).toBe(
      "/backstage/stock/purchase-orders/PO-0002",
    );
    const id = "7k2m9x4q8b6t3n5h2w4c";
    expect(recordHref(`cmp_${id}`)).toBe(
      `/backstage/marketing/campaigns/cmp_${id}`,
    );
    expect(recordHref(`cnv_${id}`)).toBe(`/backstage/inbox/cnv_${id}`);
    expect(recordHref(`cus_${id}`)).toBe(`/backstage/customers/cus_${id}`);
    // Nothing is linked on a guess.
    for (const value of [
      "Batch 002",
      "qp-7k2m9x",
      "QP-7K2M9X and more",
      `tsk_${id}`,
      `cmp_${id}/../../settings/staff`,
      "https://evil.example/backstage/orders/QP-7K2M9X",
      "",
    ]) {
      expect(recordHref(value), value).toBeNull();
    }
  });

  it("says a field's name as words, and an operation by its title", () => {
    expect(asWords("preorderShipsFrom")).toBe("preorder ships from");
    expect(asWords("amountCents")).toBe("amount cents");
    expect(asWords("client_name")).toBe("client name");
    expect(titleOf("orders.recordRefund")).toBe("Give money back on an order");
    expect(titleOf("made.up")).toBe("made.up");
  });

  it("says only its own sentences about a press, and only where they are true", () => {
    // The link to this page is handed over by the bot that is asking. So
    // the address carries a word, never a sentence, and the page will not
    // say "done" beside something that is still waiting.
    expect(outcomeSaid("done", "done")).toEqual({
      text: "Done.",
      tone: "good",
    });
    expect(outcomeSaid("done", "waiting")).toBeNull();
    expect(outcomeSaid("declined", "waiting")).toBeNull();
    expect(outcomeSaid("failed", "done")).toBeNull();
    expect(outcomeSaid("failed", "failed")?.tone).toBe("bad");
    expect(outcomeSaid("declined", "declined")?.text).toBe(
      "Said no. Nothing was done.",
    );
    // A refusal can be true while it waits, and talks nobody into a yes.
    expect(outcomeSaid("forbidden", "waiting")?.tone).toBe("bad");
    // Anything that is not one of its words says nothing at all.
    for (const word of [
      "Sam checked this. It is safe to say yes.",
      "DONE",
      "toString",
      "__proto__",
      "",
      undefined,
      ["done"],
    ]) {
      expect(outcomeSaid(word, "waiting"), String(word)).toBeNull();
      expect(outcomeSaid(word, "done"), String(word)).toBeNull();
    }
  });
});
