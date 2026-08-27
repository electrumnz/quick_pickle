import type { ReactNode } from "react";

import { FooterAdminLink } from "@/components/auth/footer-admin-link";

/** Layout for the public storefront route group. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-black/10 px-6 py-4 dark:border-white/15">
        <span className="text-sm font-semibold tracking-[0.2em] uppercase">
          Half Sour
        </span>
      </header>
      <main className="flex-1 px-6 py-12">{children}</main>
      <footer className="flex items-center justify-between gap-4 border-t border-black/10 px-6 py-6 text-xs dark:border-white/15">
        <span className="opacity-60">
          &copy; {new Date().getFullYear()} Half Sour
        </span>
        {/*
          Deliberately quiet, deliberately not hidden: the staff way in sits at
          the end of the footer row rather than announcing itself, but it is a
          real link with real contrast and a real focus ring. See
          components/auth/footer-admin-link.tsx.
        */}
        <FooterAdminLink />
      </footer>
    </div>
  );
}
