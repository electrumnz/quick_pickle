"use server";

import { createHash } from "node:crypto";

import { staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  checkShipping,
  readTrackingBack,
  type TrackingRead,
} from "@/lib/backstage/orders/courier";
import {
  ANOTHER_COURIER,
  knownCourier,
  trackingLink,
} from "@/lib/backstage/orders/couriers";
import { markShipped } from "@/lib/backstage/orders/ops";

/**
 * Tracking numbers back from the courier.
 *
 * Two presses, on purpose. The first only reads what was pasted and shows
 * which orders it names, who each is for, and anything it could not read.
 * The second marks them shipped, which tells each customer and cannot be
 * undone, so it will only act on exactly what the first one showed: change
 * the list in between and it shows it again instead.
 */

export type TrackingRow = {
  readonly number: string;
  readonly tracking: string;
  /** Who it is for and where, or null when there is no such order. */
  readonly who: string | null;
  readonly items: string;
  readonly test: boolean;
  /** Where the customer will be sent to follow it, if we know the page. */
  readonly link: string | null;
  /** Why it will not be marked shipped, or null if it will. */
  readonly problem: string | null;
};

export type TrackingState = {
  readonly step: "idle" | "checked" | "done";
  /** What was pasted, handed back so nothing has to be pasted twice. */
  readonly text: string;
  readonly courier: string;
  readonly courierName: string;
  readonly error: string | null;
  /** A mark of exactly what the check was for. The second press sends it. */
  readonly checkedFor: string | null;
  readonly rows: readonly TrackingRow[];
  readonly unread: TrackingRead["unread"];
  readonly results: readonly {
    readonly number: string;
    readonly ok: boolean;
    readonly said: string;
  }[];
};

/** The biggest paste or file read. A courier's file for a day is a sliver of it. */
const MOST_CHARACTERS = 200_000;

const text = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

async function pasted(form: FormData): Promise<string> {
  const typed = text(form, "lines");
  if (typed.trim() !== "") return typed.slice(0, MOST_CHARACTERS);
  const file = form.get("file");
  if (file instanceof File && file.size > 0 && file.size <= MOST_CHARACTERS) {
    return (await file.text()).slice(0, MOST_CHARACTERS);
  }
  return "";
}

export async function trackingBackAction(
  _previous: TrackingState,
  form: FormData,
): Promise<TrackingState> {
  const courier = text(form, "courier").trim();
  const courierName = text(form, "courierName").trim().slice(0, 60);
  const lines = await pasted(form);
  const base: TrackingState = {
    step: "idle",
    text: lines,
    courier,
    courierName,
    error: null,
    checkedFor: null,
    rows: [],
    unread: [],
    results: [],
  };

  const known = knownCourier(courier);
  const name = known?.name ?? courierName;
  if (known === null && (courier !== ANOTHER_COURIER || name === "")) {
    return { ...base, error: "Say which courier these are with." };
  }
  if (lines.trim() === "") {
    return {
      ...base,
      error:
        "Paste the tracking numbers in, or choose the courier's file, first.",
    };
  }

  const read = readTrackingBack(lines);
  if (read.rows.length === 0 && read.unread.length === 0) {
    return { ...base, error: "There was nothing in that to read." };
  }

  let caller;
  let checks;
  try {
    caller = await staffCaller();
    checks = await execute(
      checkShipping,
      { numbers: read.rows.map((row) => row.number) },
      caller,
    );
  } catch (error) {
    return {
      ...base,
      error:
        error instanceof OpError
          ? error.message
          : "Something went wrong on our side. Give it another go.",
    };
  }

  const rows: TrackingRow[] = read.rows.map((row) => {
    const check = checks.find((candidate) => candidate.number === row.number);
    return {
      number: row.number,
      tracking: row.tracking,
      who:
        check?.order == null
          ? null
          : `${check.order.name}, ${check.order.city}`,
      items: check?.order?.items ?? "",
      test: check?.order?.isTest === true,
      link: trackingLink(known, row.tracking),
      problem: check === undefined ? "There is no such order." : check.problem,
    };
  });
  const checkedFor = createHash("sha256")
    .update(
      JSON.stringify([name, rows.map((row) => [row.number, row.tracking])]),
    )
    .digest("hex");
  const checked: TrackingState = {
    ...base,
    step: "checked",
    checkedFor,
    rows,
    unread: read.unread,
  };

  if (text(form, "intent") !== "ship") return checked;
  if (text(form, "checkedFor") !== checkedFor) {
    return {
      ...checked,
      error:
        "That changed since it was checked. Have another look, then press the button again.",
    };
  }

  const results: {
    readonly number: string;
    readonly ok: boolean;
    readonly said: string;
  }[] = [];
  for (const row of rows) {
    if (row.problem !== null) continue;
    try {
      await execute(
        markShipped,
        {
          number: row.number,
          carrier: name,
          trackingNumber: row.tracking,
          ...(row.link === null ? {} : { trackingUrl: row.link }),
        },
        caller,
      );
      results.push({ number: row.number, ok: true, said: "Shipped." });
    } catch (error) {
      results.push({
        number: row.number,
        ok: false,
        said:
          error instanceof OpError
            ? error.message
            : "Something went wrong on our side. It was not marked shipped.",
      });
    }
  }

  // What is left in the box is only what still needs doing.
  const shipped = new Set(
    results.filter((result) => result.ok).map((result) => result.number),
  );
  const left = [
    ...rows
      .filter((row) => !shipped.has(row.number))
      .map((row) => `${row.number}, ${row.tracking}`),
    ...read.unread.map((line) => line.line),
  ].join("\n");
  return {
    ...base,
    step: "done",
    text: left,
    rows: rows.filter((row) => row.problem !== null),
    unread: read.unread,
    results,
  };
}
