<p align="center">
  <img src="assets/banner.png" alt="tldbot banner" width="100%">
</p>

# tldbot

CLI-first domain finder for AI agents like Claude Code and Codex.

1. Skill to help find domains
2. Check domain availability
3. Check social handles
4. Guide buying from correct registrar

Supports both CLI and MCP

## Install

Recommended

```bash
# Inside Claude Code or Codex, prompt
curl -fsSL https://raw.githubusercontent.com/thellimist/tldbot/main/skills/tldbot-domain-selector/SKILL.md and download tldbot
```

Others

```bash
# One-off CLI:
npx -y tldbot@latest --help

# Global CLI:
npm install -g tldbot

# Homebrew:
brew install thellimist/tap/tldbot
```

## Core Commands

```bash
# Search default TLDs:
tldbot search mydomain

# Search multiple names:
tldbot search mydomain namecli domscout --tlds com,io,dev,app,co

# Search custom TLDs:
tldbot search mydomain --tlds com,io,dev,app,co,net,ai,sh,so,bot

# Verify hot TLDs explicitly:
tldbot search mydomain --tlds io,sh,bot --verify

# Check socials:
tldbot check_socials mydomain

# Show buy commands:
tldbot buy mydomain.com

# Show buy commands with pricing context:
tldbot buy mydomain.com --price

# Show help:
tldbot --help
tldbot skills
```

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

Optional. Most users do not need this.
`--config` means: use this JSON settings file for this run.

```bash
tldbot --config ./tldbot.config.json search tldscout
```

```json
{
  "defaultSearchTlds": ["com", "io", "dev", "app", "co", "net", "ai", "sh", "so"],
  "allowedTlds": ["com", "io", "dev", "app", "co", "net", "org", "xyz", "ai", "sh", "so", "tools", "studio", "company", "me", "cc", "bot"]
}
```

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

## Development

```bash
npm install
npm run build
npm test -- --runInBand
```

## License

MIT
