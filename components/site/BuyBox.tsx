"use client";

import { useEffect, useRef, useState } from "react";

import { Bottle } from "@/components/brand/Bottle";
import {
  Burst,
  CalendarIcon,
  HeartIcon,
  MinusIcon,
  PlusIcon,
  TruckIcon,
} from "@/components/brand/Icons";
import { useCart } from "@/components/cart/CartProvider";
import {
  MAX_PACKS_PER_LINE,
  PACKS,
  PRODUCT,
  SHIPPING,
  STORE,
} from "@/content/offer";
import { BUY } from "@/content/site";
import {
  bestValuePack,
  featuredPack,
  packBySku,
  perShotCents,
  savingCents,
} from "@/lib/shop/catalogue";
import { formatNzd } from "@/lib/shop/money";

/**
 * The buy box: pick a pack, pick how many, put it in the jar.
 *
 * This is the part of the page that earns its keep, so it is built around a
 * thumb. Each pack is one big radio card (the whole card is the target), the
 * button is full width and states the price it will add, and the moment it is
 * pressed three things happen inside 100ms: the label flips to "In the jar!",
 * burst lines pop off the button, and the jar in the header jumps. Then the
 * jar opens, with the total and the checkout button in it.
 *
 * Every figure here (per-shot price, saving, "best value") is computed from
 * the offer on each render. None of it is typed in.
 */
type Props = {
  /** "14 February 2027" once the ship date is locked in, else null. */
  readonly shipDate: string | null;
};

