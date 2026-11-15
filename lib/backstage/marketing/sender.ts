/**
 * Who a campaign email is from, and how to reach them.
 *
 * Marketing email in New Zealand has to say who sent it and how to get hold
 * of them (Unsolicited Electronic Messages Act 2007). So before a campaign
 * can go there has to be an address to send from, and something to print at
 * the foot of every email: the company's name and address once they are
 * set, and always an inbox that somebody reads.
 *
 * Nothing here is made up. If the company's details have not been entered
 * the line is the inbox alone, which is enough to be reached at.
 */

import { STORE } from "@/content/offer";
import { databaseUrl } from "@/lib/db/client";
import { mailConnection, mailFrom } from "@/lib/mail";
import type { MailAddress } from "@/lib/mail/types";
import type { Offer } from "@/lib/shop/offer";
import { siteUrl } from "@/lib/site";

import type { EmailSender } from "./email";

type Env = Record<string, string | undefined>;

export type CampaignSender =
  | {
      readonly ok: true;
      /** The address every campaign email is sent from. */
      readonly from: MailAddress;
      readonly sender: EmailSender;
    }
  | { readonly ok: false; readonly why: string };

/** The line at the foot of every campaign email: who, where, and an inbox. */
export function contactLineOf(offer: Offer, inbox: string): string {
  const name = offer.company.legalName;
  return [
    name !== null && name !== STORE.name ? name : null,
    offer.company.address,
    offer.contactEmail ?? inbox,
  ]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(", ");
}

export function campaignSender(
  offer: Offer,
  env: Env = process.env,
): CampaignSender {
  const from = mailFrom(env);
  if (from === null) {
    return {
      ok: false,
      why: "There is no address to send from yet. The go-live list in Settings says what is missing.",
    };
  }
  const site = siteUrl();
  const local = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(site);
  if (!site.startsWith("https://") && !local) {
    return {
      ok: false,
      why: "The shop's own address has to be https before a campaign can go, or the unsubscribe link in it would not be trusted.",
    };
  }
  return {
    ok: true,
    from: { address: from, name: STORE.name },
    sender: {
      businessName: STORE.name,
      contactLine: contactLineOf(offer, from),
      siteUrl: site,
    },
  };
}

export type HowCampaignsGo = {
  /** True when a campaign that is sent really reaches inboxes from here. */
  readonly goes: boolean;
  /** One sentence for a screen, true of this place right now. */
  readonly says: string;
};

/**
 * Whether a campaign sent from here really goes, said the same way on every
 * screen that mentions it. Three places it can be: connected, on invented
 * records, or on real records with no way out (where sending is refused).
 */
export function howCampaignsGo(env: Env = process.env): HowCampaignsGo {
  const connection = mailConnection(env);
  if (connection.delivers) {
    return {
      goes: true,
      says: "Emails go out a few dozen at a time, so a long list takes a while to finish.",
    };
  }
  if (databaseUrl(env) === null) {
    return {
      goes: false,
      says: "This back end is on invented records, so nothing is sent: each email is written down as not sent.",
    };
  }
  return {
    goes: false,
    says: `${whyNoWayOut(env)} A campaign cannot be sent until that is put right. The go-live list in Settings says what is missing.`,
  };
}

/** With real records and no way to send: why, in a sentence. */
export function whyNoWayOut(env: Env = process.env): string {
  const connection = mailConnection(env);
  return (
    connection.problem ??
    (connection.provider === "off" ? null : connection.held) ??
    "Email is not connected here."
  );
}
