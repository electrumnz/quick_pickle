import type { Metadata } from "next";
import Link from "next/link";

import { Empty, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { flavourName } from "@/lib/backstage/stock/flavours";
import { listBatches } from "@/lib/backstage/stock/ops";
import { NEAR_BEST_BEFORE_DAYS } from "@/lib/backstage/stock/status";

import {
  BatchStatusPill,
  BestBeforePill,
  count,
  DateText,
  FormNotice,
} from "../parts";

export const metadata: Metadata = { title: "Batches" };

const TABS = [
  { key: "all", label: "All" },
  { key: "planned", label: "Planned" },
  { key: "made", label: "Made" },
  { key: "released", label: "Released" },
  { key: "closed", label: "Closed" },
  { key: "recalled", label: "Recalled" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const status: TabKey =
    TABS.find((tab) => tab.key === params.status)?.key ?? "all";
  // Batches are few (one for each run of making), so the tabs and their
  // counts come from the one list.
  const all = await execute(listBatches, { limit: 200 }, await staffCaller());
  const rows =
    status === "all" ? all : all.filter((batch) => batch.status === status);
  const countFor = (key: TabKey) =>
    key === "all"
      ? all.length
      : all.filter((batch) => batch.status === key).length;
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Batches"
        back={{ href: "/backstage/stock", label: "Stock" }}
        lead="Each run of making, by the code printed on its bottles."
        actions={
          canWrite && all.length > 0 ? (
            <Link href="/backstage/stock/batches/new" className="bk-btn">
              <span className="cap-trim">Plan a batch</span>
            </Link>
          ) : null
        }
      />
      <FormNotice notice={params.notice} tone={params.tone} />

      {all.length === 0 ? (
        <Panel flush>
          <Empty title="No batches yet">
            A batch is one run of making. Plan it here, record it once it is
            made, then release it for sale. From then on every order is tied to
            the batch it was filled from.
          </Empty>
          {canWrite ? (
            <p className="-mt-4 pb-8 text-center">
              <Link href="/backstage/stock/batches/new" className="bk-btn">
                <span className="cap-trim">Plan the first batch</span>
              </Link>
            </p>
          ) : null}
        </Panel>
      ) : (
        <>
          <nav aria-label="Batch states" className="mb-4">
            <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
              {TABS.map((tab) => {
                const current = tab.key === status;
                return (
                  <li key={tab.key} className="shrink-0">
                    <Link
                      href={`/backstage/stock/batches?status=${tab.key}`}
                      aria-current={current ? "page" : undefined}
                      className={`bk-btn ${current ? "" : "bk-btn-quiet"}`}
                    >
                      <span className="cap-trim">
                        {tab.label} {countFor(tab.key)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <Panel flush>
            {rows.length === 0 ? (
              <Empty title="Nothing here">No batches in this state.</Empty>
            ) : (
              <ul className="bk-rows">
                {rows.map((batch) => (
                  <li key={batch.id}>
                    <Link
                      href={`/backstage/stock/batches/${batch.code}`}
                      className="bk-row grid-cols-[1fr_auto] md:grid-cols-[7rem_1.4fr_1fr_1fr_8rem]"
                    >
                      <span className="font-semibold tabular-nums">
                        {batch.code}
                      </span>
                      <span className="row-start-2 min-w-0 md:row-auto">
                        <span className="block truncate">{batch.name}</span>
                        <span className="bk-muted block truncate text-[0.9375rem]">
                          {flavourName(batch.flavour)}
                        </span>
                      </span>
                      <span className="bk-muted col-span-2 row-start-3 text-[0.9375rem] md:col-span-1 md:row-auto">
                        {batch.status === "planned" ? "Planned for " : "Made "}
                        <DateText date={batch.madeOn} none="no date yet" />
                      </span>
                      <span className="bk-muted col-span-2 row-start-4 flex flex-wrap items-center gap-2 text-[0.9375rem] md:col-span-1 md:row-auto">
                        <span>
                          Best before{" "}
                          <DateText date={batch.bestBefore} none="not set" />
                        </span>
                        <BestBeforePill
                          days={
                            batch.onHand > 0 ? batch.daysToBestBefore : null
                          }
                          within={NEAR_BEST_BEFORE_DAYS}
                        />
                      </span>
                      <span className="col-start-2 row-span-2 row-start-1 flex flex-col items-end gap-1 md:col-auto md:row-span-1 md:row-auto">
                        <BatchStatusPill status={batch.status} />
                        <span className="bk-num text-[0.9375rem]">
                          {batch.status === "planned" ? (
                            <span className="bk-muted">
                              {batch.shotsPlanned === null
                                ? "No number yet"
                                : `${count(batch.shotsPlanned)} planned`}
                            </span>
                          ) : (
                            <>
                              <span className="font-semibold">
                                {count(batch.onHand)}
                              </span>{" "}
                              <span className="bk-muted">on hand</span>
                            </>
                          )}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
