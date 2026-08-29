# The bottle — decision record

**Status: built, working, and not on the storefront.**
Last worked on 29 August 2026. Live at `/lab/bottle` (noindex).

This unit renders the HALF SOUR bottle in WebGL. It was rebuilt to try to make
that render photographic. It got a lot better and it still lost to a generated
photograph, and the storefront went with the photograph. This file is here so
that nobody has to re-derive any of that.

If you are here to **use** it, skip to [How it works](#how-it-works).
If you are here because you asked _"why isn't this on the site?"_, read on.

---

## Why it is not on the site

Two reasons, and only the second one is decisive.

**1. It does not beat the photography.** A parallel unit generated product
photography through FLUX 1.1 Pro for about four cents an image, in under a
minute. Beside it this render loses on condensation, on depth of field, on
suspended solids that read as dill and garlic rather than as instanced
geometry, and on the plain fact that a photograph of glass has ten thousand
small things in it that nobody models.

**2. It is a ten-year maintenance surface on a site with no technical staff.**
A JPEG is still a JPEG in 2036. A shader stack with quality tiers, capability
detection and three device fallbacks is a thing that breaks on a browser
release nobody here is watching for. Against four-cent photography, the one
thing 3D offers that a photograph cannot — the viewer can turn it — did not
justify that trade for a range of four SKUs.

Reason 2 would have carried the decision even if reason 1 had gone the other
way. **Do not revive this because the render got better.** Revive it if the
maintenance calculus changes: see [What would have to be
true](#what-would-have-to-be-true).

---

## What changed in the rebuild

The client's word for the previous render was "tacky". They were right, and
the cause was one specific thing.

### The bug that mattered: the bottle refracted its own brine, not the room

three's transmission pass renders the scene once more into an off-screen
buffer, and transmissive materials sample **that buffer** along a refracted
ray. The buffer is built from the **opaque draw list only**.

The previous build drew the brine as an opaque mesh inside the glass. So the
only thing the glass could ever refract was a flat green shape standing
between it and the room. Nothing behind the bottle ever moved — and a bottle
that does not bend what is behind it does not read as glass, whatever else you
do to it. Every other defect in that render was downstream of this one.

Making the brine transmissive as well does not fix it: three sorts both
surfaces into the transmissive list, draws the brine first, then lets the glass
overwrite it with a refraction of a room that has no brine in it. The bottle
comes out empty.

**The fix was to stop modelling them as two surfaces.** The brine is now the
glass's own volume — see [How it works](#how-it-works). One transmissive
surface, one shared transmission pass, and the room genuinely bends.

`refraction-proof.png` is that claim under test: the same frame with a grid
painted on the sweep, at high tier and at low tier. It is the only honest way
to show whether a bottle is refracting anything, because a featureless
backdrop looks identical bent or straight.

| high tier — the grid is compressed and displaced through the glass | low tier — no transmission, the grid stops at the bottle |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| ![](evidence/refraction-proof.png)                                 | ![](evidence/refraction-proof-low-tier.png)              |

### The rest of it

- **Nothing behind the bottle to bend.** The old set was a sphere intersecting
  a disc, which met in a dead-straight horizon across the frame, and was
  otherwise a smooth gradient. A perfect refraction of a smooth gradient is a
  smooth gradient. Replaced with a continuous cyclorama (floor → cove → wall,
  one mesh, no seam) and two strip softboxes that are **real planes** standing
  just behind the bottle, hidden by it from the camera. A `Lightformer` inside
  `<Environment>` is a reflection and nothing more; it never reaches the
  transmission buffer, so it cannot shine through the glass.
- **`ior` was 1.66, not 1.52.** three backs `reflectivity` with `ior` — the
  setter writes `ior = (1 + 0.4r) / (1 - 0.4r)` — so passing `ior={1.52}` and
  `reflectivity={0.62}` to the same material left the second one in charge and
  shipped flint crystal instead of soda-lime. Found with
  `tools/probe-scene.mjs`; nothing in the render says so.
- **The label was a placeholder** reading "PLACEHOLDER LABEL".
  `tools/rasterise-labels.mjs` now lays the brand unit's own
  `brand/assets/label-0*.svg` into wrap textures with a real trim edge.
- **The label was refracted by its own bottle**, reappearing smeared across the
  glass either side of itself. It was `transparent: false`, which put it in the
  opaque list and therefore into the transmission buffer. Anything opaque in
  front of the bottle gets refracted; the label is `transparent: true` now and
  the effect that flag has on the render list is load-bearing, not cosmetic.
- **Softboxes read as hard CG rectangles.** The strips are Gaussian across
  their width in both the HDRI and the scene geometry, and the HDRI was rebuilt
  (512×256 → 1024×512) from an evenly lit grey room — which is the one thing
  that cannot draw an edge on glass — into a dark studio with two tall strips
  and a broad ceiling.
- **Suspended solids double-counted the brine.** They carried the full
  Beer-Lambert absorption themselves; stacked on top of the glass volume that
  now also applies it, every seed became the same flat green pebble.
- **The contact shadow was spread over four bottle heights** — a grey cloud
  the subject happened to be standing in. Tightened to 1.9, and the caustic now
  lands in _front_ of the bottle with a hole where the bottle stands, because
  the light comes from behind and a caustic centred under the subject is a
  caustic nobody lit.
- **`OrbitControls` replaced with a turntable** (`lib/turntable.ts`): yaw only,
  momentum with a real spin-down, arrow-key support, and `touch-action: pan-y`
  so a vertical swipe still scrolls the page instead of being eaten.
- **The static fallback did not exist.** `DEFAULT_FALLBACK_SRC` pointed at
  `/3d/fallback/bottle-hero.png` and `public/3d/fallback/` was an empty
  directory, so every reduced-motion and no-WebGL visitor got a broken image.
  It is now a render from the current scene.

### Before and after

|                                | before                               | after                         |
| ------------------------------ | ------------------------------------ | ----------------------------- |
| hero                           | ![](evidence/before-hero.png)        | ![](evidence/hero.png)        |
| label edge and shoulder        | ![](evidence/before-label-edge.png)  | ![](evidence/label-edge.png)  |
| waterline and suspended solids | ![](evidence/before-meniscus.png)    | ![](evidence/meniscus.png)    |
| grounding                      | ![](evidence/before-grounding.png)   | ![](evidence/grounding.png)   |
| medium tier                    | ![](evidence/before-tier-medium.png) | ![](evidence/tier-medium.png) |
| low tier                       | ![](evidence/before-tier-low.png)    | ![](evidence/tier-low.png)    |
| pour                           | ![](evidence/before-pour.png)        | ![](evidence/pour.png)        |

Every frame is a link — see [Tools](#tools).

---

## What still falls short

Written plainly, because the next person needs to know which of these is a bug
and which is a limit.

**Real defects, still present:**

- **The suspended solids read as discs, not as spice.** They are icosahedra
  with per-species scale. Dill fronds and garlic cloves are shapes, and no
  amount of shading makes a lumpy sphere into one. This needs actual geometry.
- **The strip highlights read as painted rather than reflected.** They sit too
  still on the glass as the bottle turns, because the surface waviness that
  should break them up is a low-frequency noise rather than measured glass.
- **No condensation.** Beading on the outside of the glass is most of what
  makes a chilled bottle photograph look wet, and there is none here.
- **No depth of field.** Deliberately not built — see below.
- **The background refraction is real but weak in the hero frame.** The proof
  render shows it clearly against a grid. Against the smooth sweep the hero
  actually uses, there is very little structure to bend, so the effect is
  nearly invisible. Fixing that means putting something in the room worth
  looking through the bottle at, which is a set-dressing problem, not a shader
  one.
- **Single-sample screen-space refraction shears.** The displacement is applied
  in one step over the whole optical path, so neighbouring fragments displace
  far enough apart to smear the image horizontally. The chord is scaled to 1.35
  of its true value as a compromise; at the true 2.0 the magnification is right
  and the interior turns to mush. A real fix is a two-interface trace, which is
  a different material.

**Limits of the environment this was built in, not of the code:**

- The sandbox had **no GPU**. Every frame here is SwiftShader software
  rasterisation, which is materially softer and noisier than the same scene on
  real hardware, and runs at well under one frame per second.
- **The frame costs in `evidence/stats.json` are not usable.** The probe
  averages over a 500 ms window; at sub-1 fps that window closes before the
  scene has finished loading, so several rows record 4 draw calls and 144
  triangles — the backdrop alone. They are kept for provenance, not for
  reading. **This unit's per-tier frame cost has never been measured on a
  GPU.** What can be said structurally: the rebuild replaced drei's
  `MeshTransmissionMaterial`, which runs one to two extra full-scene renders
  into a fixed 1024² buffer _per transmissive material_, with three's own
  transmission pass — one extra render, at `transmissionResolutionScale` ×
  canvas, shared by every transmissive material in the frame — and dropped one
  mesh from the refractive tiers. It should be cheaper. It has not been proven
  cheaper.

**Not attempted, on purpose:** film grain, lens character, chromatic
aberration at the frame edge, bloom. Those are the axes on which a render
loses to a photograph fastest, and chasing them is how a product render ends up
looking like a game cutscene.

---

## What would have to be true

For this to earn its place on the storefront, roughly all of:

1. **A reason that is not fidelity.** Turning the bottle has to be worth
   something on its own — a range large enough that a viewer is comparing, or
   packaging with a back label people want to read. Four SKUs and a front label
   is not that.
2. **Real geometry for the solids.** Dill fronds and garlic, modelled, not
   instanced blobs.
3. **A set worth refracting.** The whole argument for 3D glass is that it bends
   the room; a smooth grey sweep gives it nothing to bend. This is a lighting
   and set problem and it is cheap to fix.
4. **Condensation, and a two-interface refraction.**
5. **Someone who will own it.** This is the real one. It needs a person who
   will notice when a browser release breaks it, and this project does not
   currently have one.

If a physical product and a real photo shoot happen, the calculus changes
again — a 3D bottle matched to real photography of the same object is a much
easier thing to sell than one competing with it.

---

## How it works

`BottleHero` is the only entry a page should import; it keeps three and drei
out of the initial bundle behind a `next/dynamic` import that fires when the
component mounts and intersects. `BottleScene`, `BottleModel` and
`StudioEnvironment` are exported for composition inside an existing canvas.
Importing either one eagerly pulls in the whole renderer.

### The one idea worth knowing

**The bottle and the brine are a single refractive volume, not two surfaces.**
`materials/glass.ts` sets three of the transmission chunk's inputs per
fragment:

| quantity           | set to                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `thickness`        | two glass walls, plus the chord the view ray cuts through the cavity below the waterline                                        |
| `attenuationColor` | the brine, so Beer-Lambert does the colour                                                                                      |
| `roughness`        | turbidity — three blurs the refraction by roughness through the buffer's mip chain, which is exactly what cloudiness looks like |

The suspended spice and the liquid surface stay **opaque** meshes inside the
cavity, so they land in the transmission buffer and are refracted along with
the room rather than pasted over it. That is also the fix for the old
particulate-occlusion bug: the seeds are not drawn over the brine any more,
they are seen _through_ it.

### Tiers

`TIER_SETTINGS` in `defaults.ts`. `transmission` is the switch that matters:

| tier   | transmission        | buffer scale | dispersion | brine                     |
| ------ | ------------------- | ------------ | ---------- | ------------------------- |
| high   | three's, full res   | 1.0          | yes        | the glass's volume        |
| medium | three's, reduced    | 0.6          | no         | the glass's volume        |
| low    | none — Fresnel only | —            | no         | an opaque mesh, as before |

The low tier is a real fallback, not an apology: it keeps the silhouette, the
environment reflections and the suspended spice, and costs one draw call
instead of a second scene render.

### Tools

```bash
node components/3d/tools/generate-assets.mjs       # studio HDRI + UV registration card
node components/3d/tools/rasterise-labels.mjs      # brand/assets/label-*.svg -> wrap PNGs
node components/3d/tools/capture-evidence.mjs      # re-renders evidence/ (add --prefix before-)
node components/3d/tools/render-frame.mjs <url> <out.png> [w] [h] [settleMs] [dpr]
node components/3d/tools/probe-scene.mjs <url>     # dumps the live scene graph and materials
```

`/lab/bottle` takes deterministic overrides, so any frame in this file is a
link someone can open:

```
?tier=high&pour=0.55&still=1&rot=0.6&cam=0.9&dist=1.4&fov=32&label=0&bg=0&chrome=0
```

### Bundle

Nothing outside this directory imports `three` or `@react-three/*`. The 1.2 MB
three chunk is a first-load chunk on `/lab/bottle` only; `/`, `/shop`,
`/products` and `/products/[handle]` do not carry it, and did not carry it even
while the product page was consuming `BottleHero` — the barrel at `index.ts` is
deliberately three-free so a page can import the defaults and the capability
probes without paying for the renderer. Dropping the last storefront import
leaves nothing behind in any shipped bundle.
