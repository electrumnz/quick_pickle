import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./backstage.css";

export const metadata: Metadata = {
  title: { default: "Backstage", template: "%s | Quick Pickle backstage" },
  robots: { index: false, follow: false, nocache: true },
};

/** Nothing here is ever cached or prerendered: it is somebody's business. */
export const dynamic = "force-dynamic";

/**
 * The back end. Not linked from the shop and never indexed.
 *
 * This layout only brings the stylesheet. Who may come in is decided one
 * level down: (door) holds the sign-in pages, (app) holds everything else
 * and checks for a signed-in member of staff on every request.
 */
export default function BackstageLayout({ children }: { children: ReactNode }) {
  return children;
}
