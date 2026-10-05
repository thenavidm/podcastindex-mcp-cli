# Versions

| Component | Version | Checked |
|---|---|---|
| Podcast Index API | 1.0 | 2026-09-01 |
| Slipway | ^0.1.17 | 2026-10-05 |
| MCP TypeScript SDK, through Slipway | 2.3.0 | 2026-10-05 |
| zod | 4.x | 2026-10-05 |
| Node | 22+ | 2026-10-05 |

## 2.0.1, 2026-10-05

- **Built on Slipway 0.1.17**, which a fresh install of 2.0.0 already used. Since the Slipway 2.0.0 was measured on, 0.1.11, `which` also reads a tool's argument names and prints a title once where a description opens with it, and the general help names the settings that connect an account and the safety switches and counts the rest, which `agent-context` describes one by one. [Slipway's changelog](https://github.com/thenavidm/slipway/blob/main/CHANGELOG.md) lists the rest.
- **A test checks that every setting is named in `--help` or described by `agent-context`**, where it asked `--help` to name each one.

## 2.0.0, 2026-10-05

Built on [Slipway](https://github.com/thenavidm/slipway) 0.1.11. The 36 tools keep their names and arguments, and every difference below was measured against 1.1.2, the last version on npm, before release.

- **A person approves each feed submission over MCP.** `submit_feed` and `submit_feed_by_itunes_id` add a podcast to a public directory that this API cannot remove it from; Claude Code (2.1.246 and later) shows its own prompt for each, and a client that can show forms asks with an approval form whose one box starts unticked. Approvals are signed, bound to the exact call and work once. Where a client can do neither, the model's `confirm: true` still counts, and `PODCASTINDEX_CONFIRM=model` makes it enough everywhere. `notify_feed_update` still needs nothing, and the audit log records who approved each write.
- **A smaller tool list.** 11,843 tokens in Claude Code with every tool loaded, down from 13,095: the per-tool `$schema` line, an `execution` field and `additionalProperties: false` are gone. The last one advertised strict input while unknown keys were dropped anyway; the schema now says what happens. The resources now say their type.
- **Exit codes come from the error, not its wording.** A rejected key, or one without write permission, exits 4; a feed that is not in the index 3; a rate limit 7, whatever the status, as in 1.1; and a missing key or secret 10. A parameter Podcast Index rejects (400) exits 2 instead of 5, and so do a show name passed where an identifier belongs, an identifier `notify_feed_update` cannot take, and `get_episode` with neither an id nor a GUID, which exited 3. An unknown command and a write hidden by `PODCASTINDEX_READ_ONLY=1` exit 2 instead of 1, and `doctor` with nothing configured 10 instead of 1. 1 now means an unexpected error. The resource, the surface and Podcast Index's detail come along in `details`.
- **`which <words>` finds a command**, and `agent-context` describes every command, flag and setting as JSON. In Codex 0.159.3, finding the command that finds the moment a phrase was said took 83,167 input tokens over the CLI instead of 83,990 (median of five), because Codex asked `which` instead of reading the full command list.
- **`install <client>`** adds the server to Claude Code, Codex, Claude Desktop, Cursor, VS Code or Gemini CLI in each one's own format.
- **Less work to start.** The entry turns on Node's compile cache, and the server spends 154 ms of CPU before its first answer where 1.1.2 spent 186 (median of 21 runs, taking turns on one busy Mac). npx installs 4 dependencies instead of 94.
- **The release carries the desktop extension**, which the README already sent Claude Desktop users to.
- **Docs fixes.** The README has a Features table, the icon and the terminal recording load from cdn.navid.me, the sample `doctor` output is the real one, the exit codes include 1, the server instructions, tool descriptions and docs use American spelling, and THIRD_PARTY_NOTICES.md lists the production dependencies' licenses.

### Upgrading

Node 22 or newer; 1.1 ran on 20. Scripts keep working for success, a refused submit, missing credentials, a rejected key, a rate limit and a show that is not in the index; one that read exit 1 as an unknown command or a hidden write, or exit 5 as a rejected parameter or an unusable identifier, should read 2. Over MCP, expect an approval prompt or form before a feed is submitted; a headless agent that should submit with `confirm: true` alone needs `PODCASTINDEX_CONFIRM=model`. The audit log's lines gain `surface`, `risk` and `confirmed_by`, and each allowed write is followed by a `done` or `failed` line. A script that pipes JSON-RPC into the server must keep stdin open until it reads the answer: the server now stops when its input ends, as the MCP stdio binding asks. `--http` refuses a page from another site unless `PODCASTINDEX_HTTP_ALLOWED_ORIGINS` lists it. Some terminal screens grew: the command list by 24 tokens, for the lines that point to `which` and `--help`; and the refusal to submit without `--confirm` by 14, for its code and a hint that `--confirm` is only for an action the user asked for.

## 1.1.2, 2026-10-04

- **`npx -y @thenavidm/podcastindex-mcp-cli` always starts the MCP server.** npx starts whichever binary the npm registry lists first when they share one file, and the registry does not keep the published order, so an MCP client set up with this README's install line could get `podcastindex-cli` and its command list instead of a server. A third binary named after the package now always starts the server, and npx picks it by name.

## 1.1.1

SKILL.md's exit-code table now matches the code: a refused write exits 2, not 5, and 10 says what is missing.

## 1.1.0

### Renamed to podcastindex-mcp-cli

The package and the repo are now `@thenavidm/podcastindex-mcp-cli`, the name
every server with a CLI carries. The binaries are `podcastindex-mcp` and
`podcastindex-cli`. The old package is deprecated with a pointer here, and
GitHub redirects the old repo address.

### A Claude Desktop extension

`desktop-extension/build.sh` produces a `.mcpb` that vendors its own
dependencies, so it installs on a double click with nothing present first. It
asks for the API key and secret, whether to run read only, and whether to allow
adding feeds to the index. Each release carries the file.

### Exit codes follow the contract

Nothing configured exits 10, not 4: the missing-credentials message names the
API key, and matching auth first sent people looking for a rejected key they
never set. A refused write exits 2, not 5, because it is the caller's to fix.

### The CLI

A second surface. The same 36 tools now run as shell commands.

- `podcastindex-cli` is a second binary onto the same entry point, dispatching
  on the invoked name. `podcastindex-mcp` is unchanged and still silent on
  stdout.
- Commands are generated from `ALL_TOOLS`, not described a second time: every
  flag, placeholder, help line and validation comes from the Zod schema the MCP
  tool already declares, so the two surfaces cannot drift. A tool added tomorrow
  is a command tomorrow.
- `--agent` (compact JSON, no prompts, no colour), `--select` for field
  projection, and exit codes a script can branch on: 2 usage, 3 not found,
  4 auth, 5 API, 7 rate limited, 10 config.
- `podcastindex-cli schema <command>` prints the exact JSON Schema an MCP client
  receives, so parity is checkable rather than asserted.
- `WriteGuard` now knows which surface called it, so a refusal names `--confirm`
  in a terminal and `confirm: true` to a model. `PODCASTINDEX_READ_ONLY=1` hides
  the writes from both surfaces identically.
- `makeContext` in `tools/kit.ts` is now the one place a handler context is
  built. The server used to assemble it inline.
- The `references` folder is gone. Its setup guide is now `INSTALL.md`, which
  the README links to. That folder was never in `files`, so it had shipped to
  nobody.
- README gained a complete environment variable table. Nine of the sixteen
  settings the code reads had never been documented, and two never reached
  `--help`. Both are now asserted by a test.

## 0.1.0

Not yet published to npm.

First build. 36 tools over the Podcast Index API and the Podcasting 2.0 files it
points at.

- Reads transcripts rather than returning a link to one. Fetches the file,
  detects SRT, WebVTT, JSON or HTML from the body rather than trusting the
  declared mime type, and returns timestamped text with speaker labels where the
  file carries them.
- `search_transcript` finds the moment a phrase was said, matching against
  merged paragraphs so a phrase split across two cues still matches.
- Chapters parsed from the Podcasting 2.0 file, keeping publisher-excluded
  chapters labelled rather than dropping them, since those are usually sponsor
  reads and hiding them misrepresents the episode.
- Three workflow tools: `get_show_profile`, `find_guest_appearances`,
  `find_shows_to_pitch`.
- `check_feed_health` turns the index's crawl counters into a verdict.
- Request signing with the clock drift measured from the server's own Date
  header, so `doctor` can distinguish a skewed clock from a bad key. Those are
  indistinguishable from the API response and the clock is the more common cause.
- Writes on by default, `confirm` required only on the two tools that add a
  feed to the public directory, which cannot be undone.
- stdio and streamable HTTP. HTTP refuses a non-loopback bind without a token.
- 70 tests against a faked transport. No network, no credentials.
