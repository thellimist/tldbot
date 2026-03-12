---
summary: Architecture of the CLI-first runtime, stdio MCP adapter, and domain search pipeline.
read_when:
  - You are changing CLI flow or MCP tool execution.
  - You are moving logic between CLI and MCP and want to keep behavior aligned.
  - You are debugging how a domain query becomes a search result or buy command.
---

# Architecture

## System overview

`tldbot` has two surfaces:
1. CLI
2. stdio MCP

Both use the same shared application layer.

The repo also ships an installable skill in `skills/tldbot-domain-selector/`.
That skill is guidance and workflow, not runtime code.

Core runtime:
- `src/main.ts`: entrypoint
- `src/cli.ts`: direct CLI parsing and local rendering
- `src/server.ts`: stdio MCP bootstrap
- `src/app/tool-registry.ts`: shared tool registry

## Search flow

1. User runs `tldbot search_domain ...` or an MCP client calls `search_domain`.
2. Input is normalized by the CLI parser or MCP tool adapter.
3. The shared tool registry dispatches the tool executor.
4. `services/domain-search.ts` expands names and TLDs into concrete checks.
5. RDAP runs first.
6. WHOIS runs only when verification mode requires it.
7. Registered domains go through aftermarket detection:
   - nameserver fingerprints
   - listing-page enrichment when supported
8. Pricing is attached:
   - marketplace listing price when confidently available
   - public catalog estimate otherwise
9. Results are normalized into `available`, `for_sale`, or `taken`.
10. Verification state is attached:
   - `confirmed`
   - `provisional`
   - `skipped_rate_limited`
11. CLI or MCP formatting renders the same result object.

## Rate-limit strategy

1. TLDs are split into low-pressure and high-pressure buckets.
2. Low-pressure TLDs verify deeply by default.
3. High-pressure TLDs run with lower concurrency and host cooldowns.
4. When a hot source is rate-limited, the result degrades to honest non-verified output instead of blocking the whole run.
5. The next-step command tells the user how to rerun a strict verify pass.

## Cache strategy

1. In-process TTL caches reduce repeated work during one CLI or MCP run.
2. Domain and TLD caches also persist to disk for 24 hours.
3. Default cache path is `~/.tldbot/`.
4. When `--config` is used, the cache lives beside that config file in `.tldbot/`.
5. Expired entries are removed automatically on read and cleanup.

## Buy flow

1. User runs `tldbot --buy example.com` or MCP calls `purchase_domain`.
2. `services/purchase.ts` resolves one shared purchase result.
3. `for_sale` domains prefer the detected marketplace path.
4. `available` domains return registrar-specific checkout commands.

## Design constraints

1. CLI is primary.
2. MCP stays thin.
3. No hosted backend dependencies for normal use.
4. No `.env` runtime path; config is optional and file-based.
5. Keep output compact and agent-friendly.
