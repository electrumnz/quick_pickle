"use client";

import { useEffect, useRef, useState } from "react";

import { useFinePointer, useMotionProfile } from "./use-motion";
import styles from "./home.module.css";

type CursorState = "default" | "link" | "pour";

/**
 * The cursor state machine.
 *
 * Three states, read off the DOM rather than wired per component: any element
 * carrying `data-cursor="link"` or `data-cursor="pour"` puts the cursor into
 * that state while the pointer is over it, and `data-cursor-label` supplies the
 * word it carries. Adding a new affordance is an attribute, not a subscription.
 *
 * TOUCH IS NOT A MISSING FEATURE HERE. This component only mounts behind
 * `(hover: hover) and (pointer: fine)`, because a cursor is meaningless without
 * a pointer — but every label it shows is also rendered inline in the markup
 * under the `touch:` variant, so a phone gets the same words as a visible chip
 * on the element itself. Nothing this cursor says is said only by this cursor.
 *
 * Under reduced motion the ring stops trailing and snaps to the pointer: the
 * state machine still reads, the lag does not. The native cursor is only
 * hidden once the replacement is actually on screen.
 */
export function Cursor() {
  const fine = useFinePointer();
  const motion = useMotionProfile();
  const ref = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<CursorState>("default");

  useEffect(() => {
    if (!fine) return;
    const node = ref.current;
    if (!node) return;

    const lerp = motion.name === "reduced" ? 1 : 0.18;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let targetX = x;
    let targetY = y;
    let raf = 0;
    let seen = false;

    const frame = () => {
      x += (targetX - x) * lerp;
      y += (targetY - y) * lerp;
      node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      raf = requestAnimationFrame(frame);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      targetX = event.clientX;
      targetY = event.clientY;
      if (!seen) {
        seen = true;
        x = targetX;
        y = targetY;
        setReady(true);
        document.documentElement.dataset.cursor = "custom";
      }
      const hit = (event.target as Element | null)?.closest?.(
        "[data-cursor]",
      ) as HTMLElement | null;
      const next =
        (hit?.dataset.cursor as CursorState | undefined) ?? "default";
      setState(next);
      if (labelRef.current) {
        labelRef.current.textContent = hit?.dataset.cursorLabel ?? "";
      }
    };

    const onLeave = () => {
      setReady(false);
      delete document.documentElement.dataset.cursor;
    };

    raf = requestAnimationFrame(frame);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      delete document.documentElement.dataset.cursor;
    };
  }, [fine, motion.name]);

  if (!fine) return null;

  return (
    <div
      ref={ref}
      className={styles.cursor}
      data-ready={ready}
      data-state={state}
      aria-hidden="true"
    >
      <span className={styles.cursorRing}>
        <span ref={labelRef} className={styles.cursorLabel} />
      </span>
      <span className={styles.cursorDot} />
    </div>
  );
}
