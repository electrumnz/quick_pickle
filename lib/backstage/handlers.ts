/**
 * Who hears about what.
 *
 * One list of every listener in the back end, so that "what happens when an
 * order is paid?" has one place to look. Each area exports the function that
 * does its part; this file only says which event sets it off.
 *
 * A listener can be run twice for one event (lib/backstage/core/events.ts),
 * so each must be safe to repeat.
 */

import "server-only";

import { on } from "./core/events";
import { sendQueuedMail } from "./mail/listeners";
import { startCampaign } from "./marketing/deliver";
import {
  showSpecialChange,
  stopSayingUsedUpSpecial,
} from "./marketing/special-listeners";
import { emailAboutOrder } from "./orders/emails";
import { closePaymentPage } from "./orders/listeners";
import { sendRefund } from "./orders/refunds";
import { refreshPublicPage } from "./pages/listeners";
import { showShopChange } from "./shop/listeners";

let registered = false;

/** Register every listener. Safe to call more than once. */
export function registerHandlers(): void {
  if (registered) return;
  registered = true;

  on("order.cancelled", "close the payment page", closePaymentPage());
  on("order.refund_requested", "send the money back", sendRefund());

  // An order's emails. Each listener writes the email down (an operation);
  // "send the email" is what hands it to the mail provider afterwards.
  on("order.paid", "write the receipt", emailAboutOrder("receipt"));
  on(
    "order.shipped",
    "write the on-the-courier email",
    emailAboutOrder("shipped"),
  );
  on(
    "order.cancelled",
    "write the cancelled email",
    emailAboutOrder("cancelled"),
  );
  on(
    "order.refunded",
    "write the email about the payment on its way back",
    emailAboutOrder("refunded"),
  );
  on("mail.queued", "send the email", sendQueuedMail());
  // A campaign's first few emails go as send is pressed. The clock sends
  // the rest, a few dozen a round (lib/backstage/marketing/deliver.ts).
  on("campaign.send_requested", "start sending it", startCampaign());

  on("page.published", "show the new words at once", refreshPublicPage());
  on("page.taken_down", "stop showing the page at once", refreshPublicPage());
  on(
    "special.changed",
    "say it, or stop saying it, at once",
    showSpecialChange(),
  );
  on(
    "promo.redeemed",
    "stop saying a special that is used up",
    stopSayingUsedUpSpecial(),
  );
  on("shop.changed", "show the new prices at once", showShopChange());
  on(
    "shop.line_changed",
    "show the new line across the top at once",
    showShopChange(),
  );
}
