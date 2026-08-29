import type { ReactNode } from "react";

/**
 * The frame around everything behind the password.
 *
 * Two very different things live in this route group: the sign-in page, which
 * is a single centred card, and the admin itself, which is a full-bleed
 * application shell. So this layout paints the brand's ground and then gets
 * out of the way — the centring rules apply only when the admin shell is *not*
 * the child, which `:has()` can ask directly. That keeps the sign-in page
 * composed without wrapping the shell in padding it would have to undo.
 */
export default function AdminGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-page text-primary [&:not(:has(#admin-shell))]:items-center [&:not(:has(#admin-shell))]:justify-center [&:not(:has(#admin-shell))]:px-6 [&:not(:has(#admin-shell))]:py-16">
      {children}
    </div>
  );
}
