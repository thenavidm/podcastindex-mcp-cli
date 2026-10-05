/**
 * The Podcast Index app: everything Slipway needs to ship the MCP server and the CLI.
 *
 * This file only describes. It never starts anything, so `slipway check` and
 * tests can import it; `index.ts` is what runs.
 */

import { slipway } from "@thenavidm/slipway";
import { hasCredentials, loadConfig } from "./config.js";
import { doctor } from "./doctor.js";
import { INSTRUCTIONS, PROMPTS, RESOURCES } from "./guide.js";
import { ALL_TOOLS } from "./tools/index.js";
import { makeContext, type ToolContext } from "./tools/kit.js";
import { VERSION } from "./version.js";

export { VERSION };

export const app = slipway<ToolContext>({
  name: "podcastindex",
  title: "Podcast Index",
  version: VERSION,
  package: "@thenavidm/podcastindex-mcp-cli",
  description: "the open podcast directory: shows, episodes, people, Podcasting 2.0 data, and the transcripts and chapters it points at",
  instructions: INSTRUCTIONS,
  context: (env) => makeContext(loadConfig(env)),
  configured: ({ config }) => hasCredentials(config),
  secrets: ({ config }) => [config.apiKey, config.apiSecret],
  tools: ALL_TOOLS,
  resources: [
    {
      name: "podcastindex-status",
      uri: "podcastindex://status",
      mimeType: "application/json",
      read: ({ config }) => ({
        credentials_configured: hasCredentials(config),
        read_only: config.readOnly,
        audit_log: config.auditPath ?? null,
        max_transcript_chars: config.maxTranscriptChars,
      }),
    },
    ...RESOURCES.map(({ text, ...resource }) => ({ ...resource, read: () => text })),
  ],
  prompts: PROMPTS.map(({ text, ...prompt }) => ({ ...prompt, render: () => text })),
  httpPort: 8000,
  doctor,
  // A key, a secret and a clock inside the three minute signing window all fail as the same 401, so doctor calls the API every time, as 1.1 did.
  doctorNetwork: true,
  login:
    "Get a free API key and secret at https://api.podcastindex.org/signup, then set PODCASTINDEX_API_KEY and PODCASTINDEX_API_SECRET. Run `podcastindex-cli doctor` to check them, and this machine's clock with them.",
  settings: [
    { env: "PODCASTINDEX_API_KEY", description: "Your API key, from api.podcastindex.org/signup.", secret: true },
    { env: "PODCASTINDEX_API_SECRET", description: "Your API secret. It signs each request and is never sent.", secret: true },
    { env: "PODCASTINDEX_USER_AGENT", description: "Your product's name, which Podcast Index asks callers to send.", tuning: true },
    { env: "PODCASTINDEX_MAX_TRANSCRIPT_CHARS", description: "How much transcript one call returns; 24000 when unset.", tuning: true },
    { env: "PODCASTINDEX_CACHE_TTL_MS", description: "How long a response stays reusable; 300000 when unset.", tuning: true },
    { env: "PODCASTINDEX_REQUEST_TIMEOUT_MS", description: "Each request's deadline; 30000 when unset.", tuning: true },
    { env: "PODCASTINDEX_FILE_TIMEOUT_MS", description: "The deadline for a transcript or chapters file; 45000 when unset.", tuning: true },
    { env: "PODCASTINDEX_MIN_REQUEST_INTERVAL_MS", description: "Spacing between requests; 120 when unset.", tuning: true },
    { env: "PODCASTINDEX_MAX_RETRIES", description: "Retries on rate limits and 5xx; 3 when unset.", tuning: true },
    { env: "PODCASTINDEX_API_HOST", description: "Another API host, for testing.", tuning: true },
  ],
  links: { repository: "https://github.com/thenavidm/podcastindex-mcp-cli" },
});
