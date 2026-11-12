"use server";

import { staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { emailCustomer } from "@/lib/backstage/orders/emails";
import { shipDateStanding } from "@/lib/backstage/orders/ship-date";
import { confirmFact, shopOffer } from "@/lib/backstage/shop/ops";
import {
  formCents,
  formText,
  sayAndGo,
  submit,
} from "@/lib/backstage/ui/submit";
import { mailConnection } from "@/lib/mail";

import { blankState, checkThenChange, type ShopFormState } from "./flow";

/**
 * Changing the shop: prices, delivery, the ship date, pre-order or live,
 * and whether it is taking orders. Two presses (./flow.ts).
 */

type Asked = {
  readonly open: boolean;
  readonly launchMode: "preorder" | "live";
  readonly batchName: string;
  readonly preorderShipsFrom: string | null;
  readonly contactEmail: string | null;
  readonly prices: Record<string, number>;
  readonly shipping: {
    readonly standardCents: number;
    readonly ruralSurchargeCents: number;
    readonly freeOverCents: number | null;
  };
};

/** The form as the operation's input, or which boxes cannot be read. */
function read(
  form: FormData,
  skus: readonly string[],
): {
  values: Record<string, string>;
  asked: Asked | null;
  fields: Record<string, string>;
} {
  const values: Record<string, string> = {};
  const fields: Record<string, string> = {};
  const text = (key: string) => {
    const value = formText(form, key);
    values[key] = value;
    return value;
  };
  const money = (key: string, what: string): number => {
    const typed = text(key);
    const cents = formCents(form, key);
    if (typed === "" || Number.isNaN(cents)) {
      fields[key] = `${what} is an amount of money, like 7 or 7.50`;
      return 0;
    }
    return cents;
  };

  const open = text("open") !== "no";
  const launchMode = text("launchMode") === "live" ? "live" : "preorder";
  const batchName = text("batchName");
  if (batchName === "") fields.batchName = "Give the batch a name";
  const shipDate = text("preorderShipsFrom");
  const contact = text("contactEmail");

  const prices: Record<string, number> = {};
  for (const sku of skus) {
    prices[sku] = money(`price:${sku}`, "A price");
  }
  const standardCents = money("standard", "Standard delivery");
  const ruralSurchargeCents = money("rural", "The rural extra");
  // Empty means no order earns free delivery.
  const freeTyped = text("freeOver");
  const freeOverCents =
    freeTyped === "" ? null : money("freeOver", "Free delivery");

  const asked: Asked = {
    open,
    launchMode,
    batchName,
    preorderShipsFrom: shipDate === "" ? null : shipDate,
    contactEmail: contact === "" ? null : contact,
    prices,
    shipping: { standardCents, ruralSurchargeCents, freeOverCents },
  };
  return {
    values,
    asked: Object.keys(fields).length === 0 ? asked : null,
    fields,
  };
}

/** Which box an operation's complaint is about. */
function boxFor(path: string): string {
  if (path.startsWith("prices.")) return `price:${path.slice(7)}`;
  if (path === "shipping.standardCents") return "standard";
  if (path === "shipping.ruralSurchargeCents") return "rural";
  if (path === "shipping.freeOverCents") return "freeOver";
  return path;
}

export async function shopAction(
  _previous: ShopFormState,
  form: FormData,
): Promise<ShopFormState> {
  const caller = await staffCaller();
  const { offer } = await execute(shopOffer, {}, caller);
  const { values, asked, fields } = read(
    form,
    offer.packs.map((pack) => pack.sku),
  );
  const blank = blankState(values);
  if (asked === null) {
    return {
      ...blank,
      error: Object.values(fields)[0] ?? "Some of that does not look right.",
      fields,
    };
  }
  return checkThenChange(form, asked, blank, boxFor, caller);
}

/** Say that an open fact is right, or that it is not after all. */
export async function confirmFactAction(form: FormData): Promise<void> {
  const confirmed = formText(form, "confirmed") !== "no";
  await submit(
    confirmFact,
    { key: formText(form, "key"), confirmed },
    {
      back: "/backstage/settings/go-live",
      done: (output) =>
        confirmed
          ? output.open.length === 0
            ? "Confirmed. That was the last one: the site is open to search engines."
            : "Confirmed."
          : "Marked as not confirmed.",
    },
  );
}

/**
 * Email everybody with a pre-order who has not been told the ship date.
 *
 * One press, one email each, and only for the date the person pressing was
 * shown: if the date has been changed since their page was drawn, nothing
 * is sent and they look again. Somebody already told that date gets nothing
 * (the operation writes one email for each date, however often it is asked).
 */
export async function tellShipDateAction(form: FormData): Promise<void> {
  const back = "/backstage/settings/shop#pre-orders";
  const caller = await staffCaller();
  // With no way to send, writing these down would use up each customer's
  // one email for this date and tell nobody.
  const mail = mailConnection();
  if (!mail.delivers) {
    sayAndGo(
      back,
      "Order emails are not connected, so nobody was told. Nothing was written down.",
      "bad",
    );
  }
  const standing = await execute(shipDateStanding, {}, caller);
  if (standing.cannot !== null) sayAndGo(back, standing.cannot, "bad");
  if (standing.date !== formText(form, "date")) {
    sayAndGo(
      back,
      "The ship date has changed since this page was drawn. Have another look, then tell them.",
      "bad",
    );
  }

  let told = 0;
  const refused: string[] = [];
  for (const one of standing.owed) {
    // On the do-not-email list: nothing may go to them. They are named on
    // the screen, to be told another way.
    if (one.blocked) continue;
    try {
      const done = await execute(
        emailCustomer,
        { number: one.number, about: "ship_date" },
        caller,
      );
      if (done.written && !done.already) told += 1;
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      refused.push(one.number);
    }
  }
  const blocked = standing.owed.filter((one) => one.blocked).length;
  const said = [
    told === 0
      ? "Nobody was emailed."
      : `Wrote to ${String(told)} ${told === 1 ? "person" : "people"}: it ships from ${standing.dateSaid ?? standing.date ?? ""}.`,
    ...(refused.length === 0
      ? []
      : [`Could not write to ${refused.join(", ")}.`]),
    ...(blocked === 0
      ? []
      : [
          `${String(blocked)} cannot be emailed and ${blocked === 1 ? "is" : "are"} still to be told another way.`,
        ]),
    ...(standing.more ? ["There are more: press it again."] : []),
  ].join(" ");
  sayAndGo(back, said, refused.length > 0 || told === 0 ? "bad" : "good");
}
