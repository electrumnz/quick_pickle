/**
 * HALF SOUR motion vocabulary.
 *
 * Every animated unit in this build imports from here. Nothing hard-codes a
 * duration, an easing curve or a stagger interval.
 *
 * Two complete profiles are authored: `fullMotion` and `reducedMotion`. The
 * reduced profile is a DESIGNED ALTERNATIVE, not a kill switch — it keeps
 * timing, sequence and hierarchy and drops only the parts that move you:
 * translation, parallax, scroll-scrubbing and overshoot. Content still arrives
 * in order, still resolves at a readable pace, and depth is still expressed —
 * as value and edge rather than as displacement.
 *
 * The same values exist as CSS custom properties in `tokens.css`, which swap
 * under `@media (prefers-reduced-motion: reduce)`, so a CSS-only component gets
 * the reduced profile without shipping a line of JavaScript.
 */

/** Named durations, in milliseconds. Intent, never a number at the call site. */
export interface MotionDurations {
  /** State flips with no travel: checkbox, toggle, colour swap. */
  readonly instant: number;
  /** Hover and focus feedback. Must feel attached to the pointer. */
  readonly micro: number;
  /** Small UI reveals: tooltip, dropdown, inline validation. */
  readonly quick: number;
  /** Something arriving: card, panel, section. */
  readonly enter: number;
  /** Something leaving. Always faster than `enter` — dismissal is not an event. */
  readonly exit: number;
  /** The one move on screen that is asking to be noticed. */
  readonly emphasis: number;
  /** A full-page or hero transition. Used sparingly, once per view. */
  readonly deliberate: number;
}

/** Named easing curves as CSS `cubic-bezier()` / keyword strings. */
export interface MotionEasings {
  /** Decelerating. Arrivals settle rather than stop. */
  readonly enter: string;
  /** Accelerating. Departures commit and go. */
  readonly exit: string;
  /** Symmetric. Anything that moves between two on-screen positions. */
  readonly standard: string;
  /** A small overshoot. Reserved for the emphasis moment. */
  readonly emphasis: string;
  /** Scroll-linked motion must be linear or it lies about the scroll position. */
  readonly scrub: string;
}

/** Interval between items in a sequence, in milliseconds. */
export interface MotionStagger {
  /** Dense lists — table rows, chips. */
  readonly tight: number;
  /** The default: cards in a grid, form fields. */
  readonly base: number;
  /** Few, large items. */
  readonly loose: number;
  /** Editorial pacing: a headline resolving line by line. */
  readonly editorial: number;
  /**
   * Hard cap on total sequence length. Past this the stagger compresses so a
   * long list never makes the last item wait. Milliseconds.
   */
  readonly maxTotal: number;
}

/** Travel distances for entrances, in CSS pixels. */
export interface MotionDistance {
  /** Inline elements, chips, validation text. */
  readonly sm: number;
  /** Cards, panels, list items. */
  readonly md: number;
  /** Sections and hero content. */
  readonly lg: number;
  /** Parallax layer offset at full scroll range. */
  readonly parallax: number;
}

/** How a scroll-linked sequence behaves. */
export interface MotionScrub {
  /**
   * "continuous" ties progress to scroll position frame by frame.
   * "threshold" plays a fixed-length transition once, when the element crosses
   * into view, and never again — the designed alternative to scrubbing.
   */
  readonly mode: "continuous" | "threshold";
  /** Fraction of the viewport at which the range starts. 0 = bottom edge. */
  readonly start: number;
  /** Fraction of the viewport at which the range completes. */
  readonly end: number;
  /**
   * Smoothing applied to scroll progress, 0..1. 0 is raw (correct for
   * scroll-driven CSS animations); higher values lag behind the finger and
   * judder under touch momentum, so keep it low.
   */
  readonly smoothing: number;
  /** Duration used when `mode` is "threshold". Milliseconds. */
  readonly thresholdDuration: number;
}

