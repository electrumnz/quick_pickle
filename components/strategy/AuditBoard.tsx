import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Meter,
  Row,
  Rows,
  Stat,
  StatGrid,
} from "@/components/admin/ui/primitives";
import type { AudienceAvatars, AudienceId } from "@/content/strategy/types";
import type { AuditFinding, AuditRun, AuditSeverity } from "@/lib/strategy";

/**
 * The storefront's current score against the two avatars.
 *
 * Three things in one screen, in the order a person needs them: how many checks
 * pass, the one fix that clears the most, and then every check with what was
 * actually found on the page. The middle one is the only part that is a
 * decision; the rest is the evidence for it.
 *
 * Red is the normal state of this board while the store is unfinished, so
 * nothing here is styled as an alarm. A failing check is a piece of work with a
 * page attached, and it says which page.
 */

const SEVERITY_WORDS: Record<AuditSeverity, string> = {
  blocking: "Stops them",
  serious: "Loses some of them",
  friction: "Costs trust",
};

function severityBadge(severity: AuditSeverity) {
  return (
    <Badge tone={severity === "blocking" ? "danger" : "neutral"}>
      {SEVERITY_WORDS[severity]}
    </Badge>
  );
}

function avatarName(avatars: AudienceAvatars, id: AudienceId): string {
  return avatars.avatars[id].label;
}

function FindingRow({
  finding,
  avatars,
}: {
  finding: AuditFinding;
  avatars: AudienceAvatars;
}) {
  return (
    <Row>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <p className="text-body-sm font-medium text-primary">
          {finding.question}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {severityBadge(finding.severity)}
          <Badge tone={finding.passed ? "positive" : "strong"}>
            {finding.passed ? "Passing" : "Failing"}
          </Badge>
        </div>
      </div>
      <p className="mt-1.5 max-w-prose text-caption text-muted">
        <span className="text-primary">Found:</span> {finding.detail}
      </p>
      {!finding.passed && (
        <p className="mt-1 max-w-prose text-caption text-muted">
          <span className="text-primary">What it costs:</span>{" "}
          {finding.whyItMatters}
        </p>
      )}
      <p className="mt-1.5 font-mono text-caption break-words text-muted">
        {avatarName(avatars, finding.avatar)} · {finding.id} ·{" "}
        {finding.paths.join(" ")}
      </p>
    </Row>
  );
}

export function AuditBoard({
  run,
  avatars,
  baseUrl,
  elapsedMs,
}: {
  run: AuditRun;
  avatars: AudienceAvatars;
  baseUrl: string;
  elapsedMs: number;
}) {
  const failing = run.findings.filter((finding) => !finding.passed);

  return (
    <div className="space-y-6">
      <StatGrid columns={4}>
        <Stat
          label="Checks passing"
          value={`${String(run.passed)} of ${String(run.total)}`}
          hint={`Run just now against ${baseUrl}, page by page, in ${String(Math.round(elapsedMs / 100) / 10)}s.`}
          tone={run.passed === run.total ? "neutral" : "danger"}
        />
        {run.scores.map((score) => (
          <Stat
            key={score.avatar}
            label={avatarName(avatars, score.avatar)}
            value={`${String(score.passed)} of ${String(score.total)}`}
            hint={
              score.blocking === 0
                ? "Nothing on this list stops them completing what they came for."
                : `${String(score.blocking)} of the failures stop them completing what they came for.`
            }
            tone={score.blocking > 0 ? "danger" : "neutral"}
          />
        ))}
        <Stat
          label="Fixes outstanding"
          value={String(run.fixFirst.length)}
          hint={`${String(failing.length)} failing checks, and several share one fix.`}
        />
      </StatGrid>

      <div>
        <Meter
          value={run.passed}
          max={run.total}
          label={`${String(run.passed)} of ${String(run.total)} checks passing`}
          tone={run.passed * 2 < run.total ? "danger" : "neutral"}
        />
      </div>

      <Card>
        <CardHeader
          title="What to fix first"
          count={run.fixFirst.length}
          note="Worst first, then whichever fix clears the most"
        />
        {run.fixFirst.length === 0 ? (
          <CardBody>
            <p className="max-w-prose text-body-sm text-primary">
              Nothing is failing. Every check the two avatars imply passes
              against the live store — which is the moment to write harder
              checks rather than the moment to stop.
            </p>
          </CardBody>
        ) : (
          <Rows>
            {run.fixFirst.map((group, index) => (
              <Row key={group.fix}>
                <div className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 font-mono text-caption text-muted tabular-nums"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                      <p className="text-body-sm font-medium text-primary">
                        {group.fix}
                      </p>
                      {severityBadge(group.severity)}
                    </div>
                    <p className="mt-1 text-caption text-muted">
                      Clears {String(group.checkIds.length)}{" "}
                      {group.checkIds.length === 1 ? "check" : "checks"}:{" "}
                      <span className="font-mono">
                        {group.checkIds.join(", ")}
                      </span>
                    </p>
                  </div>
                </div>
              </Row>
            ))}
          </Rows>
        )}
      </Card>

      {run.unreachable.length > 0 && (
        <Callout title="Pages the audit could not reach" tone="danger">
          <p>
            {run.unreachable.join("; ")}. A check that could not read its page
            is reported as failing, because an audit that skips what it cannot
            see is an audit that always passes.
          </p>
        </Callout>
      )}

      {(["b2c", "b2b"] as const).map((audience) => (
        <Card key={audience}>
          <CardHeader
            title={avatarName(avatars, audience)}
            count={
              run.findings.filter((finding) => finding.avatar === audience)
                .length
            }
            note="Every check, and what was on the page"
          />
          <Rows>
            {run.findings
              .filter((finding) => finding.avatar === audience)
              .map((finding) => (
                <FindingRow
                  key={finding.id}
                  finding={finding}
                  avatars={avatars}
                />
              ))}
          </Rows>
        </Card>
      ))}
    </div>
  );
}
