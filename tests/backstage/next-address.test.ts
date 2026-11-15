import { describe, expect, it } from "vitest";

import { FRONT, safeNext } from "@/lib/backstage/auth/next";
import { withNotice } from "@/lib/backstage/ui/notice";

/**
 * Where somebody is sent once they have signed in. The address comes from
 * the link they followed to the sign-in page, so a stranger can write it.
 *
 * Two things are held here: it is only ever a page of the back end, and it
 * never carries a sentence for a notice box. Signing in is a form, and with
 * scripting on its redirect sets the browser's address without a page being
 * asked for there, so nothing else would take a strange sentence out before
 * the next form on that page was drawn from it.
 */

describe("the address somebody is sent on to after signing in", () => {
  it("is the page of the back end they were on their way to", () => {
    for (const path of [
      "/backstage",
      "/backstage/orders",
      "/backstage/orders/QP-7K2M9X",
      "/backstage/orders?status=packed&q=boot",
      "/backstage/inbox/settings#do-not-email",
      "/backstage/marketing/pages/who?asked=1&via=clubs",
    ]) {
      expect(safeNext(path), path).toBe(path);
    }
  });

  it("is the front of the back end for anywhere else", () => {
    for (const path of [
      "",
      "/",
      "/checkout",
      "/backstagefoo",
      "backstage/orders",
      "//evil.example/backstage",
      "/\\evil.example/backstage",
      "/backstage\\..\\..\\checkout",
      "https://evil.example/backstage",
      "javascript:alert(1)",
      // Worked out, these are not in the back end at all.
      "/backstage/../checkout",
      "/backstage/orders/../../order/thanks",
      "/backstage/%2e%2e/checkout",
    ]) {
      expect(safeNext(path), path).toBe(FRONT);
    }
    expect(safeNext(null)).toBe(FRONT);
    expect(safeNext(undefined)).toBe(FRONT);
  });

  it("never carries a sentence, and keeps the rest of the address", () => {
    expect(
      safeNext(
        "/backstage/settings/shop?notice=Not%20saved.%20Ring%200800%20000%20000&tone=bad",
      ),
    ).toBe("/backstage/settings/shop");
    expect(
      safeNext(
        "/backstage/orders?status=packed&notice=Hello&tone=good&nat=1&nsig=zz&q=boot#top",
      ),
    ).toBe("/backstage/orders?status=packed&q=boot#top");
    // Said twice, or with its name spelt in percent signs: still taken out.
    expect(safeNext("/backstage/orders?notice=a&notice=b&%6Eotice=c")).toBe(
      "/backstage/orders",
    );
  });

  it("takes out a sentence the back end sealed itself, too", () => {
    // Nobody needs "Saved." to follow them through the sign-in page, and a
    // rule with no exceptions is one that cannot be got round.
    const env = { CRON_SECRET: "c".repeat(64) };
    const sealed = withNotice(
      "/backstage/orders/QP-7K2M9X",
      "Shipped.",
      "good",
      {
        env,
      },
    );
    expect(sealed).toContain("nsig=");
    expect(safeNext(sealed)).toBe("/backstage/orders/QP-7K2M9X");
  });
});
