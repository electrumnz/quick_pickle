import type { ReactNode } from "react";

/** The way in: one card on a pink poster. */
export default function DoorLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="bk-door on-pink">
      <p className="varsity text-cream mb-6 text-[2rem] leading-none [text-shadow:3px_3px_0_var(--color-navy)]">
        Quick Pickle
        {/* Navy on pink is 3.4:1, so this has to be large type (see the
            brand guide's colour rules): 1.35rem bold clears the bar. */}
        <span className="label text-navy ml-3 text-[1.35rem] [text-shadow:none]">
          Backstage
        </span>
      </p>
      <div className="card w-full max-w-[26rem] p-6 md:p-8">{children}</div>
    </main>
  );
}
