import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { leaveBy, standingOf } from "@/app/(site)/unsubscribe/[token]/leave";
import * as oneClick from "@/app/(site)/unsubscribe/[token]/one-click/route";
import { auditLog, crewMembers, events, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { crewStanding, joinCrew, leaveCrew } from "@/lib/backstage/crew/ops";
import {
  unsubscribeOneClickUrl,
  unsubscribePageUrl,
} from "@/lib/backstage/marketing/email";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";

/**
 * Leaving the Pickle Crew from an email. Every campaign email carries two
 * addresses: the page with its one button, and the one a mail program posts
 * to for its own unsubscribe button. Both have to work with nothing but the
 * token in the address: no sign-in, no cookie.
 */

const SITE = "https://shop.example";
const shop = systemCaller("The shop", "storefront");

describe("leaving the Pickle Crew from an email", () => {
  let handle: DbHandle;
  let staff: Caller;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const id = newId("usr");
    await handle.db
      .insert(users)
      .values({ id, email: "sam@example.co.nz", name: "Sam", role: "staff" });
    staff = {
      actor: { type: "human", userId: id, name: "Sam", role: "staff" },
      via: "ui",
      confirmed: true,
    };
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    await handle.db.delete(crewMembers);
    await handle.db.delete(auditLog);
    await handle.db.delete(events);
  });

  const join = async (email: string) => {
    await execute(joinCrew, { email, source: "crew-form" }, shop);
    const [member] = await handle.db
      .select()
      .from(crewMembers)
      .where(eq(crewMembers.email, email));
    return member?.unsubscribeToken ?? "";
  };
  const tokenOf = async (email: string) =>
    (
      await handle.db
        .select({ token: crewMembers.unsubscribeToken })
        .from(crewMembers)
        .where(eq(crewMembers.email, email))
    )[0]?.token ?? "";
  const statusOf = async (email: string) =>
    (
      await handle.db
        .select({ status: crewMembers.status })
        .from(crewMembers)
        .where(eq(crewMembers.email, email))
    )[0]?.status;
  const post = (token: string, body = "List-Unsubscribe=One-Click") =>
    oneClick.POST(
      new Request(unsubscribeOneClickUrl(SITE, token), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
      { params: Promise.resolve({ token }) },
    );

  it("says whose link it is, takes them off, and goes on saying so", async () => {
    const token = await join("mere@example.co.nz");
    expect(await standingOf(token)).toEqual({
      known: true,
      email: "mere@example.co.nz",
      on: true,
    });
    // Looking changes nothing. A mail program that opens every link in an
    // email to check it has taken nobody off the list.
    expect(await statusOf("mere@example.co.nz")).toBe("subscribed");

    expect(await leaveBy(token)).toBe("left");
    expect(await statusOf("mere@example.co.nz")).toBe("unsubscribed");
    expect(await standingOf(token)).toEqual({
      known: true,
      email: "mere@example.co.nz",
      on: false,
    });
    // Pressed again, or the link opened next month: still off, no error.
    expect(await leaveBy(token)).toBe("left");
    expect(await statusOf("mere@example.co.nz")).toBe("unsubscribed");
    const lines = (await handle.db.select().from(auditLog)).map(
      (line) => `${line.actorName}: ${line.summary}`,
    );
    expect(lines).toContain(
      "The shop: mere@example.co.nz left the Pickle Crew",
    );
  });

  it("knows nothing about a link that is not one of ours", async () => {
    await join("mere@example.co.nz");
    for (const token of [
      "not-one-of-ours-at-all-0123456789",
      "short",
      "",
      "../../backstage",
      "x".repeat(300),
      "has spaces in it and more",
    ]) {
      expect(await standingOf(token), token).toEqual({ known: false });
      expect(await leaveBy(token), token).toBe("unknown");
    }
    expect(await statusOf("mere@example.co.nz")).toBe("subscribed");
  });

  it("only tells the shop itself whose link it is", async () => {
    const token = await join("mere@example.co.nz");
    // The token is what proves somebody was sent the email. A member of
    // staff, or a bot, asking by token would be a way to read the list.
    await expect(execute(crewStanding, { token }, staff)).rejects.toMatchObject(
      { code: "forbidden" },
    );
  });

  it("lets a member of staff take off somebody who asked some other way", async () => {
    await join("mere@example.co.nz");
    const lines = async () =>
      (await handle.db.select().from(auditLog)).map(
        (line) => `${line.actorName}: ${line.summary}`,
      );
    expect(
      await execute(leaveCrew, { email: " Mere@Example.co.nz " }, staff),
    ).toEqual({ email: "mere@example.co.nz" });
    expect(await statusOf("mere@example.co.nz")).toBe("unsubscribed");
    expect(await lines()).toContain(
      "Sam: mere@example.co.nz left the Pickle Crew",
    );
    // Asked again, by them or by us: nothing changes, and nothing is logged.
    const before = (await lines()).length;
    await execute(leaveCrew, { email: "mere@example.co.nz" }, staff);
    expect(await leaveBy(await tokenOf("mere@example.co.nz"))).toBe("left");
    expect((await lines()).length).toBe(before);
    // Somebody who was never on it gets no campaigns, and it says so.
    await expect(
      execute(leaveCrew, { email: "kai@example.co.nz" }, staff),
    ).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining(
        "kai@example.co.nz is not on the Pickle Crew list",
      ),
    });
  });

  it("takes a mail program's own unsubscribe button: one POST, nothing else", async () => {
    const token = await join("mere@example.co.nz");
    const done = await post(token);
    expect(done.status).toBe(200);
    expect(done.headers.get("cache-control")).toBe("no-store");
    expect(await statusOf("mere@example.co.nz")).toBe("unsubscribed");
    // Twice is the same as once, and the body is not needed.
    expect((await post(token, "")).status).toBe(200);
    // Not one of ours: said so, and nobody else is touched.
    const other = await join("kai@example.co.nz");
    expect((await post("not-one-of-ours-at-all-0123456789")).status).toBe(404);
    expect(await statusOf("kai@example.co.nz")).toBe("subscribed");
    expect(other).not.toBe(token);
  });

  it("sends somebody who follows that address as a link to the page with the button", async () => {
    const token = await join("mere@example.co.nz");
    const answer = await oneClick.GET(
      new Request(unsubscribeOneClickUrl(SITE, token)),
      { params: Promise.resolve({ token }) },
    );
    expect(answer.status).toBe(303);
    expect(answer.headers.get("location")).toBe(
      unsubscribePageUrl(SITE, token),
    );
    // Following a link changes nothing.
    expect(await statusOf("mere@example.co.nz")).toBe("subscribed");
  });
});
