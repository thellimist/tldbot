# tldbot

CLI-first domain finder for AI agents.

`tldbot` checks domain availability, distinguishes `available` vs `for_sale` vs `taken`, can verify a focused set of social handles, and gives the next buy command to run.

## What It Is

- local-first CLI
- stdio MCP server from the same runtime
- public-infra domain search: RDAP, WHOIS, DNS nameserver fingerprints
- simple output built for terminals and agent transcripts

## Core Commands

Search default TLDs:

```bash
npx -y tldbot@latest search_domain tldscout
```

Search custom TLDs:

```bash
npx -y tldbot@latest search_domain tldscout --tlds com,io,dev,app,co,net,ai,sh,so,bot
```

Verify hot TLDs explicitly:

```bash
npx -y tldbot@latest search_domain tldscout --tlds io,sh,bot --verify
```

Search multiple names:

```bash
npx -y tldbot@latest search_domain tldscout namecli domscout --tlds com,io,dev,app,co
```

Check socials:

```bash
npx -y tldbot@latest check_socials tldscout
```

Show buy commands:

```bash
npx -y tldbot@latest --buy tldscout.com
```

Show buy commands with pricing context:

```bash
npx -y tldbot@latest --buy tldscout.com --price
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

## MCP

Run as stdio MCP server:

```bash
npx -y tldbot@latest
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

## Development

```bash
npm install
npm run build
npm test -- --runInBand
```

## License

MIT