/** Spring constants for physics-driven UI (r3f, spring libraries). */
export interface MotionSpring {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

export interface MotionSprings {
  /** Pointer-following, magnetic and drag interactions. */
  readonly responsive: MotionSpring;
  /** Panels and cards settling into place. */
  readonly settle: MotionSpring;
  /** Heavy objects: the 3D jar, a full-screen overlay. */
  readonly weighted: MotionSpring;
}

export interface MotionProfile {
  /** Which profile this is, for logging and test assertions. */
  readonly name: "full" | "reduced";
  readonly duration: MotionDurations;
  readonly easing: MotionEasings;
  readonly stagger: MotionStagger;
  readonly distance: MotionDistance;
  readonly scrub: MotionScrub;
  readonly springs: MotionSprings;
  /**
   * True when the profile permits motion that continues without user input:
   * autoplay, looping ambient motion, marquees, idle 3D drift.
   */
  readonly allowsAmbient: boolean;
  /** True when the profile permits translation on entrance. */
  readonly allowsTravel: boolean;
}

/** The full-motion profile. */
export const fullMotion: MotionProfile = {
  name: "full",
  duration: {
    instant: 80,
    micro: 140,
    quick: 200,
    enter: 320,
    exit: 220,
    emphasis: 480,
    deliberate: 640,
  },
  easing: {
    enter: "cubic-bezier(0.16, 1, 0.3, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    emphasis: "cubic-bezier(0.34, 1.4, 0.64, 1)",
    scrub: "linear",
  },
  stagger: {
    tight: 30,
    base: 60,
    loose: 110,
    editorial: 160,
    maxTotal: 900,
  },
  distance: { sm: 8, md: 24, lg: 48, parallax: 96 },
  scrub: {
    mode: "continuous",
    start: 0.15,
    end: 0.85,
    smoothing: 0,
    thresholdDuration: 320,
  },
  springs: {
    responsive: { stiffness: 420, damping: 34, mass: 1 },
    settle: { stiffness: 260, damping: 30, mass: 1 },
    weighted: { stiffness: 140, damping: 26, mass: 1.4 },
  },
  allowsAmbient: true,
  allowsTravel: true,
};

/**
 * The reduced-motion profile — a first-class design, not `animation: none`.
 *
 * What it keeps: sequence, hierarchy, the sense that something resolved.
 * Fades, colour, edge and opacity all still transition, and staggering still
 * reads as an order of arrival.
 *
 * What it drops: every kind of displacement. Travel distances are zero,
 * parallax is zero, scroll-scrubbing becomes a single threshold transition,
 * overshoot easing is replaced with a plain decelerate, and ambient/looping
 * motion is off. Durations shorten but never reach zero — an instant cut is
 * its own kind of jolt, and it destroys the sense of causality that makes the
 * interface legible.
 */
export const reducedMotion: MotionProfile = {
  name: "reduced",
  duration: {
    instant: 60,
    micro: 100,
    quick: 130,
    enter: 180,
    exit: 140,
    emphasis: 240,
    deliberate: 300,
  },
  easing: {
    enter: "cubic-bezier(0.2, 0, 0, 1)",
    exit: "cubic-bezier(0.2, 0, 0, 1)",
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    // No overshoot: a bounce is displacement, whatever it is applied to.
    emphasis: "cubic-bezier(0.2, 0, 0, 1)",
    scrub: "linear",
  },
  stagger: {
    // Order still reads, at roughly a third of the interval.
    tight: 12,
    base: 24,
    loose: 40,
    editorial: 60,
    maxTotal: 400,
  },
  distance: { sm: 0, md: 0, lg: 0, parallax: 0 },
  scrub: {
    mode: "threshold",
    start: 0.25,
    end: 0.25,
    smoothing: 0,
    thresholdDuration: 180,
  },
  springs: {
    // Critically damped: reaches the target and stops, no oscillation.
    responsive: { stiffness: 600, damping: 49, mass: 1 },
    settle: { stiffness: 500, damping: 45, mass: 1 },
    weighted: { stiffness: 400, damping: 40, mass: 1 },
  },
  allowsAmbient: false,
  allowsTravel: false,
};

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Pick a profile. Pass the result of `usePrefersReducedMotion()` or similar. */
export function motionFor(prefersReduced: boolean): MotionProfile {
  return prefersReduced ? reducedMotion : fullMotion;
}

/**
 * Read the preference. SSR-safe: returns `false` on the server, which pairs
 * with the CSS media query so the first paint is already correct either way.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Subscribe to preference changes. Returns an unsubscribe function. */
export function watchReducedMotion(
  onChange: (prefersReduced: boolean) => void,
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

/**
 * Stagger delay for item `index`, compressed so the sequence never runs past
 * `stagger.maxTotal`.
 */
export function staggerDelay(
  index: number,
  count: number,
  profile: MotionProfile = fullMotion,
  interval: keyof Omit<MotionStagger, "maxTotal"> = "base",
): number {
  const step = profile.stagger[interval];
  const last = Math.max(count - 1, 0);
  if (last === 0 || step === 0) return 0;
  const scale = Math.min(1, profile.stagger.maxTotal / (last * step));
  return Math.round(index * step * scale);
}

/** `"320ms cubic-bezier(...)"` for a named duration and easing. */
export function timing(
  profile: MotionProfile,
  duration: keyof MotionDurations,
  easing: keyof MotionEasings,
): string {
  return `${profile.duration[duration]}ms ${profile.easing[easing]}`;
}

/** A complete `transition` shorthand for one or more properties. */
export function transition(
  properties: readonly string[],
  profile: MotionProfile = fullMotion,
  duration: keyof MotionDurations = "quick",
  easing: keyof MotionEasings = "standard",
): string {
  return properties
    .map((property) => `${property} ${timing(profile, duration, easing)}`)
    .join(", ");
}

/**
 * The CSS custom-property names the same vocabulary is published under in
 * `tokens.css`. Use these when a value has to reach CSS — they already respect
 * `prefers-reduced-motion` without any JavaScript.
 */
export const MOTION_VARS = {
  duration: {
    instant: "--motion-duration-instant",
    micro: "--motion-duration-micro",
    quick: "--motion-duration-quick",
    enter: "--motion-duration-enter",
    exit: "--motion-duration-exit",
    emphasis: "--motion-duration-emphasis",
    deliberate: "--motion-duration-deliberate",
  },
  easing: {
    enter: "--motion-ease-enter",
    exit: "--motion-ease-exit",
    standard: "--motion-ease-standard",
    emphasis: "--motion-ease-emphasis",
    scrub: "--motion-ease-scrub",
  },
  stagger: {
    tight: "--motion-stagger-tight",
    base: "--motion-stagger-base",
    loose: "--motion-stagger-loose",
    editorial: "--motion-stagger-editorial",
  },
  distance: {
    sm: "--motion-distance-sm",
    md: "--motion-distance-md",
    lg: "--motion-distance-lg",
    parallax: "--motion-distance-parallax",
  },
} as const;
