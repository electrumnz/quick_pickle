import type { Role, Via } from "@/db/schema";

/**
 * Who is doing something.
 *
 *   human   a member of staff, at the keyboard
 *   bot     software acting for a member of staff: Claude through the MCP
 *           connection, or a bot account signed in to the back end
 *   system  nobody in particular: an automation, a schedule, a webhook, the
 *           shop itself taking an order
 *
 * A bot always acts as a named user, so the activity log can say whose bot it
 * was. The system has a name but no user.
 */
export type Actor =
  | {
      readonly type: "human" | "bot";
      readonly userId: string;
      readonly name: string;
      readonly role: Role;
    }
  | { readonly type: "system"; readonly name: string };

export type Caller = {
  readonly actor: Actor;
  /** The door they came in by. */
  readonly via: Via;
  /** Ties the activity lines of one request together. */
  readonly requestId?: string;
  /**
   * Set when the person has been shown what an outward or destructive
   * operation will do and has said yes. The back end's own forms set it (the
   * button is the confirmation). A bot has to ask first.
   */
  readonly confirmed?: boolean;
};

export function systemCaller(name: string, via: Via): Caller {
  return { actor: { type: "system", name }, via, confirmed: true };
}

export type Access = "read" | "write" | "admin";

/**
 * What each role may do.
 *
 *   viewer  read
 *   staff   read and write: run the shop day to day
 *   owner   everything, including staff accounts, settings and anything that
 *           cannot be undone
 */
export function can(actor: Actor, access: Access): boolean {
  if (actor.type === "system") return true;
  switch (actor.role) {
    case "owner":
      return true;
    case "staff":
      return access !== "admin";
    case "viewer":
      return access === "read";
  }
}
