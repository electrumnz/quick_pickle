import {
  doorIsOpen,
  json,
  mayRead,
  nothingHere,
  notThatWay,
  OPEN_TO_READ,
  resourceMetadata,
} from "@/lib/backstage/connect/http";

/**
 * Which server this is, and who to ask for a key to it (RFC 9728).
 *
 * An app that has been told "you need a key" reads this to find out where
 * keys come from. It asks at this address, and first at this address with
 * the server's own path on the end, so both are answered, with the same
 * words. While connecting is switched off there is nothing here.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!(await doorIsOpen())) return nothingHere();
  return json(resourceMetadata(), 200, OPEN_TO_READ);
}

export { mayRead as OPTIONS };

// Every other verb, so that nothing here answers while the door is shut.
const no = notThatWay("GET, HEAD, OPTIONS");
export { no as POST, no as PUT, no as PATCH, no as DELETE };
