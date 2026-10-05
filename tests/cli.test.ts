/**
 * The two surfaces, now that Slipway builds both from ALL_TOOLS.
 *
 * Parsing, help and the exit-code contract are Slipway's and tested there. What
 * matters here: every tool arrives on both surfaces intact, under 1.1's command
 * names; the resources and prompts still reach a client; Podcast Index's
 * errors keep their exit codes; and the docs stay in step with the code.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXIT } from "@thenavidm/slipway";
import { checkApp, cli, connect } from "@thenavidm/slipway/testing";
import { MissingCredentialsError, NotFoundError, PodcastIndexError, RateLimitError, TimeoutError, WritePermissionError, errorFor } from "../src/api/errors.js";
import { app } from "../src/app.js";
import { ALL_TOOLS } from "../src/tools/index.js";
import { classifyShow, toSlipway } from "../src/tools/kit.js";

const creds = (): NodeJS.ProcessEnv => ({ PODCASTINDEX_API_KEY: "TESTKEY", PODCASTINDEX_API_SECRET: "testsecret" });

describe("Podcast Index on Slipway", () => {
  it("offers every tool as a command and over MCP, under the same names", async () => {
    const list = await cli(app, [], { env: creds() });
    for (const tool of ALL_TOOLS) expect(list.stdout).toContain(tool.command);
    const mcp = await connect(app, { env: creds() });
    const names = (await mcp.listTools()).map((tool) => tool.name);
    await mcp.close();
    expect(names).toEqual(ALL_TOOLS.map((tool) => tool.name));
  });

  it("serves the status and concepts resources and the four prompts", async () => {
    const mcp = await connect(app, { env: creds() });
    const resources = (await mcp.request("resources/list")) as { resources: Array<{ uri: string }> };
    const status = (await mcp.request("resources/read", { uri: "podcastindex://status" })) as { contents: Array<{ text: string }> };
    const prompts = (await mcp.request("prompts/list")) as { prompts: Array<{ name: string }> };
    await mcp.close();
    expect(resources.resources.map((r) => r.uri).sort()).toEqual(["podcastindex://concepts", "podcastindex://status"]);
    expect(JSON.parse(status.contents[0]!.text)).toMatchObject({ credentials_configured: true, read_only: false, max_transcript_chars: 24000 });
    expect(prompts.prompts.map((p) => p.name)).toEqual(["episode-deep-read", "guest-research", "pitch-list", "feed-checkup"]);
  });

  it("exits 10 with nothing configured, and 2 for a missing argument", async () => {
    expect((await cli(app, ["get-podcast", "--show", "920666"], { env: {} })).code).toBe(EXIT.notConfigured);
    expect((await cli(app, ["get-podcast"], { env: creds() })).code).toBe(EXIT.usage);
  });

  it("passes slipway check", async () => {
    const report = await checkApp(app, { env: creds() });
    expect(report.findings.filter((finding) => finding.level === "error")).toEqual([]);
  });
});

describe("Podcast Index's errors keep their exit codes", () => {
  it.each([
    ["nothing configured, not an auth failure", new MissingCredentialsError("neither is set"), EXIT.notConfigured],
    ["a rejected key", errorFor(401, "stats/current", ""), EXIT.auth],
    ["a key without write permission", new WritePermissionError("add/byfeedurl"), EXIT.auth],
    ["a feed that is not in the index", new NotFoundError("No podcast with that id", "podcasts"), EXIT.notFound],
    ["rate limited", new RateLimitError("search/byterm", 2), EXIT.rateLimited],
    ["a parameter Podcast Index rejected", errorFor(400, "search/byterm", ""), EXIT.usage],
    ["an upstream failure", errorFor(503, "search/byterm", ""), EXIT.api],
    ["a host that never answered", new PodcastIndexError("Could not reach api.podcastindex.org: fetch failed", 0, "api.podcastindex.org", { retryable: true }), EXIT.api],
    ["a timeout", new TimeoutError("No response from api.podcastindex.org within 30000ms.", "api.podcastindex.org"), EXIT.api],
    ["a chapters file that is not JSON", new Error("The chapters URL did not return JSON."), EXIT.api],
  ])("%s", (_name, raw, code) => {
    expect((toSlipway(raw) as { exitCode: number }).exitCode).toBe(code);
  });

  it("calls a show name a usage mistake, and says what to do instead", () => {
    expect(() => classifyShow("The Daily")).toThrow(expect.objectContaining({ exitCode: EXIT.usage, message: expect.stringContaining("search_podcasts") }));
  });

  it("leaves a bug in this code as unexpected", () => {
    expect(toSlipway(new TypeError("x is undefined"))).toBeInstanceOf(TypeError);
  });
});

describe("documentation stays in step with the code", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf-8");
  const names = (text: string): Set<string> => new Set((text.match(/PODCASTINDEX_[A-Z_]+/g) ?? []).filter((name) => !name.endsWith("_")));
  const source = (dir: string): string =>
    readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
      .map((entry) => (entry.isDirectory() ? source(`${dir}${entry.name}/`) : entry.name.endsWith(".ts") ? read(`${dir}${entry.name}`) : ""))
      .join("\n");

  /** Every variable the server reads: this repo's code, and Slipway's as agent-context lists them. */
  const used = async (): Promise<Set<string>> => {
    const context = JSON.parse((await cli(app, ["agent-context"], { env: {} })).stdout);
    return new Set([...names(source("../src/")), ...context.settings.map((setting: { env: string }) => setting.env)]);
  };

  /**
   * Two variables shipped undocumented and five never reached `--help`, which is
   * the kind of drift nobody notices because both sides look complete on their own.
   */
  it("documents every environment variable the code reads", async () => {
    const documented = names(read("../README.md"));
    expect([...(await used())].filter((v) => !documented.has(v))).toEqual([]);
  });

  it("lists every environment variable in --help", async () => {
    const help = (await cli(app, ["--help"], { env: {} })).stdout;
    // The help groups the HTTP ones as `PODCASTINDEX_HTTP_PORT / _HOST / _TOKEN / _ALLOWED_ORIGINS`.
    const shorthand = new Set(["PODCASTINDEX_HTTP_HOST", "PODCASTINDEX_HTTP_TOKEN", "PODCASTINDEX_HTTP_ALLOWED_ORIGINS"]);
    expect([...(await used())].filter((v) => !help.includes(v) && !shorthand.has(v))).toEqual([]);
  });

  /**
   * Two in-page links pointed at headings that had been renamed, including the
   * one row routing a shell user to the CLI. The ship checklist's link pass only
   * greps http, so a dead `#anchor` is the kind that ships quietly.
   */
  it.each(["../README.md", "../INSTALL.md"])("has no dead in-page anchors in %s", (file) => {
    if (!existsSync(new URL(file, import.meta.url))) return; // repo may ship one doc
    const md = read(file).replace(/```[\s\S]*?```/g, "");
    // GitHub's slug keeps letters, marks, numbers and connector punctuation, so an
    // emoji's variation selector (U+FE0F) stays in the anchor and a link has to carry it.
    const slugs = new Set(
      [...md.matchAll(/^#{1,6} (.+)$/gm)].map(([, heading]) =>
        (heading as string).trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, "").replace(/ /g, "-"),
      ),
    );
    const dead = [...md.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)]
      .map((m) => decodeURIComponent(m[1] as string))
      .filter((a) => !slugs.has(a));
    expect(dead).toEqual([]);
  });
});
