import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { DemoBanner } from "@/components/demo/DemoBanner";
import { fontVariables } from "@/lib/brand/fonts";
import { isDemoMode } from "@/lib/demo/mode";
import { siteUrl } from "@/lib/site";

import "./globals.css";

/**
 * Demo mode, read once for the whole document.
 *
 * Module scope, not per render, because `metadata` below is a plain object and
 * a static export cannot call a function per request. That is not a limitation
 * here: the demo database image is built by `prebuild`, so `HALF_SOUR_DEMO` is
 * necessarily set at build time for a demo deployment to exist at all, and the
 * value cannot differ between build and serve.
 */
const demo = isDemoMode();

export const metadata: Metadata = {
  // Absolute base for canonical, Open Graph and Twitter URLs. Without this,
  // Next emits relative OG/canonical URLs, which crawlers will not resolve.
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Half Sour",
    template: "%s | Half Sour",
  },
  description: "Half Sour — pickle brine, bottled with a straight face.",
  applicationName: "Half Sour",
  alternates: {
    // "./" resolves against the current route, so every page is self-canonical.
    canonical: "./",
  },
  // Served from public/ rather than app/icon.svg on purpose: the brand's
  // favicon cut carries its own Brine ground, so the file holds raw hex, and
  // tests/unit/brand-tokens.test.ts forbids that anywhere under app/.
  icons: {
    icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    type: "website",
    siteName: "Half Sour",
    title: "Half Sour",
    description: "Half Sour — pickle brine, bottled with a straight face.",
    url: "./",
    locale: "en_NZ",
  },
  twitter: {
    card: "summary_large_image",
    title: "Half Sour",
    description: "Half Sour — pickle brine, bottled with a straight face.",
  },
  // A demonstration must never enter a search index. Two more layers say the
  // same thing — `app/robots.ts` disallows everything and `next.config.ts`
  // sends `X-Robots-Tag` on every response — because a meta tag only covers
  // HTML and a robots.txt is only a request.
  robots: demo
    ? { index: false, follow: false, nocache: true, noarchive: true }
    : {
        index: true,
        follow: true,
      },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // fontVariables publishes --font-fraunces and --font-inter-tight, which
    // lib/brand/tokens.css reads to build --font-display and --font-sans.
    // next/font self-hosts both and emits a metric-matched fallback, so the
    // swap costs no layout shift. Antialiasing is set in the brand base layer.
    <html lang="en-NZ" className={`h-full ${fontVariables}`}>
      {/* The padding is the demo banner's own height: it is fixed to the
          bottom of the viewport, and without the reserve it would sit on top of
          the last line of every page. Three steps, because the notice wraps to
          several lines on a narrow phone and two on a laptop.

          Measured, not guessed, and re-measured every time the copy moves. The
          bar has just taken on both of the standing admin warnings and come out
          SHORTER at every width, because each clause was rewritten to fit one
          line: 158px at 320 and 360, 119px at 375 and 390, 98px at 414 to 480,
          78px at 540 to 700, 58px from 768, 59px at 1920. It was 160/140/99/80/
          60 before. Each step below clears the tallest wrap inside its own
          range with a couple of pixels to spare, and `sm` came down from 24 to
          20 so the shorter bar does not leave a gap under a laptop page.
          Grow the copy again and these are wrong again, so measure them
          again — `components/demo/DemoBanner.tsx` says how. */}
      <body
        className={
          demo
            ? "flex min-h-full flex-col pb-40 sm:pb-20 lg:pb-16"
            : "flex min-h-full flex-col"
        }
      >
        {children}
        {demo ? <DemoBanner /> : null}
      </body>
    </html>
  );
}
