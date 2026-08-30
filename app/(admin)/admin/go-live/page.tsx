import type { Metadata } from "next";

import { CopyPrompt } from "@/components/admin/go-live/CopyPrompt";
import { PageHeader, PageSections, Section } from "@/components/admin/ui/page";
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  DefinitionList,
  Meter,
  Row,
  Rows,
} from "@/components/admin/ui/primitives";
import {
  goLiveProgress,
  type GoLiveTask,
  type GoLiveUrgency,
} from "@/content/go-live";

export const metadata: Metadata = {
  title: "Go live",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Go live — the handover, on one screen.
 *
 * Everything still standing between the founder and trading for real, in the
 * order it should be done, each one with the exact words to paste into a Claude
 * Code session to get it done. It reads `content/go-live.ts` and holds no copy
 * of its own, so the page and the checklist cannot say different things.
 *
 * It is ordered by what holds up the most, not by how hard each is: the origin
 * claim sitting live on a product page comes first because it is unlawful while
 * it is published and takes ten minutes to take down, then the two settings
 * without which no money can be taken at all.
 *
 * This is the one page in the admin she will stop visiting. That is why it is
 * not one of the destinations in the sidebar's main list — it sits under them,
 * behind a rule, on its own.
 */

const URGENCY_WORD: Readonly<Record<GoLiveUrgency["kind"], string>> = {
  law: "Against the law today",
  blocks: "Blocks everything else",
  clock: "On a clock",
};

const URGENCY_TERM: Readonly<Record<GoLiveUrgency["kind"], string>> = {
  law: "Why it cannot wait",
  blocks: "What it holds up",
  clock: "What changes on a date",
};

export default function GoLivePage() {
  const { total, done, remaining, finished, next } = goLiveProgress();

  return (
    <>
      <PageHeader
        title="Go live"
        lede="Everything still standing between you and trading for real, in the order to do it. Every one of these says why it matters and hands you the exact words to paste into Claude Code."
        meta={
          <>
            <span className="tabular-nums">
              {done} of {total} done
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {next === null
                ? "Nothing left on the list"
                : `Next: ${next.title}`}
            </span>
          </>
        }
      />

      <PageSections>
        <Card>
          <CardBody className="space-y-3">
            <p className="max-w-prose text-body-sm text-primary">
              {done === 0
                ? `None of these ${String(total)} are done yet. The first two are the ones that matter most: one of them is unlawful while it sits there, and the other is the reason no money can be taken.`
                : done === total
                  ? `All ${String(total)} are done. There is nothing left on this page that is stopping you trading.`
                  : `${String(done)} of ${String(total)} done, ${String(remaining.length)} to go.`}
            </p>
            {done > 0 && (
              <Meter
                value={done}
                max={total}
                label={`${String(done)} of ${String(total)} done`}
              />
            )}
            {next !== null && (
              <p className="text-caption text-muted">
                Next:{" "}
                <a
                  href={`#${next.id}`}
                  className="rounded-sm text-link underline underline-offset-4 hover:no-underline"
                >
                  {next.title}
                </a>
              </p>
            )}
          </CardBody>
        </Card>

        {remaining.length === 0 ? (
          <Card>
            <CardBody>
              <p className="max-w-prose text-body-sm text-primary">
                That is the whole list. Nothing here is standing between you and
                trading, and this page has done its job — you should not need to
                come back to it.
              </p>
            </CardBody>
          </Card>
        ) : (
          <Section
            title="Still to do"
            description="Top to bottom is the order to do them in. Nothing below needs anything above it to be finished first, so if one of them stalls, move down."
          >
            <ol className="space-y-4">
              {remaining.map((task, index) => (
                <TaskCard key={task.id} task={task} position={index + 1} />
              ))}
            </ol>
          </Section>
        )}

        {finished.length > 0 && (
          <Section
            title="Already done"
            description="Kept here rather than deleted, so you can see what this list used to hold."
          >
            <Card>
              <CardHeader title="Done" count={finished.length} />
              <Rows>
                {finished.map((task) => (
                  <Row key={task.id}>
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body-sm text-primary">
                      {task.title}
                      <Badge tone="quiet">Done</Badge>
                    </p>
                    <p className="mt-0.5 max-w-prose text-caption text-muted">
                      {task.what}
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>
          </Section>
        )}

        <Callout title="How this page stays true">
          The list itself lives in the repository, at{" "}
          <span className="font-mono">content/go-live.ts</span>, and not in the
          database — the database here is rebuilt on every deploy and would wipe
          it. When a Claude Code session finishes one of these it marks it done
          in that file and ticks the same item in{" "}
          <span className="font-mono">TODO.md</span>, and a test fails if the
          two ever disagree. So what you are reading is what is actually left.
        </Callout>
      </PageSections>
    </>
  );
}

// ---------------------------------------------------------------------------

function TaskCard({ task, position }: { task: GoLiveTask; position: number }) {
  const { urgency } = task;
  return (
    <li id={task.id} className="scroll-mt-24">
      <Card>
        <div className="border-b border-hairline px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
            <span
              aria-hidden="true"
              className="font-mono text-caption text-muted tabular-nums"
            >
              {position}
            </span>
            <h3 className="font-sans text-body font-semibold tracking-tight text-primary">
              {task.title}
            </h3>
            {urgency !== null && (
              <Badge tone={urgency.kind === "law" ? "danger" : "strong"}>
                {URGENCY_WORD[urgency.kind]}
              </Badge>
            )}
          </div>
          <p className="mt-1 max-w-prose text-body-sm text-muted">
            {task.what}
          </p>
        </div>
        <CardBody>
          <DefinitionList
            items={[
              { term: "Why it matters", value: task.why },
              ...(urgency === null
                ? []
                : [
                    {
                      term: URGENCY_TERM[urgency.kind],
                      value: urgency.text,
                    },
                  ]),
              { term: "Until it is done", value: task.until },
              ...(task.waiting.length === 0
                ? []
                : [
                    {
                      term: "Waiting on it",
                      value: (
                        <ul className="space-y-0.5">
                          {task.waiting.map((item) => (
                            <li key={item} className="flex gap-2">
                              <span aria-hidden="true" className="text-muted">
                                &#8226;
                              </span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ),
                    },
                  ]),
              { term: "How long it takes", value: task.howLong },
              ...(task.place === null
                ? []
                : [
                    {
                      term: "Where to go",
                      value:
                        task.place.href === null ? (
                          task.place.label
                        ) : (
                          <a
                            href={task.place.href}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-sm text-link underline underline-offset-4 hover:no-underline"
                          >
                            {task.place.label}
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </a>
                        ),
                    },
                  ]),
            ]}
          />
          <CopyPrompt prompt={task.prompt} taskTitle={task.title} />
        </CardBody>
      </Card>
    </li>
  );
}
