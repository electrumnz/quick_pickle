"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Turn the bottle.
 *
 * This is the one thing the 3D can do that a photograph cannot, so it is worth
 * building properly rather than reaching for `OrbitControls`. Orbit controls
 * are a viewer for a scene; what a shopper wants on a product page is a
 * turntable — the object spins about its own axis, it never tips, it never
 * ends up looking at the floor, and letting go leaves it wherever it was
 * rather than snapping back.
 *
 * The three things that make the difference:
 *
 *   - **Horizontal only, and `touch-action: pan-y`.** A drag across turns the
 *     bottle; a drag up or down scrolls the page, because the browser is
 *     allowed to claim the gesture. Orbit controls take `touch-action: none`
 *     and a product page that eats vertical swipes on mobile is broken.
 *   - **Momentum with a real spin-down.** Velocity is carried out of the
 *     gesture and decays exponentially, so a flick keeps turning and a slow
 *     drag stops dead. Without it the bottle feels like a slider.
 *   - **Keyboard.** Arrow keys turn it. A control that only answers to a
 *     pointer is not a control everyone has.
 */
export interface TurntableHandle {
  /** Advance the spin and read the current yaw, in radians. */
  step: (dt: number) => number;
  /** True while a pointer is down, for anything that wants to pause idle. */
  isDragging: () => boolean;
}

const DRAG_THRESHOLD_PX = 4;
/** Radians of yaw per pixel of drag, at a nominal 1000px-wide viewer. */
const SENSITIVITY = 6.0;
/** Exponential spin-down, in seconds to fall to 1/e of the release speed. */
const DAMPING = 0.55;
const MAX_SPIN = 9;
const KEY_STEP = Math.PI / 9;

export function useTurntable(enabled: boolean): {
  ref: (el: HTMLElement | null) => void;
  handle: TurntableHandle;
} {
  const yaw = useRef(0);
  const velocity = useRef(0);
  const target = useRef<number | null>(null);
  const dragging = useRef(false);
  const host = useRef<HTMLElement | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const handle = useRef<TurntableHandle>({
    step: (dt: number) => {
      // A keyed nudge is a target to ease toward; a flick is a velocity to
      // spend. Keeping them separate is what stops an arrow press fighting
      // the momentum from the drag before it.
      if (target.current !== null) {
        const k = 1 - Math.exp(-dt / 0.13);
        yaw.current += (target.current - yaw.current) * k;
        if (Math.abs(target.current - yaw.current) < 1e-4) {
          yaw.current = target.current;
          target.current = null;
        }
        return yaw.current;
      }
      if (!dragging.current && velocity.current !== 0) {
        yaw.current += velocity.current * dt;
        velocity.current *= Math.exp(-dt / DAMPING);
        if (Math.abs(velocity.current) < 1e-3) velocity.current = 0;
      }
      return yaw.current;
    },
    isDragging: () => dragging.current,
  }).current;

  useEffect(() => {
    const el = host.current;
    if (!el || !enabled) return;

    let pointerId: number | null = null;
    let lastX = 0;
    let lastT = 0;
    let startX = 0;
    let claimed = false;

    const width = () => Math.max(el.clientWidth, 1);

    const onDown = (e: PointerEvent) => {
      if (pointerId !== null || !e.isPrimary) return;
      pointerId = e.pointerId;
      startX = lastX = e.clientX;
      lastT = e.timeStamp;
      claimed = false;
      dragging.current = true;
      velocity.current = 0;
      target.current = null;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - lastX;
      const dt = Math.max((e.timeStamp - lastT) / 1000, 1e-3);
      // Do not claim the gesture until it has clearly gone sideways. Before
      // that the browser may still want it for a scroll, and taking it early
      // is what makes a 3D viewer feel like a trap on a phone.
      if (!claimed && Math.abs(e.clientX - startX) > DRAG_THRESHOLD_PX) {
        claimed = true;
        el.setPointerCapture(pointerId);
      }
      if (!claimed) return;
      const d = (dx / width()) * SENSITIVITY;
      yaw.current += d;
      velocity.current = Math.max(
        -MAX_SPIN,
        Math.min(MAX_SPIN, velocity.current * 0.6 + (d / dt) * 0.4),
      );
      lastX = e.clientX;
      lastT = e.timeStamp;
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (claimed && el.hasPointerCapture(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
      // A pointer that has been still for a moment before release should stop,
      // not drift: stale velocity from earlier in the gesture is the classic
      // "it keeps going after I put it down" bug.
      if (e.timeStamp - lastT > 90) velocity.current = 0;
      pointerId = null;
      dragging.current = false;
    };

    const onKey = (e: KeyboardEvent) => {
      const dir =
        e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? 0 : null;
      if (dir === null) return;
      e.preventDefault();
      velocity.current = 0;
      target.current =
        dir === 0 ? 0 : (target.current ?? yaw.current) + dir * KEY_STEP;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("keydown", onKey);
    };
  }, [enabled]);

  const ref = useCallback((el: HTMLElement | null) => {
    host.current = el;
  }, []);

  return { ref, handle };
}
