"use client";

import { useEffect, useState } from "react";

import { describeCode, type CarriedCode } from "@/components/checkout/actions";
import { CODES } from "@/content/site";

import { useCart } from "./CartProvider";

/**
 * "Code ROVERS10 is in: 10% off. You'll see it come off at the checkout."
 *
 * For a visitor who followed a link that carries a promo code. The browser
 * only holds the word. Before saying anything, this asks the server what the
 * code gives and whether it could be used right now, and stays silent on a
 * no: the page must never promise a saving the checkout would then refuse.
 *
 * It shows in two places at once (the buy box and the jar), so the question
 * is asked once for each code and the answer shared.
 */
const asked = new Map<string, Promise<CarriedCode>>();

function ask(code: string): Promise<CarriedCode> {
  let answer = asked.get(code);
  if (answer === undefined) {
    answer = describeCode(code).catch((): CarriedCode => ({ ok: false }));
    asked.set(code, answer);
  }
  return answer;
}

export function CarriedCodeNote({
  className = "",
}: {
  readonly className?: string;
}) {
  const { carriedCode } = useCart();
  const [told, setTold] = useState<{
    readonly code: string;
    readonly label: string;
  } | null>(null);

  useEffect(() => {
    if (carriedCode === null) return;
    let live = true;
    void ask(carriedCode).then((answer) => {
      if (live && answer.ok) {
        setTold({ code: answer.code, label: answer.label });
      }
    });
    return () => {
      live = false;
    };
  }, [carriedCode]);

  if (carriedCode === null || told === null || told.code !== carriedCode) {
    return null;
  }
  return (
    <p
      role="status"
      data-testid="carried-code"
      className={`border-navy bg-olive-wash rounded-[14px] border-2 border-dashed px-4 py-3 text-[0.9375rem] leading-snug ${className}`}
    >
      <strong>
        {CODES.carriedLead} {told.code} {CODES.carriedIn} {told.label}.
      </strong>{" "}
      {CODES.carriedTail}
    </p>
  );
}
