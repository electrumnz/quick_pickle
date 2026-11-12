import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { META } from "@/content/site";
import { THEME_COLOUR } from "@/lib/brand/colours";
import { fontVariables } from "@/lib/brand/fonts";
import { siteUrl } from "@/lib/site";

import "./globals.css";

/**
 * The root: the document, the fonts, the shop's stylesheet and the metadata
 * every route shares. No script of its own.
 *
 * The shop's stylesheet is imported HERE, beside the fonts, so the two leave
 * as one file. One level down it became a second render-blocking request on
 * every shop page, which cost enough to fail the Lighthouse budget. The back
 * end's stylesheet is the one that must stay out of the shop, and it does:
 * only app/backstage/layout.tsx imports it. (The back end gets this file as
 * well. It is the same tokens and base, so nothing changes there.)
 */

export const metadata: Metadata = {
  // Absolute base for canonical and Open Graph URLs.
  metadataBase: new URL(siteUrl()),
  title: {
    default: META.title,
    template: "%s | Quick Pickle",
  },
  description: META.description,
  applicationName: "Quick Pickle",
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    siteName: "Quick Pickle",
    title: META.title,
    description: META.description,
    url: "./",
    locale: "en_NZ",
  },
  twitter: {
    card: "summary_large_image",
    title: META.title,
    description: META.description,
  },
  // Closed to search engines unless a layout further in says otherwise. The
  // shop's own layout (app/(site)/layout.tsx) opens its pages once every
  // fact about the offer is confirmed; nothing else is ever a page to find.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the sticky buy bar sit above the home indicator on a notched phone.
  viewportFit: "cover",
  themeColor: THEME_COLOUR,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NZ" className={fontVariables}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
