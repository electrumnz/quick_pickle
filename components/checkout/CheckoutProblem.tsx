"use client";

import { useEffect, useRef } from "react";

import { cx } from "@/components/product/cx";
import site from "@/components/site/site.module.css";

import { CHECKOUT_PROBLEM_ANCHOR } from "./link";

/**
 * What a refused submission is told, and where the focus goes.
 *
 * The only client component on the storefront's buy path, and it is here for
 * one reason: a form that answers by re-rendering somewhere above the fold has
 * not told a screen-reader or a keyboard user anything. Focus has to move to
 * the explanation.
 *
 * ## Both ways, because the form works both ways
 *
 * With scripting **off**, the Server Action redirects to
 * `…#checkout-problem` and this element carries that id and `tabindex="-1"`.
 * Navigating to a fragment whose target is focusable focuses it — that is the
 * browser's own behaviour, and it is why the id and the tabindex are here
 * rather than only the effect below.
 *
 * With scripting **on**, Next answers the same redirect with a client-side
 * navigation, which scrolls to the fragment but does not focus it. So the
 * effect does, on mount.
 *
 * The effect has no dependency array on purpose. A second refusal carrying the
 * same code re-renders this element rather than remounting it, and a
 * mount-only effect would leave focus on the submit button the buyer had just
 * pressed — which is the case a person who is getting it wrong twice is most
 * likely to be in. It refuses to move focus that is already here, so it can
 * only ever be a no-op when the buyer has gone somewhere themselves.
 */
export function CheckoutProblem({ said }: { said: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (document.activeElement === node) return;
    node.focus();
  });

  return (
    <p
      ref={ref}
      id={CHECKOUT_PROBLEM_ANCHOR}
      tabIndex={-1}
      role="alert"
      className={cx(
        site.said,
        site.saidProblem,
        "text-body-sm text-primary mt-block max-w-prose",
      )}
    >
      {said}
    </p>
  );
}
