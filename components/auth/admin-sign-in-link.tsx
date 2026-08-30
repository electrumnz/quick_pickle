import { DEMO_ADMIN_OPEN } from "@/components/demo/copy";
import { LOGIN_PATH } from "@/lib/auth/config";

/**
 * What stands where the sign-out button stands, when nobody is signed in.
 *
 * The admin shell always has something in that slot, and on an open demo the
 * honest thing to put there is the way IN. A link, not a form: arriving at the
 * login page changes nothing, so there is no state change to protect and no
 * token to carry — the opposite of `AdminSignOutForm`, which is a form for
 * exactly that reason.
 *
 * It is styled as the sign-out button's twin so the slot does not jump when a
 * demo visitor signs in, and it carries the same focus ring.
 */
export function AdminSignInLink() {
  return (
    <a
      href={LOGIN_PATH}
      className="inline-flex min-h-[var(--size-touch-min)] items-center rounded-md border border-current px-3 py-1.5 text-xs font-semibold tracking-wide uppercase outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2"
    >
      {DEMO_ADMIN_OPEN.signIn}
    </a>
  );
}
