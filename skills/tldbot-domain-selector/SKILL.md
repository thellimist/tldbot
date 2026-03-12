---
name: tldbot-domain-selector
description: Use when the user wants help choosing a startup, product, or AI-agent domain name, wants an interactive naming workflow, or wants to install and use tldbot plus a domain-selection skill. This skill prioritizes breadth first, shortlist second, verification third, and buy flow last.
---

# tldbot Domain Selector

Use this skill when the user wants to:
- pick a startup or agent name
- choose a domain from many options
- use `tldbot` interactively instead of doing one rigid lookup
- install `tldbot` or add domain-selection behavior to an agent setup

## First Move

If the user has not clearly installed `tldbot`, ask:

`Do you want me to install tldbot first, or just guide the naming process and give you the commands to run?`

If the user asks about installing the skill itself, offer two paths:
- install this skill into a local Codex skill folder
- append the AGENTS snippet from `references/agents-snippet.md`

## Install Paths

### CLI

Prefer one of these:

```bash
npx -y tldbot@latest --help
```

```bash
npm install -g tldbot
```

```bash
brew install thellimist/tap/tldbot
```

### Skill Install

Codex skill folder:

```bash
mkdir -p ~/.codex/skills/tldbot-domain-selector
curl -fsSL https://raw.githubusercontent.com/thellimist/tldbot/main/skills/tldbot-domain-selector/SKILL.md \
  -o ~/.codex/skills/tldbot-domain-selector/SKILL.md
```

Claude Code or AGENTS fallback:
- read `references/agents-snippet.md`
- append that snippet to the relevant `AGENTS.md`

## Naming Principles

Follow these rules:

1. Start with breadth.
Generate 30 to 100 options before trying to pick one.

2. Avoid early emotional commitment.
Do not anchor on one favorite name before checking domain reality.

3. Prefer names that are easy to say, spell, and remember.

4. Treat the domain path as part of the name quality.
A great name with a bad domain path is usually not a real finalist.

5. Do not over-negotiate parked names early.
If a name is merely decent and already parked, keep moving.

6. Use verification carefully.
For hot TLDs like `.ai`, `.io`, `.sh`, `.app`, `.dev`, and sometimes `.bot`, do fast search first and only verify the shortlist.

These principles are adapted from Paul Graham's startup naming essay and public comments on domain pricing and `.com` selection.

## Interaction Pattern

Always bias toward optionality.

### Round 1: option generation

Return a wide set of names first.

Group them into styles such as:
- literal
- compound
- coined
- operator-like
- infra/tool-like
- brandable

Do not search socials or buy paths yet unless the user explicitly asks.

### Round 2: first-pass domain search

Once the user reacts to the name directions, search broadly.

Good default:

```bash
tldbot search <name1> <name2> <name3> --tlds com,io,dev,app,co,net,ai,sh,so,bot
```

If many candidates are involved, keep the first pass fast.

### Round 3: shortlist

Summarize finalists in a compact form:
- name
- strongest TLD path
- whether the result is available, for sale, or taken
- whether any result is still non-verified

### Round 4: verification

Only verify the names the user actually likes.

For high-rate-limit TLDs, use:

```bash
tldbot search <name> --tlds ai,io,sh,app,dev,bot --verify
```

Mention clearly when a prior result was provisional and is now being confirmed.

### Round 5: socials

Check socials only on the shortlist.

```bash
tldbot check_socials <name>
```

### Round 6: price and buy

For finalists:

```bash
tldbot buy <domain.tld> --price
```

Only suggest buying after the user has shown conviction.

## Output Discipline

Prefer this sequence:

1. large option set
2. narrower shortlist
3. verification
4. socials
5. buy commands

Avoid this sequence:
- generate 3 names
- verify everything immediately
- social-check everything immediately
- talk about buying too early

## Rate-Limit Policy

If the TLD mix is low-pressure:
- deeper verification is fine earlier

If the TLD mix is high-pressure:
- fast mode first
- verify later

If the user likes a candidate on a hot TLD:
- explicitly say it is worth running a stricter verify pass now

## What To Say

Good opening:

`I’ll start with breadth first: 40-60 options, grouped by style, then we’ll only search the directions you like.`

Good transition to search:

`You have three promising directions. I’ll run a fast domain pass first so we preserve optionality before doing stricter verification.`

Good transition to verify:

`These two survived the fast pass. I’ll verify the hot TLDs now before we check socials or buying paths.`

## References

If you need the fuller reasoning, read:
- `references/paul-graham-domain-guide.md`
- `references/agents-snippet.md`
