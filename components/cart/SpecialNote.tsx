"use client";

import { useEffect, useState } from "react";

import { describeSpecial } from "@/components/checkout/actions";
import { SPECIAL } from "@/content/site";
import type { SpecialNow } from "@/lib/shop/store";

/**
 * "Special: 10% off every pack, until Sunday 15 November. No code needed.
 * It comes off at the checkout."
 *
 * In the jar, for whoever opens it while a special is on. The jar's own
 * figures are before any saving, like they are for a code, and this says
 * why the checkout's total will be lower.
 *
 * It asks the server only once the jar has been opened, and once for each
 * page: a visitor who never opens the jar costs nothing.
 */
let asked: Promise<SpecialNow | null> | null = null;

function ask(): Promise<SpecialNow | null> {
  asked ??= describeSpecial().catch(() => null);
  return asked;
}

export function SpecialNote({
  open,
  className = "",
}: {
  /** The jar is open. Nothing is asked before it is. */
  readonly open: boolean;
  readonly className?: string;
}) {
  const [special, setSpecial] = useState<SpecialNow | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void ask().then((answer) => {
      if (live) setSpecial(answer);
    });
    return () => {
      live = false;
    };
  }, [open]);

  if (special === null) return null;
  return (
    <p
      role="status"
      data-testid="special-note"
      className={`border-navy bg-olive-wash rounded-[14px] border-2 px-4 py-3 text-[0.9375rem] leading-snug ${className}`}
    >
      <strong>
        {SPECIAL.tag}
        {special.name === "" ? "" : ` · ${special.name}`}: {special.sentence}
      </strong>{" "}
      {SPECIAL.noCode} {SPECIAL.comesOff}
    </p>
  );
}
