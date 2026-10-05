/**
 * Shared plumbing every tool uses, now on Slipway.
 *
 * Tool modules keep describing themselves with a Zod shape, a risk and a
 * handler. This adapter turns each into a Slipway tool, so the MCP server, the
 * CLI, the write guard, annotations and errors all come from the framework
 * instead of a copy kept in this repo.
 *
 * The piece of real logic here is `resolveFeed`. Podcast Index identifies a
 * show four different ways and has a different endpoint for each, while a
 * person asking a question has whichever one they happened to find: a feed URL
 * from their host, an Apple link they copied, a numeric id from an earlier
 * result. Four near-identical tools would push that bookkeeping onto the model,
 * which then has to know that an Apple Podcasts URL contains an iTunes id. One
 * tool that recognizes all four is the difference between a working call and a
 * plausible guess at the wrong endpoint.
 */

import {
  ApiError,
  NotConfiguredError,
  RateLimitError as SlipwayRateLimitError,
  SlipwayError,
  TimeoutError as SlipwayTimeoutError,
  UsageError,
  httpError,
  toSlipwayError,
  toolkit,
  z,
  type Risk,
  type Tool,
} from "@thenavidm/slipway";
import { MissingCredentialsError, NotFoundError, PodcastIndexError, TimeoutError } from "../api/errors.js";
import { PodcastIndexClient } from "../api/client.js";
import { HttpClient, type FetchLike } from "../api/http.js";
import type { Config } from "../config.js";
import type { Feed } from "../api/types.js";

/**
 * Which of the three surfaces a tool needs.
 *
 * `index` needs the credential. `open` does not. `web` leaves Podcast Index
 * entirely and fetches a file from the podcaster's own host, which is both the
 * least reliable thing this server does and the most injectable.
 */
export type Surface = "index" | "open" | "web";

export type ToolContext = {
  api: PodcastIndexClient;
  http: HttpClient;
  config: Config;
};

const kit = toolkit<ToolContext>();

/** The argument that names a show, in every shape someone might have one. */
export const showArg = {
  show: z
    .string()
    .describe(
      "The show, in whichever form you have. Any of: a Podcast Index feed id (920666), an RSS feed URL, a podcast GUID, an Apple Podcasts URL, or a bare iTunes id. The form is detected, so pass what you have rather than converting it.",
    ),
};

/**
 * Kept so tool modules read the same, but never sent: Slipway adds `confirm`
 * to every tool that cannot be undone, with one description everywhere.
 */
export const confirmArg = {
  confirm: z.boolean().optional(),
};

export const maxArg = (fallback: number, note = "") => ({
  max: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(`How many to return. Defaults to ${fallback}.${note ? ` ${note}` : ""}`),
});

export const sinceArg = {
  since: z
    .number()
    .int()
    .optional()
    .describe(
      "Only include things published after this time, as a unix timestamp in seconds. A negative number is read as seconds before now, so -604800 means the last week.",
    ),
};

/** What kind of identifier a caller handed us. */
export type ShowRef =
  | { kind: "feedId"; value: number }
  | { kind: "feedUrl"; value: string }
  | { kind: "guid"; value: string }
  | { kind: "itunesId"; value: number };

/**
 * Work out which of the four identifiers a string is.
 *
 * Order matters. A URL is checked before a bare number because an Apple
 * Podcasts URL contains a numeric id, and a GUID before a feed id because a
 * podcast GUID is a UUID and would otherwise fall through to the URL branch.
 */
export function classifyShow(raw: string): ShowRef {
  const input = raw.trim();

  if (/^\d+$/.test(input)) return { kind: "feedId", value: Number(input) };

  // Apple Podcasts links end in /id1234567890, sometimes with a query string.
  const apple = input.match(/podcasts\.apple\.com\/.*\/id(\d+)/i);
  if (apple?.[1]) return { kind: "itunesId", value: Number(apple[1]) };

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    return { kind: "guid", value: input };
  }

  if (/^https?:\/\//i.test(input)) return { kind: "feedUrl", value: input };

  throw new UsageError(
    `"${raw}" is not a show identifier this understands. Pass a Podcast Index feed id, an RSS feed URL, a podcast GUID, or an Apple Podcasts URL. If you only have a name, call search_podcasts first.`,
  );
}

/**
 * Fetch a feed from whichever identifier the caller had.
 *
 * The single-feed endpoints answer a miss with 200 and an empty `feed`, not a
 * 404, so an absent show has to be detected here rather than surfacing as an
 * empty object that reads like a real result.
 */
