import type { ReactNode } from "react";

/** Layout for the password-gated admin route group. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-black/10 px-6 py-4 dark:border-white/15">
        <span className="text-sm font-semibold tracking-[0.2em] uppercase">
          Half Sour — Admin
        </span>
      </header>
      <main className="flex-1 px-6 py-12">{children}</main>
    </div>
  );
}
