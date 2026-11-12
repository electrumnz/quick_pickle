"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Art } from "@/components/brand/Art";
import { Bottle } from "@/components/brand/Bottle";
import {
  ArrowIcon,
  CheckIcon,
  CloseIcon,
  MinusIcon,
  PlusIcon,
  TruckIcon,
} from "@/components/brand/Icons";
import { MAX_PACKS_PER_LINE, SHIPPING } from "@/content/offer";
import { JAR } from "@/content/site";
import { nextSizeUp, perShotCents } from "@/lib/shop/catalogue";
import { formatNzd } from "@/lib/shop/money";

import { CarriedCodeNote } from "./CarriedCodeNote";
import { useCart } from "./CartProvider";

/**
 * The jar sheet.
 *
 * A native <dialog>, so the browser owns the hard parts: focus is trapped
 * inside, Escape closes it, and the page behind is inert. It slides in from
 * the right in 420ms and is full-width on a phone.
 *
 * Three things here exist to lift the order, and all three are computed from
 * the offer rather than written down, so none of them can go stale:
 * the free-delivery bar, the "make it the next size up" swap, and the total
 * on the checkout button.
 */
export function CartDrawer() {
  const { cart, quote, count, isOpen, close, setQty, remove, swap, ready } =
    useCart();
  const ref = useRef<HTMLDialogElement>(null);

  // Nothing inside the sheet is rendered until it has been opened once: a
  // closed jar is a few dozen elements the page would otherwise build, and
  // hydrate, for nobody. It stays rendered after that so the closing slide
  // has something in it.
  const [seen, setSeen] = useState(false);
  if (isOpen && !seen) setSeen(true);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const empty = !ready || cart.lines.length === 0;

  // The smallest line that has a bigger, cheaper-per-shot size above it.
  const upgrade = (() => {
    for (const line of quote.lines) {
      const bigger = nextSizeUp(line.pack);
      if (bigger === null) continue;
      if (perShotCents(bigger) >= perShotCents(line.pack)) continue;
      // Only offer the swap when the bigger size is not already in the jar.
      if (quote.lines.some((other) => other.sku === bigger.sku)) continue;
      return {
        from: line.pack,
        to: bigger,
        extraCents: (bigger.priceCents - line.pack.priceCents) * line.qty,
      };
    }
    return null;
  })();

  const progress = quote.freeDelivery
    ? 1
    : Math.min(1, quote.subtotalCents / SHIPPING.freeOverCents);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="jar-title"
      onClose={close}
      onClick={(event) => {
        // A click that lands on the dialog itself is a click on the backdrop.
        if (event.target === event.currentTarget) close();
      }}
    >
      {seen ? (
        <div className="flex h-full flex-col">
          <div className="bg-navy text-cream on-navy flex items-center justify-between gap-3 px-5 py-3">
            <h2 id="jar-title" className="varsity text-[1.75rem] leading-none">
              <span className="cap-trim inline-block">{JAR.title}</span>
              {count > 0 && ready ? (
                <span className="label text-olive ml-3 text-[1.1rem]">
                  {count} {count === 1 ? "pack" : "packs"}
                </span>
              ) : null}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label={JAR.close}
              className="bg-cream text-navy grid size-12 place-items-center rounded-full transition-transform duration-100 active:scale-[0.94]"
            >
              <CloseIcon className="size-6" />
            </button>
          </div>

          {empty ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
              <Art
                name="lucky-sleeping"
                alt={JAR.emptyAlt}
                sizes="200px"
                className="w-44"
              />
              <p className="varsity mt-6 text-[2rem] leading-none">
                {JAR.emptyTitle}
              </p>
              <p className="text-navy-muted mt-3 max-w-[18rem]">
                {JAR.emptyBody}
              </p>
              <Link href="/#shop" onClick={close} className="btn mt-7">
                <span className="cap-trim">{JAR.emptyCta}</span>
              </Link>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                {/* Free delivery: how far, or done. */}
                <div className="card-flat bg-olive-wash p-4">
                  <p className="label flex items-center gap-2 text-[1.1rem] leading-tight">
                    {quote.freeDelivery ? (
                      <>
                        <CheckIcon className="text-olive-deep size-5 shrink-0" />
                        <span className="cap-trim">{JAR.unlocked}</span>
                      </>
                    ) : (
                      <>
                        <TruckIcon className="size-6 shrink-0" />
                        <span className="cap-trim">
                          {formatNzd(quote.freeDeliveryGapCents)} {JAR.gap}
                        </span>
                      </>
                    )}
                  </p>
                  <div
                    className="bg-paper border-navy mt-3 h-3.5 overflow-hidden rounded-full border-2"
                    aria-hidden="true"
                  >
                    <div
                      className="bg-olive ease-qp-out h-full origin-left transition-transform duration-[400ms]"
                      style={{ transform: `scaleX(${String(progress)})` }}
                    />
                  </div>
                </div>

                <ul className="mt-5 flex flex-col gap-4">
                  {quote.lines.map((line) => (
                    <li key={line.sku} className="card-flat flex gap-3 p-3">
                      <div className="bg-cream border-navy grid w-16 shrink-0 place-items-center rounded-xl border-2 py-2">
                        <Bottle detail={false} className="h-16 w-auto" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="varsity text-[1.35rem] leading-none">
                              {line.pack.name}
                            </p>
                            <p className="text-navy-muted text-small mt-1">
                              {line.pack.shots} {JAR.shots} ·{" "}
                              {formatNzd(line.unitCents)} {JAR.each}
                            </p>
                          </div>
                          <p className="label text-[1.35rem] leading-none">
                            {formatNzd(line.lineCents)}
                          </p>
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <div className="border-navy bg-paper flex items-center rounded-full border-2">
                            <button
                              type="button"
                              aria-label={`${JAR.less}: ${line.pack.name}`}
                              onClick={() => setQty(line.sku, line.qty - 1)}
                              className="grid size-11 place-items-center rounded-full active:scale-90"
                            >
                              <MinusIcon className="size-5" />
                            </button>
                            <span
                              className="label w-7 text-center text-[1.25rem]"
                              aria-live="polite"
                              aria-label={`${String(line.qty)} of ${line.pack.name}`}
                            >
                              {line.qty}
                            </span>
                            <button
                              type="button"
                              aria-label={`${JAR.more}: ${line.pack.name}`}
                              disabled={line.qty >= MAX_PACKS_PER_LINE}
                              onClick={() => setQty(line.sku, line.qty + 1)}
                              className="grid size-11 place-items-center rounded-full active:scale-90 disabled:opacity-35"
                            >
                              <PlusIcon className="size-5" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => remove(line.sku)}
                            aria-label={`${JAR.remove} ${line.pack.name}`}
                            className="link text-small text-navy-muted"
                          >
                            {JAR.remove}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>

                {upgrade ? (
                  <div className="border-navy bg-paper mt-5 flex items-center justify-between gap-3 rounded-[18px] border-2 border-dashed p-4">
                    <p className="text-small leading-snug">
                      <strong>
                        {JAR.upgradeLead} {upgrade.to.shots} {JAR.shots}
                      </strong>{" "}
                      for {formatNzd(upgrade.extraCents)} {JAR.upgradeTail}.
                      That drops it to {formatNzd(perShotCents(upgrade.to))} a
                      shot.
                    </p>
                    <button
                      type="button"
                      onClick={() => swap(upgrade.from.sku, upgrade.to.sku)}
                      className="btn btn-sm btn-olive shrink-0"
                    >
                      <span className="cap-trim">{JAR.upgradeCta}</span>
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="border-navy bg-paper safe-bottom border-t-[3px] px-5 pt-4">
                {JAR.preorderNote ? (
                  <p className="text-navy-muted text-small mb-3 leading-snug">
                    {JAR.preorderNote}
                  </p>
                ) : null}
                <CarriedCodeNote className="mb-3" />
                <div className="flex items-baseline justify-between">
                  <p className="label text-[1.25rem]">{JAR.subtotal}</p>
                  <p className="label text-[1.75rem] leading-none">
                    {formatNzd(quote.subtotalCents)}
                  </p>
                </div>
                <p className="text-navy-muted text-small mt-1">
                  {JAR.deliveryNote}
                </p>
                <Link
                  href="/checkout"
                  onClick={close}
                  className="btn btn-lg btn-block mt-4"
                >
                  <span className="cap-trim">{JAR.checkout}</span>
                  <ArrowIcon className="size-6" />
                </Link>
                <button
                  type="button"
                  onClick={close}
                  className="link text-small mx-auto mt-1 mb-2 flex"
                >
                  {JAR.keepShopping}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </dialog>
  );
}
