import type { Metadata } from "next";
import type { ReactNode } from "react";

import { BrandAreaNav } from "@/components/strategy/BrandAreaNav";

/**
 * Brand & Plan — four areas, one destination.
 *
 * Identity is who we are, Messaging is what we say, Plan is how the company
 * runs, Market is how big it can get. They are separate routes rather than tabs
 * so each one can be linked to, printed, and bookmarked, and so the nav works
 * before any JavaScript has loaded.
 */
export const metadata: Metadata = {
  title: { default: "Brand & Plan", template: "%s · Brand & Plan" },
  robots: { index: false, follow: false, nocache: true },
};

export default function BrandLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <BrandAreaNav />
      {children}
    </>
  );
}
