"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ACCEPT_ATTRIBUTE, MAX_FILES_PER_UPLOAD } from "@/lib/assets";

import { Checkbox, Field, PrimaryButton, TextArea, TextInput } from "./bits";

/**
 * Putting files in.
 *
 * The form works with no JavaScript at all: it is an ordinary multipart POST to
 * the upload route, which redirects back with a count. Everything below is
 * enhancement on top of that, and it earns its place by doing one thing the
 * server cannot:
 *
 * **capturing the poster frame.** There is no video decoder on the server — no
 * ffmpeg, no native module — so the still that represents a clip is grabbed
 * here, from a `<video>` element that never enters the document, drawn to a
 * canvas and sent alongside the file. It is uploaded as a file like any other
 * and goes through the same sniffing, the same size cap and the same metadata
 * scrub, because a frame this code produced is still a file the server did not
 * make.
 *
 * If the browser cannot decode the clip — an old QuickTime codec, say — the
 * capture is skipped, the upload still happens, and the admin says plainly that
 * the clip has no still.
 */

interface UploadResult {
  readonly status: "stored" | "duplicate" | "rejected";
  readonly filename: string;
  readonly title?: string;
  readonly message?: string;
  readonly notes?: readonly string[];
  readonly href?: string;
}

export function UploadPanel({
  csrfToken,
  csrfField,
  drafting,
}: {
  csrfToken: string;
  /**
   * The name of the hidden field the CSRF checker reads. Passed in rather than
   * imported: the module that owns the name is `server-only`, and this is the
   * one component in the area that runs in the browser.
   */
  csrfField: string;
  /** True when a vision model is wired up and will draft a description. */
  drafting: boolean;
}) {
  const router = useRouter();
  const formReference = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<readonly UploadResult[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const files = data
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (files.length === 0) {
      setProblem("Choose a photo or a clip first.");
      return;
    }
    if (files.length > MAX_FILES_PER_UPLOAD) {
      setProblem(
        `That is ${String(files.length)} files. Add them ${String(MAX_FILES_PER_UPLOAD)} at a time.`,
      );
      return;
    }

    setProblem(null);
    setBusy(true);
    setResults([]);

    try {
      for (const [index, file] of files.entries()) {
        if (!file.type.startsWith("video/")) continue;
        const poster = await captureFrame(file);
        if (poster !== null) {
          data.append(`poster-${String(index)}`, poster, `poster-${String(index)}.jpg`);
        }
      }

      const response = await fetch("/admin/assets/upload", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken, accept: "application/json" },
        body: data,
      });
      const payload = (await response.json()) as {
        results?: readonly UploadResult[];
        message?: string;
      };
      if (!response.ok) {
        setProblem(payload.message ?? "The upload did not go through.");
        return;
      }
      setResults(payload.results ?? []);
      formReference.current?.reset();
      router.refresh();
    } catch {
      setProblem(
        "The upload did not finish. Nothing was added — try it again, or with fewer files.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-hairline bg-surface-raised">
      <div className="border-b border-hairline px-4 py-3">
        <h2 className="font-sans text-body-sm font-semibold text-primary">
          Add photos or video
        </h2>
        <p className="mt-1 max-w-prose text-caption text-muted">
          Straight off your phone. Location data is taken out of every file
          before it is stored, and the same photo added twice stays one file.
          {drafting
            ? " A first line about what is in each picture is drafted for you to correct."
            : ""}
        </p>
      </div>

      <form
        ref={formReference}
        method="post"
        action="/admin/assets/upload"
        encType="multipart/form-data"
        onSubmit={(event) => void submit(event)}
        className="space-y-4 px-4 py-4"
      >
        <input
          type="hidden"
          name={csrfField}
          value={csrfToken}
          readOnly
        />

        <Field
          label="The files"
          hint={`Up to ${String(MAX_FILES_PER_UPLOAD)} at a time. JPEG, PNG, WebP, AVIF or HEIC pictures; MP4, QuickTime or WebM clips.`}
          htmlFor="files"
        >
          <input
            id="files"
            name="files"
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="block w-full rounded-md border border-strong bg-surface-raised px-3 py-2 text-body-sm text-primary"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="The occasion"
            hint="Applied to everything in this batch. You can change any of them afterwards."
            htmlFor="occasion"
          >
            <TextInput
              id="occasion"
              name="occasion"
              placeholder="the Sunday market"
            />
          </Field>
          <Field label="The day it happened" htmlFor="occasionOn">
            <TextInput id="occasionOn" name="occasionOn" type="date" />
          </Field>
        </div>

        <Field
          label="What is in them"
          hint="One line, shared by everything in this batch. Leave it empty and each file gets its own draft to correct."
          htmlFor="description"
        >
          <TextArea id="description" name="description" rows={2} />
        </Field>

        <Field label="Tags" htmlFor="tags">
          <TextInput id="tags" name="tags" placeholder="market, stall, spring" />
        </Field>

        <div className="space-y-2.5 rounded-md border border-strong px-3.5 py-3">
          <Checkbox
            id="peoplePresent"
            name="peoplePresent"
            label="There are identifiable people in these"
            hint="Tick it and they arrive marked as waiting on a consent decision, which nothing on the team can use until you answer it."
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add to the library"}
          </PrimaryButton>
          <p className="text-caption text-muted">
            Nothing here is published. This is your own library.
          </p>
        </div>
      </form>

      <div aria-live="polite" className="px-4 pb-4">
        {problem !== null && (
          <p className="rounded-md border border-danger/40 px-3.5 py-3 text-caption text-danger">
            {problem}
          </p>
        )}
        {results.length > 0 && (
          <ul className="space-y-2">
            {results.map((result) => (
              <li
                key={`${result.filename}-${result.status}`}
                className="rounded-md border border-hairline px-3.5 py-2.5"
              >
                <p className="text-caption font-medium text-primary">
                  {result.filename} ·{" "}
                  {result.status === "stored"
                    ? "added"
                    : result.status === "duplicate"
                      ? "already here"
                      : "not added"}
                </p>
                {result.message !== undefined && (
                  <p
                    className={`mt-0.5 text-caption ${result.status === "rejected" ? "text-danger" : "text-muted"}`}
                  >
                    {result.message}
                  </p>
                )}
                {(result.notes ?? []).map((note) => (
                  <p key={note} className="mt-0.5 text-caption text-muted">
                    {note}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * One frame out of a clip, as a JPEG.
 *
 * A tenth of the way in rather than at zero: the first frame of a phone video
 * is very often the lens still adjusting, and a grey rectangle is a worse
 * poster than no poster.
 */
async function captureFrame(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        resolve();
      };
      video.onerror = () => {
        reject(new Error("This browser cannot decode that clip."));
      };
      setTimeout(() => {
        reject(new Error("Timed out reading the clip."));
      }, 10_000);
    });

    const target = Number.isFinite(video.duration)
      ? Math.min(video.duration / 10, 2)
      : 0;
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => {
        resolve();
      };
      video.onerror = () => {
        reject(new Error("This browser could not seek that clip."));
      };
      video.currentTime = target;
      setTimeout(() => {
        reject(new Error("Timed out seeking the clip."));
      }, 10_000);
    });

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return null;
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, "image/jpeg", 0.82);
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
