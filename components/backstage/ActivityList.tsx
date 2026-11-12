import type { ActivityLine } from "@/lib/backstage/activity/ops";

import { Empty, Pill, When } from "./ui";

const VIA_LABEL: Readonly<Record<string, string>> = {
  ui: "",
  mcp: "via Claude",
  automation: "automation",
  cron: "on schedule",
  webhook: "from outside",
  storefront: "the shop",
  script: "script",
};

/** The activity log, as a list a person can read down. */
export function ActivityList({
  lines,
  now,
  empty = "Nothing has been done here yet.",
}: {
  readonly lines: readonly ActivityLine[];
  readonly now: Date;
  readonly empty?: string;
}) {
  if (lines.length === 0) {
    return <Empty title="All quiet">{empty}</Empty>;
  }
  return (
    <ul className="bk-rows">
      {lines.map((line) => {
        const via = VIA_LABEL[line.via] ?? line.via;
        return (
          <li
            key={line.id}
            className="bk-row grid-cols-1 md:grid-cols-[1fr_auto]"
          >
            <div className="min-w-0">
              <p className="leading-snug [overflow-wrap:anywhere]">
                {line.summary}
              </p>
              <p className="bk-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.9375rem]">
                <span>{line.actorName}</span>
                {line.actorType === "bot" ? (
                  <Pill tone="doing">Bot</Pill>
                ) : null}
                {via !== "" ? <span>· {via}</span> : null}
              </p>
            </div>
            <p className="bk-muted text-[0.9375rem] whitespace-nowrap md:text-right">
              <When at={line.at} now={now} />
            </p>
          </li>
        );
      })}
    </ul>
  );
}