export async function resolveFeed(api: PodcastIndexClient, raw: string): Promise<Feed> {
  const ref = classifyShow(raw);

  const response =
    ref.kind === "feedId"
      ? await api.podcastByFeedId(ref.value)
      : ref.kind === "feedUrl"
        ? await api.podcastByFeedUrl(ref.value)
        : ref.kind === "guid"
          ? await api.podcastByGuid(ref.value)
          : await api.podcastByItunesId(ref.value);

  const feed = Array.isArray(response.feed) ? response.feed[0] : response.feed;
  if (!feed || !feed.id) {
    throw new NotFoundError(
      `Podcast Index has no feed for "${raw}" (read as a ${ref.kind}). The index is large but not complete, and a show can be missing entirely. If you have the RSS URL, submit_feed adds it.`,
      "podcasts",
    );
  }
  return feed;
}

/** Turn a negative `since` into an absolute unix timestamp. */
export function normalizeSince(since: number | undefined): number | undefined {
  if (since === undefined) return undefined;
  if (since < 0) return Math.floor(Date.now() / 1000) + since;
  return since;
}

type Shape = Record<string, z.ZodType>;

export type ToolSpec<S extends Shape> = {
  name: string;
  /** One line, imperative. Shown in tool pickers. */
  title: string;
  description: string;
  schema: S;
  risk: Risk;
  surface: Surface;
  /** True when calling twice has the same effect as calling once. */
  idempotent?: boolean;
  /** What a confirmed call does that cannot be taken back, for the refusal and the approval. */
  consequence?: string;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
  /** One line for the audit log and the confirm message, when this writes. */
  summary?: (args: z.infer<z.ZodObject<S>>) => string;
};

export type AnyToolSpec = Tool<ToolContext>;

/**
 * Podcast Index's status picks the exit code: 401 and 403 (a key without
 * write permission) are 4, 404 is 3, 429 is 7, 400 is 2 and the rest 5. A
 * rate limit is 7 whatever the status, read from the words as 1.1 did, and a
 * missing key or secret is setup still to do, 10. A request that never got an
 * answer is upstream, 5, and a bug in this code stays 1.
 */
export function toSlipway(error: unknown): unknown {
  if (error instanceof SlipwayError) return error;
  if (error instanceof MissingCredentialsError) return new NotConfiguredError(error.message, { cause: error });
  if (error instanceof PodcastIndexError) {
    const options = {
      ...(error.status ? { status: error.status } : {}),
      details: { resource: error.resource, ...(error.surface ? { surface: error.surface } : {}), ...(error.detail ? { detail: error.detail } : {}) },
      cause: error,
    };
    if (error.status === 429 || /rate ?limit/i.test(error.message)) return new SlipwayRateLimitError(error.message, options);
    if (error instanceof TimeoutError) return new SlipwayTimeoutError(error.message, options);
    return error.status ? httpError(error.status, error.message, options) : new ApiError(error.message, options);
  }
  if (error instanceof Error && error.constructor === Error) {
    const known = toSlipwayError(error);
    return known.code === "internal" ? new ApiError(error.message, { cause: error }) : known;
  }
  return error;
}

export function defineTool<S extends Shape>(spec: ToolSpec<S>): Tool<ToolContext> {
  const { confirm: _confirm, ...shape } = spec.schema as Shape;
  const handler = spec.handler as (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  return kit.defineTool({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: z.object(shape),
    risk: spec.risk,
    // 1.1 called every call idempotent unless it could not be undone, and the annotations keep saying so.
    idempotent: spec.idempotent ?? spec.risk !== "destructive",
    ...(spec.consequence ? { consequence: spec.consequence } : {}),
    ...(spec.summary ? { summary: spec.summary as (args: Record<string, unknown>) => string } : {}),
    handler: async (args, ctx) => {
      try {
        return await handler(args, ctx);
      } catch (error) {
        throw toSlipway(error);
      }
    },
  });
}

/**
 * Build the context every handler receives.
 *
 * Both surfaces call this. The MCP server used to assemble the object inline,
 * which meant the CLI would have had to assemble a second one and the two would
 * have drifted the first time a field was added. One constructor, one shape.
 */
export function makeContext(config: Config, fetchImpl: FetchLike = fetch): ToolContext {
  const http = new HttpClient(config, fetchImpl);
  const api = new PodcastIndexClient(http);
  return { api, http, config };
}

/** Clamp a caller-supplied max into a range the upstream will accept. */
export function clamp(value: number | undefined, fallback: number, max = 1000): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/** Trim a summary to one readable line for the audit log. */
export function snippet(text: string | undefined, length = 60): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}
