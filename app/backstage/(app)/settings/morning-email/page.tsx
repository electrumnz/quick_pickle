import type { Metadata } from "next";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Notice, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { morningEmail } from "@/lib/backstage/digest/ops";
import { formatDateKey } from "@/lib/backstage/stock/dates";

import { saveMorningEmailAction, sendOneNowAction } from "./actions";

export const metadata: Metadata = { title: "Morning email" };

/**
 * The morning email: one a day, saying how many things need a person. It
 * ships switched off. This is where it is switched on, pointed at an
 * address, and read before it is ever sent.
 */
export default async function MorningEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff("/backstage/settings/morning-email");
  const params = await searchParams;
  const now = await execute(morningEmail, {}, await staffCaller());
  const canChange = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Morning email"
        back={{ href: "/backstage/settings", label: "Settings" }}
        lead={
          now.on
            ? `On. One email goes to ${now.to ?? ""} each morning, around seven, saying how many things need you.`
            : "Off. Switched on, one email a day says how many things need you, so the back end comes to you."
        }
      />
      {params.notice ? (
        <div className="mb-5">
          <Notice tone={params.tone === "bad" ? "bad" : "good"}>
            {params.notice}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <form action={saveMorningEmailAction} className="flex flex-col gap-5">
            <fieldset>
              <legend className="field-label">The morning email</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="inline-flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="on"
                    value="yes"
                    defaultChecked={now.on}
                    className="accent-navy size-5"
                  />
                  On
                </label>
                <label className="inline-flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="on"
                    value="no"
                    defaultChecked={!now.on}
                    className="accent-navy size-5"
                  />
                  Off
                </label>
              </div>
            </fieldset>
            <div>
              <label htmlFor="to" className="field-label">
                Where it goes
              </label>
              <input
                id="to"
                name="to"
                type="email"
                maxLength={254}
                autoComplete="email"
                defaultValue={now.to ?? staff.email}
                aria-describedby="to-hint"
                className="field"
              />
              <p
                id="to-hint"
                className="bk-muted mt-1 text-[0.9375rem] leading-snug"
              >
                One address. It only ever gets counts and a link: no
                customer&apos;s name, address or order is put in an email.
              </p>
            </div>
            {canChange ? (
              <div>
                <SubmitButton pending="Saving">Save</SubmitButton>
              </div>
            ) : (
              <p className="bk-muted text-[0.9375rem] leading-snug">
                You can look at this and not change it.
              </p>
            )}
          </form>

          <div className="border-navy-line mt-6 border-t-2 pt-5">
            <p className="leading-snug">
              {now.canSend
                ? now.lastDay === null
                  ? "None has been sent yet."
                  : `The last one was written on ${formatDateKey(now.lastDay)}.`
                : `Email is not being sent, so none would go. ${now.whyNot ?? ""}`}
            </p>
            {canChange && now.canSend && now.to !== null ? (
              <form action={sendOneNowAction} className="mt-3">
                <SubmitButton pending="Sending" className="bk-btn bk-btn-quiet">
                  Send me one now
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <h2 className="bk-h2">
            <span className="cap-trim">What it would say right now</span>
          </h2>
          <p className="mt-3 font-semibold" data-testid="morning-subject">
            {now.preview.subject}
          </p>
          <pre
            data-testid="morning-preview"
            className="mt-3 font-sans text-[0.9688rem] leading-relaxed whitespace-pre-wrap"
          >
            {now.preview.text}
          </pre>
        </Panel>
      </div>
    </>
  );
}
