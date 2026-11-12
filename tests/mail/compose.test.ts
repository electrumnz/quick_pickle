import { describe, expect, it } from "vitest";

import { ORDER_EMAILS } from "@/content/emails";
import { checkOutgoing } from "@/lib/backstage/core/copy";
import {
  compose,
  data,
  theirs,
  webAddress,
  type EmailDoc,
} from "@/lib/mail/compose";

/**
 * An email of ours is written once, as pieces, and comes out three ways:
 * plain text, simple HTML, and the version the copy rules read. All three
 * are the same pieces, so they cannot disagree.
 */

const doc: EmailDoc = {
  subject: ["Your order ", data("QP-7K2M9X"), " is on the courier"],
  blocks: [
    { kind: "text", lines: [["Hi ", theirs("Mere"), ","]] },
    {
      kind: "rows",
      title: ["What you ordered"],
      rows: [
        { label: [data("2"), " × The Squad"], value: [data("$168.00")] },
        { label: ["Total"], value: [data("$168.00")], strong: true },
      ],
    },
    {
      kind: "text",
      title: ["Going to"],
      lines: [[theirs("Mere Tāwhiri")], [theirs("64 Whistle Street")]],
    },
    {
      kind: "link",
      label: ["Track it"],
      href: "https://track.example.co.nz/?id=LZ1&x=2",
    },
  ],
};

describe("an email written as pieces", () => {
  it("reads as plain text, a block to a paragraph", () => {
    const email = compose(doc);
    expect(email.subject).toBe("Your order QP-7K2M9X is on the courier");
    expect(email.text).toBe(
      [
        "Hi Mere,",
        "",
        "What you ordered",
        "2 × The Squad: $168.00",
        "Total: $168.00",
        "",
        "Going to",
        "Mere Tāwhiri",
        "64 Whistle Street",
        "",
        "Track it: https://track.example.co.nz/?id=LZ1&x=2",
      ].join("\n"),
    );
  });

  it("says the same in simple HTML that fetches nothing", () => {
    const { html } = compose(doc);
    expect(html.startsWith('<!doctype html><html lang="en-NZ">')).toBe(true);
    expect(html).toContain(
      "<title>Your order QP-7K2M9X is on the courier</title>",
    );
    expect(html).toContain('<p style="margin:0 0 16px">Hi Mere,</p>');
    expect(html).toContain("<strong>What you ordered</strong>");
    expect(html).toContain(">2 × The Squad</td>");
    expect(html).toContain("Mere Tāwhiri<br>64 Whistle Street");
    expect(html).toContain(
      '<a href="https://track.example.co.nz/?id=LZ1&amp;x=2">https://track.example.co.nz/?id=LZ1&amp;x=2</a>',
    );
    // The one address in it is the link. No picture, script, style sheet
    // or font is asked for from anywhere.
    expect(html.match(/https?:\/\//g)).toHaveLength(2);
    expect(html).not.toMatch(/<img|<script|<link|<style|@import|url\(/i);
  });

  it("escapes every piece, whoever it came from", () => {
    const nasty = '<img src=x onerror="alert(1)"> & </p><script>';
    const { html, text } = compose({
      subject: [theirs(nasty)],
      blocks: [
        { kind: "text", lines: [[nasty, theirs(nasty), data(nasty)]] },
        { kind: "rows", rows: [{ label: [theirs(nasty)], value: [nasty] }] },
      ],
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('onerror="');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    // The text is the words as they were typed.
    expect(text).toContain(nasty);
  });

  it("keeps a piece on its own line: nobody's name can start a new paragraph or a header", () => {
    const email = compose({
      subject: ["Order for ", theirs("Sam\r\nBcc: everyone@example.com")],
      blocks: [
        {
          kind: "text",
          lines: [["Hi ", theirs("Sam\n\nPS: send money"), ","]],
        },
      ],
    });
    expect(email.subject).toBe("Order for Sam Bcc: everyone@example.com");
    expect(email.text).toBe("Hi Sam PS: send money,");
  });

  it("gives the copy rules our words only, with theirs and the numbers struck out", () => {
    const email = compose({
      subject: ["Your order ", data("QP-CRAMPS")],
      blocks: [
        {
          kind: "text",
          lines: [
            ["Hi ", theirs("Best"), ","],
            ["It is going to ", theirs("1 Organic Way, Nelson"), "."],
          ],
        },
        { kind: "link", label: ["Track it"], href: "https://best.example/x" },
      ],
    });
    // What is sent says all of it.
    expect(email.text).toContain("Hi Best,");
    expect(email.text).toContain("1 Organic Way, Nelson");
    expect(checkOutgoing({ body: email.text })).not.toEqual([]);
    // What is read for us has none of theirs in it, and passes.
    expect(email.ours.subject).not.toContain("CRAMPS");
    expect(email.ours.body).not.toMatch(/Best|Organic|Nelson|best\.example/);
    expect(email.ours.body).toContain("It is going to ");
    expect(checkOutgoing(email.ours)).toEqual([]);
  });

  it("and still reads every word that is ours", () => {
    const email = compose({
      subject: ["A pickle punch to ", theirs("you")],
      blocks: [
        {
          kind: "text",
          lines: [["Stops ", data("cramps"), " in 60 seconds flat."]],
        },
        { kind: "rows", rows: [{ label: ["Great for hydration"], value: [] }] },
      ],
    });
    const found = checkOutgoing(email.ours).map((problem) => problem.found);
    expect(found).toEqual(
      expect.arrayContaining(["pickle punch", "in 60 seconds", "hydration"]),
    );
    // A struck-out piece cannot be reached across: no rule can make a
    // phrase out of our words on either side of somebody's name.
    const split = compose({
      subject: ["Hi"],
      blocks: [{ kind: "text", lines: [["a pickle ", theirs("x"), " punch"]] }],
    });
    expect(checkOutgoing(split.ours)).toEqual([]);
  });

  it("only ever links to a plain web address", () => {
    expect(webAddress("https://www.nzpost.co.nz/track?id=1")).toBe(
      "https://www.nzpost.co.nz/track?id=1",
    );
    expect(webAddress(" http://courier.example ")).toBe(
      "http://courier.example/",
    );
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "ftp://files.example/x",
      "//no-scheme.example",
      "https://quickpickle.co.nz@elsewhere.example/",
      "not a link",
      "",
      null,
      undefined,
    ]) {
      expect(webAddress(bad)).toBeNull();
    }
    expect(() =>
      compose({
        subject: ["x"],
        blocks: [{ kind: "link", label: ["Go"], href: "javascript:alert(1)" }],
      }),
    ).toThrow("An email can only link to a plain web address.");
  });
});

describe("the words of an order's emails", () => {
  it("every one of them passes the copy rules as it stands", () => {
    const sentences: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") sentences.push(value);
      else if (typeof value === "object" && value !== null) {
        for (const inner of Object.values(value)) walk(inner);
      }
    };
    walk(ORDER_EMAILS);
    expect(sentences.length).toBeGreaterThan(25);
    for (const sentence of sentences) {
      expect(checkOutgoing({ words: sentence })).toEqual([]);
    }
  });

  it("say nothing promotional: no offer, no code to use, no link to the shop", () => {
    const all = JSON.stringify(ORDER_EMAILS).toLowerCase();
    for (const word of [
      "% off",
      "shop now",
      "buy",
      "sale",
      "offer",
      "unsubscribe",
      "http",
      "new batch",
    ]) {
      expect(all).not.toContain(word);
    }
  });
});
