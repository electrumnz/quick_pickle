import { notFound } from "next/navigation";

/**
 * Anything under /admin that is not a real page.
 *
 * A static route always wins over this catch-all, so a section landing here is
 * a section whose page has not been written yet. It renders the admin's own
 * not-found screen — inside the shell, with the sidebar still there — rather
 * than dropping her onto a bare framework 404 with no way back.
 */
export default function MissingAdminPage(): never {
  notFound();
}
