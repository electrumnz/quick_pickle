"use client";

import { JarIcon } from "@/components/brand/Icons";
import { JAR } from "@/content/site";

import { useCart } from "./CartProvider";

/**
 * The jar in the header. Opens the jar sheet, and pops once (scale up and
 * settle, 400ms on the spring curve) every time something lands in it. The
 * rest of the page stays still, as the guide asks.
 */
export function JarButton() {
  const { count, open, pulse, ready } = useCart();
  const shown = ready ? count : 0;

  return (
    <button
      type="button"
      onClick={open}
      aria-label={`${JAR.open}, ${String(shown)} ${shown === 1 ? "pack" : "packs"}`}
      className="relative grid size-12 place-items-center rounded-full transition-transform duration-100 active:scale-[0.94]"
    >
      <span
        // Re-keyed on every add so the pop restarts.
        key={pulse}
        className={pulse > 0 ? "animate-pop" : ""}
      >
        <JarIcon className="text-navy size-9" />
      </span>
      {shown > 0 ? (
        <span
          key={`count-${String(shown)}`}
          className="label bg-olive text-navy border-navy animate-pop absolute -top-0.5 -right-1 grid min-w-6 place-items-center rounded-full border-2 px-1 text-[0.95rem] leading-[1.35rem]"
        >
          <span className="cap-trim">{shown}</span>
        </span>
      ) : null}
    </button>
  );
}
