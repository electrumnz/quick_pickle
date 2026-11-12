import type { MetadataRoute } from "next";

import { META } from "@/content/site";
import { BACKGROUND_COLOUR, THEME_COLOUR } from "@/lib/brand/colours";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Quick Pickle",
    short_name: "Quick Pickle",
    description: META.description,
    start_url: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOUR,
    theme_color: THEME_COLOUR,
    icons: [
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/brand/app-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
