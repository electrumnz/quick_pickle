import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Notice,
  PageHeader,
  Panel,
  Pill,
  When,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { countWaiting } from "@/lib/backstage/connect/approvals";
import {
  connectStatus,
  listConnections,
  ROLE_SAID,
} from "@/lib/backstage/connect/oauth";
import { execute } from "@/lib/backstage/core/op";
import { backstageMode } from "@/lib/backstage/mode";
import { getDb } from "@/lib/db/client";

import { cutOffAction, setConnectOnAction } from "./actions";

export const metadata: Metadata = { title: "Claude" };

/**
 * Connecting Claude: whether it can be, the address to give it, who has
 * connected one, and the button that cuts one off. It ships switched off,
 * and nothing here does anything until an owner switches it on.
 */
export default async function ClaudeSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff("/backstage/settings/claude");
  const params = await searchParams;
  const caller = await staffCaller();
  const live = backstageMode() === "live";
  const status = await execute(connectStatus, {}, caller);
  const connections = live ? await execute(listConnections, {}, caller) : [];
  const waiting = live ? await countWaiting(await getDb()) : 0;
  const isOwner = staff.role === "owner";
  const working = connections.filter((each) => each.ended === null);
  const ended = connections.filter((each) => each.ended !== null).slice(0, 8);
  const on = live && status.on;

  return (
    <>
      <PageHeader
        title="Claude"
        back={{ href: "/backstage/settings", label: "Settings" }}
        lead={
          on
            ? "On. Staff can connect their own Claude, to look things up and do the day-to-day for them."
            : "Off. Switched on, you can connect your own Claude to the back end, so it can look things up and do the day-to-day for you."
        }
      />
      {params.notice ? (
        <div className="mb-5">
          <Notice tone={params.tone === "bad" ? "bad" : "good"}>
            {params.notice}
          </Notice>
        </div>
      ) : null}
      {live ? null : (
        <div className="mb-5">
          <Notice tone="bad">
            This back end is running on invented records, so there is nothing
            real to connect Claude to. It can be connected once a database is.
          </Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <h2 className="bk-h2">
            <span className="cap-trim">What it can and cannot do</span>
          </h2>
          <ul className="mt-3 list-disc pl-5 leading-relaxed">
            <li>
              It can read what you can read: orders, customers, stock, the
              inbox, the numbers.
            </li>
            <li>
              If you let it, it can make ordinary changes: a note, a task, a
              draft, a count of stock.
            </li>
            <li>
              It cannot send, publish, refund or delete anything. It can only
              ask, and what it asked for waits here for your yes.
            </li>
            <li>
              It can never do more than your own account, never what only an
              owner may do, and everything it does is in the activity log under
              its own name.
            </li>
          </ul>
          {live && isOwner ? (
            <form action={setConnectOnAction} className="mt-5">
              <input type="hidden" name="on" value={on ? "no" : "yes"} />
              <SubmitButton
                pending="Saving"
                className={on ? "bk-btn bk-btn-quiet" : "bk-btn"}
              >
                {on ? "Stop Claude connecting" : "Let Claude be connected"}
              </SubmitButton>
              <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
                {on
                  ? "Every connection stops working at once. They are kept, and work again if this is switched back on."
                  : "Claude will be able to read customers' names, addresses, emails and orders. What it reads goes to the company that makes Claude."}
              </p>
            </form>
          ) : live ? (
            <p className="bk-muted mt-5 text-[0.9375rem] leading-snug">
              An owner switches this on and off.
            </p>
          ) : null}
        </Panel>

        <Panel>
          <h2 className="bk-h2">
            <span className="cap-trim">To connect yours</span>
          </h2>
          {on ? (
            <>
              <ol className="mt-3 list-decimal pl-5 leading-relaxed">
                <li>In Claude, add a custom connector.</li>
                <li>Give it this address:</li>
              </ol>
              <label htmlFor="address" className="sr-only">
                The address to give Claude
              </label>
              <input
                id="address"
                readOnly
                value={status.address}
                className="field mt-2 font-mono text-[0.9375rem]"
              />
              <ol start={3} className="mt-3 list-decimal pl-5 leading-relaxed">
                <li>
                  Claude sends you back here to say yes, and to choose what it
                  may do.
                </li>
              </ol>
            </>
          ) : (
            <p className="bk-muted mt-3 leading-snug">
              There is an address to give Claude once this is switched on.
            </p>
          )}
          <p className="mt-4 leading-snug">
            {waiting === 0
              ? "Nothing is waiting for your yes."
              : `${String(waiting)} ${waiting === 1 ? "thing is" : "things are"} waiting for your yes.`}{" "}
            <Link
              href="/backstage/approvals"
              className="underline decoration-2 underline-offset-4"
            >
              Waiting for a yes
            </Link>
          </p>
        </Panel>
      </div>

      <section className="mt-8">
        <Panel>
          <h2 className="bk-h2">
            <span className="cap-trim">Connections</span>
          </h2>
          {working.length === 0 ? (
            <p className="bk-muted mt-3 leading-snug">
              {isOwner
                ? "Nobody has a Claude connected."
                : "You have no Claude connected."}
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3" data-testid="connections">
              {working.map((each) => (
                <li
                  key={each.id}
                  className="card-flat flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="leading-snug font-semibold">
                      {each.clientName}, for {each.yours ? "you" : each.forName}
                    </p>
                    <p className="bk-muted text-[0.9375rem] leading-snug">
                      It {ROLE_SAID[each.role]}. Connected{" "}
                      <When at={each.createdAt} />
                      {each.lastUsedAt === null ? (
                        ", not used yet."
                      ) : (
                        <>
                          , last used <When at={each.lastUsedAt} />.
                        </>
                      )}
                    </p>
                  </div>
                  {each.yours || isOwner ? (
                    <form action={cutOffAction}>
                      <input type="hidden" name="id" value={each.id} />
                      <SubmitButton
                        pending="Cutting off"
                        className="bk-btn bk-btn-quiet"
                      >
                        Cut off
                      </SubmitButton>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {ended.length === 0 ? null : (
            <>
              <h3 className="label bk-muted mt-6 text-[1rem]">
                <span className="cap-trim">Ended</span>
              </h3>
              <ul className="mt-2 flex flex-col gap-2 text-[0.9375rem]">
                {ended.map((each) => (
                  <li key={each.id} className="leading-snug">
                    <Pill tone="off">Ended</Pill> {each.clientName}, for{" "}
                    {each.yours ? "you" : each.forName}. {each.ended?.why}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </section>
    </>
  );
}
