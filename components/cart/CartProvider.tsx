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

/** Last value written, for browsers where localStorage is unavailable. */
let memory = "";

function readRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return memory;
  }
}

function writeRaw(raw: string): void {
  memory = raw;
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Private browsing or a full disk: the jar still works for this visit.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
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
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { readonly children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  const ready = useHydrated();
  const cart = useMemo(() => parse(raw), [raw]);

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
