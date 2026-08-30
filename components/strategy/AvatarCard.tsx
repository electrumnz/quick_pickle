import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DefinitionList,
  Row,
  Rows,
} from "@/components/admin/ui/primitives";
import { Field, Points } from "@/components/strategy/pieces";
import { formatCents } from "@/content/strategy/market";
import type { CustomerAvatar } from "@/content/strategy/types";

/**
 * One customer, at the length a decision needs.
 *
 * The order is the order a person asks the questions in: who, what job, what
 * they do instead, where they are, what makes them buy, what stops them, what
 * they will pay — and last and most important, what brings them back, because
 * at 10,560 bottles a year the second order is half the business.
 *
 * The two blocks at the end are the ones that keep this honest: how many of
 * this person the plan needs, and who this person is not.
 */
export function AvatarCard({ avatar }: { avatar: CustomerAvatar }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={avatar.label}
          note={avatar.id === "b2c" ? "Buys one bottle" : "Buys cases"}
        />
        <CardBody className="space-y-4">
          <p className="max-w-prose text-body text-primary">
            {avatar.headline}
          </p>
          <Field label="Who they are">{avatar.who}</Field>
          <Field
            label="The job they are hiring a bottle to do"
            hint="One job. If there were two, there would be two avatars."
          >
            {avatar.jobToBeDone}
          </Field>
          <Field
            label="Where this comes from"
            hint="The BrandScript character this deepens"
          >
            <span className="font-mono text-caption">{avatar.derivedFrom}</span>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Their week"
          count={avatar.week.length}
          note="Where a piece of work could land"
        />
        <Rows>
          {avatar.week.map((moment) => (
            <Row key={moment.when}>
              <p className="text-body-sm font-medium text-primary">
                {moment.when}
              </p>
              <p className="mt-1 max-w-prose text-caption text-muted">
                {moment.what}
              </p>
              <p className="mt-1 max-w-prose text-caption text-muted">
                <span className="text-primary">Our window:</span>{" "}
                {moment.ourWindow}
              </p>
            </Row>
          ))}
        </Rows>
      </Card>

      <Card>
        <CardHeader
          title="What they do instead today"
          count={avatar.insteadToday.length}
          note="This, not another brine, is the competition"
        />
        <Rows>
          {avatar.insteadToday.map((option) => (
            <Row key={option.option}>
              <p className="text-body-sm font-medium text-primary">
                {option.option}
              </p>
              <p className="mt-1 max-w-prose text-caption text-muted">
                <span className="text-primary">Why it survives:</span>{" "}
                {option.whyItPersists}
              </p>
              <p className="mt-1 max-w-prose text-caption text-muted">
                <span className="text-primary">What it costs them:</span>{" "}
                {option.whatItCosts}
              </p>
            </Row>
          ))}
        </Rows>
      </Card>

      <Card>
        <CardHeader
          title="Where they are, and what they read there"
          count={avatar.whereTheyAre.length}
        />
        <Rows>
          {avatar.whereTheyAre.map((place) => (
            <Row key={place.place}>
              <p className="text-body-sm font-medium text-primary">
                {place.place}
              </p>
              <p className="mt-1 max-w-prose text-caption text-muted">
                {place.reading}
              </p>
              <p className="mt-1 max-w-prose text-caption text-muted">
                <span className="text-primary">Reached by:</span>{" "}
                {place.reachedBy}
              </p>
            </Row>
          ))}
        </Rows>
      </Card>

      <Card>
        <CardHeader
          title="What starts a purchase"
          count={avatar.triggers.length}
          note="A piece of work that sits on none of these is decoration"
        />
        <Rows>
          {avatar.triggers.map((trigger) => (
            <Row key={trigger.trigger}>
              <p className="text-body-sm font-medium text-primary">
                {trigger.trigger}
              </p>
              <p className="mt-1 max-w-prose text-caption text-muted">
                They then: {trigger.whatTheyDoNext}
              </p>
              <p className="mt-1 max-w-prose text-caption text-muted">
                <span className="text-primary">Needs:</span> {trigger.needs}
              </p>
            </Row>
          ))}
        </Rows>
      </Card>

      <Card>
        <CardHeader
          title="What stops them"
          count={avatar.whatStopsThem.length}
          note="Marked by whether a page can settle it"
        />
        <Rows>
          {avatar.whatStopsThem.map((stop) => (
            <Row key={stop.objection}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                <p className="text-body-sm font-medium text-primary">
                  {stop.objection}
                </p>
                <Badge tone={stop.answerableOnSite ? "quiet" : "neutral"}>
                  {stop.answerableOnSite
                    ? "A page can settle it"
                    : "Needs a person"}
                </Badge>
              </div>
              <p className="mt-1 max-w-prose text-caption text-muted">
                {stop.ourAnswer}
              </p>
            </Row>
          ))}
        </Rows>
      </Card>

      <Card>
        <CardHeader
          title="Price"
          note="What they compare it against, and where they stop"
        />
        <CardBody className="space-y-4">
          <Field label="They price it against">{avatar.price.anchor}</Field>
          <DefinitionList
            items={[
              ...avatar.price.comparedWith.map((item) => ({
                term: item.thing,
                value: formatCents(item.cents),
                hint: item.note,
              })),
              {
                term: "Pays without thinking",
                value: formatCents(avatar.price.unblinkingCents),
              },
              {
                term: "Stops to think",
                value: formatCents(avatar.price.deliberateCents),
              },
            ]}
          />
          <Field label="The cost that is not on the price tag">
            {avatar.price.hiddenCost}
          </Field>
          <Field label="In short">{avatar.price.note}</Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="What would make them buy again"
          note="At two production days a week, this is the business"
        />
        <CardBody className="space-y-4">
          <DefinitionList
            items={[
              { term: "Cadence", value: avatar.repeat.cadence },
              {
                term: "Bottles a year",
                value: String(avatar.repeat.bottlesPerYear),
              },
              { term: "The number to watch", value: avatar.repeat.theCheck },
            ]}
          />
          <Field label="What brings them back">
            <Points items={avatar.repeat.whatBringsThemBack} />
          </Field>
          <Field label="What loses them">
            <Points items={avatar.repeat.whatLosesThem} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="How many of them the plan needs"
          note="Straight out of the market model"
        />
        <CardBody className="space-y-4">
          <DefinitionList
            items={[
              { term: "Channel", value: avatar.counted.channel },
              { term: "How many", value: avatar.counted.howMany },
              {
                term: "Share of what can be made",
                value: avatar.counted.capacityShare,
              },
              {
                term: "Counted by",
                value: (
                  <span className="font-mono text-caption break-words">
                    {avatar.counted.countedBy.join(", ")}
                  </span>
                ),
                hint: "Assumptions on the Market screen. Change one and this moves.",
              },
            ]}
          />
          <Field
            label="Who this is not"
            hint="Named so that a sentence does not widen to include them"
          >
            <Points items={avatar.notThisPerson} />
          </Field>
        </CardBody>
      </Card>
    </div>
  );
}
