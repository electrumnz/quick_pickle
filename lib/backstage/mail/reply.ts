/**
 * Telling the new part of an email from the earlier messages quoted under it.
 *
 * The work is done by `email-reply-parser`. It is wrapped here for one
 * reason: with no RE2 installed it runs ordinary regular expressions, and a
 * few of them take time that grows with the cube of the text they are given.
 * Measured, 8,000 characters written to provoke it took half a second and
 * 32,000 would take half a minute. Email is written by strangers, so the
 * parser is only ever shown the top of a message (`ANALYSED_CHARS`), where
 * the new part and the start of the quote are. Whatever comes after that
 * takes the kind of the last thing seen: more quote, or more message.
 * tests/mail/reply.test.ts holds the parser to a time budget on hostile text.
 */

import EmailReplyParser from "email-reply-parser";

/** How much of a message the parser is shown. See the note above. */
export const ANALYSED_CHARS = 3000;

export type Segment = {
  /** `quoted`: an earlier message, shown folded away. */
  readonly kind: "text" | "quoted";
  readonly text: string;
};

export type ReplySplit = {
  /** What the sender wrote this time, without quotes or sign-offs. */
  readonly fresh: string;
  /** The whole message in order, cut into what to show and what to fold. */
  readonly segments: readonly Segment[];
};

/** Where to cut so that the head ends on a whole line. -1: nowhere sensible. */
function headLength(text: string): number {
  if (text.length <= ANALYSED_CHARS) return text.length;
  return text.lastIndexOf("\n", ANALYSED_CHARS);
}

function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
}

/**
 * Split a plain-text message into the new part and the quoted earlier
 * messages. A sign-off ("Cheers, Liam") stays with the text it signs; the
 * signature under a quoted message stays with the quote.
 */
export function splitReply(input: string): ReplySplit {
  const text = input.replace(/\r\n?/g, "\n");
  const cut = headLength(text);
  if (cut <= 0) {
    // One enormous first line: nothing for the parser to find.
    const whole = trimBlankLines(text);
    return {
      fresh: whole,
      segments: whole === "" ? [] : [{ kind: "text", text: whole }],
    };
  }
  const head = text.slice(0, cut);
  const tail = text.slice(cut);

  const fragments = new EmailReplyParser().read(head).getFragments();
  const segments: { kind: Segment["kind"]; parts: string[] }[] = [];
  const fresh: string[] = [];
  let quoting = false;
  for (const fragment of fragments) {
    if (fragment.isQuoted()) quoting = true;
    else if (!fragment.isHidden()) quoting = false;
    const kind = quoting ? "quoted" : "text";
    const last = segments[segments.length - 1];
    if (last !== undefined && last.kind === kind) {
      last.parts.push(fragment.getContent());
    } else {
      segments.push({ kind, parts: [fragment.getContent()] });
    }
    if (!fragment.isHidden()) fresh.push(fragment.getContent());
  }

  if (tail !== "") {
    // The cut was made at a line break, which the join below puts back.
    const rest = tail.replace(/^\n/, "");
    const last = segments[segments.length - 1];
    if (last === undefined) segments.push({ kind: "text", parts: [rest] });
    else last.parts.push(rest);
    if (last === undefined || last.kind === "text") fresh.push(rest);
  }

  const out = segments
    .map((segment) => ({
      kind: segment.kind,
      text: trimBlankLines(segment.parts.join("\n")),
    }))
    .filter((segment) => segment.text !== "");

  const freshText = trimBlankLines(fresh.join("\n"));
  return {
    // A message that is nothing but a quote still said something: the quote.
    fresh: freshText === "" ? trimBlankLines(text) : freshText,
    segments: out,
  };
}

/** The first words of a message, on one line, for a list. */
export function snippetOf(text: string, length = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  const cut = flat.slice(0, length);
  const space = cut.lastIndexOf(" ");
  return `${(space > length * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
