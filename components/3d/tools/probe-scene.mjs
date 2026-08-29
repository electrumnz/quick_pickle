#!/usr/bin/env node
/**
 * Dumps the live scene graph and every material's state out of the lab.
 *
 *   node components/3d/tools/probe-scene.mjs "http://localhost:3000/lab/bottle?tier=high&still=1"
 *
 * Worth reaching for before tuning anything by eye. It is how the glass was
 * caught running at ior 1.66 instead of 1.52: three backs `reflectivity` with
 * `ior`, so passing both to the same material leaves whichever React applied
 * last in charge, and nothing in the render says so.
 *
 * Reads `window.__hs`, which `lab/FpsProbe` publishes. Lab only.
 */
import { chromium } from "@playwright/test";
const url = process.argv[2];
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
page.on("pageerror", (e) =>
  console.log("[pageerror]", String(e).slice(0, 400)),
);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(Number(process.argv[3] ?? 14000));
const out = await page.evaluate(() => {
  const hs = window.__hs;
  if (!hs) return { error: "no __hs" };
  const rows = [];
  hs.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    rows.push({
      name: o.name || o.type,
      geo: o.geometry?.type,
      mat: m?.type,
      transmission: m?.transmission,
      thickness: m?.thickness,
      ior: m?.ior,
      roughness: m?.roughness,
      transparent: m?.transparent,
      opacity: m?.opacity,
      side: m?.side,
      depthWrite: m?.depthWrite,
      renderOrder: o.renderOrder,
      visible: o.visible,
      envMap: !!m?.envMap,
      hasBuffer: !!m?.buffer,
    });
  });
  return {
    rows,
    toneMapping: hs.gl.toneMapping,
    exposure: hs.gl.toneMappingExposure,
    outputColorSpace: hs.gl.outputColorSpace,
    capabilities: {
      isWebGL2: hs.gl.capabilities.isWebGL2,
      maxSamples: hs.gl.capabilities.maxSamples,
    },
    envTexture: hs.scene.environment
      ? hs.scene.environment.image?.width +
        "x" +
        hs.scene.environment.image?.height
      : "none",
    background: hs.scene.background ? "set" : "none",
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
