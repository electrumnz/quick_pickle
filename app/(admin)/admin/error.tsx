"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * A page that threw.
 *
 * She gets a sentence and a button. The developer gets the digest, which is
 * the key into the server log — the message itself stays on the server, where
 * it cannot leak anything about the business to a screen someone is standing
 * behind.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] page failed:", error.digest ?? error.name);
  }, [error]);

  return (
    <div className="mx-auto max-w-prose py-8">
      <h1 className="font-display text-heading-2 tracking-tight text-primary">
        This page could not load
      </h1>
      <p className="mt-2 text-body-sm text-muted">
        Something went wrong reading the business data. The rest of the admin is
        unaffected — the sidebar still works, and nothing has been changed.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-strong px-3 py-1.5 text-body-sm font-medium text-primary hover:bg-surface-raised"
        >
          Try again
        </button>
        <Link
          href="/admin"
          className="text-body-sm text-link underline underline-offset-4 hover:no-underline"
        >
          Back to Today
        </Link>
      </div>
      {error.digest !== undefined && (
        <p className="mt-4 font-mono text-caption text-muted">
          Reference {error.digest}
        </p>
      )}
    </div>
  );
}
