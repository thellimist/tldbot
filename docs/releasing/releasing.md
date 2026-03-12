---
summary: Release flow for npm, GitHub Releases, and the Homebrew tap.
read_when:
  - You are cutting a new tldbot release.
  - You are debugging why npm or Homebrew did not update after a tag.
  - You are changing the install story in README.
---

# Releasing

## Release Surfaces

`tldbot` ships through:
1. npm
2. GitHub releases
3. Homebrew tap
4. raw GitHub URLs for the installable skill

## Tag Flow

Tagging `vX.Y.Z` triggers:
- npm publish via `.github/workflows/publish.yml`
- Homebrew formula update via `.github/workflows/homebrew-tap.yml`

## Homebrew

Homebrew automation expects:
- tap repo: `thellimist/homebrew-tap`
- secret: `HOMEBREW_TAP_TOKEN`

The workflow:
1. downloads the tagged source tarball
2. computes `sha256`
3. writes `Formula/tldbot.rb`
4. commits it to the tap repo

Expected install command:

```bash
brew install thellimist/tap/tldbot
```

## Skill Distribution

The domain-selection skill is distributed directly from raw GitHub:

```bash
mkdir -p ~/.codex/skills/tldbot-domain-selector
curl -fsSL https://raw.githubusercontent.com/thellimist/tldbot/main/skills/tldbot-domain-selector/SKILL.md \
  -o ~/.codex/skills/tldbot-domain-selector/SKILL.md
```

The AGENTS fallback snippet is:

```bash
curl -fsSL https://raw.githubusercontent.com/thellimist/tldbot/main/skills/tldbot-domain-selector/references/agents-snippet.md
```
