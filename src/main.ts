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

  const command = normalizedArgs[0];
  return Boolean(
    command === '--buy' ||
    command === 'search_domain' ||
    command === 'domain_search' ||
    command === 'check_socials'
  );
}

async function main(): Promise<void> {
  if (await tryHandleDirectCliCommand(process.argv.slice(2))) {
    return;
  }

  await startServer();
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
