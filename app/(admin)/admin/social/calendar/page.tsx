import type { Metadata } from "next";

import { load } from "@/components/admin/data/db";
import { plural, until } from "@/components/admin/data/format";
import { socialAccounts, socialPosts } from "@/components/admin/data/queries";
import {
  CalendarControls,
  CalendarMonth,
  CalendarWeek,
  GapSummary,
  PostPreview,
  StateLegend,
  UndatedPosts,
  calendarHref,
  dayInWords,
  periodTitle,
  periodWords,
  type CalendarView,
} from "@/components/admin/social";
import {
  ActionLink,
  DataUnavailable,
  NotBuiltYet,
  PageHeader,
  PageSections,
  Section,
} from "@/components/admin/ui/page";
import { Callout, Card, CardHeader } from "@/components/admin/ui/primitives";
import { Flash } from "@/components/admin/write/flash";
import { adminFormToken, requireAdminAccess } from "@/lib/auth/server";
import {
  addDays,
  addMonths,
  entriesByDay,
  isNzDay,
  monthGridDays,
  nzDay,
  nzToday,
  nzWallClock,
  placeOnDiary,
  weekDays,
  type NzDay,
} from "@/lib/social";

import { PostDiaryForm } from "../post-forms";

export const metadata: Metadata = {
  title: "Calendar",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The calendar — what is going out, when, and where the gaps are.
 *
 * The Social page answers "is this post any good" and it answers it well: the
 * caption rendered the way each platform will render it, with every limit it
 * is about to hit. What it cannot answer is "what does the next fortnight look
 * like", and for a company whose whole marketing is a feed, that is the
 * question that decides whether there is anything to look at at all.
 *
 * ## What it is, and what it deliberately is not
 *
 * **It is the same database, not a second one.** Every post here is a row in
 * `public.social_posts` — the table that already existed, with the
 * `scheduled_for` column that already existed. Nothing was added to the schema
 * for this screen. A published post is drawn on the day it went out; everything
 * else on the day it is due; anything with no date at all is listed underneath
 * rather than dropped, because a post nobody can see is a post that never goes
 * out.
 *
 * **It moves a post through the same door as everything else.** Rescheduling
 * is `schedulePostAction`, the action the Social page already used: session
 * checked, CSRF checked, `audit_log` row written, approval raised if the post
 * has none. There is no drag and drop, and not because it would be hard —
 * because a diary a person can only operate with a mouse is a diary she cannot
 * operate one-handed on a phone at a market, and because a drag has nowhere to
 * put the sentence saying that approving a post still does not post it.
 *
 * **It is honest when it is empty.** No account is connected to this
 * deployment and no agent has to be running for this page to work. An empty
 * September is a normal thing for a calendar to say, and it says it in those
 * words rather than as an error or as a blank.
 */

/** How far back and forward the page will read. Two years of a small feed. */
const POST_WINDOW = 400;

function first(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = params[key];
  return Array.isArray(raw) ? raw[0] : raw;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SocialCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Reads on an open demonstration need no session; writes still do. With
  // nobody signed in `adminFormToken` returns "", which `assertAdminCsrf` can
  // never accept, so the reschedule form is not drawn at all.
  const csrfToken = adminFormToken(await requireAdminAccess());
  const params = await searchParams;

  const today = nzToday();
  const view: CalendarView =
    first(params, "view") === "week" ? "week" : "month";
  const asked = first(params, "on") ?? "";
  const on: NzDay = isNzDay(asked) ? asked : today;
  const askedPost = first(params, "post") ?? "";
  const chosenId = UUID.test(askedPost) ? askedPost : null;

  const days = view === "month" ? monthGridDays(on) : weekDays(on);
  const previous = view === "month" ? addMonths(on, -1) : addDays(on, -7);
  const next = view === "month" ? addMonths(on, 1) : addDays(on, 7);
  const title = periodTitle(view, days, on);
  const words = periodWords(view, days, on);
  const back = calendarHref({ view, on, post: chosenId });

  const result = await load(async () => {
    const [accounts, posts] = await Promise.all([
      socialAccounts(),
      socialPosts(POST_WINDOW),
    ]);
    return { accounts, posts };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Calendar"
          lede="What is going out, when, and where the gaps are."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const { accounts, posts } = result.data;
  const handles: Record<string, string | null> = {};
  for (const account of accounts) {
    handles[account.platform] = account.isActive ? account.handle : null;
  }

  const { dated, undated } = placeOnDiary(posts);
  const entries = entriesByDay(dated);
  const inPeriod = days.flatMap((day) => entries.get(day) ?? []);
  const chosen =
    chosenId === null ? undefined : posts.find((post) => post.id === chosenId);
  const ahead = dated.filter((entry) => !entry.done && entry.day >= today);
  const nextOut = ahead[0];

  return (
    <>
      <PageHeader
        title="Calendar"
        lede="What is going out, when, and where the gaps are. Every time on this page is New Zealand time."
        meta={
          <>
            <span>{plural(ahead.length, "post")} still to go out</span>
            <span aria-hidden="true">·</span>
            <span>
              {nextOut === undefined
                ? "nothing booked ahead"
                : `next one ${until(nextOut.instant)}`}
            </span>
          </>
        }
        actions={<ActionLink href="/admin/social">Back to Social</ActionLink>}
      />

      <PageSections>
        <Flash searchParams={params} />

        <Section
          title={title}
          description={
            view === "month"
              ? "Whole weeks, Monday first. On a phone the empty days fold into the sentence that replaces them."
              : "Seven days in full: what each one carries, who drafted it, and where it stands."
          }
          action={
            <CalendarControls
              view={view}
              on={on}
              previous={previous}
              next={next}
              today={today}
              label={view === "month" ? "month" : "week"}
            />
          }
        >
          <div className="space-y-4">
            <GapSummary
              days={days}
              entries={entries}
              today={today}
              periodWords={words}
            />
            {view === "month" ? (
              <CalendarMonth
                days={days}
                entries={entries}
                today={today}
                focus={on}
                chosenPost={chosenId}
              />
            ) : (
              <CalendarWeek
                days={days}
                entries={entries}
                today={today}
                anchor={on}
                chosenPost={chosenId}
              />
            )}
            <StateLegend used={inPeriod.map((entry) => entry.status)} />
          </div>
        </Section>

        <Section
          id="chosen"
          title="The post you picked"
          description="The same preview the Social page shows, and the one control that moves it."
        >
          {chosen === undefined ? (
            <Card>
              <div className="px-4 py-6 text-center">
                <p className="text-body-sm font-semibold text-primary">
                  Nothing is picked
                </p>
                <p className="mx-auto mt-1.5 max-w-prose text-caption text-muted">
                  Choose any post on the calendar above and it opens here, drawn
                  the way the platform will draw it, with the field that moves
                  it to another day.
                </p>
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader
                title={
                  chosen.scheduledFor === null && chosen.publishedAt === null
                    ? "Not in the diary"
                    : dayInWords(
                        nzDay(chosen.publishedAt ?? chosen.scheduledFor ?? ""),
                      )
                }
              />
              <div className="space-y-4 px-4 py-4">
                <PostPreview
                  post={chosen}
                  handles={handles}
                  scope="calendar"
                  whenWords={
                    chosen.publishedAt !== null
                      ? "Already out"
                      : chosen.scheduledFor === null
                        ? "Not in the diary yet"
                        : "Pencilled in — nothing sends it"
                  }
                />
                {chosen.status === "published" ? (
                  <Callout title="This one has already gone out">
                    A published post cannot be moved. Its numbers are on the
                    Social page.
                  </Callout>
                ) : csrfToken === "" ? null : (
                  <div className="flex flex-wrap items-start gap-2">
                    <PostDiaryForm
                      post={chosen}
                      csrfToken={csrfToken}
                      back={back}
                      scope="calendar"
                      defaultWhen={
                        chosen.scheduledFor === null
                          ? undefined
                          : nzWallClock(chosen.scheduledFor)
                      }
                    />
                    <ActionLink href="/admin/social">
                      Change the wording, or take it out
                    </ActionLink>
                  </div>
                )}
              </div>
            </Card>
          )}
        </Section>

        <Section
          title="Written, but on no day"
          description="A draft with no time and anything the platform refused. These are the posts a calendar would otherwise hide."
        >
          <Card>
            <UndatedPosts posts={undated}>
              {(post) =>
                csrfToken === "" ? null : (
                  <PostDiaryForm
                    post={post}
                    csrfToken={csrfToken}
                    back={back}
                    scope="undated"
                  />
                )
              }
            </UndatedPosts>
          </Card>
        </Section>

        <NotBuiltYet
          blurb="This page reads the real business database and can move a post to another day, permanently, with your name on it. It posts nothing: no Instagram or TikTok account is connected to this admin, so a post in the diary is a post written down and waiting for a person."
          works={[
            "A month and a week of everything with a date on it, in New Zealand time, right across the mornings the clocks change",
            "Where the gaps are, said in days and dates rather than left as white space",
            "Each post's state as a shape and a word, so it survives a screen reader, a printout and sunlight",
            "Opening any post into the same preview the Social page uses",
            "Moving a post to another day and time from the keyboard, through the same approval and audit trail as everything else",
            "Posts with no date at all, listed rather than hidden",
          ]}
          coming={[
            "Actually posting: nothing here is connected to Instagram or TikTok, so a post in the diary waits for a person",
            "Vinnie writing straight onto the calendar — an agent run raises a decision today, and a post only appears here once it is a row in the database",
            "Dragging a post from one day to another with a mouse, as well as moving it with the field",
            "A view of a whole quarter, for planning a season rather than a fortnight",
          ]}
        />
      </PageSections>
    </>
  );
}
