"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  ARRIVAL_KEY,
  arrivalFrom,
  isFreshArrival,
  packArrival,
  unpackArrival,
} from "@/lib/shop/arrival";
import {
  addToCart,
  EMPTY_CART,
  normaliseCart,
  packCount,
  removeFromCart,
  setQuantity,
  swapPack,
  type Cart,
} from "@/lib/shop/cart";
import { featuredPack } from "@/lib/shop/catalogue";
import { quote, type Quote } from "@/lib/shop/pricing";

/**
 * The jar.
 *
 * It lives in the buyer's own browser (localStorage), so it is still there
 * when they come back and nothing about it reaches the server until they
 * place an order. It holds SKUs and quantities and nothing else: every price
 * on screen is worked out from the offer, and worked out again on the server
 * when the order is placed.
 *
 * `useSyncExternalStore` is what keeps two tabs in step and what keeps the
 * server render and the first client render identical (both see an empty
 * jar; the real one arrives one tick after hydration, flagged by `ready`).
 */

const STORAGE_KEY = "qp-jar-v1";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Last values written, for browsers where localStorage is unavailable. */
const memory = new Map<string, string>();

function readKey(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return memory.get(key) ?? "";
  }
}

function writeKey(key: string, raw: string): void {
  memory.set(key, raw);
  try {
    // An emptied jar is stored as an empty string, not removed: another tab
    // is told about a change of value, and reads "" as an empty jar.
    window.localStorage.setItem(key, raw);
  } catch {
    // Private browsing or a full disk: it still works for this visit.
  }
  for (const listener of listeners) listener();
}

const readRaw = () => readKey(STORAGE_KEY);
const writeRaw = (raw: string) => writeKey(STORAGE_KEY, raw);
const readArrival = () => readKey(ARRIVAL_KEY);

/**
 * How this visitor arrived: the link they followed and any code it carried
 * (lib/shop/arrival). Read from the address once, when the page first comes
 * alive, and kept in the browser beside the jar. An arrival that has gone
 * stale is thrown away at the same moment, so nothing here ever needs to
 * look at the clock while the page is drawing.
 */
let arrivalNoted = false;
function noteArrival(): void {
  if (arrivalNoted) return;
  arrivalNoted = true;
  const now = Date.now();
  let before = unpackArrival(readArrival());
  if (before !== null && !isFreshArrival(before, now)) before = null;
  const next = arrivalFrom(window.location.search, before, now) ?? before;
  const raw = next === null ? "" : packArrival(next);
  if (raw !== readArrival()) writeKey(ARRIVAL_KEY, raw);
}

// Noted as soon as this file loads in a browser, not when the page finishes
// coming alive: somebody who taps through to the checkout straight away has
// still arrived by the link they followed.
if (typeof window !== "undefined") noteArrival();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === STORAGE_KEY ||
      event.key === ARRIVAL_KEY
    ) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  noteArrival();
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function parse(raw: string): Cart {
  if (raw === "") return EMPTY_CART;
  try {
    return normaliseCart(JSON.parse(raw));
  } catch {
    return EMPTY_CART;
  }
}

/**
 * Apply a change to the stored jar. It reads the freshest stored value, not
 * one captured at render, so two quick taps both land.
 */
function mutate(change: (cart: Cart) => Cart): void {
  writeRaw(JSON.stringify(change(parse(readRaw()))));
}

/** False on the server and for the first client render, true after. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

type CartContextValue = {
  readonly cart: Cart;
  readonly quote: Quote;
  /** Packs in the jar. */
  readonly count: number;
  /** True once the stored jar has been read. Until then the jar looks empty. */
  readonly ready: boolean;
  readonly add: (sku: string, qty?: number) => void;
  readonly setQty: (sku: string, qty: number) => void;
  readonly remove: (sku: string) => void;
  readonly swap: (fromSku: string, toSku: string) => void;
  readonly clear: () => void;
  /** The jar sheet. */
  readonly isOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
  /** Goes up by one every time something is added: a key for the pop. */
  readonly pulse: number;
  /** The pack the buy box has selected; the sticky bar offers the same one. */
  readonly selectedSku: string;
  readonly select: (sku: string) => void;
  /** A promo code the visitor's link carried, waiting for the checkout. */
  readonly carriedCode: string | null;
  /** Stop offering the carried code: it was taken off, or cannot be used. */
  readonly forgetCarriedCode: () => void;
  /** The link and labels the visit came with, to go on the order. */
  readonly source: Readonly<Record<string, string>>;
};

const NO_SOURCE: Readonly<Record<string, string>> = {};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { readonly children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  const arrivalRaw = useSyncExternalStore(subscribe, readArrival, () => "");
  const ready = useHydrated();
  const cart = useMemo(() => parse(raw), [raw]);
  const arrival = useMemo(() => unpackArrival(arrivalRaw), [arrivalRaw]);

  const [isOpen, setOpen] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [selectedSku, select] = useState(() => featuredPack().sku);

  const add = useCallback((sku: string, qty = 1) => {
    mutate((current) => addToCart(current, sku, qty));
    setPulse((value) => value + 1);
  }, []);

  const setQty = useCallback((sku: string, qty: number) => {
    mutate((current) => setQuantity(current, sku, qty));
  }, []);

  const remove = useCallback((sku: string) => {
    mutate((current) => removeFromCart(current, sku));
  }, []);

  const swap = useCallback((fromSku: string, toSku: string) => {
    mutate((current) => swapPack(current, fromSku, toSku));
    setPulse((value) => value + 1);
  }, []);

  const clear = useCallback(() => {
    writeRaw("");
  }, []);

  const forgetCarriedCode = useCallback(() => {
    const now = unpackArrival(readArrival());
    if (now === null || now.code === null) return;
    writeKey(ARRIVAL_KEY, packArrival({ ...now, code: null }));
  }, []);

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      quote: quote(cart),
      count: packCount(cart),
      ready,
      add,
      setQty,
      remove,
      swap,
      clear,
      isOpen,
      open,
      close,
      pulse,
      selectedSku,
      select,
      carriedCode: arrival?.code ?? null,
      forgetCarriedCode,
      source: arrival?.source ?? NO_SOURCE,
    }),
    [
      cart,
      ready,
      add,
      setQty,
      remove,
      swap,
      clear,
      isOpen,
      open,
      close,
      pulse,
      selectedSku,
      arrival,
      forgetCarriedCode,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (value === null) {
    throw new Error("useCart must be used inside <CartProvider>");
  }
  return value;
}
