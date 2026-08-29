"use client";

import Link from "next/link";

import { useEffect } from "react";

import { SHOP_PATH, STATE } from "@/components/product/copy";
import styles from "@/components/product/shop.module.css";
import { cx } from "@/components/product/cx";

/**
 * The product page, failed.
 *
 * Three things a buyer needs and a default error screen does not give them:
 * a plain statement that nothing was ordered and nothing was charged, a retry
 * that actually retries (`reset` re-runs the server render rather than
 * reloading the tab), and a way back to the range.
 *
 * The digest is printed because it is the only string that connects what the
 * buyer saw to what the server logged, and it is the only part of the error
 * that is safe to show — the message itself can name a table or a variant id.
 */
export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[shop] product page failed", error);
  }, [error]);

  return (
    <main className="px-gutter py-section flex-1">
      <div className="max-w-page mx-auto">
        <p className={cx(styles.figure, "text-caption text-danger uppercase")}>
          Error
        </p>
        <h1 className="text-display-3 text-primary mt-stack">
          {STATE.errorHeading}
        </h1>
        <p className="text-lede text-muted mt-stack max-w-prose">
          {STATE.errorNote}
        </p>

        <div className="gap-stack mt-block flex flex-wrap items-center">
          <button
            type="button"
            onClick={reset}
            className={cx(styles.button, styles.buttonPrimary)}
          >
            {STATE.errorRetry}
          </button>
          <Link
            href={SHOP_PATH}
            className={cx(styles.button, styles.buttonSecondary)}
          >
            {STATE.notFoundCta}
          </Link>
        </div>

        {error.digest === undefined ? null : (
          <p className={cx(styles.figure, "text-caption text-muted mt-block")}>
            Reference {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
