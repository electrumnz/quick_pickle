import type { SocialPostItem } from "@/components/admin/data/queries";
import {
  Confirm,
  Disclosure,
  Field,
  FormFields,
  SubmitButton,
  Textarea,
  TextInput,
} from "@/components/admin/ui/controls";

import {
  declinePostAction,
  editPostAction,
  schedulePostAction,
} from "./actions";

/**
 * The three things she does to a post.
 *
 * Reword it, give it a time, or take it out of the queue. The wording on all
 * three says the same thing in different words, because it is the thing most
 * likely to be misread: putting a post in the diary does not post it. No
 * account is connected to this admin.
 */

/** Change what it says. Also handed to the approval card as its editor. */
export function PostEditor({
  post,
  csrfToken,
  back,
  scope,
  bare = false,
}: {
  post: SocialPostItem;
  csrfToken: string;
  back: string;
  /**
   * Which part of the page this copy is in. A post can appear twice — once as
   * the decision at the top, once in the queue below — and two fields with the
   * same `id` would point every second `<label for>` at the first copy.
   */
  scope: string;
  /** True when the card has already drawn the fold around it. */
  bare?: boolean;
}) {
  const field = `caption-${scope}-${post.id}`;
  const form = (
    <form action={editPostAction} className="space-y-3">
      <FormFields
        csrfToken={csrfToken}
        back={back}
        values={{ postId: post.id }}
      />
      <Field
        label="What it says"
        htmlFor={field}
        hint="Culinary only. Nothing about what brine does to a body — that is a claim about food, and it is the one thing this company never writes."
      >
        <Textarea
          id={field}
          name="caption"
          rows={5}
          required
          maxLength={2200}
          defaultValue={post.caption}
        />
      </Field>
      <SubmitButton>Save the wording</SubmitButton>
    </form>
  );
  return bare ? (
    form
  ) : (
    <Disclosure label="Change the wording">{form}</Disclosure>
  );
}

/** Approve it and give it a time. */
export function PostDiaryForm({
  post,
  csrfToken,
  back,
  defaultWhen,
  scope = "queue",
}: {
  post: SocialPostItem;
  csrfToken: string;
  back: string;
  /**
   * The time already in the box, as a New Zealand wall clock
   * (`2026-09-03T17:00`).
   *
   * Moving a post is the same form as diarising one, and a move starts from
   * where the post already is: an empty field would make her retype a time she
   * is only nudging by a day.
   */
  defaultWhen?: string;
  /**
   * Which part of the page this copy is in. The calendar can show the same
   * post in a cell and again in the panel below it, and two fields with the
   * same `id` point every second `<label for>` at the first one.
   */
  scope?: string;
}) {
  const scheduled = post.status === "scheduled";
  const field = `when-post-${scope}-${post.id}`;
  const noteField = `post-note-${scope}-${post.id}`;
  return (
    <Disclosure
      label={
        scheduled ? "Move it in the diary" : "Approve and put it in the diary"
      }
    >
      <form action={schedulePostAction} className="space-y-3">
        <FormFields
          csrfToken={csrfToken}
          back={back}
          values={{ postId: post.id }}
        />
        <Field
          label="When should it go out? (New Zealand time)"
          htmlFor={field}
          hint="Read as Auckland time and stored as the moment it means, so it stays right either side of the clocks changing. Saying yes is recorded against this post for good. Nothing posts it: there is no account connected to this admin, so the time is a note for whoever does."
        >
          <TextInput
            id={field}
            name="scheduledFor"
            type="datetime-local"
            defaultValue={defaultWhen}
            required
          />
        </Field>
        <Field label="Anything to add? (optional)" htmlFor={noteField}>
          <TextInput
            id={noteField}
            name="note"
            maxLength={300}
            placeholder="Good — but not the same morning as the market post"
          />
        </Field>
        <SubmitButton tone="primary">
          {scheduled ? "Save the new time" : "Approve it"}
        </SubmitButton>
      </form>
    </Disclosure>
  );
}

/** Take it out of the queue. */
export function PostDeclineForm({
  post,
  csrfToken,
  back,
}: {
  post: SocialPostItem;
  csrfToken: string;
  back: string;
}) {
  return (
    <Confirm
      label="Take it out of the queue"
      consequence={
        <>
          This post is archived and will not go out. Your reason is recorded
          against it. Archived posts are not deleted, but they do not come back
          to the queue on their own.
        </>
      }
    >
      <form action={declinePostAction} className="space-y-3">
        <FormFields
          csrfToken={csrfToken}
          back={back}
          values={{ postId: post.id }}
        />
        <Field
          label="Why not?"
          htmlFor={`kill-note-${post.id}`}
          hint="Required. It is what the agent reads before it drafts the next one."
        >
          <Textarea
            id={`kill-note-${post.id}`}
            name="note"
            rows={2}
            required
            maxLength={500}
            placeholder="Too close to the last kawakawa one, and it strays off flavour."
          />
        </Field>
        <SubmitButton tone="danger">Take it out</SubmitButton>
      </form>
    </Confirm>
  );
}
