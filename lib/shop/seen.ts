/**
 * The shop's own visit counter, from the browser's side.
 *
 * A page tells the server three things as they happen: it was viewed,
 * something went in the jar, the checkout was opened. (An order is counted
 * by the server itself, when it is placed.) That is the whole of it: how
 * many came, how far they got.
 *
 * What makes this different from the usual kind:
 *
 *   - No cookie, and nothing kept in the browser. Each page load makes a
 *     random id that lives only in that page's memory, so the steps of one
 *     visit can be strung together and tomorrow's visit is a stranger's.
 *   - Nothing that says who anybody is: no name, no address of theirs, no
 *     fingerprint. A phone or not, which page, and how they found us.
 *   - A browser that asks not to be tracked (Global Privacy Control, or Do
 *     Not Track) is not counted at all. Nothing is sent.
 *   - It goes to this site and nowhere else.
 *
 * It must never get in the way. Every call here can fail silently, and the
 * page works exactly the same if the counter is not there.
 */

import { PAGE_COOKIE, testArmOf } from "./routing";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function makeId(): string {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    let out = "";
    for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
    return out;
  } catch {
    return "";
  }
}

/** This page load's own id. Made once, when this file loads in a browser. */
const VISIT = typeof window === "undefined" ? "" : makeId();

function askedNotToBeTracked(): boolean {
  try {
    const nav = navigator as Navigator & {
      readonly globalPrivacyControl?: boolean;
    };
    return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
  } catch {
    return true;
  }
}

/** Which page is on screen: "home", or a landing page's own short name. */
function currentPage(): string {
  try {
    return document.querySelector("main")?.dataset.page ?? "home";
  } catch {
    return "home";
  }
}

/** A member of staff previewing a draft is not a visit. */
function isPreview(): boolean {
  try {
    return document.querySelector("main")?.dataset.preview !== undefined;
  } catch {
    return false;
  }
}

/**
 * The test this visitor is part of and which side they are on, read from
 * the one cookie a rule or a test sets (lib/shop/routing.ts). Null almost
 * always: there is no such cookie unless a test is running.
 */
function testArm(): string | null {
  try {
    const found = document.cookie
      .split("; ")
      .find((each) => each.startsWith(`${PAGE_COOKIE}=`));
    return found === undefined
      ? null
      : testArmOf(decodeURIComponent(found.slice(PAGE_COOKIE.length + 1)));
  } catch {
    return null;
  }
}

function device(): "phone" | "desk" {
  try {
    return window.matchMedia("(max-width: 767px)").matches ? "phone" : "desk";
  } catch {
    return "desk";
  }
}

export type SeenStep = "view" | "add" | "checkout";

/** Tell the counter about one step. Never throws, never waits. */
export function seen(
  step: SeenStep,
  source: Readonly<Record<string, string>>,
): void {
  if (typeof window === "undefined" || VISIT === "") return;
  if (askedNotToBeTracked() || isPreview()) return;
  try {
    const body = JSON.stringify({
      kind: step,
      visit: VISIT,
      path: window.location.pathname,
      page: currentPage(),
      source,
      referrer: source.ref ?? null,
      device: device(),
      test: testArm(),
    });
    const sent =
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(
        "/api/seen",
        new Blob([body], { type: "application/json" }),
      );
    if (!sent) {
      void fetch("/api/seen", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Not counted. The page carries on.
  }
}

/**
 * What goes with an order about the visit it came from: how they found us,
 * which page they were shown, and (unless the browser asked not to be
 * tracked) this visit's id, so the order can be counted as its last step.
 */
export function visitDetails(
  source: Readonly<Record<string, string>>,
): Record<string, string> {
  const details: Record<string, string> = {
    ...source,
    page: currentPage(),
    device: device(),
  };
  if (VISIT !== "" && !askedNotToBeTracked()) details.visit = VISIT;
  const test = testArm();
  if (test !== null) details.test = test;
  return details;
}
