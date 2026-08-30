/**
 * Evidence: the asset library, used for real.
 *
 * This is not a screenshot of a mock. It signs in through the real login form,
 * uploads real files through the real form, and then checks the things this
 * unit claims:
 *
 *   - the empty state, which is the first screen she ever sees;
 *   - a photograph carrying GPS goes in, and the bytes the admin serves back
 *     contain no EXIF block at all;
 *   - a clip gets a poster frame captured by the browser, and the scrubbed MP4
 *     still decodes — `videoWidth` is read from the element that is on screen;
 *   - the video is not playing and is muted, with no autoplay attribute;
 *   - a photo with people in it lands unusable and says so;
 *   - the file route's response headers.
 *
 * Run it against a server that is already up:
 *
 *   BASE=http://localhost:3000 ADMIN_PASSWORD='…' \
 *     node components/assets/evidence/capture.mjs
 *
 * Everything it measures goes into `measurements.json` beside the images.
 */

import { chromium } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const REPO = process.cwd();
const OUT = path.join(REPO, "components", "assets", "evidence");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  ["1440", { width: 1440, height: 1000 }],
  ["375", { width: 375, height: 812 }],
];
const SCHEMES = ["light", "dark"];

const report = [];
const note = (entry) => {
  report.push(entry);
  console.log(JSON.stringify(entry));
};

/* ---------------------------------------------------------------- fixtures */

/**
 * A real photo from this repository with a real EXIF block, GPS IFD included,
 * put back into it exactly the way a phone writes one.
 *
 * The canonical version of this lives in `tests/assets/support/fixtures.ts` and
 * is what the unit tests use; it is repeated here because an evidence script has
 * to be runnable on its own, with node and nothing else.
 */
function exifWithGps() {
  const tiff = new Uint8Array(160);
  const view = new DataView(tiff.buffer);
  const ascii = (offset, text, length) => {
    for (let index = 0; index < length; index += 1) {
      tiff[offset + index] = index < text.length ? text.charCodeAt(index) : 0;
    }
  };
  const entry = (_view, at, tag, type, count, value) => {
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    view.setUint32(at + 8, value, true);
  };
  const rational = (offset, numerator, denominator) => {
    view.setUint32(offset, numerator, true);
    view.setUint32(offset + 4, denominator, true);
  };

  ascii(0, "II", 2);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 2, true);
  entry(view, 10, 0x0132, 2, 20, 92);
  entry(view, 22, 0x8825, 4, 1, 38);
  view.setUint32(34, 0, true);
  view.setUint16(38, 4, true);
  entry(view, 40, 0x0001, 2, 2, 0);
  ascii(48, "S", 2);
  entry(view, 52, 0x0002, 5, 3, 112);
  entry(view, 64, 0x0003, 2, 2, 0);
  ascii(72, "E", 2);
  entry(view, 76, 0x0004, 5, 3, 136);
  view.setUint32(88, 0, true);
  ascii(92, "2026:09:14 10:31:08", 20);
  rational(112, 36, 1);
  rational(120, 50, 1);
  rational(128, 546, 10);
  rational(136, 174, 1);
  rational(144, 45, 1);
  rational(152, 479, 10);
  return tiff;
}

function jpegWithGps(source) {
  const original = new Uint8Array(readFileSync(path.join(REPO, source)));
  const tiff = exifWithGps();
  const payloadLength = 2 + 6 + tiff.length;
  const segment = new Uint8Array(2 + payloadLength);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = (payloadLength >> 8) & 0xff;
  segment[3] = payloadLength & 0xff;
  segment.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
  segment.set(tiff, 10);
  const out = new Uint8Array(original.length + segment.length);
  out.set(original.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(original.subarray(2), 2 + segment.length);
  return out;
}

const scratch = mkdtempSync(path.join(tmpdir(), "half-sour-evidence-"));
// The names are the names a phone gives a file, tidied: the library turns a
// filename into the first draft of a title, so these are what appears on the
// cards in the screenshots.
const files = {
  stall: path.join(scratch, "The stall on the corner.JPG"),
  crowd: path.join(scratch, "Two customers at the stall.jpg"),
  clip: path.join(scratch, "Bottling line, batch E.mp4"),
  webm: path.join(scratch, "Filling the last case.webm"),
  liar: path.join(scratch, "holiday.jpg"),
};
const gpsBytes = jpegWithGps("public/media/bottles/no-01-house.jpg");
writeFileSync(files.stall, gpsBytes);
writeFileSync(
  files.crowd,
  readFileSync(path.join(REPO, "public/media/range/range.jpg")),
);
writeFileSync(
  files.clip,
  readFileSync(path.join(REPO, "public/media/film/no-01-house.mp4")),
);
// A PNG called .jpg: the mislabelled-file case, shown failing in the interface.
writeFileSync(
  files.liar,
  readFileSync(path.join(REPO, "public/3d/fallback/bottle-hero.png")),
);

function contains(haystack, needle) {
  outer: for (
    let start = 0;
    start <= haystack.length - needle.length;
    start += 1
  ) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ driver */

const browser = await chromium.launch();

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#admin-password", PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30000,
    }),
    page.click('button[type="submit"]'),
  ]);
}

