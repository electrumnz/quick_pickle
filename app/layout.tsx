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
          the last line of every page. Three steps, because the sentence wraps
          to four lines on a 375px phone and one on a laptop — measured, not
          guessed: 99px, 59px and 37px at 375, 768 and 1440. */}
      <body
        className={
          demo
            ? "flex min-h-full flex-col pb-28 sm:pb-20 lg:pb-14"
            : "flex min-h-full flex-col"
        }
      >
        {children}
        {demo ? <DemoBanner /> : null}
      </body>
    </html>
  );
}
