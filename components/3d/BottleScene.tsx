"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  AdaptiveDpr,
  AdaptiveEvents,
  OrbitControls,
  PerformanceMonitor,
} from "@react-three/drei";
import { BottleModel } from "./BottleModel";
import { StudioEnvironment } from "./StudioEnvironment";
import { DEFAULT_LIQUID, DEFAULT_STUDIO, TIER_SETTINGS } from "./defaults";
import { useQualityTier } from "./lib/quality";
import type { BottleSceneProps } from "./types";

/**
 * Frames the bottle to whatever viewport it lands in.
 *
 * A fixed camera distance is how 3D heroes end up cropped on a phone and
 * marooned in the middle of a desktop monitor. This solves for the distance
 * that fits the subject at the current aspect ratio, every resize.
 */
function FramingCamera({
  height,
  distance,
  offset,
  lift,
  fov,
}: {
  height: number;
  distance: number;
  offset: number;
  lift: number;
  fov: number;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const vFov = THREE.MathUtils.degToRad(fov);
    // Fit the full bottle plus headroom vertically, and its widest point
    // horizontally, then take whichever needs more room.
    const fitV = (height * 1.42) / 2 / Math.tan(vFov / 2);
    const fitH =
      (height * 0.46) / 2 / (Math.tan(vFov / 2) * Math.max(aspect, 0.2));
    const d = Math.max(fitV, fitH) * distance;
    camera.fov = fov;
    camera.position.set(offset * height, height * 0.5 + lift * height, d);
    camera.near = d * 0.05;
    camera.far = d * 24;
    camera.lookAt(0, height * 0.48, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, height, distance, offset, lift, fov]);
  return null;
}

function Ready({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (!done.current) {
      done.current = true;
      onReady?.();
    }
  });
  return null;
}

function RendererSetup({
  exposure,
  scale,
}: {
  exposure: number;
  scale: number;
}) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    // Three renders a full-screen pass for every transmissive draw. On the
    // cheaper tiers that pass runs at a fraction of the canvas, which is the
    // single biggest lever on mobile frame time in this scene.
    (
      gl as THREE.WebGLRenderer & { transmissionResolutionScale: number }
    ).transmissionResolutionScale = scale;
  }, [gl, exposure, scale]);
  return null;
}

export function BottleScene({
  studio,
  backdrop,
  cameraDistance = 1,
  cameraHeight = 0.16,
  cameraOffset = 0.34,
  cameraFov = 26,
  exposure = 1.05,
  forceTier,
  maxDpr,
  className,
  style,
  interactive = false,
  onReady,
  children,
  height = 1,
  ...model
}: BottleSceneProps) {
  const { tier, decline, incline } = useQualityTier(forceTier);
  const q = TIER_SETTINGS[tier];
  const dprCap = Math.min(maxDpr ?? q.maxDpr, q.maxDpr);
  const setDpr = useRef<((dpr: number) => void) | null>(null);

  const liquidTint = new THREE.Color(
    (model.liquid?.shallowColor ?? DEFAULT_LIQUID.shallowColor) as string,
  );
  const rim = studio?.rimPosition ?? DEFAULT_STUDIO.rimPosition;

  const onChange = useCallback(
    ({ factor }: { factor: number }) => {
      setDpr.current?.(
        Math.max(0.75, THREE.MathUtils.lerp(0.75, dprCap, factor)),
      );
    },
    [dprCap],
  );

  return (
    <div
      className={className}
      // The canvas is the classic source of horizontal overflow: it is a
      // replaced element that will happily exceed its column.
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: interactive ? "none" : "pan-y",
        ...style,
      }}
    >
      <Canvas
        style={{ width: "100%", height: "100%", display: "block" }}
        dpr={[1, dprCap]}
        gl={{
          antialias: tier !== "low",
          alpha: true,
          powerPreference: "high-performance",
          stencil: false,
          depth: true,
        }}
        camera={{ fov: cameraFov, position: [0, height * 0.5, height * 3] }}
        eventPrefix="client"
      >
        <RendererSetup
          exposure={exposure}
          scale={q.transmissionResolutionScale}
        />
        <FramingCamera
          height={height}
          distance={cameraDistance}
          offset={cameraOffset}
          lift={cameraHeight}
          fov={cameraFov}
        />
        <DprBridge onMount={(fn) => (setDpr.current = fn)} />
        <PerformanceMonitor
          ms={220}
          iterations={6}
          // Below ~50fps on the target device, step down rather than limp on.
          bounds={(refresh) => (refresh > 90 ? [55, 500] : [48, 500])}
          flipflops={3}
          onDecline={decline}
          onIncline={incline}
          onChange={onChange}
          onFallback={decline}
        />
        <AdaptiveDpr />
        <AdaptiveEvents />
        <Suspense fallback={null}>
          <StudioEnvironment
            studio={studio}
            backdrop={backdrop}
            tier={tier}
            height={height}
            liquidTint={liquidTint}
          />
          <BottleModel
            {...model}
            height={height}
            tier={tier}
            keyDirection={rim}
          />
        </Suspense>
        {interactive ? (
          <OrbitControls
            makeDefault
            enablePan={false}
            enableZoom={false}
            minPolarAngle={Math.PI * 0.22}
            maxPolarAngle={Math.PI * 0.62}
            target={[0, height * 0.48, 0]}
            rotateSpeed={0.55}
            enableDamping
            dampingFactor={0.08}
          />
        ) : null}
        <Ready onReady={onReady} />
        {children}
      </Canvas>
    </div>
  );
}

function DprBridge({
  onMount,
}: {
  onMount: (fn: (dpr: number) => void) => void;
}) {
  const set = useThree((s) => s.setDpr);
  useEffect(() => {
    onMount(set);
  }, [set, onMount]);
  return null;
}
