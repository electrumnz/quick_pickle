import type { ReactNode } from "react";

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
      <footer className="border-t border-black/10 px-6 py-6 text-xs opacity-60 dark:border-white/15">
        &copy; {new Date().getFullYear()} Half Sour
      </footer>
    </div>
  );
}
