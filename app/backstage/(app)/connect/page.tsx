import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Notice, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import {
  checkConnectRequest,
  type ConnectRequest,
} from "@/lib/backstage/connect/oauth";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { backstageMode } from "@/lib/backstage/mode";

import { decideConnectAction } from "./actions";

export const metadata: Metadata = { title: "Connect Claude" };

type Asked = {
  readonly response_type?: string;
  readonly client_id?: string;
  readonly redirect_uri?: string;
  readonly code_challenge?: string;
  readonly code_challenge_method?: string;
  readonly state?: string;
  readonly resource?: string;
};

/**
 * The consent screen: where an app sends a person to ask to be let in.
 *
 * It is behind the sign-in like any other page of the back end, so the yes
 * is a signed-in person's. The request is checked to the letter before
 * anything is drawn, and a request with anything out of place is refused
 * here, on this page: nobody is ever sent on to an address that was not
 * checked.
 */
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<Asked>;
}) {
  const staff = await requireStaff();
  const asked = await searchParams;

  let request: ConnectRequest | null = null;
  let refused: string | null = null;
  if (backstageMode() !== "live") {
    refused =
      "This back end is running on invented records, so there is nothing real to connect Claude to.";
  } else if (staff.role === "viewer") {
    refused =
      "Your account can look but not change things, so it cannot connect Claude. Ask an owner.";
  } else if (
    asked.response_type !== "code" ||
    asked.code_challenge_method !== "S256" ||
    !asked.client_id ||
    !asked.redirect_uri ||
    !asked.code_challenge
  ) {
    refused =
      "This page is where Claude sends you to say yes to a connection. Nothing was asked for, or it was not asked for in the way that keeps a connection safe. Start again from Claude.";
  } else {
    try {
      request = await execute(
        checkConnectRequest,
        {
          clientId: asked.client_id,
          redirectUri: asked.redirect_uri,
          codeChallenge: asked.code_challenge,
          resource: asked.resource ?? null,
        },
        await staffCaller(),
      );
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      refused = error.message;
    }
  }

  if (request === null) {
    return (
      <>
        <PageHeader title="Connect Claude" lead="Nothing has been connected." />
        <Notice tone="bad">{refused}</Notice>
        <p className="mt-5">
          <Link
            href="/backstage/settings/claude"
            className="underline decoration-2 underline-offset-4"
          >
            How to connect Claude
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Connect Claude"
        lead={`An app that calls itself "${request.clientName}" is asking to be let in to the back end, as you.`}
      />
      <Panel>
        <form action={decideConnectAction} className="flex flex-col gap-6">
          <input type="hidden" name="client_id" value={asked.client_id} />
          <input type="hidden" name="redirect_uri" value={asked.redirect_uri} />
          <input
            type="hidden"
            name="code_challenge"
            value={asked.code_challenge}
          />
          <input type="hidden" name="state" value={asked.state ?? ""} />
          <input type="hidden" name="resource" value={asked.resource ?? ""} />

          <div>
            <h2 className="bk-h2">
              <span className="cap-trim">Where your answer goes</span>
            </h2>
            <p className="mt-2 leading-snug" data-testid="connect-back-to">
              {request.sentBackTo === "claude"
                ? `Back to Claude, at ${request.host}. Only say yes if you started this yourself, just now, from your own Claude. If somebody sent you a link to this page, say no.`
                : "To an app on this computer. Only say yes if you started this yourself, just now, on this computer. If somebody sent you a link to this page, say no."}
            </p>
          </div>

          <fieldset>
            <legend className="bk-h2 mb-3">
              <span className="cap-trim">What it may do</span>
            </legend>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="bk-panel flex min-h-11 cursor-pointer items-start gap-3 p-3">
                <input
                  type="radio"
                  name="role"
                  value="viewer"
                  defaultChecked
                  className="accent-navy mt-1 size-5 shrink-0"
                />
                <span>
                  <span className="block font-semibold">Look</span>
                  <span className="bk-muted block text-[0.9375rem] leading-snug">
                    Read orders, customers, stock, the inbox and the numbers. It
                    changes nothing.
                  </span>
                </span>
              </label>
              <label className="bk-panel flex min-h-11 cursor-pointer items-start gap-3 p-3">
                <input
                  type="radio"
                  name="role"
                  value="staff"
                  className="accent-navy mt-1 size-5 shrink-0"
                />
                <span>
                  <span className="block font-semibold">
                    Look and make changes
                  </span>
                  <span className="bk-muted block text-[0.9375rem] leading-snug">
                    Also add notes, tasks, drafts and stock counts. Anything
                    that sends, publishes or cannot be undone still waits for
                    your yes, here in the back end.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <ul className="list-disc pl-5 leading-relaxed">
            <li>
              It will be able to read customers&apos; names, addresses, emails
              and orders. What it reads goes to the company that makes Claude,
              under your own agreement with them.
            </li>
            <li>
              It can never do more than your own account can, and what it does
              is written in the activity log under its own name.
            </li>
            <li>You can cut it off at any time, under Settings, Claude.</li>
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton name="decision" value="yes" pending="Connecting">
              Connect
            </SubmitButton>
            <SubmitButton
              name="decision"
              value="no"
              pending="Going back"
              className="bk-btn bk-btn-quiet"
            >
              No, do not connect
            </SubmitButton>
          </div>
        </form>
      </Panel>
    </>
  );
}
