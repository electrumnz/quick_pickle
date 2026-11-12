"use client";

import { useEffect, useRef, useState } from "react";

import { useCart } from "@/components/cart/CartProvider";
import { BUY, BUYBAR } from "@/content/site";
import { featuredPack, packBySku } from "@/lib/shop/catalogue";
import { formatNzd } from "@/lib/shop/money";

/**
 * The sticky buy bar, phones only.
 *
 * On a phone the buy button is always one thumb away: once the hero's button
 * has scrolled off, this bar rises from the bottom carrying whichever pack is
 * selected in the buy box, and it steps aside while the buy box itself (or
 * the footer) is on screen so there are never two buttons for one job.
 *
 * It sits above the home-indicator inset, the page reserves its height so it
 * never covers the last line, and it moves with transform only.
 */
export function StickyBuyBar() {
  const { offer, add, open, selectedSku } = useCart();
  const [visible, setVisible] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const hero = document.getElementById("top");
    const shop = document.getElementById("shop");
    const footer = document.querySelector("footer");
    if (hero === null) return;

    const onScreen = new Map<Element, boolean>();
    const update = () => {
      const heroVisible = onScreen.get(hero) ?? true;
      const shopVisible = shop ? (onScreen.get(shop) ?? false) : false;
      const footerVisible = footer ? (onScreen.get(footer) ?? false) : false;
      setVisible(!heroVisible && !shopVisible && !footerVisible);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          onScreen.set(entry.target, entry.isIntersecting);
        }
        update();
      },
      // The buy box counts as "on screen" only once a real slice of it is.
      { threshold: 0.12 },
    );
    observer.observe(hero);
    if (shop) observer.observe(shop);
    if (footer) observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const pack = packBySku(offer, selectedSku) ?? featuredPack(offer);
  // Shut for now: there is nothing to add, so there is no bar.
  if (!offer.open) return null;

  function handleAdd() {
    add(pack.sku, 1);
    setJustAdded(true);
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [
      setTimeout(() => open(), 520),
      setTimeout(() => setJustAdded(false), 1600),
    ];
  }

  return (
    <div
      role="region"
      aria-label={BUYBAR.label}
      // `inert` while hidden: not focusable, not announced, not tappable.
      inert={!visible}
      className={`bg-navy border-navy-deep on-navy ease-qp-out fixed inset-x-0 bottom-0 z-30 border-t-[3px] transition-transform duration-[420ms] md:hidden ${
        visible ? "translate-y-0" : "translate-y-[110%]"
      }`}
    >
      <div className="safe-bottom">
        <div className="flex h-[76px] items-center justify-between gap-3 px-4">
          <a href="#shop" className="text-cream min-w-0">
            <span className="varsity block truncate text-[1.3rem] leading-none">
              {pack.name}
            </span>
            <span className="label text-cream mt-1.5 block text-[1.05rem] leading-none">
              {pack.shots} {BUY.shots} · {formatNzd(pack.priceCents)}
            </span>
          </a>
          <button
            type="button"
            onClick={handleAdd}
            className={`btn shrink-0 ${justAdded ? "btn-olive" : "btn-on-navy"}`}
          >
            <span className="cap-trim" aria-live="polite">
              {justAdded ? BUYBAR.added : BUYBAR.add(offer)}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
