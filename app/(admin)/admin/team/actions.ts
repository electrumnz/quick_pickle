"use server";

import { revalidatePath } from "next/cache";

import { adminSql } from "@/components/admin/data/db";
import { CsrfError } from "@/lib/auth/errors";
import {
  ADMIN_CSRF_FIELD_NAME,
  assertAdminCsrf,
  requireAdminSession,
} from "@/lib/auth/server";

import { setAgentPaused, teamMember } from "./data";

/**
 * The one thing this page can change: whether an agent is working.
 *
 * Three checks before anything is written, in this order:
 *
 *  1. `requireAdminSession()` — the proxy already turned an unauthenticated
 *     visitor away, and this is the second, non-optional check inside the
 *     render, exactly as `lib/auth/README.md` asks for.
 *  2. `assertAdminCsrf()` — a state change triggered by a form must carry the
 *     session's CSRF token, so another site cannot post this form.
 *  3. The slug must name an agent that exists.
 *
 * The write itself is one column, `agents.is_enabled`, which is what the
 * runtime's control plane checks before every model call and before every tool
 * call. Pausing an agent stops it mid-run; it does not let it finish what it
 * started. Every pause and restart is written to `audit_log`, which is
 * append-only at the grant level.
 */
export async function setAgentPausedAction(formData: FormData): Promise<void> {
  const { session } = await requireAdminSession();
  const submitted = formData.get(ADMIN_CSRF_FIELD_NAME);
  await assertAdminCsrf(typeof submitted === "string" ? submitted : null);

  const slug = formData.get("slug");
  const intent = formData.get("intent");
  if (typeof slug !== "string" || slug === "") {
    throw new CsrfError("No agent named in the request");
  }
  const pause = intent === "pause";

  const before = await teamMember(slug);
  if (before === null) {
    throw new CsrfError("No such agent");
  }
  const after = await setAgentPaused(slug, pause);
  if (after === null) {
    throw new CsrfError("No such agent");
  }

  await adminSql().query(
    `insert into public.audit_log
       (actor_type, actor_id, actor_label, action, entity_type, entity_id,
        entity_label, summary, before_data, after_data)
     values ('operator', $1, $2, 'update', 'agents', $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      session.operatorId,
      "Founder",
      after.id,
      after.name,
      pause
        ? `Paused ${after.name} (${after.jobTitle}). It will stop mid-run and start nothing new.`
        : `Put ${after.name} (${after.jobTitle}) back on duty.`,
      JSON.stringify({ is_enabled: before.isEnabled, status: before.status }),
      JSON.stringify({ is_enabled: after.isEnabled, status: after.status }),
    ],
  );

  revalidatePath("/admin/team");
  revalidatePath(`/admin/team/${slug}`);
  revalidatePath("/admin");
}
