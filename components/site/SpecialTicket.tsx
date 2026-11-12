import { Sparkle } from "@/components/brand/Icons";
import { SPECIAL } from "@/content/site";
import type { SpecialNow } from "@/lib/shop/store";

import { WhileOn } from "./WhileOn";

/**
 * The special that is on, said where the packs are picked.
 *
 * Its name is the one thing a person typed, and it went through the copy
 * rules when the special was switched on. What it gives and until when is
 * written by the shop from the special's own terms, so the sentence is what
 * the checkout does.
 */
export function SpecialTicket({
  special,
  className = "",
}: {
  readonly special: SpecialNow;
  readonly className?: string;
}) {
  return (
    <WhileOn until={special.endsAt}>
      <div
        data-testid="special-ticket"
        className={`on-navy bg-navy text-cream max-w-[34rem] rounded-[18px] px-5 py-4 ${className}`}
      >
        <p className="label flex items-center gap-2 text-[1.15rem]">
          <Sparkle className="text-pink size-4 shrink-0" />
          <span className="cap-trim">
            {SPECIAL.tag}
            {special.name === "" ? "" : ` · ${special.name}`}
          </span>
        </p>
        <p className="mt-1.5 text-[1.0625rem] leading-snug font-semibold">
          {special.sentence}
        </p>
        <p className="mt-1 text-[0.9375rem] leading-snug">
          {SPECIAL.noCode} {SPECIAL.comesOff}
        </p>
      </div>
    </WhileOn>
  );
}
