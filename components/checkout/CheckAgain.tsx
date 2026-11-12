"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * While an order is waiting on its payment, ask the server again every few
 * seconds, for a minute. The page works without this (there is a link that
 * does the same thing); it just saves the buyer pressing it.
 */
export function CheckAgain({
  everyMs = 4000,
  times = 15,
}: {
  readonly everyMs?: number;
  readonly times?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    let left = times;
    const timer = window.setInterval(() => {
      left -= 1;
      router.refresh();
      if (left <= 0) window.clearInterval(timer);
    }, everyMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [router, everyMs, times]);
  return null;
}
