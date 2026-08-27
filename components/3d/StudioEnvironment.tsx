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
import {
  createCausticMaterial,
  createFloorMaterial,
  createSweepMaterial,
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
function Rig({
  studio,
  resolution,
}: {
  studio: StudioParams;
  resolution: number;
}) {
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
      />
      {/* Overhead diffusion. */}
      <Lightformer
        form="rect"
        intensity={studio.topIntensity}
        color={studio.topColor as string}
        position={[0, 3.2, 0.4]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[3.5, 3.5]}
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

  const sweep = useMemo(
    () =>
      createSweepMaterial(
        backdrop.topColor as string,
        backdrop.bottomColor as string,
      ),
    [backdrop.topColor, backdrop.bottomColor],
  );
  const floor = useMemo(
    () =>
      createFloorMaterial(
        backdrop.floorColor as string,
        backdrop.bottomColor as string,
        height * 2.2,
        height * 9,
      ),
    [backdrop.floorColor, backdrop.bottomColor, height],
  );
  useEffect(() => () => floor.dispose(), [floor]);

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
        intensity={0.85}
        color={studio.keyColor as string}
      />

      {backdrop.enabled ? (
        <>
          <mesh material={sweep} renderOrder={-10}>
            <sphereGeometry args={[height * 26, 32, 24]} />
          </mesh>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0, 0]}
            material={floor}
            renderOrder={-9}
          >
            <circleGeometry args={[height * 16, 96]} />
          </mesh>
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
