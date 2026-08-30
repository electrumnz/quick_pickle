import { CommerceError } from "@/lib/commerce";

/**
 * A provider failure, as something a buyer can act on.
 *
 * The same narrow mapping `components/product/actions.ts` makes for the add
 * path, and narrow for the same reason: the raw provider message can name a
 * table, a variant id or a connection string, and none of that may reach a
 * page. Anything unrecognised is `failed`, which says the one thing that
 * matters — nothing was recorded and nothing was charged.
 *
 * It lives in its own module rather than beside the action because a file
 * marked `"use server"` may only export async functions, and this is neither.
 */
export function checkoutProblemFor(error: unknown): string {
  if (error instanceof CommerceError) {
    switch (error.code) {
      case "OUT_OF_STOCK":
      case "VARIANT_UNAVAILABLE":
        return "sold-out";
      case "INSUFFICIENT_STOCK":
        return "not-enough";
      case "CART_NOT_FOUND":
      case "CART_EXPIRED":
      case "CART_ALREADY_COMPLETED":
      case "CART_EMPTY":
        return "cart-gone";
      default:
        return "failed";
    }
  }
  return "failed";
}
