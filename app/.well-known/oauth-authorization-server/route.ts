import {
  doorIsOpen,
  json,
  mayRead,
  nothingHere,
  notThatWay,
  OPEN_TO_READ,
  serverMetadata,
} from "@/lib/backstage/connect/http";

/**
 * How to ask this site for a key (RFC 8414): where an app registers, where
 * it sends a person to say yes, and where it swaps the code it is handed.
 * While connecting is switched off there is nothing here.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!(await doorIsOpen())) return nothingHere();
  return json(serverMetadata(), 200, OPEN_TO_READ);
}

export { mayRead as OPTIONS };

// Every other verb, so that nothing here answers while the door is shut.
const no = notThatWay("GET, HEAD, OPTIONS");
export { no as POST, no as PUT, no as PATCH, no as DELETE };
