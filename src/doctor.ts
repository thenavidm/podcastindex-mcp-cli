/**
 * The checks that say what is actually broken.
 *
 * Integrations fail for about five reasons and all of them look identical from
 * inside an MCP client, which reports "the tool errored" and nothing else.
 *
 * The reason this file earns its place here specifically is the clock. Podcast
 * Index signs every request with a timestamp and accepts a three minute window.
 * A machine outside that window fails every call with a 401, and a 401 reads as
 * "wrong key" to everybody, so the natural response is to regenerate a
 * perfectly good credential and fail again. Measuring the drift against the
 * server's own Date header turns a mystery into one line of output. Slipway
 * runs these on every `doctor`, as 1.1 did, after its own checks.
 */

import type { DoctorCheck } from "@thenavidm/slipway";
import { hasCredentials } from "./config.js";
import type { ToolContext } from "./tools/kit.js";

/** How far outside the signing window is fatal. The API allows three minutes. */
const WINDOW_SECONDS = 180;

const SIGNUP = "Get a free key and secret at https://api.podcastindex.org/signup, then set both in the server's env block.";

export async function doctor({ api, config }: ToolContext, options: { network: boolean }): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [
    config.apiKey
      ? { name: "API key", ok: true, detail: `set, ${config.apiKey.length} characters` }
      : { name: "API key", ok: false, detail: "PODCASTINDEX_API_KEY is not set", fix: SIGNUP },
    config.apiSecret
      ? { name: "API secret", ok: true, detail: `set, ${config.apiSecret.length} characters` }
      : { name: "API secret", ok: false, detail: "PODCASTINDEX_API_SECRET is not set. The key alone cannot sign a request", fix: SIGNUP },
  ];
  if (!hasCredentials(config)) {
    checks.push({ name: "Clock sync", ok: true, warn: true, detail: "not measured: credentials are needed to reach the server" });
    return checks;
  }
  if (!options.network) return checks;

  try {
    const stats = await api.stats();
    const total = stats.stats?.feedCountTotal;
    checks.push({
      name: "Podcast Index API",
      ok: true,
      detail: total ? `reachable and authenticated, ${total.toLocaleString()} feeds indexed` : "reachable and authenticated",
    });
  } catch (error) {
    checks.push({ name: "Podcast Index API", ok: false, detail: (error as Error)?.message ?? String(error) });
  }

  // Measured even when the call above failed, because the 401 response
  // carries a Date header too, and a drifting clock is the likeliest reason
  // that call failed in the first place.
  const skew = api.clockSkewSeconds;
  if (skew === undefined) {
    checks.push({ name: "Clock sync", ok: false, detail: "could not be measured: no response reached the server" });
  } else if (Math.abs(skew) >= WINDOW_SECONDS) {
    checks.push({
      name: "Clock sync",
      ok: false,
      detail: `this machine is ${Math.abs(skew)} seconds ${skew > 0 ? "ahead of" : "behind"} Podcast Index, which is outside the ${WINDOW_SECONDS} second signing window. Every request will fail with a 401 that looks like a bad key`,
      fix: 'Fix the clock rather than the credentials: enable automatic time sync in system settings, or run "sudo sntp -sS time.apple.com" on macOS.',
    });
  } else {
    checks.push({ name: "Clock sync", ok: true, detail: `${Math.abs(skew)} seconds ${skew >= 0 ? "ahead" : "behind"}, well inside the ${WINDOW_SECONDS} second signing window` });
  }
  return checks;
}
