"use client";

import { useFormStatus } from "react-dom";

import { STATE } from "./copy";
import { cx } from "./cx";
import styles from "./shop.module.css";

/**
 * The buy button, including the state it is in while the order is being placed.
 *
 * ## Why the loading state lives HERE and not in a `loading.tsx`
 *
 * A route-level `loading.tsx` wraps the page in a Suspense boundary. React then
 * streams the fallback first and swaps the real content in with an inline
 * script — so with JavaScript switched off the visitor is left looking at a
 * skeleton of a page that has already been rendered and sent. That trades a
 * hard requirement (the shop must work with scripting off) for an animation,
 * which is the wrong way round, and it was caught by the no-JS pass in
 * `evidence/capture.mjs` rather than by reading the docs.
 *
 * So these pages are complete in their first response — nothing to stream, a
 * database read away — and the loading state is put where waiting actually
 * happens: on the control the buyer just pressed. `useFormStatus` reads the
 * pending state of the enclosing form, so it covers both the client transition
 * and, correctly, does nothing at all without scripting, where the browser's
 * own navigation indicator is the loading state.
 */
export function SubmitButton({
  price,
  block,
}: {
  price: string;
  block: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-live="polite"
      className={cx(
        styles.button,
        styles.buttonPrimary,
        block ? styles.buttonBlock : "flex-1",
        pending ? styles.buttonPending : undefined,
      )}
    >
      {pending ? (
        <>
          <span className={cx(styles.spinner)} aria-hidden="true" />
          {STATE.adding}
        </>
      ) : (
        <>
          {STATE.addToCart}
          <span className={cx(styles.figure)}>{price}</span>
        </>
      )}
    </button>
  );
}
