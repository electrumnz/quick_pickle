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
import { CarriedCodeNote } from "@/components/cart/CarriedCodeNote";
import { useCart } from "@/components/cart/CartProvider";
import { LoopVideo } from "@/components/ui/LoopVideo";
import { deliveryPromise } from "@/content/delivery";
import type { Media } from "@/content/media";
import { MAX_PACKS_PER_LINE, PRODUCT } from "@/content/offer";
import { BUY, SHOP } from "@/content/site";
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
 * the offer on each render. None of it is typed in. The offer is the jar's
 * (components/cart/CartProvider), so the button and the jar always agree.
 */
type Props = {
  /** "14 February 2027" once the ship date is locked in, else null. */
  readonly shipDate: string | null;
  /** A product clip to show in place of the illustration, when there is one. */
  readonly productLoop: Media | null;
  /** True when the hero has drawn Lucky inline, so the labels can reuse him. */
  readonly luckyOnPage: boolean;
};

export function BuyBox({ shipDate, productLoop, luckyOnPage }: Props) {
  const lucky = luckyOnPage ? "page" : "file";
  const { offer, add, open, selectedSku, select, ready } = useCart();
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const packs = useRef<HTMLFieldSetElement>(null);

  // A pack picked before the page came alive: the browser ticked the radio
  // and the card showed it, but nothing was listening yet. Take the pick the
  // buyer can see, so the button never offers one pack while another looks
  // chosen.
  useEffect(() => {
    const picked = packs.current?.querySelector<HTMLInputElement>(
      'input[name="pack"]:checked',
    )?.value;
    if (picked !== undefined && packBySku(offer, picked) !== null) {
      select(picked);
    }
  }, [offer, select]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const pack = packBySku(offer, selectedSku) ?? featuredPack(offer);
  const best = bestValuePack(offer);
  const pick = featuredPack(offer);
  const totalCents = pack.priceCents * qty;
  const preorder = offer.launchMode === "preorder";
  const delivery = deliveryPromise(offer.shipping);

  function handleAdd() {
    if (!offer.open) return;
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
    <div className="mt-8 grid gap-8 md:grid-cols-2 md:items-start md:gap-12 [&>*]:min-w-0">
      {/* The product, illustrated. Sticks beside the picker on wide screens. */}
      <div className="md:sticky md:top-24">
        <div className="card bg-olive-wash relative overflow-hidden px-6 pt-8 pb-5">
          <div
            aria-hidden="true"
            className="pattern-dots absolute inset-0 opacity-[0.07]"
          />
          {productLoop ? (
            <div className="border-navy relative overflow-hidden rounded-[14px] border-[3px]">
              <LoopVideo media={productLoop} className="h-auto w-full" />
            </div>
          ) : (
            <div
              role="img"
              aria-label={BUY.bottleAlt}
              className="relative flex items-end justify-center gap-1"
            >
              <Bottle
                lucky={lucky}
                className="h-36 w-auto -rotate-[7deg] translate-y-1 md:h-48"
              />
              <Bottle lucky={lucky} className="z-10 h-48 w-auto md:h-64" />
              <Bottle
                lucky={lucky}
                className="h-36 w-auto translate-y-1 rotate-[7deg] md:h-48"
              />
            </div>
          )}
          <p className="label bg-navy text-cream relative mx-auto mt-4 w-fit rounded-full px-4 py-1.5 text-[1.15rem] leading-none">
            <span className="cap-trim inline-block">
              {pack.shots} {BUY.shots} · {formatNzd(perShotCents(pack))}{" "}
              {BUY.perShot}
            </span>
          </p>
          {productLoop ? null : (
            <p className="text-navy-muted relative mt-3 text-center text-[0.8125rem]">
              {BUY.artNote}
            </p>
          )}
        </div>
      </div>

      <div>
        <fieldset ref={packs}>
          <legend className="label text-[1.25rem]">{BUY.packLegend}</legend>
          <div className="mt-3 flex flex-col gap-3.5">
            {offer.packs.map((option) => {
              const selected = option.sku === pack.sku;
              // Which card looks chosen is the radio's own doing (the
              // has-checked styles), so it is right on the first paint and
              // follows a tap before any script has run. Once the page is
              // alive the same look is also set from here, for the few
              // browsers that cannot style a card by what is inside it.
              const lit = ready && selected;
              const saving = savingCents(offer, option);
              const tag =
                option.sku === pick.sku
                  ? BUY.luckysPick
                  : option.sku === best.sku
                    ? BUY.bestValue
                    : null;
              return (
                <label
                  key={option.sku}
                  className={`group has-checked:border-navy has-checked:bg-paper has-checked:shadow-hard relative block cursor-pointer rounded-[18px] border-[3px] p-4 transition-transform duration-100 active:scale-[0.985] ${
                    tag ? "pt-5" : ""
                  } ${
                    lit
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
                    className="focus-proxy pointer-events-none absolute -inset-[3px] rounded-[18px]"
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
                      className={`border-navy group-has-checked:bg-navy grid size-6 shrink-0 place-items-center rounded-full border-[3px] ${
                        lit ? "bg-navy" : "bg-paper"
                      }`}
                    >
                      <span
                        className={`bg-olive size-2.5 rounded-full transition-transform duration-150 group-has-checked:scale-100 ${
                          lit ? "scale-100" : "scale-0"
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

        <div className="mt-6 flex flex-wrap items-stretch gap-3">
          {/* Shut for now: there is nothing to count, so the button takes
              the whole row and its words fit. */}
          {offer.open ? (
            <div
              role="group"
              aria-label={BUY.quantity}
              className="border-navy bg-paper flex min-h-[3.75rem] shrink-0 items-center rounded-[12px] border-[3px]"
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
          ) : null}

          <div className="relative min-w-[13.5rem] flex-1">
            <button
              type="button"
              onClick={handleAdd}
              disabled={!offer.open}
              data-testid="add-to-jar"
              className={`btn btn-lg btn-block disabled:cursor-not-allowed disabled:opacity-60 ${justAdded ? "btn-olive" : ""}`}
            >
              <span className="cap-trim" aria-live="polite">
                {!offer.open
                  ? SHOP.closedButton
                  : justAdded
                    ? BUY.added
                    : `${BUY.add(offer)} · ${formatNzd(totalCents)}`}
              </span>
            </button>
            {/* The pickle punch: burst lines off the button, once per add. */}
            {justAdded ? (
              <Burst className="text-pink animate-pop pointer-events-none absolute -top-7 -right-4 size-16" />
            ) : null}
          </div>
        </div>

        {/* Shut for now: say so, and point at the one thing there is to do. */}
        {offer.open ? null : (
          <div data-testid="shop-closed" className="card-flat mt-5 p-4">
            <p className="text-[0.9688rem] leading-snug">{SHOP.closedNote}</p>
            <a href="#crew" className="btn btn-sm mt-3">
              <span className="cap-trim">{SHOP.closedCta}</span>
            </a>
          </div>
        )}

        <CarriedCodeNote className="mt-5" />

        <ul className="mt-6 flex flex-col gap-2.5 text-[0.9375rem] leading-snug">
          {preorder && offer.open ? (
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
              {delivery.lead}
              {delivery.strong === null ? null : (
                <>
                  {" "}
                  <strong>{delivery.strong}</strong>
                </>
              )}
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
