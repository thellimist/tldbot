# tldbot

CLI-first domain finder for AI agents.

`tldbot` checks domain availability, distinguishes `available` vs `for_sale` vs `taken`, can verify a focused set of social handles, and gives the next buy command to run.

## Install

One-off CLI:

```bash
npx -y tldbot@latest --help
```

Global CLI:

```bash
npm install -g tldbot
```

Homebrew:

```bash
brew install thellimist/tap/tldbot
```

Install the interactive domain-selection skill into Codex:

```bash
mkdir -p ~/.codex/skills/tldbot-domain-selector
curl -fsSL https://raw.githubusercontent.com/thellimist/tldbot/main/skills/tldbot-domain-selector/SKILL.md \
  -o ~/.codex/skills/tldbot-domain-selector/SKILL.md
```

Or append the AGENTS fallback snippet:

```bash
curl -fsSL https://raw.githubusercontent.com/thellimist/tldbot/main/skills/tldbot-domain-selector/references/agents-snippet.md >> AGENTS.md
```

Then use `tldbot` to find a domain.

The skill is interactive by design:
- it starts with lots of naming options
- narrows only after you react
- uses fast search first on hot TLDs
- verifies only the shortlist
- social-checks and buy commands come last

## What It Is

- local-first CLI
- stdio MCP server from the same runtime
- public-infra domain search: RDAP, WHOIS, DNS nameserver fingerprints
- simple output built for terminals and agent transcripts
- installable agent skill for interactive domain selection

## Core Commands

Show help:

```bash
tldbot --help
tldbot help search_domain
tldbot help skills
```

Show version:

```bash
tldbot --version
```

Search default TLDs:

```bash
tldbot search_domain tldscout
```

Search custom TLDs:

```bash
tldbot search_domain tldscout --tlds com,io,dev,app,co,net,ai,sh,so,bot
```

Verify hot TLDs explicitly:

```bash
tldbot search_domain tldscout --tlds io,sh,bot --verify
```

Search multiple names:

```bash
tldbot search_domain tldscout namecli domscout --tlds com,io,dev,app,co
```

Check socials:

```bash
tldbot check_socials tldscout
```

Show buy commands:

```bash
tldbot --buy tldscout.com
tldbot buy tldscout.com
```

Show buy commands with pricing context:

```bash
tldbot --buy tldscout.com --price
```

## Interactive Domain Workflow

Use the skill when you want the agent to:
- generate a lot of options first
- narrow gradually
- run fast searches before strict verification
- only social-check and buy after a shortlist exists

Read the full guide:
- [domain-selection.md](/Users/kan/Projects/code/domain-search-mcp/docs/domain-selection/domain-selection.md)

## How Search Works

1. RDAP checks the registration state.
2. If registered, DNS nameserver fingerprints and listing-page enrichment detect aftermarket state.
3. Low-pressure TLDs verify deeply by default.
4. High-pressure TLDs stay fast by default and may be reported as non-verified.
5. `--verify` runs the stricter pass for the hot TLDs.

Statuses:

- `available`
- `for_sale`
- `taken`

Verification states:

- `confirmed`
- `provisional`
- `skipped_rate_limited`

## Config

No `.env`.

Optional config file:

```bash
tldbot --config ./tldbot.config.json search_domain tldscout
```

Example config file lives at `./tldbot.config.example.json`.

Use config only when you need to override defaults, such as:

- pricing backend URL/token
- Porkbun / Namecheap credentials
- custom Qwen endpoint
- default TLDs
- output format

## Cache

Search results are cached for 24 hours to avoid re-running the same TLD checks.

- default location: `~/.tldbot/`
- with `--config /path/to/tldbot.config.json`: `/path/to/.tldbot/`

Expired cache entries are dropped automatically.

## MCP

Run as stdio MCP server:

```bash
tldbot mcp
```

or let `tldbot` default to MCP when launched by an agent in non-interactive mode:

```bash
tldbot
```

Claude Code / Cursor style config:

```json
{
  "mcpServers": {
    "tldbot": {
      "command": "npx",
      "args": ["-y", "tldbot@latest"]
    }
  }
}
```

With a config file:

```json
{
  "mcpServers": {
    "tldbot": {
      "command": "npx",
      "args": ["-y", "tldbot@latest", "--config", "/absolute/path/tldbot.config.json"]
    }
  }
}
```

## What Changed

- package renamed to `tldbot`
- CLI/MCP only
- no HTTP/OpenAPI transport
- no `.env` flow
- no hosted negative-cache backend
- no training assets in this repo
- no Glama / Context7 listing metadata
- persistent 24h local cache in `~/.tldbot/`
- installable domain-selection skill
- Homebrew tap automation

## Development

```bash
npm install
npm run build
npm test -- --runInBand
```

## License

MIT
