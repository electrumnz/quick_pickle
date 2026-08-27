"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { button, folder, useControls } from "leva";
import { Leva } from "leva";
import { BottleScene } from "../BottleScene";
import { FpsProbe } from "./FpsProbe";
import {
  DEFAULT_BACKDROP,
  DEFAULT_CAP,
  DEFAULT_GLASS,
  DEFAULT_LABEL,
  DEFAULT_LIQUID,
  DEFAULT_PARTICULATE,
  DEFAULT_POUR,
  DEFAULT_STUDIO,
} from "../defaults";
import { detectDevice } from "../lib/quality";
import type { QualityTier } from "../types";

type Sample = { fps: number; calls: number; triangles: number; dpr: number };

/** Scroll fraction of the tall scrub track, clamped and overscroll-safe. */
function useScrollProgress(
  ref: React.RefObject<HTMLDivElement | null>,
  active: boolean,
) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = Math.max(r.height - window.innerHeight, 1);
      // iOS elastic overscroll pushes this past both ends; clamping here is
      // what stops the pour snapping when the rubber band lets go.
      setP(Math.min(1, Math.max(0, -r.top / span)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref, active]);
  return p;
}

export function BottleLab() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [manual, setManual] = useState<number | null>(null);
  const [sample, setSample] = useState<Sample>({
    fps: 0,
    calls: 0,
    triangles: 0,
    dpr: 1,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [device, setDevice] = useState<ReturnType<typeof detectDevice> | null>(
    null,
  );
  useEffect(() => setDevice(detectDevice()), []);

  const scrollP = useScrollProgress(trackRef, manual === null);
  const progress = manual ?? scrollP;

  const scene = useControls({
    Scene: folder(
      {
        pourProgress: { value: 0, min: 0, max: 1, step: 0.001 },
        usePourSlider: false,
        forceTier: {
          value: "auto",
          options: ["auto", "low", "medium", "high"],
        },
        exposure: { value: 1.05, min: 0.3, max: 2.2, step: 0.01 },
        cameraFov: { value: 26, min: 14, max: 60, step: 1 },
        cameraDistance: { value: 1, min: 0.6, max: 2.4, step: 0.01 },
        cameraHeight: { value: 0.16, min: -0.5, max: 0.9, step: 0.01 },
        cameraOffset: { value: 0.34, min: -1.5, max: 1.5, step: 0.01 },
        idleMotion: { value: 1, min: 0, max: 3, step: 0.05 },
        autoRotate: { value: 0, min: -0.6, max: 0.6, step: 0.01 },
        rotation: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01 },
        pointerParallax: { value: 0.09, min: 0, max: 0.5, step: 0.005 },
        parallaxMode: {
          value: "auto",
          options: ["auto", "pointer", "orientation", "drift", "off"],
        },
        progressSmoothing: { value: 0.14, min: 0, max: 1, step: 0.01 },
        interactive: false,
        paused: false,
      },
      { collapsed: false },
    ),
  });

  const glass = useControls("Glass", {
    color: DEFAULT_GLASS.color as string,
    ior: { value: DEFAULT_GLASS.ior, min: 1, max: 2.4, step: 0.01 },
    thickness: { value: DEFAULT_GLASS.thickness, min: 0, max: 2, step: 0.01 },
    roughness: {
      value: DEFAULT_GLASS.roughness,
      min: 0,
      max: 0.6,
      step: 0.005,
    },
    chromaticAberration: {
      value: DEFAULT_GLASS.chromaticAberration,
      min: 0,
      max: 0.4,
      step: 0.001,
    },
    distortion: { value: DEFAULT_GLASS.distortion, min: 0, max: 1, step: 0.01 },
    distortionScale: {
      value: DEFAULT_GLASS.distortionScale,
      min: 0,
      max: 1,
      step: 0.01,
    },
    temporalDistortion: {
      value: DEFAULT_GLASS.temporalDistortion,
      min: 0,
      max: 1,
      step: 0.01,
    },
    anisotropicBlur: {
      value: DEFAULT_GLASS.anisotropicBlur,
      min: 0,
      max: 2,
      step: 0.01,
    },
    envMapIntensity: {
      value: DEFAULT_GLASS.envMapIntensity,
      min: 0,
      max: 5,
      step: 0.05,
    },
    reflectivity: {
      value: DEFAULT_GLASS.reflectivity,
      min: 0,
      max: 1,
      step: 0.01,
    },
    attenuationDistance: {
      value: DEFAULT_GLASS.attenuationDistance,
      min: 0.05,
      max: 8,
      step: 0.05,
    },
    attenuationColor: DEFAULT_GLASS.attenuationColor as string,
  });

  const liquid = useControls("Liquid", {
    deepColor: DEFAULT_LIQUID.deepColor as string,
    shallowColor: DEFAULT_LIQUID.shallowColor as string,
    cloudColor: DEFAULT_LIQUID.cloudColor as string,
    scatterColor: DEFAULT_LIQUID.scatterColor as string,
    cloudiness: {
      value: DEFAULT_LIQUID.cloudiness,
      min: 0,
      max: 1,
      step: 0.01,
    },
    cloudScale: {
      value: DEFAULT_LIQUID.cloudScale,
      min: 1,
      max: 30,
      step: 0.1,
    },
    cloudSpeed: {
      value: DEFAULT_LIQUID.cloudSpeed,
      min: 0,
      max: 0.5,
      step: 0.005,
    },
    absorption: {
      value: DEFAULT_LIQUID.absorption,
      min: 0,
      max: 8,
      step: 0.05,
    },
    scatterStrength: {
      value: DEFAULT_LIQUID.scatterStrength,
      min: 0,
      max: 3,
      step: 0.02,
    },
    meniscusHeight: {
      value: DEFAULT_LIQUID.meniscusHeight,
      min: 0,
      max: 0.05,
      step: 0.0005,
    },
    meniscusWidth: {
      value: DEFAULT_LIQUID.meniscusWidth,
      min: 0.02,
      max: 0.8,
      step: 0.005,
    },
    rippleAmplitude: {
      value: DEFAULT_LIQUID.rippleAmplitude,
      min: 0,
      max: 0.01,
      step: 0.0001,
    },
    rippleScale: {
      value: DEFAULT_LIQUID.rippleScale,
      min: 2,
      max: 120,
      step: 1,
    },
    rippleSpeed: {
      value: DEFAULT_LIQUID.rippleSpeed,
      min: 0,
      max: 3,
      step: 0.01,
    },
    viscosity: { value: DEFAULT_LIQUID.viscosity, min: 0, max: 1, step: 0.01 },
    roughness: {
      value: DEFAULT_LIQUID.roughness,
      min: 0,
      max: 0.8,
      step: 0.005,
    },
    envMapIntensity: {
      value: DEFAULT_LIQUID.envMapIntensity,
      min: 0,
      max: 4,
      step: 0.05,
    },
    opacity: { value: DEFAULT_LIQUID.opacity, min: 0.2, max: 1, step: 0.01 },
    fillLevel: { value: 0.9, min: 0, max: 1, step: 0.005 },
    useFillSlider: false,
  });

  const particulate = useControls("Particulate", {
    enabled: DEFAULT_PARTICULATE.enabled,
    count: { value: DEFAULT_PARTICULATE.count, min: 0, max: 900, step: 10 },
    size: {
      value: DEFAULT_PARTICULATE.size,
      min: 0.002,
      max: 0.04,
      step: 0.0005,
    },
    drift: { value: DEFAULT_PARTICULATE.drift, min: 0, max: 2, step: 0.01 },
    settle: { value: DEFAULT_PARTICULATE.settle, min: 0, max: 1, step: 0.01 },
    dillColor: DEFAULT_PARTICULATE.dillColor as string,
    peppercornColor: DEFAULT_PARTICULATE.peppercornColor as string,
    mustardColor: DEFAULT_PARTICULATE.mustardColor as string,
  });

  const label = useControls("Label", {
    enabled: DEFAULT_LABEL.enabled,
    textureUrl: DEFAULT_LABEL.textureUrl ?? "",
    start: { value: DEFAULT_LABEL.start, min: 0, max: 0.9, step: 0.005 },
    end: { value: DEFAULT_LABEL.end, min: 0.05, max: 0.95, step: 0.005 },
    paperColor: DEFAULT_LABEL.paperColor as string,
    roughness: { value: DEFAULT_LABEL.roughness, min: 0, max: 1, step: 0.01 },
    offset: { value: DEFAULT_LABEL.offset, min: 0, max: 0.01, step: 0.0001 },
    rotation: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01 },
    repeat: { value: 1, min: 1, max: 4, step: 1 },
    opacity: { value: 1, min: 0, max: 1, step: 0.01 },
  });

  const cap = useControls("Cap", {
    enabled: DEFAULT_CAP.enabled,
    color: DEFAULT_CAP.color as string,
    metalness: { value: DEFAULT_CAP.metalness, min: 0, max: 1, step: 0.01 },
    roughness: { value: DEFAULT_CAP.roughness, min: 0, max: 1, step: 0.01 },
    knurlCount: { value: DEFAULT_CAP.knurlCount, min: 0, max: 200, step: 1 },
    knurlDepth: {
      value: DEFAULT_CAP.knurlDepth,
      min: 0,
      max: 0.5,
      step: 0.005,
    },
    liftDistance: {
      value: DEFAULT_CAP.liftDistance,
      min: 0,
      max: 0.6,
      step: 0.005,
    },
  });

  const pour = useControls("Pour", {
    maxTiltDeg: { value: DEFAULT_POUR.maxTiltDeg, min: 0, max: 140, step: 1 },
    headingRad: {
      value: DEFAULT_POUR.headingRad,
      min: -Math.PI,
      max: Math.PI,
      step: 0.01,
    },
    tiltInStart: { value: DEFAULT_POUR.tiltIn[0], min: 0, max: 1, step: 0.01 },
    tiltInEnd: { value: DEFAULT_POUR.tiltIn[1], min: 0, max: 1, step: 0.01 },
    tiltOutStart: {
      value: DEFAULT_POUR.tiltOut[0],
      min: 0,
      max: 1,
      step: 0.01,
    },
    tiltOutEnd: { value: DEFAULT_POUR.tiltOut[1], min: 0, max: 1, step: 0.01 },
    drainStart: { value: DEFAULT_POUR.drain[0], min: 0, max: 1, step: 0.01 },
    drainEnd: { value: DEFAULT_POUR.drain[1], min: 0, max: 1, step: 0.01 },
    fillFrom: { value: DEFAULT_POUR.fillRange[0], min: 0, max: 1, step: 0.01 },
    fillTo: { value: DEFAULT_POUR.fillRange[1], min: 0, max: 1, step: 0.01 },
    streamRadius: {
      value: DEFAULT_POUR.streamRadius,
      min: 0.002,
      max: 0.05,
      step: 0.0005,
    },
    gravity: { value: DEFAULT_POUR.gravity, min: 0.5, max: 12, step: 0.1 },
    streamLength: {
      value: DEFAULT_POUR.streamLength,
      min: 0.2,
      max: 4,
      step: 0.05,
    },
    streamWobble: {
      value: DEFAULT_POUR.streamWobble,
      min: 0,
      max: 2,
      step: 0.01,
    },
    streamBreakup: {
      value: DEFAULT_POUR.streamBreakup,
      min: 0,
      max: 1,
      step: 0.01,
    },
    pool: DEFAULT_POUR.pool,
    poolY: { value: DEFAULT_POUR.poolY, min: -1, max: 1, step: 0.002 },
    poolRadius: {
      value: DEFAULT_POUR.poolRadius,
      min: 0.02,
      max: 1,
      step: 0.005,
    },
  });

  const studio = useControls("Studio", {
    intensity: { value: DEFAULT_STUDIO.intensity, min: 0, max: 4, step: 0.02 },
    keyColor: DEFAULT_STUDIO.keyColor as string,
    keyIntensity: {
      value: DEFAULT_STUDIO.keyIntensity,
      min: 0,
      max: 20,
      step: 0.1,
    },
    keyPosition: DEFAULT_STUDIO.keyPosition,
    keyScale: { value: DEFAULT_STUDIO.keyScale as [number, number] },
    fillColor: DEFAULT_STUDIO.fillColor as string,
    fillIntensity: {
      value: DEFAULT_STUDIO.fillIntensity,
      min: 0,
      max: 20,
      step: 0.1,
    },
    fillPosition: DEFAULT_STUDIO.fillPosition,
    fillScale: { value: DEFAULT_STUDIO.fillScale as [number, number] },
    topColor: DEFAULT_STUDIO.topColor as string,
    topIntensity: {
      value: DEFAULT_STUDIO.topIntensity,
      min: 0,
      max: 20,
      step: 0.1,
    },
    rimColor: DEFAULT_STUDIO.rimColor as string,
    rimIntensity: {
      value: DEFAULT_STUDIO.rimIntensity,
      min: 0,
      max: 20,
      step: 0.1,
    },
    rimPosition: DEFAULT_STUDIO.rimPosition,
    ambientColor: DEFAULT_STUDIO.ambientColor as string,
    hdri: true,
  });

  const backdrop = useControls("Backdrop", {
    enabled: DEFAULT_BACKDROP.enabled,
    topColor: DEFAULT_BACKDROP.topColor as string,
    bottomColor: DEFAULT_BACKDROP.bottomColor as string,
    floorColor: DEFAULT_BACKDROP.floorColor as string,
    shadowOpacity: {
      value: DEFAULT_BACKDROP.shadowOpacity,
      min: 0,
      max: 1,
      step: 0.01,
    },
    shadowBlur: {
      value: DEFAULT_BACKDROP.shadowBlur,
      min: 0.1,
      max: 8,
      step: 0.05,
    },
    causticIntensity: {
      value: DEFAULT_BACKDROP.causticIntensity,
      min: 0,
      max: 3,
      step: 0.02,
    },
    causticScale: {
      value: DEFAULT_BACKDROP.causticScale,
      min: 0.5,
      max: 10,
      step: 0.1,
    },
  });

  useControls({
    "Copy settings to clipboard": button(() => {
      const payload = {
        glass,
        liquid,
        particulate,
        label,
        cap,
        pour,
        studio,
        backdrop,
      };
      void navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
    }),
  });

  const onSample = useCallback((s: Sample) => setSample(s), []);

  const glassProps = useMemo(() => ({ ...glass }), [glass]);
  const liquidProps = useMemo(
    () => ({
      deepColor: liquid.deepColor,
      shallowColor: liquid.shallowColor,
      cloudColor: liquid.cloudColor,
      scatterColor: liquid.scatterColor,
      cloudiness: liquid.cloudiness,
      cloudScale: liquid.cloudScale,
      cloudSpeed: liquid.cloudSpeed,
      absorption: liquid.absorption,
      scatterStrength: liquid.scatterStrength,
      meniscusHeight: liquid.meniscusHeight,
      meniscusWidth: liquid.meniscusWidth,
      rippleAmplitude: liquid.rippleAmplitude,
      rippleScale: liquid.rippleScale,
      rippleSpeed: liquid.rippleSpeed,
      viscosity: liquid.viscosity,
      roughness: liquid.roughness,
      envMapIntensity: liquid.envMapIntensity,
      opacity: liquid.opacity,
    }),
    [liquid],
  );
  const particulateProps = useMemo(() => ({ ...particulate }), [particulate]);
  const labelProps = useMemo(
    () => ({ ...label, textureUrl: label.textureUrl || undefined }),
    [label],
  );
  const capProps = useMemo(() => ({ ...cap }), [cap]);
  const pourProps = useMemo(
    () => ({
      tiltIn: [pour.tiltInStart, pour.tiltInEnd] as [number, number],
      tiltOut: [pour.tiltOutStart, pour.tiltOutEnd] as [number, number],
      drain: [pour.drainStart, pour.drainEnd] as [number, number],
      fillRange: [pour.fillFrom, pour.fillTo] as [number, number],
      maxTiltDeg: pour.maxTiltDeg,
      headingRad: pour.headingRad,
      streamRadius: pour.streamRadius,
      gravity: pour.gravity,
      streamLength: pour.streamLength,
      streamWobble: pour.streamWobble,
      streamBreakup: pour.streamBreakup,
      pool: pour.pool,
      poolY: pour.poolY,
      poolRadius: pour.poolRadius,
    }),
    [pour],
  );
  const studioProps = useMemo(
    () => ({
      intensity: studio.intensity,
      keyColor: studio.keyColor,
      keyIntensity: studio.keyIntensity,
      keyPosition: studio.keyPosition as [number, number, number],
      keyScale: studio.keyScale as [number, number],
      fillColor: studio.fillColor,
      fillIntensity: studio.fillIntensity,
      fillPosition: studio.fillPosition as [number, number, number],
      fillScale: studio.fillScale as [number, number],
      topColor: studio.topColor,
      topIntensity: studio.topIntensity,
      rimColor: studio.rimColor,
      rimIntensity: studio.rimIntensity,
      rimPosition: studio.rimPosition as [number, number, number],
      ambientColor: studio.ambientColor,
      hdriUrl: studio.hdri ? DEFAULT_STUDIO.hdriUrl : undefined,
    }),
    [studio],
  );
  const backdropProps = useMemo(() => ({ ...backdrop }), [backdrop]);

  const effectiveProgress = scene.usePourSlider ? scene.pourProgress : progress;

  useEffect(() => {
    setManual(scene.usePourSlider ? scene.pourProgress : null);
  }, [scene.usePourSlider, scene.pourProgress]);

  return (
    <div
      style={{
        background: "#08090a",
        color: "#e9e6df",
        minHeight: "100dvh",
        overflowX: "hidden",
      }}
    >
      <Leva collapsed hidden={!panelOpen} titleBar={{ title: "Bottle" }} />

      <header
        style={{
          position: "fixed",
          insetInline: 0,
          top: 0,
          zIndex: 30,
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.65rem clamp(0.75rem, 3vw, 1.5rem)",
          background: "linear-gradient(#08090acc, #08090a00)",
          fontSize: "0.7rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        <span style={{ opacity: 0.72 }}>Bottle lab</span>
        <span
          style={{
            display: "flex",
            gap: "0.9rem",
            opacity: 0.55,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <span data-testid="fps">{sample.fps.toFixed(0)} fps</span>
          <span data-testid="tier">{device ? device.tier : "—"}</span>
          <span data-testid="dpr">dpr {sample.dpr.toFixed(2)}</span>
          <span data-testid="calls">{sample.calls} calls</span>
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            style={{
              pointerEvents: "auto",
              border: "1px solid #ffffff2e",
              background: "transparent",
              color: "inherit",
              font: "inherit",
              letterSpacing: "inherit",
              textTransform: "inherit",
              padding: "0.25rem 0.6rem",
              borderRadius: "999px",
              cursor: "pointer",
            }}
          >
            {panelOpen ? "Hide controls" : "Controls"}
          </button>
        </span>
      </header>

      {/* A tall track with a pinned canvas: the pour is scrubbed by scroll,
          which is how the hero will drive it and the only way to see whether
          it survives touch momentum. */}
      <div ref={trackRef} style={{ height: "340vh", position: "relative" }}>
        <div
          style={{
            position: "sticky",
            top: 0,
            height: "100svh",
            width: "100%",
          }}
        >
          <BottleScene
            key={scene.forceTier}
            pourProgress={effectiveProgress}
            forceTier={
              scene.forceTier === "auto"
                ? undefined
                : (scene.forceTier as QualityTier)
            }
            exposure={scene.exposure}
            cameraFov={scene.cameraFov}
            cameraDistance={scene.cameraDistance}
            cameraHeight={scene.cameraHeight}
            cameraOffset={scene.cameraOffset}
            idleMotion={scene.idleMotion}
            autoRotate={scene.autoRotate}
            rotation={scene.rotation}
            pointerParallax={scene.pointerParallax}
            parallaxMode={
              scene.parallaxMode as
                "auto" | "pointer" | "orientation" | "drift" | "off"
            }
            progressSmoothing={scene.progressSmoothing}
            interactive={scene.interactive}
            paused={scene.paused}
            fillLevel={liquid.useFillSlider ? liquid.fillLevel : undefined}
            glass={glassProps}
            liquid={liquidProps}
            particulate={particulateProps}
            label={labelProps}
            cap={capProps}
            pour={pourProps}
            studio={studioProps}
            backdrop={backdropProps}
          >
            <FpsProbe onSample={onSample} />
          </BottleScene>

          <div
            style={{
              position: "absolute",
              insetInline: 0,
              bottom: "clamp(1rem, 4vh, 2.5rem)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0 clamp(1rem, 6vw, 3rem)",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontSize: "0.65rem",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                opacity: 0.45,
              }}
            >
              Pour {(effectiveProgress * 100).toFixed(0)}%
            </div>
            <div
              aria-hidden
              style={{
                width: "min(30rem, 100%)",
                height: 2,
                background: "#ffffff1f",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                data-testid="progress-bar"
                style={{
                  width: `${effectiveProgress * 100}%`,
                  height: "100%",
                  background: "#d8d387",
                }}
              />
            </div>
            <div
              style={{
                fontSize: "0.62rem",
                opacity: 0.32,
                textAlign: "center",
              }}
            >
              Scroll to scrub &middot; toggle <em>usePourSlider</em> in the
              panel to scrub by hand
            </div>
          </div>
        </div>
      </div>

      <section
        style={{
          maxWidth: "46rem",
          margin: "0 auto",
          padding: "clamp(3rem, 10vw, 7rem) clamp(1.25rem, 6vw, 2rem) 6rem",
          fontSize: "0.9rem",
          lineHeight: 1.7,
          opacity: 0.72,
        }}
      >
        <h1
          style={{
            fontSize: "1.1rem",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            marginBottom: "1.5rem",
          }}
        >
          Bottle lab
        </h1>
        <p style={{ marginBottom: "1rem" }}>
          Internal tuning surface for the reusable bottle system. Every material
          parameter, light and pour timing is exposed in the control panel and
          nothing is hardcoded in a shader — brand colours and the label artwork
          drop in through props.
        </p>
        <p style={{ marginBottom: "1rem" }}>
          The pour is a single normalised 0&ndash;1 value. Here it is driven by
          scroll position over the track above; a page can drive it from
          anything. Quality tier is detected from the device and steps down on
          its own if frames slip.
        </p>
        <p style={{ opacity: 0.6 }}>
          Detected:{" "}
          {device
            ? `${device.tier} — ${device.reason}, ${device.cores} cores, dpr ${device.dpr}`
            : "…"}
        </p>
      </section>
    </div>
  );
}
