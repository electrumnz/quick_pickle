"use client";

import { usePathname } from "next/navigation";

/**
 * "Send me back to where I am."
 *
 * The floating panel is rendered by the admin layout, which is a server
 * component and cannot know which page it is floating over — Next gives a
 * layout no pathname. But asking a question from the panel must not move her:
 * she opened it standing on Stock, and landing on the chat page afterwards
 * costs her the screen she was reading and the scroll position she had, which
 * is the whole thing the panel exists to avoid.
 *
 * So the return path is filled in by the one thing that does know: a client
 * component reading `usePathname()`. It is rendered on the server too, so the
 * value is in the HTML before any script runs and the form still returns her to
 * the right page with the scripting turned off.
 *
 * The server does not trust it. `readReturnPath` accepts only a path inside the
 * admin, so a rewritten value cannot turn this form into an open redirect.
 */
export function CurrentPathField({
  fallback = "/admin/chat",
}: {
  fallback?: string;
}) {
  const pathname = usePathname();
  return (
    <input
      type="hidden"
      name="back"
      value={pathname === null || pathname === "" ? fallback : pathname}
      readOnly
    />
  );
}
