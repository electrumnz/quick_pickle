/**
 * Text as a person would read it, which is what the copy rules have to see.
 *
 * Phones type curly quotes, and the rules are written with straight ones.
 * Characters that do not show (a zero-width space, a soft hyphen, a
 * direction mark) can sit inside a word without anybody seeing them, and
 * compatibility forms (full-width letters, the "fi" ligature) read as
 * ordinary letters. All of those are folded away before a rule looks.
 *
 * Both checks read through this: the copy check a draft is shown with
 * (../marketing/copy-check.ts) and the last look everything that leaves the
 * back end is given (./copy.ts). A word a rule knows is the same word to
 * both, however it was typed.
 */

import { withoutInvisible } from "@/lib/text/visible";

export function asRead(text: string): string {
  return (
    withoutInvisible(text.normalize("NFKC"))
      .replace(/[\u{2018}\u{2019}\u{201A}\u{201B}\u{2032}]/gu, "'")
      .replace(/[\u{201C}\u{201D}\u{201E}\u{201F}\u{2033}]/gu, '"')
      // Control characters do not show either, the scanner's own segment
      // break among them: inside a word they are taken out, so the word is
      // still the word. Tabs and line ends stay, and the three that a
      // screen draws as a gap are a gap.
      .replace(/[\u000B\u000C\u0085]/g, " ")
      .replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g, "")
  );
}
