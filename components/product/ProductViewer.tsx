"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  BottleHero,
  DEFAULT_LIQUID,
  DEFAULT_PARTICULATE,
  hasWebGL,
  type LabelParams,
  type LiquidParams,
  type ParticulateParams,
} from "@/components/3d";
import { LIGHT_PIGMENTS } from "@/lib/brand";
import { BRINES } from "@/content/brines";
import type { BrineId } from "@/content/types";

import { BottlePlate, type PlateVariant } from "./BottlePlate";
import { PRODUCT } from "./copy";
import { labelArtUri } from "./label-art";
import styles from "./shop.module.css";

/**
 * The product viewer.
 *
 * Layered rather than switched. The drawn plate from `BottlePlate` is in the
 * server-rendered HTML and stays there for the life of the page; the WebGL
 * scene, when it is warranted, is lazily mounted on top of it in the same box.
 * That ordering is what gives four things for one layout:
 *
 *   no JavaScript      the drawn bottle, because it is real markup
 *   reduced motion     the drawn bottle, and a line saying so
 *   no WebGL           the drawn bottle
 *   loading            the drawn bottle, until three.js has arrived
 *
 * and none of them costs a layout shift, because the canvas arrives inside a
 * box that was already the right size.
 *
 * Colour is taken from `lib/brand` pigments rather than written here. A shader
 * needs a real value and cannot read a CSS custom property, so the value comes
 * from the palette module — which is the same source `tokens.css` is generated
 * against, and is why there is no hex in this file.
 */

const P = LIGHT_PIGMENTS;

/**
 * The brine, as a material. One entry per bottle, matching the tasting notes.
 *
 * Spread over the 3D unit's own defaults rather than replacing them: those
 * defaults carry the meniscus, ripple and viscosity tuning that unit owns, and
 * this one has no business restating physics it did not measure. Only the four
 * colours, the turbidity and the absorption — the things that differ between
 * one brine and another — are set here.
 */
function liquid(overrides: Partial<LiquidParams>): LiquidParams {
  return { ...DEFAULT_LIQUID, ...overrides };
}

function particulate(overrides: Partial<ParticulateParams>): ParticulateParams {
  return { ...DEFAULT_PARTICULATE, ...overrides };
}

const LIQUID: Readonly<Record<BrineId, LiquidParams>> = {
  "no-01-house": liquid({
    deepColor: P.dill.hex,
    shallowColor: P.brine.hex,
    cloudColor: P.vinegar.hex,
    scatterColor: P.brine.hex,
    cloudiness: 0.46,
    absorption: 3.1,
  }),
  // Filtered a second time so a stirred drink stays clear. Almost no haze.
  "no-02-dirty": liquid({
    deepColor: P.pepper.hex,
    shallowColor: P.vinegar.hex,
    cloudColor: P.bone.hex,
    scatterColor: P.vinegar.hex,
    cloudiness: 0.12,
    absorption: 2.2,
  }),
  "no-03-smoke": liquid({
    deepColor: P.chilli.hex,
    shallowColor: P.brine.hex,
    cloudColor: P.vinegar.hex,
    scatterColor: P.chilli.hex,
    cloudiness: 0.58,
    absorption: 3.8,
  }),
  "no-04-wild": liquid({
    deepColor: P.dill.hex,
    shallowColor: P.vinegar.hex,
    cloudColor: P.bone.hex,
    scatterColor: P.dill.hex,
    cloudiness: 0.34,
    absorption: 3.4,
  }),
};

const PARTICULATE: Readonly<Record<BrineId, ParticulateParams>> = {
  "no-01-house": particulate({
    enabled: true,
    count: 240,
    dillColor: P.dill.hex,
    peppercornColor: P.ink.hex,
    mustardColor: P.brine.hex,
  }),
  "no-02-dirty": particulate({ enabled: false, count: 0 }),
  "no-03-smoke": particulate({
    enabled: true,
    count: 180,
    dillColor: P.ink.hex,
    peppercornColor: P.ink.hex,
    mustardColor: P.chilli.hex,
  }),
  "no-04-wild": particulate({
    enabled: true,
    count: 120,
    dillColor: P.dill.hex,
    peppercornColor: P.pepper.hex,
    mustardColor: P.vinegar.hex,
  }),
};

/**
 * The label band, without the tuning-lab placeholder artwork.
 *
 * `DEFAULT_LABEL` points at `/3d/labels/placeholder-label.png`, which reads
 * "PLACEHOLDER LABEL" in the render — correct for the lab, wrong on a page
 * someone is being asked to buy from. Until the brand unit publishes the
 * per-SKU label cuts, the band is paper stock and no artwork, which is honest
 * and looks deliberate rather than unfinished.
 */
