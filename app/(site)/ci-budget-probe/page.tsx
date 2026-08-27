"use client";

import { useEffect, useState } from "react";

/**
 * TEMPORARY — proof that the Lighthouse budget in `lighthouserc.json` actually
 * gates CI rather than merely reporting. This route injects a large block above
 * the fold after first paint, which blows the `cumulative-layout-shift <= 0.02`
 * assertion. It exists only on the `ci/lighthouse-budget-probe` branch and is
 * never merged into the working branch.
 */
export default function CiBudgetProbePage() {
  const [shifted, setShifted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShifted(true), 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      {shifted ? <div style={{ height: 600 }} aria-hidden="true" /> : null}
      <h1 className="text-3xl font-semibold tracking-tight">
        Lighthouse budget probe
      </h1>
      <p className="text-base opacity-70">
        Deliberately shifts layout after load so the CI budget has something to
        catch.
      </p>
    </section>
  );
}
