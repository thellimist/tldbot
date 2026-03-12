---
summary: Project overview, scope, and goals for tldbot.
read_when:
  - You are new to the repository and need the product direction first.
  - You are deciding whether a change belongs in the core CLI/MCP scope.
  - You are updating search, buy, or social-check behavior and need the intended UX.
---

# Project

## What tldbot is

`tldbot` is a simple CLI and stdio MCP tool for AI agents to find domains.

It helps agents and shell users:
1. Check a name across a default or custom TLD set.
2. Distinguish `available`, `for_sale`, and `taken`.
3. Check a focused set of social handles.
4. Get the next buy command to run.
5. Install a domain-selection skill for interactive naming workflows.

The CLI is the primary product surface.
MCP is a thin adapter over the same runtime.

## Goals

1. CLI-first UX.
2. Shared logic across CLI and MCP.
3. Zero-config availability checks with public infrastructure first.
4. Honest results when rate limits interfere.
5. Compact output that works in terminals and agent transcripts.

## In scope

- domain availability
- aftermarket detection
- smart verification
- social handle checks
- buy command generation
- stdio MCP support
- installable domain-selection skill

## Out of scope

- hosted backend services
- HTTP/OpenAPI transport
- payment handling
- registrar account management
- model training artifacts in this repo

## Acknowledgement

This project started as a fork of `dorukardahan/domain-search-mcp`.
Thanks to Doruk Ardahan for the original foundation and MIT-licensed codebase.
