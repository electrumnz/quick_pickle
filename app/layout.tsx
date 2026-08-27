import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { siteUrl } from "@/lib/site";

import "./globals.css";

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
  robots: {
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
    <html lang="en-NZ" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
