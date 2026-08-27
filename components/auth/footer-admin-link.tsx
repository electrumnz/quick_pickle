import { LOGIN_PATH } from "@/lib/auth/config";

/**
 * The discreet way in.
 *
 * The founder asked for a quiet link in the footer rather than a button
 * announcing where the admin lives, so it is small, unadorned and sits at the
 * end of the footer row where nobody browsing pickles will trip over it.
 *
 * Discreet is a visual decision and it stops there. This is a real anchor:
 * reachable by Tab, activated by Enter, announced as "Staff sign in, link" by a
 * screen reader, with a visible focus ring and full text contrast — it is not
 * dimmed, hidden off-screen, or made keyboard-inert in the name of subtlety.
 * Obscurity is not one of this gate's defences, so there is nothing to gain by
 * hiding it from assistive technology and a real person to lose.
 *
 * `rel="nofollow"` keeps crawlers off it; the proxy sets `X-Robots-Tag:
 * noindex` on the destination for anything that follows it anyway.
 */
export function FooterAdminLink({ className }: { className?: string }) {
  return (
    <a
      href={LOGIN_PATH}
      rel="nofollow"
      aria-label="Staff sign in"
      className={[
        "rounded-sm text-xs underline-offset-4 hover:underline",
        "outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2",
        className ?? "",
      ]
        .filter((value) => value !== "")
        .join(" ")}
    >
      Staff
    </a>
  );
}
