import { describe, expect, it } from "vitest";

import { checkOutgoing, refuseUnsendable } from "@/lib/backstage/core/copy";
import { OpError } from "@/lib/backstage/core/errors";

const refusal = (run: () => unknown): OpError => {
  try {
    run();
  } catch (error) {
    if (error instanceof OpError) return error;
    throw error;
  }
  throw new Error("it was let through");
};

describe("words that are about to leave", () => {
  it("lets ordinary shop talk through", () => {
    const parts = {
      subject: "Your Quick Pickle order is on the courier",
      body: "Kia ora Sam. Twelve shots, sour and salty and clear as a whistle, left us this morning. Best before 12/2027.",
    };
    expect(checkOutgoing(parts)).toEqual([]);
    expect(refuseUnsendable(parts)).toEqual({ cleared: [] });
  });

  it("refuses the concept deck's own line, whoever wrote it", () => {
    const error = refusal(() =>
      refuseUnsendable({
        subject: "Game day",
        body: "A pickle punch to cramps in 60 seconds flat.",
      }),
    );
    expect(error.code).toBe("invalid_input");
    expect(error.message).toContain('"cramps" in the body');
    expect(error.message).toContain("This cannot go out as written.");
    // The form can put the reason beside the right field.
    expect(Object.keys(error.fields)).toEqual(["body"]);
  });

  it("refuses the quieter claims too, and says which part they are in", () => {
    const problems = checkOutgoing({
      subject: "Great for hydration",
      body: "Lucky says hi.",
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: "banned",
      part: "subject",
      found: "hydration",
    });
  });

  it("refuses the word recovery by itself, not only in a phrase", () => {
    // "Aids recovery" was always caught. "Your recovery ritual" says the same
    // thing with fewer words, and it used to pass.
    for (const said of [
      "Your recovery ritual, in a tiny bottle.",
      "Recovery starts here.",
      "Made for recovery days.",
    ]) {
      const problems = checkOutgoing({ body: said });
      expect(
        problems.map((problem) => problem.rule),
        said,
      ).toContain("EL-07");
      // A tick cannot clear it: it is banned, not waiting on a check.
      expect(() =>
        refuseUnsendable({ body: said }, { checked: ["EL-07"] }),
      ).toThrow(OpError);
    }
    // The verb, about a parcel, is ordinary shop talk.
    expect(
      checkOutgoing({ body: "The courier is trying to recover your parcel." }),
    ).toEqual([]);
  });

  it("says a thing once, however many times it was written", () => {
    const problems = checkOutgoing({
      body: "Hydration. More hydration. HYDRATION!",
    });
    expect(problems).toHaveLength(1);
  });

  it("holds a claim that needs checking until a person has checked it", () => {
    const parts = { body: "Free delivery over $60 this week." };
    const [problem] = checkOutgoing(parts);
    expect(problem).toMatchObject({
      kind: "restricted",
      found: "Free delivery",
    });

    const error = refusal(() => refuseUnsendable(parts));
    expect(error.message).toContain("needs a person to confirm it is true");

    const { cleared } = refuseUnsendable(parts, {
      checked: [problem?.rule ?? ""],
    });
    expect(cleared).toHaveLength(1);
    // Checking a different rule clears nothing.
    expect(() => refuseUnsendable(parts, { checked: ["PROV-01"] })).toThrow(
      OpError,
    );
  });

  it("never lets a tick-box clear a banned claim", () => {
    const parts = { body: "The best cure for cramps." };
    const rules = checkOutgoing(parts).map((problem) => problem.rule);
    expect(rules.length).toBeGreaterThan(0);
    const error = refusal(() => refuseUnsendable(parts, { checked: rules }));
    expect(error.message).toContain("This cannot go out as written.");
  });

  it("keeps em dashes out of anything a customer reads", () => {
    const error = refusal(() =>
      refuseUnsendable({ body: "Your order is on the courier — thanks!" }),
    );
    expect(error.message).toContain("No em dashes");
    // A hyphen and an en dash in a range are fine.
    expect(
      checkOutgoing({ body: "Open 9–5, Monday to Friday. Pre-order now." }),
    ).toEqual([]);
  });

  it("lets the prescribed answer to a health question through, and nothing that leans on it", () => {
    // Word for word from legal/COPY-RULES.md, section 5.
    const answer =
      "Quick Pickle is a food and we don't make health claims about it. Your doctor or physio is the one to ask.";
    expect(checkOutgoing({ body: answer })).toEqual([]);
    // A phone's apostrophe, and the long way of saying it.
    expect(
      checkOutgoing({ body: "We don’t make health claims about it." }),
    ).toEqual([]);
    expect(
      checkOutgoing({ body: "We do not make health claims about it." }),
    ).toEqual([]);

    // Only the denial is excused. The word anywhere else is still refused.
    for (const body of [
      "It is a healthy little shot.",
      "Read our health claims here.",
      "We make health claims you can trust.",
      "We don't make health claims, but it is good for you.",
      "We don't make health claims. Ask anyone about their cramps.",
    ]) {
      const kinds = checkOutgoing({ body }).map((problem) => problem.kind);
      expect(kinds, body).toContain("banned");
    }
  });

  it("reports both kinds together, banned first", () => {
    const error = refusal(() =>
      refuseUnsendable({
        body: "Made in New Zealand, and great for hydration.",
      }),
    );
    expect(error.message.indexOf("cannot go out")).toBeLessThan(
      error.message.indexOf("needs a person"),
    );
  });
});