async function shoot(page, name, label, scheme) {
  // Thumbnails are lazy-loaded, and a full-page screenshot does not scroll, so
  // the pictures below the fold would photograph as empty boxes. Walk the page
  // down and back up first, and let the images settle.
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
    await Promise.all(
      [...document.images]
        .filter((image) => !image.complete)
        .map(
          (image) =>
            new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
              setTimeout(resolve, 4000);
            }),
        ),
    );
  });
  await page.waitForTimeout(600);
  const file = `${name}-${label}-${scheme}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  return file;
}

/* 1. The empty state, before anything is uploaded ------------------------- */

for (const scheme of SCHEMES) {
  for (const [label, viewport] of VIEWPORTS) {
    const context = await browser.newContext({
      viewport,
      colorScheme: scheme,
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      window.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal{display:none!important}";
        document.head.append(style);
      });
    });
    const page = await context.newPage();
    await signIn(page);
    await page.goto(`${BASE}/admin/assets`, { waitUntil: "networkidle" });
    const empty = await page.evaluate(() => ({
      headline:
        document.querySelector("main p.font-semibold")?.textContent?.trim() ??
        null,
      says: document.body.textContent?.includes("No data") ?? false,
      teaches: document.body.textContent?.includes("agreed") ?? false,
    }));
    note({
      shot: await shoot(page, "empty", label, scheme),
      route: "/admin/assets (empty)",
      scheme,
      viewport: label,
      ...empty,
    });
    await context.close();
  }
}

/* 2. Upload, through the real form ---------------------------------------- */

const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: "light",
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
await context.addInitScript(() => {
  window.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.head.append(style);
  });
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));
await signIn(page);

/**
 * A real WebM, recorded by this browser.
 *
 * Playwright's Chromium is an open-source build with no H.264 decoder, so it
 * cannot read the repository's own MP4 — which means it cannot capture a poster
 * frame from one, and cannot play one back. That is a property of this browser,
 * not of the library: Chrome, Safari and Edge all decode H.264.
 *
 * So the clip that proves the poster capture and the playback is one this
 * browser can definitely read: VP8 in WebM, recorded here from a canvas, then
 * uploaded through the same form as everything else.
 */
async function recordWebm() {
  const base64 = await page.evaluate(async () => {
    // The clip is painted in the brand's own tokens, read off the live page:
    // no colour is spelled out here, which is the same rule the components
    // themselves are held to.
    const styles = getComputedStyle(document.documentElement);
    const ink = styles.getPropertyValue("--surface-page").trim();
    const deep = styles.getPropertyValue("--surface-deep").trim();
    const accent = styles.getPropertyValue("--accent").trim();

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 800;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(25);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.start();
    for (let frame = 0; frame < 45; frame += 1) {
      context.fillStyle = frame % 2 === 0 ? ink : deep;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = accent;
      context.fillRect(40, 80 + frame * 6, 560, 220);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
      recorder.stop();
    });
    const buffer = await blob.arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buffer)) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  });
  writeFileSync(files.webm, Buffer.from(base64, "base64"));
  return base64.length;
}

await page.goto(`${BASE}/admin/assets`, { waitUntil: "networkidle" });
note({
  step: "recorded a WebM in the browser",
  base64Length: await recordWebm(),
});

async function upload(paths, fields) {
  await page.goto(`${BASE}/admin/assets`, { waitUntil: "networkidle" });
  await page.setInputFiles("#files", paths);
  if (fields.occasion) await page.fill("#occasion", fields.occasion);
  if (fields.occasionOn) await page.fill("#occasionOn", fields.occasionOn);
  if (fields.description) await page.fill("#description", fields.description);
  if (fields.tags) await page.fill("#tags", fields.tags);
  if (fields.people) await page.check("#peoplePresent");
  // Scoped to the upload form: the first `form button` on the page belongs to
  // the sidebar's sign-out form, and clicking that ends the session.
  await page.click('form[action="/admin/assets/upload"] button[type="submit"]');
  await page.waitForSelector('[aria-live="polite"] li', { timeout: 120000 });
  return page.$$eval('[aria-live="polite"] li', (items) =>
    items.map((item) => item.textContent?.replace(/\s+/g, " ").trim() ?? ""),
  );
}

note({
  step: "upload: a photo carrying GPS, and two clips",
  results: await upload([files.stall, files.clip, files.webm], {
    occasion: "the Sunday market",
    occasionOn: "2026-09-14",
    description:
      "The stall set up on the corner, four bottles on a trestle table.",
    tags: "market, stall, spring",
  }),
});

note({
  step: "upload: a photo with people in it",
  results: await upload([files.crowd], {
    occasion: "the Sunday market",
    occasionOn: "2026-09-14",
    description: "Two customers at the stall, one holding No 02.",
    tags: "market, people",
    people: true,
  }),
});

note({
  step: "upload: a PNG named .jpg",
  results: await upload([files.liar], {
    description: "Not what it says it is.",
  }),
});

/* 3. The library, populated ----------------------------------------------- */

for (const scheme of SCHEMES) {
  for (const [label, viewport] of VIEWPORTS) {
    const shotContext = await browser.newContext({
      viewport,
      colorScheme: scheme,
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
      storageState: await context.storageState(),
    });
    await shotContext.addInitScript(() => {
      window.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal{display:none!important}";
        document.head.append(style);
      });
    });
    const shotPage = await shotContext.newPage();
    await shotPage.goto(`${BASE}/admin/assets`, { waitUntil: "networkidle" });
    note({
      shot: await shoot(shotPage, "library", label, scheme),
      route: "/admin/assets",
      scheme,
      viewport: label,
      cards: await shotPage.$$eval("main ul li a", (items) => items.length),
      horizontalOverflow: await shotPage.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
      ),
    });

    // The photo with people in it: the one the team cannot use.
    const blocked = await shotPage
      .locator("a", { hasText: "Two customers" })
      .first()
      .getAttribute("href")
      .catch(() => null);
    if (blocked) {
      await shotPage.goto(`${BASE}${blocked}`, { waitUntil: "networkidle" });
      note({
        shot: await shoot(shotPage, "blocked", label, scheme),
        route: blocked,
        scheme,
        viewport: label,
        refusal: await shotPage
          .locator("text=The team cannot use this one")
          .first()
          .isVisible(),
      });
    }

    await shotPage.goto(`${BASE}/admin/assets`, { waitUntil: "networkidle" });
    const clip = await shotPage
      .locator("a", { hasText: "Filling the last case" })
      .first()
      .getAttribute("href")
      .catch(() => null);
    if (clip) {
      await shotPage.goto(`${BASE}${clip}`, { waitUntil: "networkidle" });
      note({
        shot: await shoot(shotPage, "clip", label, scheme),
        route: clip,
        scheme,
        viewport: label,
      });
    }
    await shotContext.close();
  }
}

/* 4. The claims, checked -------------------------------------------------- */

await page.goto(`${BASE}/admin/assets`, { waitUntil: "networkidle" });
const stallHref = await page
  .locator("a", { hasText: "The stall on the corner" })
  .first()
  .getAttribute("href");
await page.goto(`${BASE}${stallHref}`, { waitUntil: "networkidle" });
const storedShot = await shoot(page, "one-file", "1440", "light");

const imageSrc = await page.$eval("main img", (image) =>
  image.getAttribute("src"),
);
const served = await page.request.get(`${BASE}${imageSrc}`);
const servedBytes = new Uint8Array(await served.body());
note({
  check: "the served photo carries no EXIF",
  shot: storedShot,
  url: imageSrc,
  status: served.status(),
  headers: {
    "content-type": served.headers()["content-type"],
    "content-disposition": served.headers()["content-disposition"],
    "x-content-type-options": served.headers()["x-content-type-options"],
    "content-security-policy": served.headers()["content-security-policy"],
    "cache-control": served.headers()["cache-control"],
    "accept-ranges": served.headers()["accept-ranges"],
  },
  uploadedBytes: gpsBytes.length,
  servedBytesLength: servedBytes.length,
  uploadedHadExifBlock: contains(gpsBytes, exifWithGps()),
  servedHasExifBlock: contains(servedBytes, exifWithGps()),
  servedHasExifMarker: contains(
    servedBytes,
    new Uint8Array([0x45, 0x78, 0x69, 0x66]),
  ),
  pageSaysLocationRemoved:
    (await page.locator("text=found, and removed").count()) > 0,
});

// A brand-new context, so there is genuinely no session cookie — clearing the
// header on this one would not remove the jar behind it.
const anonymous = await browser.newContext();
const signedOut = await anonymous.request.get(`${BASE}${imageSrc}`, {
  maxRedirects: 0,
});
note({
  check: "the same file, from a browser with no session",
  status: signedOut.status(),
  location: signedOut.headers()["location"] ?? null,
  isTheImage: (signedOut.headers()["content-type"] ?? "").startsWith("image/"),
});
await anonymous.close();

async function hrefFor(text) {
  await page.goto(`${BASE}/admin/assets`, { waitUntil: "networkidle" });
  return page
    .locator("a", { hasText: text })
    .first()
    .getAttribute("href")
    .catch(() => null);
}

/** What the `<video>` element on the page actually is, once it has metadata. */
async function inspectClip(href) {
  if (href === null) return null;
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
  return page.evaluate(async () => {
    const element = document.querySelector("video");
    if (!element) return null;
    await new Promise((resolve) => {
      if (element.readyState >= 1) resolve(undefined);
      else {
        element.addEventListener("loadedmetadata", () => resolve(undefined), {
          once: true,
        });
      }
      setTimeout(() => resolve(undefined), 8000);
    });
    return {
      hasAutoplayAttribute: element.hasAttribute("autoplay"),
      autoplayProperty: element.autoplay,
      paused: element.paused,
      muted: element.muted,
      hasControls: element.hasAttribute("controls"),
      preload: element.getAttribute("preload"),
      poster: element.getAttribute("poster"),
      videoWidth: element.videoWidth,
      videoHeight: element.videoHeight,
      duration: element.duration,
      decodes: element.videoWidth > 0,
    };
  });
}

const webm = await inspectClip(await hrefFor("Filling the last case"));
note({
  check: "the WebM clip: poster frame, playback, and no autoplay",
  ...webm,
});

const mp4 = await inspectClip(await hrefFor("Bottling line"));
note({
  check: "the MP4 clip in this browser",
  note: "Playwright's Chromium has no H.264 decoder, so it can neither capture a still from this clip nor draw it. Chrome, Safari and Edge do. The library stored it, scrubbed, either way.",
  ...mp4,
});

const posterResponse = webm?.poster
  ? await page.request.get(`${BASE}${webm.poster}`)
  : null;
note({
  check: "the poster frame the browser captured",
  status: posterResponse?.status() ?? null,
  contentType: posterResponse?.headers()["content-type"] ?? null,
  bytes: posterResponse ? (await posterResponse.body()).length : null,
});

const ranged = await page.request.get(`${BASE}${imageSrc}`, {
  headers: { range: "bytes=0-99" },
});
note({
  check: "ranged read",
  status: ranged.status(),
  contentRange: ranged.headers()["content-range"],
  length: (await ranged.body()).length,
});

const traversal = await page.request.get(
  `${BASE}/admin/assets/file/../../../../etc/passwd`,
);
note({ check: "path traversal", status: traversal.status() });

/* 5. Recording consent, in the form, and watching the gate open ------------ */

const blockedHref = await hrefFor("Two customers");
await page.goto(`${BASE}${blockedHref}`, { waitUntil: "networkidle" });
const before = await page.locator("text=The team cannot use this one").count();
await page.selectOption("#peopleConsent", "granted");
await page.fill(
  "#consentNote",
  "Asked them both at the stall on the day; happy to be in a post.",
);
await page.getByRole("button", { name: "Save this" }).click();
await page.waitForURL((url) => url.search.includes("saved=1"), {
  timeout: 30000,
});
const after = await page.locator("text=Cleared for use").count();
note({
  check: "recording consent flips the gate",
  saidCannotUseBefore: before > 0,
  saysClearedAfter: after > 0,
  url: page.url(),
});

for (const scheme of SCHEMES) {
  for (const [label, viewport] of VIEWPORTS) {
    const shotContext = await browser.newContext({
      viewport,
      colorScheme: scheme,
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
      storageState: await context.storageState(),
    });
    await shotContext.addInitScript(() => {
      window.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal{display:none!important}";
        document.head.append(style);
      });
    });
    const shotPage = await shotContext.newPage();
    await shotPage.goto(`${BASE}${blockedHref}`, { waitUntil: "networkidle" });
    note({
      shot: await shoot(shotPage, "cleared", label, scheme),
      route: blockedHref,
      scheme,
      viewport: label,
    });
    await shotContext.close();
  }
}

/* 6. Deleting, and the bytes going with it -------------------------------- */

const doomedHref = await hrefFor("Bottling line");
await page.goto(`${BASE}${doomedHref}`, { waitUntil: "networkidle" });
const doomedFile = await page
  .locator("video")
  .first()
  .getAttribute("src")
  .catch(() => null);
await page.getByRole("button", { name: "Delete this file" }).click();
await page.waitForURL((url) => url.search.includes("deleted=1"), {
  timeout: 30000,
});
const gone = doomedFile ? await page.request.get(`${BASE}${doomedFile}`) : null;
note({
  check: "delete takes the row and the bytes together",
  file: doomedFile,
  fileStatusAfterDelete: gone?.status() ?? null,
  stillListed: await page.locator("a", { hasText: "Bottling line" }).count(),
  url: page.url(),
});

note({ consoleErrors });

await context.close();
await browser.close();

writeFileSync(
  path.join(OUT, "measurements.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(`Captured ${String(report.length)} entries into ${OUT}`);
