"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { MeshTransmissionMaterial } from "@react-three/drei";
import {
  DEFAULT_CAP,
  DEFAULT_GLASS,
  DEFAULT_LABEL,
  DEFAULT_LIQUID,
  DEFAULT_PARTICULATE,
  DEFAULT_POUR,
  TIER_SETTINGS,
} from "./defaults";
import {
  buildCapGeometry,
  buildGlassGeometry,
  buildLabelGeometry,
  buildLiquidGeometry,
  buildParticulate,
  buildStreamGeometry,
  buildSurfaceGeometry,
} from "./lib/geometry";
import { buildBottleProfile } from "./lib/profile";
import { useParallax } from "./lib/parallax";
import { createCapMaterial, createCheapGlassMaterial } from "./materials/glass";
import { createPoolMaterial } from "./materials/backdrop";
import {
  createLiquidMaterial,
  createLiquidUniforms,
  syncLiquidUniforms,
} from "./materials/liquid";
import {
  createParticulateMaterial,
  createParticulateUniforms,
  syncParticulateUniforms,
} from "./materials/particulate";
import { createStreamMaterial, createStreamUniforms } from "./materials/stream";
import type { BottleModelProps } from "./types";

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const DIR = new THREE.Vector3();
const VEL = new THREE.Vector3();
const SCRATCH = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

function ramp(p: number, [a, b]: [number, number]) {
  if (b <= a) return p >= b ? 1 : 0;
  return THREE.MathUtils.clamp((p - a) / (b - a), 0, 1);
}
const ease = (t: number) => t * t * (3 - 2 * t);

function useOptionalTexture(url: string | undefined, repeat: number) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) {
      setTex(null);
      return;
    }
    let dead = false;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (dead) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.anisotropy = 8;
        t.repeat.set(repeat, 1);
        loaded = t;
        setTex(t);
      },
      undefined,
      () => setTex(null),
    );
    return () => {
      dead = true;
      loaded?.dispose();
    };
  }, [url, repeat]);
  return tex;
}

