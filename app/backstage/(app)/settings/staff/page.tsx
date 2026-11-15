import type { Metadata } from "next";
import Link from "next/link";

import {
  Notice,
  PageHeader,
  Panel,
  Pill,
  When,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { isPinLogin } from "@/lib/backstage/auth/pin";
import { execute } from "@/lib/backstage/core/op";
import { backstageMode } from "@/lib/backstage/mode";
import { listStaff } from "@/lib/backstage/staff/ops";

import { updateStaffAction } from "./actions";
import { InviteForm, PasswordLinkForm, ProperLoginForm } from "./forms";

export const metadata: Metadata = { title: "Staff" };

const ROLE_LABEL = {
  owner: "Owner",
  staff: "Staff",
  viewer: "Viewer",
} as const;

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const me = await requireStaff("/backstage/settings/staff");
  const { notice, tone } = await searchParams;
  const now = new Date();
  const staff = await execute(listStaff, {}, await staffCaller());
  const isOwner = me.role === "owner";
  const demo = backstageMode() === "demo";
  // Whoever came in with the PIN is shown the way to a login of their own.
  // (Swapping it is an owner's act, and the PIN login is made as one. If it
  // has been turned down since, an owner invites that person instead.)
  const withPin = !demo && isOwner && isPinLogin(me);

  return (
    <>
      <PageHeader
        title="Staff"
        lead="Everyone who can sign in. Owners can do everything. Staff run the shop day to day. Viewers can look but not change anything."
        back={{ href: "/backstage/settings", label: "Settings" }}
      />

      {notice ? (
        <div className="mb-4">
          <Notice tone={tone === "bad" ? "bad" : "good"}>{notice}</Notice>
        </div>
      ) : null}
      {demo ? (
        <div className="mb-4">
          <Notice>
            In demo mode nobody signs in, so invitations made here lead nowhere.
            They work once a database is connected.
          </Notice>
        </div>
      ) : null}

      {withPin ? (
        <Panel title="You come in with a PIN" className="mb-6">
          <p className="mb-2 max-w-[44rem] leading-snug">
            That is fine while the shop is being set up. Before real
            customers&rsquo; details are in here, give yourself a proper login:
            an email and a password.
          </p>
          <p className="bk-muted mb-2 max-w-[44rem] leading-snug">
            The email is only your login name. Nothing is sent to it, so any
            address of yours will do. It takes the set-up code as well, so
            nobody who only knows the PIN can take the back end over.
          </p>
          <p className="bk-muted mb-4 max-w-[44rem] leading-snug">
            The PIN stops working as soon as this is saved, and any Claude
            connected under it is cut off and connects again. To change the PIN
            and keep it,{" "}
            <Link
              href="/backstage/set-up"
              className="underline decoration-2 underline-offset-4"
            >
              set a new one with the set-up code
            </Link>
            .
          </p>
          <ProperLoginForm />
        </Panel>
      ) : null}

      <Panel flush>
        <ul className="bk-rows">
          {staff.map((person) => (
            <li
              key={person.id}
              className="bk-row grid-cols-1 lg:grid-cols-[1.2fr_auto]"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{person.name}</span>
                  <Pill tone={person.role === "owner" ? "done" : "plain"}>
                    {ROLE_LABEL[person.role]}
                  </Pill>
                  {person.kind === "bot" ? <Pill tone="doing">Bot</Pill> : null}
                  {person.disabled ? (
                    <Pill tone="off">Switched off</Pill>
                  ) : null}
                  {person.pin ? <Pill tone="todo">PIN</Pill> : null}
                  {!person.hasPassword && !demo ? (
                    <Pill tone="todo">No password yet</Pill>
                  ) : null}
                </p>
                <p className="bk-muted mt-0.5 text-[0.9375rem] [overflow-wrap:anywhere]">
                  {person.pin ? "Comes in with the PIN" : person.email}
                  {" · "}
                  {person.lastSeenAt ? (
                    <>
                      last seen <When at={person.lastSeenAt} now={now} />
                    </>
                  ) : (
                    "never signed in"
                  )}
                </p>
              </div>

              {/* The PIN login is not switched off or turned down: it
                  stops being one by being swapped for a proper login. */}
              {isOwner && !person.pin ? (
                <div className="flex flex-wrap items-start gap-2">
                  <form
                    action={updateStaffAction}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="id" value={person.id} />
                    <label htmlFor={`role-${person.id}`} className="sr-only">
                      Role for {person.name}
                    </label>
                    <select
                      id={`role-${person.id}`}
                      name="role"
                      defaultValue={person.role}
                      className="field !min-h-11 !w-auto !py-1.5"
                    >
                      <option value="owner">Owner</option>
                      <option value="staff">Staff</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button type="submit" className="bk-btn bk-btn-quiet">
                      <span className="cap-trim">Save role</span>
                    </button>
                  </form>
                  <form action={updateStaffAction}>
                    <input type="hidden" name="id" value={person.id} />
                    <input
                      type="hidden"
                      name="disabled"
                      value={person.disabled ? "false" : "true"}
                    />
                    <button type="submit" className="bk-btn bk-btn-quiet">
                      <span className="cap-trim">
                        {person.disabled ? "Switch on" : "Switch off"}
                      </span>
                    </button>
                  </form>
                  <PasswordLinkForm id={person.id} name={person.name} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>

      {isOwner ? (
        <Panel title="Invite someone" className="mt-6">
          <p className="bk-muted mb-4 max-w-[44rem] leading-snug">
            This makes their account and gives you a one-time link for them to
            choose a password. A bot (Claude, or any other software) gets its
            own account, so the activity log always shows who really did a
            thing.
          </p>
          <InviteForm />
        </Panel>
      ) : null}
    </>
  );
}
