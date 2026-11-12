import { describe, expect, it } from "vitest";

import {
  ANALYSED_CHARS,
  snippetOf,
  splitReply,
} from "@/lib/backstage/mail/reply";

/** Telling what someone wrote this time from what they are quoting. */

describe("splitting a reply", () => {
  it("separates a reply from the message quoted under it", () => {
    const split = splitReply(
      [
        "Thanks, that works.",
        "",
        "Cheers,",
        "Liam",
        "",
        "On Tue, 10 Nov 2026 at 09:14, Quick Pickle <hello@quickpickle.example> wrote:",
        "> It left us this morning.",
        ">",
        "> The Quick Pickle crew",
      ].join("\r\n"),
    );
    expect(split.fresh).toBe("Thanks, that works.");
    expect(split.segments).toEqual([
      // The sign-off is shown with the words it signs.
      { kind: "text", text: "Thanks, that works.\n\nCheers,\nLiam" },
      {
        kind: "quoted",
        text: "On Tue, 10 Nov 2026 at 09:14, Quick Pickle <hello@quickpickle.example> wrote:\n> It left us this morning.\n>\n> The Quick Pickle crew",
      },
    ]);
  });

  it("handles the way Outlook quotes", () => {
    const split = splitReply(
      [
        "Yes please, go ahead.",
        "",
        "From: Quick Pickle <hello@quickpickle.example>",
        "Sent: Tuesday, 10 November 2026 9:14 am",
        "To: Jo Example <jo@bottles.example.co.nz>",
        "Subject: RE: Bottles",
        "",
        "Shall we order 500?",
      ].join("\n"),
    );
    expect(split.fresh).toBe("Yes please, go ahead.");
    expect(split.segments.map((segment) => segment.kind)).toEqual([
      "text",
      "quoted",
    ]);
    expect(split.segments[1]?.text).toContain("Shall we order 500?");
  });

  it("shows an answer written underneath the quote", () => {
    const split = splitReply(
      [
        "On Mon, 9 Nov 2026, Jo wrote:",
        "> Can you do Thursday?",
        "",
        "Thursday is fine.",
      ].join("\n"),
    );
    expect(split.fresh).toBe("Thursday is fine.");
    expect(split.segments).toEqual([
      {
        kind: "quoted",
        text: "On Mon, 9 Nov 2026, Jo wrote:\n> Can you do Thursday?",
      },
      { kind: "text", text: "Thursday is fine." },
    ]);
  });

  it("leaves a message with no quote alone", () => {
    const text = "Hi,\n\nDo you post to Stewart Island?\n\nCheers,\nMere";
    const split = splitReply(text);
    expect(split.segments).toEqual([{ kind: "text", text }]);
    expect(split.fresh).toBe("Hi,\n\nDo you post to Stewart Island?");

    // A sign-off the parser does not know is simply part of the message.
    const mihi = "Do you post to Stewart Island?\n\nNgā mihi,\nMere";
    expect(splitReply(mihi)).toEqual({
      fresh: mihi,
      segments: [{ kind: "text", text: mihi }],
    });
  });

  it("treats a message that is all quote as saying the quote", () => {
    const split = splitReply("> forwarded without comment\n> second line");
    expect(split.fresh).toBe("> forwarded without comment\n> second line");
    expect(split.segments).toEqual([
      { kind: "quoted", text: "> forwarded without comment\n> second line" },
    ]);
  });

  it("copes with nothing at all", () => {
    expect(splitReply("")).toEqual({ fresh: "", segments: [] });
    expect(splitReply("  \n \n")).toEqual({ fresh: "", segments: [] });
  });
});

describe("a message longer than the parser is shown", () => {
  const line = "An ordinary line of an ordinary long message.\n";

  it("keeps the rest as more message when the top was message", () => {
    const text = line.repeat(400).trimEnd();
    expect(text.length).toBeGreaterThan(ANALYSED_CHARS * 4);
    const split = splitReply(text);
    expect(split.segments).toEqual([{ kind: "text", text }]);
    expect(split.fresh).toBe(text);
  });

  it("keeps the rest as more quote when the top ended in a quote", () => {
    const quote = "> a quoted line of the earlier message\n".repeat(400);
    const text = `Short answer.\n\nOn Mon, 9 Nov 2026, Jo wrote:\n${quote}`;
    const split = splitReply(text);
    expect(split.fresh).toBe("Short answer.");
    expect(split.segments).toHaveLength(2);
    expect(split.segments[0]).toEqual({ kind: "text", text: "Short answer." });
    expect(split.segments[1]?.kind).toBe("quoted");
    // Every line of the quote is still there to be unfolded.
    expect(split.segments[1]?.text.split("\n")).toHaveLength(401);
  });

  it("does not try to read one enormous line", () => {
    const text = "x".repeat(ANALYSED_CHARS * 3);
    expect(splitReply(text)).toEqual({
      fresh: text,
      segments: [{ kind: "text", text }],
    });
  });
});

describe("text written to make the parser crawl", () => {
  /*
   * Without RE2 the parser's patterns backtrack. Each of these took seconds
   * to minutes at this size when handed to it whole. The wrapper only shows
   * it the top of a message, so they have to come back quickly however big
   * they are. If this fails after the library is upgraded, the limit in
   * reply.ts needs measuring again.
   */
  const hostile: readonly (readonly [string, string])[] = [
    ["skrev", `${"abc. x\n".repeat(20_000)}${" skrev y".repeat(20_000)}`],
    ["schreef", `${"Op x\n".repeat(20_000)}${"schreef y ".repeat(20_000)}`],
    ["wrote", "x on at y ".repeat(40_000)],
    ["on, one line", `On ${"a b ".repeat(80_000)}`],
    ["from", `From: ${"a ".repeat(150_000)}`],
    ["polish", "W dniu x\n".repeat(40_000)],
    ["chinese", "在".repeat(300_000)],
  ];

  it.each(hostile)("%s", (_name, text) => {
    expect(text.length).toBeGreaterThan(250_000);
    const started = performance.now();
    const split = splitReply(text);
    const took = performance.now() - started;
    expect(took).toBeLessThan(1500);
    // Nothing is lost for being hostile: it is all still there to read.
    const total = split.segments.reduce(
      (sum, segment) => sum + segment.text.length,
      0,
    );
    expect(total).toBeGreaterThan(text.trim().length * 0.9);
  });
});

describe("snippets", () => {
  it("puts the first words on one line", () => {
    expect(snippetOf("Hi there,\n\n  I ordered   two packs.")).toBe(
      "Hi there, I ordered two packs.",
    );
    expect(snippetOf("")).toBe("");
  });

  it("cuts at a word and says there is more", () => {
    const snippet = snippetOf("word ".repeat(100));
    expect(snippet.length).toBeLessThanOrEqual(141);
    expect(snippet.endsWith("word…")).toBe(true);
    // One long word has nowhere to break, so it is simply cut.
    expect(snippetOf("x".repeat(500))).toBe(`${"x".repeat(140)}…`);
  });
});