export function BottleModel({
  height = 1,
  radiusRatio,
  fillLevel,
  pourProgress = 0,
  idleMotion = 1,
  autoRotate = 0,
  rotation = 0,
  position = [0, 0, 0],
  tier = "high",
  paused = false,
  pointerParallax = 0.09,
  parallaxMode = "auto",
  progressSmoothing = 0.14,
  keyDirection,
  glass: glassIn,
  liquid: liquidIn,
  particulate: particulateIn,
  label: labelIn,
  cap: capIn,
  pour: pourIn,
}: BottleModelProps) {
  const glass = useMemo(() => ({ ...DEFAULT_GLASS, ...glassIn }), [glassIn]);
  const liquid = useMemo(
    () => ({ ...DEFAULT_LIQUID, ...liquidIn }),
    [liquidIn],
  );
  const particulate = useMemo(
    () => ({ ...DEFAULT_PARTICULATE, ...particulateIn }),
    [particulateIn],
  );
  const label = useMemo(() => ({ ...DEFAULT_LABEL, ...labelIn }), [labelIn]);
  const cap = useMemo(() => ({ ...DEFAULT_CAP, ...capIn }), [capIn]);
  const pour = useMemo(() => ({ ...DEFAULT_POUR, ...pourIn }), [pourIn]);
  const q = TIER_SETTINGS[tier];

  const profile = useMemo(
    () => buildBottleProfile(height, radiusRatio),
    [height, radiusRatio],
  );
  useEffect(() => () => profile.dispose(), [profile]);

  const geo = useMemo(() => {
    const surfaceRadius = profile.interiorRadius * 3.4;
    return {
      glass: buildGlassGeometry(profile, q.latheSegments),
      liquid: buildLiquidGeometry(profile, q.latheSegments),
      surface: buildSurfaceGeometry(
        surfaceRadius,
        q.surfaceRings,
        q.surfaceSegments,
      ),
      cap: buildCapGeometry(profile, Math.max(48, q.latheSegments)),
      stream: buildStreamGeometry(q.streamSegments),
    };
  }, [
    profile,
    q.latheSegments,
    q.surfaceRings,
    q.surfaceSegments,
    q.streamSegments,
  ]);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);

  const labelGeo = useMemo(
    () =>
      buildLabelGeometry(
        profile,
        profile.height * label.start,
        profile.height * label.end,
        profile.height * label.offset,
        Math.max(64, q.latheSegments),
      ),
    [profile, label.start, label.end, label.offset, q.latheSegments],
  );
  useEffect(() => () => labelGeo.dispose(), [labelGeo]);

  const liquidU = useMemo(
    () => createLiquidUniforms(profile, liquid),
    [profile],
  );
  useEffect(
    () => syncLiquidUniforms(liquidU, profile, liquid),
    [liquidU, profile, liquid],
  );

  const bodyMat = useMemo(
    () => createLiquidMaterial("body", liquidU, liquid, tier),
    [liquidU, tier],
  );
  const surfaceMat = useMemo(
    () => createLiquidMaterial("surface", liquidU, liquid, tier),
    [liquidU, tier],
  );
  useEffect(() => {
    for (const m of [bodyMat, surfaceMat]) {
      m.roughness = liquid.roughness;
      m.envMapIntensity = liquid.envMapIntensity;
      m.opacity = liquid.opacity;
      m.transparent = liquid.opacity < 0.999;
      m.depthWrite = liquid.opacity >= 0.999;
      m.needsUpdate = true;
    }
  }, [bodyMat, surfaceMat, liquid]);
  useEffect(
    () => () => [bodyMat, surfaceMat].forEach((m) => m.dispose()),
    [bodyMat, surfaceMat],
  );

  const partCount = Math.max(
    0,
    Math.round(particulate.count * q.particulateScale),
  );
  const parts = useMemo(
    () => buildParticulate(profile, partCount, particulate.settle),
    [profile, partCount, particulate.settle],
  );
  const partU = useMemo(
    () =>
      createParticulateUniforms(liquidU, particulate, profile.height * 0.075),
    [liquidU, profile],
  );
  useEffect(
    () => syncParticulateUniforms(partU, particulate),
    [partU, particulate],
  );
  const partMat = useMemo(
    () => createParticulateMaterial(partU, particulate),
    [partU],
  );
  const partGeo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const inst = new THREE.InstancedBufferGeometry();
    inst.index = g.index;
    inst.attributes = g.attributes;
    inst.instanceCount = parts.count;
    (
      inst as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number }
    )._maxInstanceCount = parts.count;
    inst.setAttribute(
      "aOffset",
      new THREE.InstancedBufferAttribute(parts.offsets, 3),
    );
    inst.setAttribute(
      "aShape",
      new THREE.InstancedBufferAttribute(parts.shapes, 3),
    );
    inst.setAttribute(
      "aSeed",
      new THREE.InstancedBufferAttribute(parts.seeds, 1),
    );
    inst.setAttribute(
      "aSpecies",
      new THREE.InstancedBufferAttribute(parts.species, 1),
    );
    inst.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, height * 0.4, 0),
      height,
    );
    return inst;
  }, [parts, height]);
  useEffect(() => () => partGeo.dispose(), [partGeo]);

  const streamU = useMemo(
    () => createStreamUniforms(liquidU, pour),
    [liquidU, pour],
  );
  const streamMat = useMemo(() => createStreamMaterial(streamU), [streamU]);
  useEffect(() => () => streamMat.dispose(), [streamMat]);

  const poolMat = useMemo(
    () =>
      createPoolMaterial(
        liquidU.uShallow!.value as THREE.Color,
        liquidU.uDeep!.value as THREE.Color,
        liquidU.uCloudColor!.value as THREE.Color,
      ),
    [liquidU],
  );
  useEffect(() => () => poolMat.dispose(), [poolMat]);

  const capMat = useMemo(
    () =>
      createCapMaterial(
        cap.color as string,
        cap.metalness,
        cap.roughness,
        cap.knurlCount,
        cap.knurlDepth,
        profile.radius,
        profile.height,
      ),
    [cap.knurlCount, profile],
  );
  useEffect(() => {
    capMat.color.set(cap.color as string);
    capMat.metalness = cap.metalness;
    capMat.roughness = cap.roughness;
    const u = capMat.userData.uniforms as
      Record<string, THREE.IUniform> | undefined;
    if (u) u.uKnurlDepth!.value = cap.knurlDepth * profile.radius * 0.14;
  }, [capMat, cap, profile]);
  useEffect(() => () => capMat.dispose(), [capMat]);

  const cheapGlass = useMemo(
    () => createCheapGlassMaterial(glass),
    [glass.color],
  );
  useEffect(() => {
    cheapGlass.color.set(glass.color as string);
    cheapGlass.roughness = glass.roughness;
    cheapGlass.ior = glass.ior;
    cheapGlass.envMapIntensity = glass.envMapIntensity * 1.35;
  }, [cheapGlass, glass]);
  useEffect(() => () => cheapGlass.dispose(), [cheapGlass]);

  const labelMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: DEFAULT_LABEL.roughness,
        metalness: 0,
        side: THREE.FrontSide,
      }),
    [],
  );
  useEffect(() => () => labelMat.dispose(), [labelMat]);

  const labelTex = useOptionalTexture(
    label.enabled ? label.textureUrl : undefined,
    label.repeat,
  );

  useEffect(() => {
    labelMat.color.set(label.paperColor as string);
    labelMat.roughness = label.roughness;
    labelMat.opacity = label.opacity;
    labelMat.transparent = label.opacity < 0.999;
    // Swapping a map in or out changes the compiled program, so the material
    // has to be told. This is why a late-loading label silently stays blank.
    if (labelMat.map !== labelTex) {
      labelMat.map = labelTex;
      labelMat.needsUpdate = true;
    }
  }, [labelMat, labelTex, label]);

  const rootRef = useRef<THREE.Group>(null);
  const bottleRef = useRef<THREE.Group>(null);
  const capRef = useRef<THREE.Group>(null);
  const surfaceRef = useRef<THREE.Mesh>(null);
  const streamRef = useRef<THREE.Mesh>(null);
  const poolRef = useRef<THREE.Mesh>(null);
  const labelRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (keyDirection) {
      (liquidU.uKeyDir!.value as THREE.Vector3)
        .set(...keyDirection)
        .normalize();
    }
  }, [liquidU, keyDirection]);

  const smoothed = useRef(pourProgress);
  const sampleParallax = useParallax(parallaxMode, pointerParallax > 0);
  const clockRef = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    if (!paused) clockRef.current += dt;
    const t = clockRef.current;
    liquidU.uTime!.value = t;
    streamU.uTime!.value = t;
    (poolMat.uniforms.uTime as THREE.IUniform).value = t;

    // Damp the incoming progress. Scroll-scrubbed values arrive in bursts on
    // touch — momentum, then rubber-band overscroll snapping back — and a
    // pour driven straight off raw scroll judders visibly on every one.
    const k =
      progressSmoothing <= 0 ? 1 : 1 - Math.exp(-dt / progressSmoothing);
    smoothed.current +=
      (THREE.MathUtils.clamp(pourProgress, 0, 1) - smoothed.current) * k;
    const p = smoothed.current;

    const tiltAmount =
      ease(ramp(p, pour.tiltIn)) * (1 - ease(ramp(p, pour.tiltOut)));
    const tilt = THREE.MathUtils.degToRad(pour.maxTiltDeg) * tiltAmount;
    const drain = ease(ramp(p, pour.drain));
    const fill =
      fillLevel != null
        ? THREE.MathUtils.clamp(fillLevel, 0, 1)
        : THREE.MathUtils.lerp(pour.fillRange[0], pour.fillRange[1], drain);
    const capOpen = ease(ramp(p, [0, 0.13]));

    const par = sampleParallax(t, dt);
    const breathe = paused ? 0 : idleMotion;

    const bottle = bottleRef.current;
    const root = rootRef.current;
    if (!bottle || !root) return;

    // Orientation is composed as quaternions rather than eulers: the pour
    // tilt is about a world axis set by the pour bearing, and stacking that
    // on top of a yaw with euler angles gimbals as soon as the bottle nears
    // horizontal.
    const yaw =
      rotation + (paused ? 0 : autoRotate * t) + par.x * pointerParallax * 1.6;
    bottle.quaternion.setFromAxisAngle(UP_AXIS, yaw);
    Q.setFromAxisAngle(
      V.set(Math.cos(pour.headingRad), 0, Math.sin(pour.headingRad)),
      -tilt,
    );
    bottle.quaternion.premultiply(Q);
    Q.setFromAxisAngle(
      X_AXIS,
      -par.y * pointerParallax * 0.55 + Math.sin(t * 0.42) * 0.006 * breathe,
    );
    bottle.quaternion.premultiply(Q);

    // Pivot about the bottle's middle, not its base. Rotating a group about
    // its origin swings the whole body through an arc, which reads as the set
    // moving rather than a hand tipping. The lift is deliberate: a real pour
    // rises as it tips.
    const pivot = height * 0.5;
    SCRATCH.set(0, pivot, 0).applyQuaternion(bottle.quaternion);
    bottle.position.set(
      -SCRATCH.x + tiltAmount * height * 0.05,
      pivot -
        SCRATCH.y +
        tiltAmount * height * 0.19 +
        Math.sin(t * 0.55) * height * 0.004 * breathe,
      -SCRATCH.z,
    );
    bottle.updateMatrixWorld(true);

    root.updateWorldMatrix(true, false);
    const rootY = root.matrixWorld.elements[13]!;

    // Liquid plane. The level is horizontal in world space whatever the
    // bottle is doing, so it is found from the world-space extent of the
    // cavity rather than from anything in bottle space.
    const e = bottle.matrixWorld.elements;
    const swing = Math.hypot(e[1]!, e[9]!);
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of profile.cavitySilhouette) {
      const base = e[5]! * s.y + e[13]!;
      const lo = base - s.x * swing;
      const hi = base + s.x * swing;
      if (lo < yMin) yMin = lo;
      if (hi > yMax) yMax = hi;
    }
    const surfaceY = yMin + Math.pow(fill, 0.82) * (yMax - yMin);
    liquidU.uSurfaceY!.value = surfaceY;
    M.copy(bottle.matrixWorld).invert();
    (liquidU.uInvBottleMatrix!.value as THREE.Matrix4).copy(M);

    // Lip. Find the lowest point of the rim analytically, which is where a
    // real bottle lets go.
    const theta = Math.atan2(-e[9]!, -e[1]!);
    const rLip = profile.lipInnerRadius;
    V.set(
      Math.cos(theta) * rLip,
      profile.lipY,
      Math.sin(theta) * rLip,
    ).applyMatrix4(bottle.matrixWorld);
    const lipY = V.y;
    const head = surfaceY - lipY;
    const flow = THREE.MathUtils.clamp(head / (height * 0.055), 0, 1);
    const flowEased = flow * flow * (3 - 2 * flow);

    // Outward direction at the lip, flattened: the stream leaves along the
    // pour bearing, not along the bottle axis.
    V2.set(Math.cos(theta) * rLip, 0, Math.sin(theta) * rLip).applyMatrix4(
      M.identity().extractRotation(bottle.matrixWorld),
    );
    V2.y = 0;
    if (V2.lengthSq() < 1e-8)
      V2.set(Math.cos(pour.headingRad), 0, Math.sin(pour.headingRad));
    V2.normalize();

    // Torricelli: exit speed comes from the head above the lip, so the pour
    // starts as a dribble, swells, and thins out again on its own.
    const speed =
      Math.sqrt(2 * pour.gravity * Math.max(head, 0)) * 0.9 + height * 0.12;
    DIR.copy(V2).setY(-0.62).normalize();
    VEL.copy(DIR).multiplyScalar(speed);

    const endY = pour.pool
      ? height * pour.poolY
      : V.y - height * pour.streamLength;
    const drop = Math.max(V.y - endY, height * 0.05);
    const flight =
      (VEL.y +
        Math.sqrt(Math.max(VEL.y * VEL.y + 2 * pour.gravity * drop, 0))) /
      pour.gravity;

    (streamU.uOrigin!.value as THREE.Vector3).copy(V);
    (streamU.uVelocity!.value as THREE.Vector3).copy(VEL);
    streamU.uSpeed0!.value = Math.max(speed, 1e-3);
    streamU.uGravity!.value = pour.gravity;
    streamU.uFlight!.value = flight;
    streamU.uRadius!.value = pour.streamRadius * height;
    streamU.uFlow!.value = flowEased;
    streamU.uWobble!.value = pour.streamWobble;
    streamU.uBreakup!.value =
      pour.streamBreakup *
      (1 - THREE.MathUtils.smoothstep(flowEased, 0.04, 0.4));
    liquidU.uAgitation!.value = 0.14 + flowEased * 0.86;

    // World-space children. Their matrices are written directly so the shader
    // can work in world coordinates without an extra inverse per vertex.
    const surface = surfaceRef.current;
    if (surface) {
      surface.visible = fill > 0.002;
      surface.matrixWorld.makeTranslation(e[12]!, surfaceY, e[14]!);
      // Widen the sheet as the bottle tips: the plane cuts a longer and
      // longer ellipse through the cavity.
      const stretch = THREE.MathUtils.clamp(
        1 / Math.max(Math.cos(tilt), 0.22),
        1,
        4.2,
      );
      surface.matrixWorld.scale(V.set(stretch, 1, stretch));
    }
    const stream = streamRef.current;
    if (stream) {
      stream.visible = flowEased > 0.004;
      stream.matrixWorld.identity();
    }
    const pool = poolRef.current;
    if (pool) {
      const amount = THREE.MathUtils.clamp(drain * 1.15, 0, 1);
      pool.visible = pour.pool && amount > 0.01;
      (poolMat.uniforms.uAmount as THREE.IUniform).value = amount;
      (poolMat.uniforms.uImpact as THREE.IUniform).value = flowEased;
      pool.matrixWorld.compose(
        V.set(
          e[12]! + VEL.x * flight * 0.55,
          rootY + height * pour.poolY,
          e[14]! + VEL.z * flight * 0.55,
        ),
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          -Math.PI / 2,
        ),
        V2.set(
          height * pour.poolRadius,
          height * pour.poolRadius,
          height * pour.poolRadius,
        ),
      );
    }

    const capGroup = capRef.current;
    if (capGroup) {
      capGroup.visible = cap.enabled && capOpen < 0.995;
      capGroup.position.set(0, height * cap.liftDistance * capOpen, 0);
      capGroup.rotation.z = capOpen * 0.42;
      capMat.opacity = 1 - THREE.MathUtils.smoothstep(capOpen, 0.55, 0.98);
    }

    const labelMesh = labelRef.current;
    if (labelMesh) labelMesh.rotation.y = label.rotation;

    void state;
  });

  const transmissionKey = `${tier}-${q.transmissionSamples}-${q.transmissionResolution}`;

  return (
    <group ref={rootRef} position={position}>
      <group ref={bottleRef}>
        <mesh geometry={geo.glass} renderOrder={4}>
          {q.transmission === "sampled" ? (
            <MeshTransmissionMaterial
              key={transmissionKey}
              samples={q.transmissionSamples}
              resolution={q.transmissionResolution}
              backside={q.backside}
              backsideThickness={glass.thickness * 0.55}
              transmission={1}
              thickness={glass.thickness}
              roughness={glass.roughness}
              chromaticAberration={glass.chromaticAberration}
              anisotropicBlur={glass.anisotropicBlur}
              distortion={glass.distortion}
              distortionScale={glass.distortionScale}
              temporalDistortion={glass.temporalDistortion}
              ior={glass.ior}
              color={glass.color as string}
              attenuationDistance={glass.attenuationDistance}
              attenuationColor={glass.attenuationColor as string}
              envMapIntensity={glass.envMapIntensity}
              reflectivity={glass.reflectivity}
              toneMapped
            />
          ) : (
            <primitive object={cheapGlass} attach="material" />
          )}
        </mesh>

        <mesh geometry={geo.liquid} material={bodyMat} renderOrder={1} />

        {particulate.enabled && parts.count > 0 ? (
          <mesh
            geometry={partGeo}
            material={partMat}
            frustumCulled={false}
            renderOrder={2}
          />
        ) : null}

        {label.enabled ? (
          <mesh
            ref={labelRef}
            geometry={labelGeo}
            material={labelMat}
            renderOrder={3}
          />
        ) : null}

        {cap.enabled ? (
          <group ref={capRef}>
            <mesh geometry={geo.cap} material={capMat} renderOrder={5} />
          </group>
        ) : null}
      </group>

      <mesh
        ref={surfaceRef}
        geometry={geo.surface}
        material={surfaceMat}
        frustumCulled={false}
        matrixAutoUpdate={false}
        matrixWorldAutoUpdate={false}
        renderOrder={2}
      />
      <mesh
        ref={streamRef}
        geometry={geo.stream}
        material={streamMat}
        frustumCulled={false}
        matrixAutoUpdate={false}
        matrixWorldAutoUpdate={false}
        renderOrder={6}
      />
      <mesh
        ref={poolRef}
        material={poolMat}
        frustumCulled={false}
        matrixAutoUpdate={false}
        matrixWorldAutoUpdate={false}
        renderOrder={7}
      >
        <planeGeometry args={[2, 2, 48, 48]} />
      </mesh>
    </group>
  );
}
