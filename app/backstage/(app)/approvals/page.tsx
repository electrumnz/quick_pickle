import type { Metadata } from "next";
import Link from "next/link";

import { Empty, PageHeader, Panel, When } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { listApprovals } from "@/lib/backstage/connect/approvals";
import { execute } from "@/lib/backstage/core/op";

import { StatusPill, titleOf } from "./shared";

export const metadata: Metadata = { title: "Waiting for a yes" };

/**
 * What a bot has asked to do that needs a person's yes. Nothing on this
 * list has happened: each is something that sends, publishes or cannot be
 * undone, and it waits here until somebody decides.
 */
export default async function ApprovalsPage() {
  await requireStaff("/backstage/approvals");
  const caller = await staffCaller();
  const waiting = await execute(listApprovals, { status: "waiting" }, caller);
  const decided = await execute(
    listApprovals,
    { status: "decided", limit: 20 },
    caller,
  );

  return (
    <>
      <PageHeader
        title="Waiting for a yes"
        back={{ href: "/backstage", label: "Today" }}
        lead={
          waiting.length === 0
            ? "Nothing is waiting. When Claude wants to send, publish or delete something, it asks here first."
            : "Claude has asked to do these. None of them has happened. Open one to see exactly what it would do, then say yes or no."
        }
      />
      <Panel flush>
        {waiting.length === 0 ? (
          <Empty title="Nothing is waiting">
            Claude can look things up and make ordinary changes by itself.
            Anything that reaches a customer, or cannot be undone, waits here.
          </Empty>
        ) : (
          <ul className="bk-rows" data-testid="approvals-waiting">
            {waiting.map((each) => (
              <li key={each.id}>
                <Link
                  href={`/backstage/approvals/${each.id}`}
                  className="bk-row"
                >
                  <span className="min-w-0">
                    <span className="block leading-snug font-semibold">
                      {titleOf(each.operation)}
                    </span>
                    <span className="bk-muted block text-[0.9375rem] leading-snug">
                      {each.says}
                    </span>
                    <span className="bk-muted block text-[0.9375rem] leading-snug">
                      {each.requestedBy}, <When at={each.requestedAt} />
                    </span>
                  </span>
                  <StatusPill status={each.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {decided.length === 0 ? null : (
        <section className="mt-8">
          <Panel title="Decided" flush>
            <ul className="bk-rows">
              {decided.map((each) => (
                <li key={each.id}>
                  <Link
                    href={`/backstage/approvals/${each.id}`}
                    className="bk-row"
                  >
                    <span className="min-w-0">
                      <span className="block leading-snug font-semibold">
                        {titleOf(each.operation)}
                      </span>
                      <span className="bk-muted block text-[0.9375rem] leading-snug">
                        {each.requestedBy}, <When at={each.requestedAt} />
                      </span>
                    </span>
                    <StatusPill status={each.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      )}
    </>
  );
}