export function BuyBox({ shipDate }: Props) {
  const { add, open, selectedSku, select } = useCart();
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const pack = packBySku(selectedSku) ?? featuredPack();
  const best = bestValuePack();
  const pick = featuredPack();
  const totalCents = pack.priceCents * qty;
  const preorder = STORE.launchMode === "preorder";

  function handleAdd() {
    add(pack.sku, qty);
    setJustAdded(true);
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [
      // Long enough to read the confirmation, short enough not to stall.
      setTimeout(() => open(), 520),
      setTimeout(() => {
        setJustAdded(false);
        setQty(1);
      }, 1600),
    ];
  }

  return (
    <div className="mt-8 grid gap-8 md:grid-cols-2 md:items-start md:gap-12">
      {/* The product, illustrated. Sticks beside the picker on wide screens. */}
      <div className="md:sticky md:top-24">
        <div className="card bg-olive-wash relative overflow-hidden px-6 pt-8 pb-5">
          <div
            aria-hidden="true"
            className="pattern-dots absolute inset-0 opacity-[0.07]"
          />
          <div
            role="img"
            aria-label={BUY.bottleAlt}
            className="relative flex items-end justify-center gap-1"
          >
            <Bottle className="h-36 w-auto -rotate-[7deg] translate-y-1 md:h-48" />
            <Bottle className="z-10 h-48 w-auto md:h-64" />
            <Bottle className="h-36 w-auto translate-y-1 rotate-[7deg] md:h-48" />
          </div>
          <p className="label bg-navy text-cream relative mx-auto mt-4 w-fit rounded-full px-4 py-1.5 text-[1.15rem] leading-none">
            <span className="cap-trim inline-block">
              {pack.shots} {BUY.shots} · {formatNzd(perShotCents(pack))}{" "}
              {BUY.perShot}
            </span>
          </p>
          <p className="text-navy-muted relative mt-3 text-center text-[0.8125rem]">
            {BUY.artNote}
          </p>
        </div>
      </div>

      <div>
        <fieldset>
          <legend className="label text-[1.25rem]">{BUY.packLegend}</legend>
          <div className="mt-3 flex flex-col gap-3.5">
            {PACKS.map((option) => {
              const selected = option.sku === pack.sku;
              const saving = savingCents(option);
              const tag =
                option.sku === pick.sku
                  ? BUY.luckysPick
                  : option.sku === best.sku
                    ? BUY.bestValue
                    : null;
              return (
                <label
                  key={option.sku}
                  className={`relative block cursor-pointer rounded-[18px] border-[3px] p-4 transition-transform duration-100 active:scale-[0.985] ${
                    selected
                      ? "border-navy bg-paper shadow-hard"
                      : "border-navy-line bg-paper/60"
                  }`}
                >
                  <input
                    type="radio"
                    name="pack"
                    value={option.sku}
                    checked={selected}
                    onChange={() => select(option.sku)}
                    className="peer sr-only"
                  />
                  {/* The focus ring belongs to the card, not the hidden input. */}
                  <span
                    aria-hidden="true"
                    className="peer-focus-visible:outline-pink pointer-events-none absolute -inset-[3px] rounded-[18px] outline-offset-2 peer-focus-visible:outline-[3px]"
                  />
                  {tag ? (
                    <span
                      className={`label border-navy absolute -top-3.5 right-4 rounded-full border-2 px-3 py-1 text-[0.95rem] leading-none ${
                        option.sku === pick.sku
                          ? "bg-pink text-white"
                          : "bg-olive text-navy"
                      }`}
                    >
                      {/* 1.2rem bold is "large text", which is what lets white
                          sit on pink at 4.25:1. Do not shrink it. */}
                      <span className="cap-trim inline-block text-[1.2rem]">
                        {tag}
                      </span>
                    </span>
                  ) : null}
                  <span className="flex items-center gap-3.5">
                    <span
                      aria-hidden="true"
                      className={`border-navy grid size-6 shrink-0 place-items-center rounded-full border-[3px] ${
                        selected ? "bg-navy" : "bg-paper"
                      }`}
                    >
                      <span
                        className={`bg-olive size-2.5 rounded-full transition-transform duration-150 ${
                          selected ? "scale-100" : "scale-0"
                        }`}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="varsity text-[1.6rem] leading-none">
                          {option.name}
                        </span>
                        <span className="label text-[1.75rem] leading-none">
                          {formatNzd(option.priceCents)}
                        </span>
                      </span>
                      <span className="text-navy-muted mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[0.9375rem] leading-snug">
                        <span>
                          {option.shots}
                          {PRODUCT.shotVolumeMl === null
                            ? ` ${BUY.shots}`
                            : ` × ${String(PRODUCT.shotVolumeMl)} ml`}{" "}
                          · {formatNzd(perShotCents(option))} {BUY.perShot}
                        </span>
                        {saving > 0 ? (
                          <span className="text-pink-deep font-semibold">
                            {BUY.save} {formatNzd(saving)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1.5 block text-[0.9375rem] leading-snug">
                        {option.blurb}
                      </span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-6 flex items-stretch gap-3">
          <div
            role="group"
            aria-label={BUY.quantity}
            className="border-navy bg-paper flex shrink-0 items-center rounded-[12px] border-[3px]"
          >
            <button
              type="button"
              aria-label={BUY.fewer}
              disabled={qty <= 1}
              onClick={() => setQty((value) => Math.max(1, value - 1))}
              className="grid h-full w-12 place-items-center rounded-l-[9px] active:scale-90 disabled:opacity-30"
            >
              <MinusIcon className="size-5" />
            </button>
            <output
              aria-live="polite"
              className="label w-7 text-center text-[1.5rem] leading-none"
            >
              {qty}
            </output>
            <button
              type="button"
              aria-label={BUY.more}
              disabled={qty >= MAX_PACKS_PER_LINE}
              onClick={() =>
                setQty((value) => Math.min(MAX_PACKS_PER_LINE, value + 1))
              }
              className="grid h-full w-12 place-items-center rounded-r-[9px] active:scale-90 disabled:opacity-30"
            >
              <PlusIcon className="size-5" />
            </button>
          </div>

          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={handleAdd}
              data-testid="add-to-jar"
              className={`btn btn-lg btn-block ${justAdded ? "btn-olive" : ""}`}
            >
              <span className="cap-trim" aria-live="polite">
                {justAdded
                  ? BUY.added
                  : `${BUY.add} · ${formatNzd(totalCents)}`}
              </span>
            </button>
            {/* The pickle punch: burst lines off the button, once per add. */}
            {justAdded ? (
              <Burst className="text-pink animate-pop pointer-events-none absolute -top-7 -right-4 size-16" />
            ) : null}
          </div>
        </div>

        <ul className="mt-6 flex flex-col gap-2.5 text-[0.9375rem] leading-snug">
          {preorder ? (
            <li className="flex items-start gap-3">
              <CalendarIcon className="mt-0.5 size-6 shrink-0" />
              <span>
                {BUY.reassure.preorder}{" "}
                <strong>{shipDate ?? BUY.reassure.shipDateTbc}</strong>.
              </span>
            </li>
          ) : null}
          <li className="flex items-start gap-3">
            <TruckIcon className="mt-0.5 size-6 shrink-0" />
            <span>
              {BUY.reassure.delivery} for {formatNzd(SHIPPING.standardCents)}.{" "}
              <strong>
                {BUY.reassure.freeOver} {formatNzd(SHIPPING.freeOverCents)}.
              </strong>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <HeartIcon className="mt-0.5 size-6 shrink-0" />
            <span>{BUY.reassure.sorted}.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
