"use client";

import { Component, type ReactNode, useEffect, useMemo } from "react";
import * as THREE from "three";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  DEFAULT_BACKDROP,
  DEFAULT_LIQUID,
  DEFAULT_STUDIO,
  TIER_SETTINGS,
} from "./defaults";
import { buildCycloramaGeometry } from "./lib/geometry";
import {
  createCausticMaterial,
  createCycloramaMaterial,
  createStripLightMaterial,
} from "./materials/backdrop";
import type { BackdropParams, QualityTier, StudioParams } from "./types";

class EnvBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Studio.
 *
 * Glass has no colour of its own worth speaking of — everything you read as
 * "expensive glass" is the shape of the light it is reflecting. So the rig is
 * built the way a product photographer builds one: two tall strip softboxes
 * running the full height of the bottle to draw its edges, a broad overhead
 * source, and a warm source directly behind to push light through the brine.
 * The HDRI underneath supplies the room; the strips supply the edges.
 */
/**
 * Soft-edged softbox gradient.
 *
 * A flat emissive rectangle reflects in glass as a flat rectangle with hard
 * corners, and hard-edged highlights are the loudest CG tell there is. Real
 * softboxes fall off toward their edges, so the highlight running down the
 * bottle has a gradient in it. One small canvas buys that.
 */
