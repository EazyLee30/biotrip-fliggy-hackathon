import { env } from "cloudflare:workers";

/** Shared storage without a dependency on browser cookies or Next rendering. */
export function getDatabase() { return env.BIOTRIP_DB; }
