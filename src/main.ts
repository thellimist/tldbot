#!/usr/bin/env node

import { startServer } from './server.js';
import { tryHandleDirectCliCommand } from './cli.js';
import { logger, setLogOutputMode } from './utils/logger.js';

function stripGlobalArgs(args: string[]): string[] {
  const stripped: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (value === '--config') {
      index += 1;
      continue;
    }
    stripped.push(value);
  }

  return stripped;
}

function isCliInvocation(args: string[], invokedAs: string | undefined = process.argv[1]): boolean {
  const normalizedArgs = stripGlobalArgs(args);
  const binaryName = invokedAs ? invokedAs.split('/').pop()?.toLowerCase() : '';
  if (binaryName === 'domain_search' || binaryName === 'search_domain') {
    return true;
  }

  if (normalizedArgs.length === 0) {
    return Boolean(process.stdout.isTTY);
  }

  const command = normalizedArgs[0];
  return Boolean(
    command === '--help' ||
    command === '-h' ||
    command === '--version' ||
    command === '-V' ||
    command === 'version' ||
    command === 'help' ||
    command === 'skills' ||
    command === '--buy' ||
    command === 'buy' ||
    command === 'search_domain' ||
    command === 'domain_search' ||
    command === 'check_socials' ||
    command !== 'mcp'
  );
}

function shouldStartServer(args: string[]): boolean {
  const normalizedArgs = stripGlobalArgs(args);
  if (normalizedArgs.length === 0) {
    return !process.stdout.isTTY;
  }
  return normalizedArgs[0] === 'mcp' || normalizedArgs[0] === 'stdio';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (await tryHandleDirectCliCommand(args)) {
    return;
  }

  if (shouldStartServer(args)) {
    await startServer();
    return;
  }

  throw new Error('Unknown command. Run `tldbot --help` for usage.');
}

main().catch((error) => {
  if (isCliInvocation(process.argv.slice(2))) {
    setLogOutputMode('plain');
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  logger.error('Failed to start server', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
