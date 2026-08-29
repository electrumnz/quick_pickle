"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  fullMotion,
  motionFor,
  prefersReducedMotion,
  reducedMotion,
  staggerDelay,
  watchReducedMotion,
  type MotionProfile,
} from "@/lib/brand/motion";

type Sample = "enter" | "exit" | "emphasis" | "stagger";

const SAMPLES: readonly { id: Sample; label: string; note: string }[] = [
  {
    id: "enter",
    label: "enter",
    note: "Rise and fade, decelerating. Reduced: the same fade, no travel.",
  },
  {
    id: "exit",
    label: "exit",
    note: "Faster than enter, accelerating. Dismissal is not an event.",
  },
  {
    id: "emphasis",
    label: "emphasis",
    note: "A scale beat plus an accent ring. Reduced: the ring alone.",
  },
  {
    id: "stagger",
    label: "stagger",
    note: "Order of arrival. Reduced: same order, roughly a third of the gap.",
  },
];

const ANIMATION: Record<Sample, string> = {
  enter: "hs-enter var(--motion-duration-enter) var(--motion-ease-enter) both",
  exit: "hs-exit var(--motion-duration-exit) var(--motion-ease-exit) both",
  emphasis:
    "hs-emphasis var(--motion-duration-emphasis) var(--motion-ease-emphasis) both",
  stagger:
    "hs-enter var(--motion-duration-enter) var(--motion-ease-enter) both",
};

/**
 * Live samples of the motion vocabulary. Every animation here is a keyframe
 * from lib/brand/tokens.css driven by the --motion-* custom properties, so
 * what you see under `prefers-reduced-motion: reduce` is the reduced design
 * itself — not this component branching on a flag.
 */
function watchMotionPreference(onStoreChange: () => void): () => void {
  return watchReducedMotion(onStoreChange);
}

/** The server has no preference to read, and the CSS default is full motion. */
function serverSnapshot(): boolean {
  return false;
}

export function MotionSpecimen() {
  const [run, setRun] = useState(0);
  const [sample, setSample] = useState<Sample>("enter");

  // The media query is an external store, so it is read as one rather than
  // mirrored into state by an effect: the server snapshot is pinned to the
  // CSS default and React reads the real value during the commit.
  const prefersReduced = useSyncExternalStore(
    watchMotionPreference,
    prefersReducedMotion,
    serverSnapshot,
  );

  const profile: MotionProfile = motionFor(prefersReduced);
  const play = useCallback((next: Sample) => {
    setSample(next);
    setRun((value) => value + 1);
  }, []);

  return (
    <div className="gap-stack flex flex-col">
      <div className="gap-inline flex flex-wrap">
        {SAMPLES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => play(item.id)}
            aria-pressed={item.id === sample}
            className={[
              "border-strong text-body-sm min-h-11 cursor-pointer rounded-sm border px-4",
              item.id === sample
                ? "bg-surface-accent text-on-accent"
                : "bg-surface-raised text-primary",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="text-caption text-muted max-w-prose">
        {SAMPLES.find((item) => item.id === sample)?.note}
      </p>

      <div
        className="border-hairline bg-surface-sunken flex min-h-32 items-center gap-2 rounded-md border p-6"
        key={`${sample}-${run}`}
      >
        {sample === "stagger" ? (
          Array.from({ length: 6 }, (_, index) => (
            <span
              key={index}
              className="bg-accent border-accent-edge block h-10 w-10 rounded-xs border"
              style={{
                animation: ANIMATION.stagger,
                animationDelay: `${staggerDelay(index, 6, profile)}ms`,
              }}
            />
          ))
        ) : (
          <span
            className="bg-accent border-accent-edge text-on-accent text-eyebrow flex h-16 w-40 items-center justify-center rounded-sm border uppercase"
            style={{ animation: ANIMATION[sample] }}
          >
            {sample}
          </span>
        )}
      </div>

      <ScrubSpecimen profile={profile} />

      <dl className="text-body-sm grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
        <dt className="text-muted">Active profile</dt>
        <dd className="text-primary font-semibold">{profile.name}</dd>
        <dt className="text-muted">Travel</dt>
        <dd className="text-primary">
          {profile.allowsTravel
            ? `${fullMotion.distance.md}px`
            : `${reducedMotion.distance.md}px — expressed as a fade instead`}
        </dd>
        <dt className="text-muted">Scrub</dt>
        <dd className="text-primary">
          {profile.scrub.mode === "continuous"
            ? "continuous, tied to scroll position"
            : "threshold, one designed reveal on entry"}
        </dd>
        <dt className="text-muted">Ambient motion</dt>
        <dd className="text-primary">
          {profile.allowsAmbient ? "permitted" : "off"}
        </dd>
      </dl>
    </div>
  );
}

/**
 * The scrub sample. In the full profile the bar tracks scroll position frame
 * by frame; in the reduced profile the SAME element fills once, when it
 * crosses the threshold, and then holds. That is the designed alternative to
 * scrubbing, not the absence of it.
 */
function ScrubSpecimen({ profile }: { profile: MotionProfile }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (profile.scrub.mode === "threshold") {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              setProgress(1);
              observer.disconnect();
            }
          }
        },
        { threshold: profile.scrub.start },
      );
      observer.observe(host);
      return () => observer.disconnect();
    }

    const update = () => {
      const rect = host.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const start = viewport * (1 - profile.scrub.start);
      const end = viewport * (1 - profile.scrub.end);
      const ratio = (start - rect.top) / Math.max(start - end, 1);
      setProgress(Math.min(1, Math.max(0, ratio)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [profile]);

  return (
    <div ref={hostRef} className="gap-inline flex flex-col">
      <span className="text-eyebrow text-muted uppercase">
        scrub — {profile.scrub.mode}
      </span>
      <div
        className="bg-surface-sunken border-hairline h-3 w-full overflow-hidden rounded-pill border"
        role="progressbar"
        aria-label="Scroll-linked sample"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="bg-accent h-full"
          style={{
            width: `${progress * 100}%`,
            transition:
              profile.scrub.mode === "threshold"
                ? `width ${profile.scrub.thresholdDuration}ms var(--motion-ease-standard)`
                : "none",
          }}
        />
      </div>
    </div>
  );
}
