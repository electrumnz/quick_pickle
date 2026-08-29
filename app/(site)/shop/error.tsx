"use client";

import Link from "next/link";

import { useEffect } from "react";

import { STATE } from "@/components/product/copy";
import styles from "@/components/product/shop.module.css";
import { cx } from "@/components/product/cx";

/**
 * The collection page, failed.
 *
 * Same contract as the product page's boundary: say plainly that nothing was
 * ordered, offer a retry that re-runs the render rather than reloading, and
 * print only the digest — the message can carry internals a buyer must not see.
 */
export default function ShopError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[shop] collection page failed", error);
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
          <Link href="/" className={cx(styles.button, styles.buttonSecondary)}>
            Home
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
