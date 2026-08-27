import { CSRF_FIELD_NAME, LOGOUT_PATH } from "@/lib/auth/config";

/**
 * Sign out, and optionally sign out everywhere.
 *
 * A form rather than a link, because signing out is a state change: a `GET`
 * sign-out is something any third-party page can trigger with an `<img>` tag.
 * It carries the session's CSRF token for the same reason.
 *
 * The admin unit renders this with the token from `getAdminCsrfToken()`:
 *
 * ```tsx
 * const { csrfToken } = await requireAdminSession();
 * return <AdminSignOutForm csrfToken={csrfToken} />;
 * ```
 */
export function AdminSignOutForm({
  csrfToken,
  everywhere = false,
  label,
}: {
  csrfToken: string;
  /** Revoke every live session for this operator, not just this one. */
  everywhere?: boolean;
  label?: string;
}) {
  const action = everywhere ? `${LOGOUT_PATH}?scope=all` : LOGOUT_PATH;
  return (
    <form method="post" action={action}>
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} readOnly />
      <button
        type="submit"
        className="rounded-md border border-current px-3 py-1.5 text-xs font-semibold tracking-wide uppercase outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2"
      >
        {label ?? (everywhere ? "Sign out everywhere" : "Sign out")}
      </button>
    </form>
  );
}