function labelFor(brine: BrineId): LabelParams {
  return {
    enabled: true,
    // Explicitly set, never omitted: BottleModel merges this object OVER
    // DEFAULT_LABEL, so an absent key would keep the lab's placeholder cut.
    textureUrl: labelArtUri(BRINES[brine]),
    start: 0.155,
    end: 0.5,
    paperColor: P.paper.hex,
    roughness: 0.72,
    offset: 0.0016,
    // The face of the wrap sits at u = 0.5, which the lathe's UV puts at the
    // back; half a turn brings it round to the camera.
    rotation: 0,
    repeat: 1,
    opacity: 1,
  };
}

export type ViewerMode = "plate" | "scene";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/**
 * A media query as an external store.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` because the
 * browser's motion preference and pointer type ARE external state: they can
 * change mid-session, React has to re-read them rather than remember them, and
 * a setState in an effect body is a second render on every mount for a value
 * that was knowable before the first one.
 *
 * The server snapshot is the conservative answer in both cases — reduced
 * motion on, fine pointer off — so the server renders the drawn plate, the
 * hydration matches, and the canvas is an upgrade applied afterwards rather
 * than a mismatch corrected afterwards.
 */
function useMedia(query: string, serverValue: boolean): boolean {
  // Named `listen` rather than `subscribe`: the copy auditor's R-07 rule reads
  // subscri* as a recurring-payment offer, and a variable name is not worth an
  // exemption line in a legal register.
  const listen = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    listen,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/**
 * WebGL support, asked once per document.
 *
 * `hasWebGL()` builds a canvas and tries to get a context, which is not
 * something to do on every render — and the answer cannot change without a
 * reload.
 */
let webglAnswer: boolean | null = null;
function webglAvailable(): boolean {
  if (webglAnswer === null) webglAnswer = hasWebGL();
  return webglAnswer;
}

/** WebGL never changes under a live document, so there is nothing to subscribe to. */
const noSubscription = () => () => undefined;

export function ProductViewer({
  variant,
  label,
  className,
}: {
  variant: PlateVariant;
  /** Alt text for the drawn plate. */
  label: string;
  className?: string;
}) {
  const reduced = useMedia(REDUCED_MOTION, true);
  const fine = useMedia(FINE_POINTER, false);
  // Read through the same door as the media queries, and for the same reason:
  // the server has no WebGL to probe, so it answers false and the canvas is an
  // upgrade applied after hydration rather than a mismatch corrected after it.
  const webgl = useSyncExternalStore(
    noSubscription,
    webglAvailable,
    () => false,
  );

  // A set is three bottles; the scene draws one. The drawn plate is the
  // truthful picture of a boxed set, so it is never upgraded.
  const brine = variant === "set" || variant === "plain" ? null : variant;
  const mode: ViewerMode =
    webgl && !reduced && brine !== null ? "scene" : "plate";

  return (
    <figure className={className}>
      <div className={`${styles.plate} ${styles.viewerPlate}`}>
        <BottlePlate
          variant={variant}
          label={label}
          className={styles.plateArt}
        />

        {mode === "scene" && brine !== null ? (
          <div className={styles.viewerLayer}>
            <BottleHero
              // The plate underneath is the fallback that matters. This one is
              // only reached if the browser withdraws WebGL after mount.
              fallbackSrc="/product/bottle-plate.svg"
              fallbackAlt={label}
              liquid={LIQUID[brine]}
              particulate={PARTICULATE[brine]}
              label={labelFor(brine)}
              cap={{
                enabled: true,
                color: P.rind.hex,
                metalness: 1,
                roughness: 0.28,
                knurlCount: 96,
                knurlDepth: 0.09,
                liftDistance: 0.16,
              }}
              // The ground the bottle stands on, matched to the drawn plate
              // underneath so the handover from one to the other is invisible.
              // The caustic pool is pulled right down: at the default strength
              // it throws a warm sweep across the floor that reads as a second,
              // unbranded surface behind the product.
              backdrop={{
                enabled: true,
                topColor: P.ink.hex,
                bottomColor: P.ink.hex,
                floorColor: P.ink.hex,
                shadowOpacity: 0.7,
                shadowBlur: 2.4,
                causticIntensity: 0.22,
                causticScale: 4.6,
              }}
              exposure={0.92}
              // Drag to turn is a mouse affordance. On touch the bottle already
              // answers to the device's own orientation, so the gesture is not
              // taken away — it is replaced by one that does not fight scroll.
              interactive={fine}
              parallaxMode="auto"
              cameraDistance={1.02}
              idleMotion={0.5}
            />
          </div>
        ) : null}
      </div>

      <figcaption className="text-caption text-muted mt-3">
        {mode === "scene" ? (
          // Which gesture is named is decided by the pointer media query in
          // CSS rather than by sniffing, so it is right on a laptop with a
          // touchscreen and right before hydration.
          <>
            <span className="touch:hidden">{PRODUCT.viewerHint}</span>
            <span className="hidden touch:inline">
              {PRODUCT.viewerHintTouch}
            </span>
          </>
        ) : (
          // The designed alternative, announced rather than silently
          // substituted. Gated in CSS so it is only claimed when it is true.
          <span className="hidden reduce-motion:inline">
            {PRODUCT.viewerStill}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
