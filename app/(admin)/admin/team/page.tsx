import type { Metadata } from "next";
import Link from "next/link";

import {
  Callout,
  Card,
  CardBody,
  PageHeader,
  PageSections,
  Section,
} from "@/components/admin";

export const metadata: Metadata = {
  title: "The Team",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The Team — a quiet pointer to Grok Bot.
 *
 * There is no live roster, no run-now, and no in-site chat. Samuel's friend
 * signs into this admin on the Bot computer; work shows up in the activity log.
 */
export default function TeamPage() {
  return (
    <>
      <PageHeader
        title="The Team"
        lede="Grok Bot sits at this admin keyboard. There is no in-site AI roster any more."
      />

      <PageSections>
        <Section title="Who runs the day to day">
          <Card>
            <CardBody className="space-y-4">
              <p className="text-body-sm text-primary">
                Half Sour keeps the brine business here — stock, batches,
                recipes, shop, orders, Mirror troubles. The person at the
                keyboard for AI work is Grok Bot, signed in like any operator.
              </p>
              <p className="text-body-sm text-muted">
                Visibility is the{" "}
                <Link
                  href="/admin/activity"
                  className="text-primary underline underline-offset-2 hover:no-underline"
                >
                  activity log
                </Link>
                , which reads the same audit trail every write already leaves.
                Nothing spends on a model from inside this site.
              </p>
              <Callout title="Install and standing rules">
                Friend-facing steps — install Grok Bot, sign into
                https://half-sour.vercel.app/admin on the Bot computer, never
                paste secrets — live in{" "}
                <code className="text-primary">docs/grok-bot-adoption.md</code>{" "}
                in the repository. Open that file locally or on GitHub; it is
                not an admin screen.
              </Callout>
            </CardBody>
          </Card>
        </Section>

        <Section title="What Mirror is">
          <Card>
            <CardBody className="space-y-3">
              <p className="text-body-sm text-primary">
                Mirror is the Shopify sync schema and the dashboard troubles
                that come from failed webhooks or stuck sync state. It is not a
                teammate and not a live Shopify client from this admin.
              </p>
              <p className="text-caption text-muted">
                Troubles still surface on Today under Needs you when something
                fails to file.
              </p>
            </CardBody>
          </Card>
        </Section>
      </PageSections>
    </>
  );
}
