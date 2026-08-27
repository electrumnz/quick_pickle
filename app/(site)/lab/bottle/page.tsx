import type { Metadata } from "next";
import dynamic from "next/dynamic";

export const metadata: Metadata = {
  title: "Bottle lab",
  description: "Internal tuning surface for the HALF SOUR 3D bottle system.",
  robots: { index: false, follow: false, nocache: true },
};

const BottleLab = dynamic(() =>
  import("@/components/3d/lab/BottleLab").then((m) => m.BottleLab),
);

export default function BottleLabPage() {
  return <BottleLab />;
}
