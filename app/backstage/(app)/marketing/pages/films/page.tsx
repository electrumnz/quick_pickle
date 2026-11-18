import type { Metadata } from "next";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import {
  FILMS_ENTITY,
  shopFilms,
  type FilmChoice,
  type FilmsState,
} from "@/lib/backstage/shop/films";
import { formatNzDateTime } from "@/lib/time";

import { Flash, LookOnly, MarketingNav } from "../../parts";
import { showFilmsAction } from "../actions";

export const metadata: Metadata = { title: "Films on the shop" };

/** Names in a sentence: "A", "A and B", "A, B and C". */
function inWords(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** Where the films stand, in a sentence a person can act on. */
function standing(state: FilmsState): string {
  const on = state.films.filter((film) => film.on).map((film) => film.name);
  if (on.length === 0) {
    return "No film is on the shop. Watch them here, tick the ones you want, and save.";
  }
  return on.length === 1
    ? `The shop is playing one film: ${inWords(on)}.`
    : `The shop is playing ${String(on.length)} films: ${inWords(on)}.`;
}

/** One film, to be watched, with its box to tick. */
function FilmCard({
  film,
  canWrite,
}: {
  readonly film: FilmChoice;
  readonly canWrite: boolean;
}) {
  const box = `film-${film.key}`;
  return (
    <li className="border-navy flex min-w-0 flex-col gap-3 rounded-2xl border-2 bg-white p-3">
      <video
        controls
        muted
        playsInline
        preload="none"
        width={film.width}
        height={film.height}
        poster={`${film.src}-poster.webp`}
        aria-label={`${film.name}. ${film.alt}`}
        className="border-navy bg-navy aspect-[9/16] h-auto w-full rounded-xl border-2 object-cover"
      >
        {film.formats.includes("webm") ? (
          <source src={`${film.src}.webm`} type="video/webm" />
        ) : null}
        {film.formats.includes("mp4") ? (
          <source src={`${film.src}.mp4`} type="video/mp4" />
        ) : null}
      </video>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[1.125rem] font-bold">{film.name}</h3>
        <Pill tone={film.on ? "done" : "off"}>
          {film.on ? "On the shop" : "Not on the shop"}
        </Pill>
      </div>
      <p className="leading-snug">{film.about}</p>
      <p className="bk-muted text-[0.9375rem] leading-snug">
        Under it on the shop: &ldquo;{film.caption}&rdquo;
      </p>
      {canWrite ? (
        <p className="mt-auto">
          <label
            htmlFor={box}
            className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold"
          >
            <input
              id={box}
              type="checkbox"
              name="on"
              value={film.key}
              defaultChecked={film.on}
              className="size-5 shrink-0"
            />
            Play this on the shop
          </label>
        </p>
      ) : null}
    </li>
  );
}

export default async function FilmsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const now = new Date();
  const [state, history] = await Promise.all([
    execute(shopFilms, {}, caller),
    execute(
      listActivity,
      {
        entityType: FILMS_ENTITY.type,
        entityId: FILMS_ENTITY.id,
        limit: 50,
      },
      caller,
    ),
  ]);
  const canWrite = staff.role !== "viewer";
  const onCount = state.films.filter((film) => film.on).length;

  const cards = (
    <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {state.films.map((film) => (
        <FilmCard key={film.key} film={film} canWrite={canWrite} />
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader
        title="Films on the shop"
        back={{ href: "/backstage/marketing/pages", label: "Landing pages" }}
        lead="The promo films can play on the shop's front page, in a strip of their own under the ritual. None plays there until you switch it on here."
      />
      <MarketingNav current="pages" />
      <p className="-mt-1 mb-5 flex flex-wrap items-center gap-2">
        <Pill tone={onCount === 0 ? "off" : "done"}>
          {onCount === 0
            ? "No films on the shop"
            : `${String(onCount)} on the shop`}
        </Pill>
      </p>
      <Flash notice={notice} tone={tone} />

      <div className="flex flex-col gap-6">
        <Panel title="The films">
          <p className="mb-2 leading-snug font-semibold">{standing(state)}</p>
          {state.changedAt ? (
            <p className="bk-muted mb-4 text-[0.9375rem]">
              Last changed {formatNzDateTime(state.changedAt)}.
            </p>
          ) : null}
          <p className="bk-muted mb-5 text-[0.9375rem] leading-snug">
            Each one plays here exactly as it would on the shop: whole, on a
            loop, with no sound. The versions with music are in the shared Drive
            folder.
          </p>
          {canWrite ? (
            <form action={showFilmsAction} className="flex flex-col gap-5">
              {state.on.map((key) => (
                <input key={key} type="hidden" name="shown" value={key} />
              ))}
              {cards}
              <div className="flex flex-col gap-2">
                <SubmitButton pending="Saving" className="bk-btn self-start">
                  Save which films play
                </SubmitButton>
                <p className="bk-muted text-[0.9375rem] leading-snug">
                  Every visitor to the shop sees the ones that are ticked,
                  within a minute. Untick one and save to take it off. They only
                  play while they are on screen, and never for somebody who has
                  asked their phone for less motion.
                </p>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-5">
              {cards}
              <LookOnly />
            </div>
          )}
        </Panel>

        <Panel title="Made with AI">
          <p className="leading-snug">
            Every one of these was made with AI. While one is on the shop, a
            line under the strip says so, and says the people in them are not
            real whenever one with people in it is showing.
          </p>
          <p className="mt-3 leading-snug">
            Post one on Instagram, Facebook or TikTok and tick their own
            &ldquo;made with AI&rdquo; label as you do: they ask for it on
            people who look real.
          </p>
        </Panel>

        <Panel title="See the shop">
          <p className="leading-snug">
            The shop as a customer sees it now. Looking is not counted as a
            visit.
          </p>
          <p className="mt-4">
            <a
              href="/preview/home"
              target="_blank"
              rel="noreferrer"
              className="bk-btn bk-btn-quiet"
            >
              <span className="cap-trim">Open the shop</span>
            </a>
          </p>
        </Panel>

        <Panel title="History" flush>
          <ActivityList
            lines={history}
            now={now}
            empty="Nobody has put a film on the shop yet."
          />
        </Panel>
      </div>
    </>
  );
}