function useSoftboxTexture() {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 256;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const u = (x + 0.5) / c.width - 0.5;
        const v = (y + 0.5) / c.height - 0.5;
        // Wide, gentle falloff across the strip; a harder shoulder along it,
        // so the highlight has ends without looking clipped.
        const a = Math.pow(
          Math.max(0, 1 - Math.pow(Math.abs(u) * 2, 2.4)),
          1.1,
        );
        const b = Math.pow(
          Math.max(0, 1 - Math.pow(Math.abs(v) * 2, 5.5)),
          0.8,
        );
        const k = Math.round(255 * a * b);
        const i = (y * c.width + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = k;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

function Rig({
  studio,
  resolution,
}: {
  studio: StudioParams;
  resolution: number;
}) {
  const soft = useSoftboxTexture();
  const lights = (
    <>
      {/* Key: tall and narrow, just off-axis. This is the highlight that runs
          down the shoulder and defines the silhouette. */}
      <Lightformer
        form="rect"
        intensity={studio.keyIntensity}
        color={studio.keyColor as string}
        position={studio.keyPosition}
        rotation={[0, Math.PI / 2, 0]}
        scale={studio.keyScale}
        target={[0, 0.45, 0]}
        map={soft ?? undefined}
        toneMapped={false}
      />
      {/* Fill: cooler, wider, softer — separates the far edge from the set
          without flattening the form. */}
      <Lightformer
        form="rect"
        intensity={studio.fillIntensity}
        color={studio.fillColor as string}
        position={studio.fillPosition}
        rotation={[0, -Math.PI / 2, 0]}
        scale={studio.fillScale}
        target={[0, 0.45, 0]}
        map={soft ?? undefined}
        toneMapped={false}
      />
      {/* Overhead diffusion. */}
      <Lightformer
        form="rect"
        intensity={studio.topIntensity}
        color={studio.topColor as string}
        position={[0, 3.2, 0.4]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[3.5, 3.5]}
        map={soft ?? undefined}
        toneMapped={false}
      />
      {/* Backlight. Everything that makes the brine glow rather than
          silhouette comes from this one. */}
      <Lightformer
        form="circle"
        intensity={studio.rimIntensity}
        color={studio.rimColor as string}
        position={studio.rimPosition}
        rotation={[0, Math.PI, 0]}
        scale={[1.6, 1.6]}
        target={[0, 0.4, 0]}
      />
      {/* A faint ring low down: the reflection of the tabletop in the heel. */}
      <Lightformer
        form="ring"
        intensity={studio.rimIntensity * 0.25}
        color={studio.keyColor as string}
        position={[0, -1.4, 1.2]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[2.4, 2.4]}
      />
    </>
  );

  return (
    <EnvBoundary
      fallback={
        <Environment
          resolution={resolution}
          frames={1}
          environmentIntensity={studio.intensity}
        >
          <mesh scale={80}>
            <sphereGeometry args={[1, 12, 12]} />
            <meshBasicMaterial
              color={studio.ambientColor as string}
              side={THREE.BackSide}
            />
          </mesh>
          {lights}
        </Environment>
      }
    >
      <Environment
        resolution={resolution}
        frames={1}
        files={studio.hdriUrl}
        environmentIntensity={studio.intensity}
      >
        {lights}
      </Environment>
    </EnvBoundary>
  );
}

function Caustic({
  backdrop,
  tint,
  y,
  radius,
}: {
  backdrop: BackdropParams;
  tint: THREE.Color;
  y: number;
  radius: number;
}) {
  const mat = useMemo(
    () =>
      createCausticMaterial(
        tint.clone(),
        backdrop.causticIntensity,
        backdrop.causticScale,
      ),
    [tint, backdrop.causticIntensity, backdrop.causticScale],
  );
  useFrame((_, dt) => {
    (mat.uniforms.uTime as THREE.IUniform).value += dt;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} material={mat}>
      <planeGeometry args={[radius * 2, radius * 2]} />
    </mesh>
  );
}

export function StudioEnvironment({
  studio: studioIn,
  backdrop: backdropIn,
  tier,
  height = 1,
  liquidTint,
}: {
  studio?: Partial<StudioParams>;
  backdrop?: Partial<BackdropParams>;
  tier: QualityTier;
  height?: number;
  liquidTint?: THREE.Color;
}) {
  const studio = useMemo(
    () => ({ ...DEFAULT_STUDIO, ...studioIn }),
    [studioIn],
  );
  const backdrop = useMemo(
    () => ({ ...DEFAULT_BACKDROP, ...backdropIn }),
    [backdropIn],
  );
  const q = TIER_SETTINGS[tier];

  // One continuous sweep: floor, cove and wall, with the strip softboxes and
  // the backlight pool painted into it. It is deliberately near enough to the
  // subject to matter — a screen-space refraction can only bend what is
  // actually on screen behind the bottle, so a backdrop that is a long way off
  // and featureless gives the glass nothing to prove itself with.
  const cycGeo = useMemo(
    () =>
      buildCycloramaGeometry(
        height * 9,
        height * 3.2,
        height * 5.2,
        height * 1.35,
        tier === "low" ? 48 : 96,
        tier === "low" ? 36 : 72,
      ),
    [height, tier],
  );
  useEffect(() => () => cycGeo.dispose(), [cycGeo]);

  const cyc = useMemo(
    () =>
      createCycloramaMaterial(
        backdrop.floorColor as string,
        backdrop.bottomColor as string,
        backdrop.topColor as string,
        backdrop.lightColor as string,
        backdrop.lightIntensity,
        backdrop.lightSpread,
        height,
      ),
    [
      backdrop.floorColor,
      backdrop.bottomColor,
      backdrop.topColor,
      backdrop.lightColor,
      backdrop.lightIntensity,
      backdrop.lightSpread,
      height,
    ],
  );
  useEffect(() => () => cyc.dispose(), [cyc]);

  const strip = useMemo(
    () =>
      createStripLightMaterial(
        backdrop.lightColor as string,
        backdrop.lightIntensity * 5.2,
      ),
    [backdrop.lightColor, backdrop.lightIntensity],
  );
  useEffect(() => () => strip.dispose(), [strip]);

  const tint = useMemo(
    () => liquidTint ?? new THREE.Color(DEFAULT_LIQUID.shallowColor as string),
    [liquidTint],
  );

  return (
    <>
      <Rig studio={studio} resolution={q.envResolution} />
      {/* One punctual light only: enough to put a hard specular on the metal
          closure and give the suspended spice a direction. The rest is IBL. */}
      <directionalLight
        position={[
          studio.keyPosition[0] * 2,
          studio.keyPosition[1] * 2 + 2,
          studio.keyPosition[2] * 2,
        ]}
        intensity={0.45}
        color={studio.keyColor as string}
      />

      {backdrop.enabled ? (
        <>
          <mesh geometry={cycGeo} material={cyc} renderOrder={-10} />

          {/* The two transmitted strips. Their x is inside the bottle's own
              silhouette on purpose: from the camera they are completely
              hidden, and the only place they are ever seen is through the
              glass, gathered into the vertical core down the shoulder. */}
          {[-1, 1].map((sign) => (
            <mesh
              key={sign}
              material={strip}
              // Kept close in z as well as in x. Further back and the
              // camera's own off-axis offset slides them sideways out from
              // behind the bottle, which is how a hidden light becomes a
              // white rectangle standing in the frame.
              position={[
                sign * height * backdrop.lightSpread * 0.088,
                height * 0.34,
                -height * 0.22,
              ]}
              renderOrder={-8}
            >
              <planeGeometry args={[height * 0.07, height * 0.6]} />
            </mesh>
          ))}
          {q.contactShadows ? (
            <ContactShadows
              position={[0, height * 0.0015, 0]}
              scale={height * 4}
              blur={backdrop.shadowBlur}
              opacity={backdrop.shadowOpacity}
              far={height * 1.4}
              resolution={tier === "high" ? 512 : 256}
              frames={Infinity}
            />
          ) : null}
          {q.caustics && backdrop.causticIntensity > 0 ? (
            <Caustic
              backdrop={backdrop}
              tint={tint}
              y={height * 0.003}
              radius={height * 0.85}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
