import { describe, expect, it } from "vitest";

import { snippetOf } from "@/lib/backstage/mail/conversations";
import {
  hasReplyPrefix,
  isGenericSubject,
  subjectKey,
  tidySubject,
} from "@/lib/backstage/mail/subjects";

/**
 * Subject lines boiled down for matching, and the first words of a message
 * for a list. Pure functions: no database anywhere in this file.
 */

describe("subject keys", () => {
  it("strips every reply and forward prefix, whatever the language or spacing", () => {
    for (const subject of [
      "Where is my parcel?",
      "Re: Where is my parcel?",
      "RE : Where is my parcel?",
      "Fwd: Re: where is my parcel",
      "FW: RE: Fwd: Where is my parcel?",
      "AW: Where is my parcel?",
      "SV: Where is my parcel?",
      "Re[2]: Where is my parcel?",
      "  re:   WHERE   is my   parcel ?  ",
    ]) {
      expect(subjectKey(subject), subject).toBe("where is my parcel");
    }
  });

  it("strips gateway tags and ticket numbers in brackets", () => {
    expect(subjectKey("[External] Bottles")).toBe("bottles");
    expect(subjectKey("RE: [EXT] (External) Bottles")).toBe("bottles");
    expect(subjectKey("RE: [External] Bottles (Case 48213-B)")).toBe("bottles");
    expect(subjectKey("Bottles [Ticket #48213]")).toBe("bottles");
    expect(subjectKey("Bottles [#991] and caps (ref: 12-34)")).toBe(
      "bottles and caps",
    );
  });

  it("leaves a ticket number that is not in brackets alone", () => {
    // Two tickets are two things. Only the reference rule may join them.
    expect(subjectKey("Ticket #48213 update")).toBe("ticket #48213 update");
    expect(subjectKey("Ticket #48213 update")).not.toBe(
      subjectKey("Ticket #48214 update"),
    );
  });

  it("knows a subject that says nothing", () => {
    for (const subject of [
      "",
      "Hi",
      "Re: hello",
      "Question",
      "ENQUIRY",
      "Fwd: Order",
      "invoice",
      "(no subject)",
      "!!!",
      "123",
    ]) {
      expect(isGenericSubject(subjectKey(subject)), subject).toBe(true);
    }
    expect(isGenericSubject(subjectKey("Bottles for the March run"))).toBe(
      false,
    );
  });

  it("tidies a title without shouting or tags", () => {
    expect(tidySubject("RE: [External]  Where is   my order?")).toBe(
      "Where is my order?",
    );
    expect(tidySubject("   ")).toBe("(no subject)");
    expect(tidySubject("x".repeat(500))).toHaveLength(200);
  });
});

describe("what looks like a reply", () => {
  it("knows a reply prefix in the languages we may see, past any gateway tag", () => {
    for (const subject of [
      "Re: Bottles",
      "RE : Bottles",
      "re[2]: Bottles",
      "AW: Bottles",
      "SV: Bottles",
      "[External] Re: Bottles",
      "(EXT) [SPAM?] RE: Bottles",
    ]) {
      expect(hasReplyPrefix(subject), subject).toBe(true);
    }
  });

  it("does not take a forward, or a word that starts the same way, for a reply", () => {
    for (const subject of [
      "Bottles",
      "Fwd: Bottles",
      "FW: Re: Bottles",
      "Regarding bottles",
      "Refill order",
      "",
    ]) {
      expect(hasReplyPrefix(subject), subject).toBe(false);
    }
  });
});

describe("snippets", () => {
  it("puts the first words on one line", () => {
    expect(snippetOf("Hi there,\n\n  Where is\tmy order?  ")).toBe(
      "Hi there, Where is my order?",
    );
    expect(snippetOf("")).toBe("");
  });

  it("cuts at a word and says there is more", () => {
    const long = "Twelve shots of pickle juice ".repeat(12);
    const cut = snippetOf(long);
    expect(cut.length).toBeLessThanOrEqual(141);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
    // One enormous word has nowhere better to be cut than the limit.
    expect(snippetOf("x".repeat(500))).toBe(`${"x".repeat(140)}…`);
  });
});
