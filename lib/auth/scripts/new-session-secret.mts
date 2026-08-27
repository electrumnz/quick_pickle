#!/usr/bin/env node
/**
 * Generate an `ADMIN_SESSION_SECRET`.
 *
 *   npm run auth:new-session-secret
 *
 * 32 bytes from the platform CSPRNG, base64. This is the root key every admin
 * cookie is sealed under, so rotating it signs everybody out immediately — the
 * blunt emergency lever that sits behind per-session revocation.
 *
 * Print it, paste it into the environment, and do not keep a copy.
 */
import { stdout } from "node:process";

const SECRET_LENGTH_BYTES = 32;

const secret = new Uint8Array(SECRET_LENGTH_BYTES);
crypto.getRandomValues(secret);
stdout.write(`${Buffer.from(secret).toString("base64")}\n`);
