"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QualityTier } from "../types";

const ORDER: QualityTier[] = ["low", "medium", "high"];

export type DeviceReport = {
  tier: QualityTier;
  webgl2: boolean;
  renderer: string;
  cores: number;
  memory: number;
  dpr: number;
  touch: boolean;
  reason: string;
};

let cached: DeviceReport | null = null;

/**
 * Pick a starting tier from what the device will admit to.
 *
 * This is only the opening bid: PerformanceMonitor moves it at runtime, so a
 * device that is misread here corrects itself within a couple of seconds
 * rather than janking for the whole session.
 */
export function detectDevice(): DeviceReport {
  if (cached) return cached;
  const fallback: DeviceReport = {
    tier: "low",
    webgl2: false,
    renderer: "unknown",
    cores: 2,
    memory: 2,
    dpr: 1,
    touch: false,
    reason: "no window",
  };
  if (typeof window === "undefined") return fallback;

  const dpr = window.devicePixelRatio || 1;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 2;
  const memory = nav.deviceMemory ?? 4;
  const touch =
    window.matchMedia?.("(pointer: coarse)").matches === true ||
    navigator.maxTouchPoints > 1;

  let renderer = "unknown";
  let webgl2 = false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    webgl2 = Boolean(gl);
    const ctx =
      gl ?? (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (ctx) {
      const ext = ctx.getExtension("WEBGL_debug_renderer_info");
      renderer = String(
        ext
          ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : ctx.getParameter(ctx.RENDERER),
      );
    }
  } catch {
    /* headless or blocked; fall through to the conservative path */
  }

  const r = renderer.toLowerCase();
  let tier: QualityTier;
  let reason: string;

  if (!webgl2) {
    tier = "low";
    reason = "no webgl2";
  } else if (/swiftshader|llvmpipe|software|basic render/.test(r)) {
    tier = "low";
    reason = "software renderer";
  } else if (/apple m\d|apple gpu/.test(r) && !touch) {
    tier = "high";
    reason = "apple silicon desktop";
  } else if (touch) {
    // Mobile. Recent Adreno 6xx/7xx and Mali-G7x/G6xx hold a transmission
    // pass at reduced resolution; anything older starts on the cheap path.
    const adreno = /adreno.*?(\d{3})/.exec(r);
    const mali = /mali-g(\d{2,3})/.exec(r);
    const modern =
      (adreno && Number(adreno[1]) >= 620) ||
      (mali && Number(mali[1]) >= 57) ||
      /apple a\d{2}|apple gpu/.test(r);
    if (modern && cores >= 6 && memory >= 4) {
      tier = "medium";
      reason = `mobile gpu ${renderer}`;
    } else if (cores >= 8 && memory >= 6 && !adreno && !mali) {
      // Unknown mobile GPU but a lot of silicon behind it.
      tier = "medium";
      reason = "mobile, unknown gpu, high core count";
    } else {
      tier = "low";
      reason = `mobile gpu ${renderer}`;
    }
  } else if (
    /nvidia|geforce|rtx|radeon|rx \d|arc a/.test(r) ||
    (cores >= 8 && memory >= 8)
  ) {
    tier = "high";
    reason = "discrete or high-core desktop";
  } else if (cores >= 4) {
    tier = "medium";
    reason = "integrated desktop";
  } else {
    tier = "low";
    reason = "low core count";
  }

  cached = { tier, webgl2, renderer, cores, memory, dpr, touch, reason };
  return cached;
}

export function hasWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Live tier with hysteresis. Downgrades quickly when frames slip, upgrades
 * grudgingly and never past where the device was first judged capable.
 */
export function useQualityTier(force?: QualityTier) {
  const [detected] = useState<DeviceReport>(() =>
    force
      ? { ...detectDevice(), tier: force, reason: "forced" }
      : typeof window === "undefined"
        ? { ...detectDevice() }
        : detectDevice(),
  );
  const [tier, setTier] = useState<QualityTier>(force ?? detected.tier);
  const ceiling = useRef<QualityTier>(force ?? detected.tier);
  const locked = useRef(Boolean(force));

  useEffect(() => {
    if (force) {
      locked.current = true;
      ceiling.current = force;
      setTier(force);
    }
  }, [force]);

  const decline = useCallback(() => {
    if (locked.current) return;
    setTier((t) => {
      const i = ORDER.indexOf(t);
      const next = ORDER[Math.max(0, i - 1)]!;
      // Once we have had to drop, do not climb back above the new level.
      ceiling.current = next;
      return next;
    });
  }, []);

  const incline = useCallback(() => {
    if (locked.current) return;
    setTier((t) => {
      const i = ORDER.indexOf(t);
      const cap = ORDER.indexOf(ceiling.current);
      return ORDER[Math.min(cap, i + 1)]!;
    });
  }, []);

  return { tier, detected, decline, incline };
}
