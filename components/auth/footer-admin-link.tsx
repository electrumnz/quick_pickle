import { ADMIN_ROOT_PATH, LOGIN_PATH } from "@/lib/auth/config";
import { DEMO_ADMIN_LINK } from "@/components/demo/copy";
import { isDemoMode } from "@/lib/demo/mode";

/**
 * The way in, in two weights.
 *
 * **On a live deployment: the discreet one.** The founder asked for a quiet
 * link in the footer rather than a button announcing where the admin lives, so
 * it is small, unadorned and sits at the end of the footer row where nobody
 * browsing pickles will trip over it.
 *
 * Discreet is a visual decision and it stops there. This is a real anchor:
 * reachable by Tab, activated by Enter, announced as "Staff sign in, link" by a
 * screen reader, with a visible focus ring and full text contrast — it is not
 * dimmed, hidden off-screen, or made keyboard-inert in the name of subtlety.
 * Obscurity is not one of this gate's defences, so there is nothing to gain by
 * hiding it from assistive technology and a real person to lose.
 *
 * **On a demonstration: the loud one.** Discretion is exactly backwards there.
 * A demo exists to be looked at, its admin is the half worth looking at, and
 * `isDemoMode()` has already opened it — so the control is a labelled button
 * pointing at `/admin` itself rather than a whisper pointing at a password
 * prompt that is not going to be asked for. The wording says where it goes and
 * promises nothing else.
 *
 * It renders at every width in both states. That is worth saying because the
 * masthead nav did not: it carried `hidden md:block` and gave a phone no
 * navigation at all. There is no width condition anywhere in this file, and
 * `styles.tap` from the caller gives it the 44px floor in both axes.
 *
 * `rel="nofollow"` keeps crawlers off it; the proxy sets `X-Robots-Tag:
 * noindex` on the destination for anything that follows it anyway, and a demo
 * deployment is noindex from top to bottom besides.
 */
export function FooterAdminLink({ className }: { className?: string }) {
  // The one predicate, read the way the banner and `robots.txt` read it. Never
  // re-derived from a hostname, a provider name or the absence of a database.
  const demo = isDemoMode();

  const classes = [
    demo
      ? // A control, not a hint: a border, a weight and enough padding to read
        // as something you press. Padding lives here rather than at the call
        // site so the two variants cannot end up fighting over `px-*` — CSS
        // resolves that by stylesheet order, not by the order of a class list.
        "rounded-md border border-current px-4 text-xs font-semibold tracking-wide uppercase"
      : "rounded-sm px-2 text-xs underline-offset-4 hover:underline",
    "outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2",
    className ?? "",
  ]
    .filter((value) => value !== "")
    .join(" ");

  if (demo) {
    return (
      <a
        href={ADMIN_ROOT_PATH}
        rel="nofollow"
        aria-label={DEMO_ADMIN_LINK.ariaLabel}
        className={classes}
      >
        {DEMO_ADMIN_LINK.label}
      </a>
    );
  }

  return (
    <a
      href={LOGIN_PATH}
      rel="nofollow"
      aria-label="Staff sign in"
      className={classes}
    >
      Staff
    </a>
  );
}
