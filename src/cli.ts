import { basename } from 'node:path';
import { spawn } from 'node:child_process';
import type { SearchDomainInput } from './tools/search_domain.js';
import type { CheckSocialsInput } from './tools/check_socials.js';
import { formatToolResult } from './utils/format.js';
import type { PurchaseResult, SearchResponse } from './types.js';
import { ConcurrencyLimiter } from './utils/concurrency.js';
import { config } from './config.js';
import { CLI_COMMAND } from './utils/cli-command.js';
import { setLogOutputMode } from './utils/logger.js';
import { executeRegisteredTool } from './app/tool-registry.js';
import type { PurchaseDomainInput } from './tools/purchase_domain.js';

function renderHelpText(): string {
  return [
    'tldbot',
    '',
    'CLI-first domain finder for AI agents.',
    '',
    'Commands:',
    `  ${CLI_COMMAND} search_domain <name...> [--tlds com,io,dev] [--verify|--fast] [--json]`,
    `  ${CLI_COMMAND} check_socials <name> [--platforms github,x,reddit] [--json]`,
    `  ${CLI_COMMAND} --buy <domain.tld> [--registrar namecheap|godaddy|cloudflare] [--price] [--json]`,
    '',
    'Global flags:',
    `  ${CLI_COMMAND} --config /path/to/tldbot.config.json ...`,
    `  ${CLI_COMMAND} --help`,
  ].join('\n');
}

export interface DirectCliSearchCommand {
  command: 'search_domain' | 'check_socials';
  input: SearchDomainInput;
  output: 'json' | 'table';
}

export interface DirectCliSocialCommand {
  command: 'check_socials';
  input: CheckSocialsInput;
  output: 'json' | 'table';
}

export type DirectCliCommand =
  | {
      command: 'help';
      output: 'table';
    }
  | {
      command: 'search_domain';
      input: SearchDomainInput;
      output: 'json' | 'table';
    }
  | {
      command: 'search_domain_multi';
      domains: string[];
      tlds?: string[];
      registrars?: string[];
      verification_mode?: SearchDomainInput['verification_mode'];
      output: 'json' | 'table';
    }
  | {
      command: 'purchase_domain';
      input: PurchaseDomainInput;
      output: 'json' | 'table';
      openBrowser: boolean;
      showPrice: boolean;
    }
  | DirectCliSocialCommand
  ;

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

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function parseCsvFlag(args: string[], flag: string): string[] | undefined {
  const value = getFlagValue(args, flag);
  if (!value) {
    return undefined;
  }

  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function parseVerificationMode(
  args: string[],
): SearchDomainInput['verification_mode'] {
  if (args.includes('--verify') || args.includes('--strict')) {
    return 'strict';
  }
  if (args.includes('--fast')) {
    return 'fast';
  }
  return 'smart';
}

function getPositionalArgsAfterCommand(args: string[]): string[] {
  const values: string[] = [];

  for (const value of args.slice(1)) {
    if (value.startsWith('--')) {
      break;
    }
    values.push(value);
  }

  return values;
}

function renderTable(headers: string[], rows: string[][]): string {
  const headerRow = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [headerRow, separator, body].filter(Boolean).join('\n');
}

function formatMatrixStatus(response: SearchResponse, tld: string): string {
  const result = response.results.find((entry) => entry.domain.endsWith(`.${tld}`));
  if (!result) {
    return '-';
  }

  if (result.status === 'available') {
    return 'A';
  }

  if (result.status === 'for_sale') {
    return result.marketplace ? `FS:${result.marketplace}` : 'FS';
  }

  return 'T';
}

function formatMultiSearchTable(
  domains: string[],
  tlds: string[],
  results: SearchResponse[],
): string {
  const headers = ['Name', ...tlds.map((tld) => `.${tld}`)];
  const rows = domains.map((domain, index) => [
    domain,
    ...tlds.map((tld) => formatMatrixStatus(results[index]!, tld)),
  ]);

  const totalDuration = results.reduce((sum, result) => sum + result.duration_ms, 0);
  const nonVerified = [...new Set(results.flatMap((result) => result.non_verified_domains || []))];
  const nextCommands = [
    `${CLI_COMMAND} search_domain <domain> --tlds ${tlds.join(',')}`,
    `${CLI_COMMAND} check_socials <domain>`,
    `${CLI_COMMAND} --buy <domain.tld> --price`,
    ...(nonVerified.length > 0
      ? [`${CLI_COMMAND} search_domain <domain> --tlds ${[...new Set(nonVerified.map((domain) => domain.split('.').pop()).filter(Boolean))].join(',')} --verify`]
      : []),
  ];

  return [
    `Search matrix: ${domains.length} names x ${tlds.length} TLDs | ${Math.max(0.1, Math.round(totalDuration / 100) / 10)}s`,
    'Legend: A=available, FS=for sale, T=taken',
    renderTable(headers, rows),
    ...(nonVerified.length > 0 ? [`Non-verified: ${nonVerified.join(', ')}`] : []),
    ...(nextCommands.length > 0
      ? [`\nNext commands:\n- ${nextCommands.join('\n- ')}`]
      : []),
  ].join('\n');
}

function formatMultiSearchJson(
  domains: string[],
  tlds: string[],
  results: SearchResponse[],
): string {
  return JSON.stringify(
    {
      tlds,
      legend: {
        A: 'available',
        FS: 'for_sale',
        T: 'taken',
      },
      rows: domains.map((domain, index) => [
        domain,
        ...tlds.map((tld) => formatMatrixStatus(results[index]!, tld)),
      ]),
      non_verified: [...new Set(results.flatMap((result) => result.non_verified_domains || []))],
      next: [
        `${CLI_COMMAND} search_domain <domain> --tlds ${tlds.join(',')}`,
        `${CLI_COMMAND} check_socials <domain>`,
        `${CLI_COMMAND} --buy <domain.tld> --price`,
        ...([...new Set(results.flatMap((result) => result.non_verified_domains || []))].length > 0
          ? [`${CLI_COMMAND} search_domain <domain> --tlds ${[...new Set(results.flatMap((result) => result.non_verified_domains || []).map((domain) => domain.split('.').pop()).filter(Boolean))].join(',')} --verify`]
          : []),
      ],
    },
    null,
    2,
  );
}

const MULTI_SEARCH_CONCURRENCY = 8;

function openUrlInBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? { binary: 'open', args: [url] }
      : process.platform === 'win32'
      ? { binary: 'cmd', args: ['/c', 'start', '', url] }
      : { binary: 'xdg-open', args: [url] };

  const child = spawn(command.binary, command.args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function isSearchBinary(invokedAs: string | undefined): boolean {
  if (!invokedAs) {
    return false;
  }

  const name = basename(invokedAs).toLowerCase();
  return name === CLI_COMMAND || name === 'domain_search' || name === 'search_domain';
}

export function resolveDirectCliSearchCommand(
  args: string[],
  invokedAs: string | undefined = process.argv[1],
): DirectCliCommand | null {
  let commandArgs = stripGlobalArgs(args);
  const explicitCommands = new Set([
    'search_domain',
    'check_socials',
    'purchase_domain',
    'suggest_domains',
    'suggest_domains_smart',
    'bulk_search',
    'tld_info',
    'analyze_project',
    'hunt_domains',
  ]);

  if (
    isSearchBinary(invokedAs) &&
    commandArgs[0] &&
    !commandArgs[0].startsWith('--') &&
    !explicitCommands.has(commandArgs[0])
  ) {
    commandArgs = ['search_domain', ...args];
  }

  const command = commandArgs[0];
  if (command === '--help' || command === 'help') {
    return {
      command: 'help',
      output: 'table',
    };
  }

  if (command === '--buy') {
    const domain = commandArgs[1];
    if (!domain) {
      throw new Error(
        `Usage: ${CLI_COMMAND} --buy <domain.tld> [--registrar namecheap|godaddy|cloudflare] [--price] [--json]`,
      );
    }

    return {
      command: 'purchase_domain',
      input: {
        domain,
        registrar: getFlagValue(commandArgs, '--registrar') as PurchaseDomainInput['registrar'],
      },
      output: commandArgs.includes('--json') ? 'json' : 'table',
      openBrowser: Boolean(getFlagValue(commandArgs, '--registrar')),
      showPrice: commandArgs.includes('--price') || commandArgs.includes('--prices'),
    };
  }

  if (command !== 'search_domain' && command !== 'domain_search') {
    if (command === 'check_socials') {
      const name = commandArgs[1];
      if (!name) {
        throw new Error(
          'Usage: tldbot check_socials <name> [--platforms github,x,reddit] [--json]',
        );
      }

      return {
        command: 'check_socials',
        input: {
          name,
          platforms: parseCsvFlag(commandArgs, '--platforms') as CheckSocialsInput['platforms'],
        } as CheckSocialsInput,
        output: commandArgs.includes('--json') ? 'json' : 'table',
      };
    }

    return null;
  }

  const domainNames = getPositionalArgsAfterCommand(commandArgs);

  if (domainNames.length === 0) {
    throw new Error(
      'Usage: tldbot search_domain <name...> [--tlds com,dev,io] [--registrars porkbun,namecheap] [--verify|--fast] [--json]',
    );
  }

  if (domainNames.length > 1) {
    return {
      command: 'search_domain_multi',
      domains: domainNames,
      tlds: parseCsvFlag(commandArgs, '--tlds') || config.defaultSearchTlds,
      registrars: parseCsvFlag(commandArgs, '--registrars'),
      verification_mode: parseVerificationMode(commandArgs),
      output: commandArgs.includes('--json') ? 'json' : 'table',
    };
  }

  return {
    command: 'search_domain',
    input: {
      domain_name: domainNames[0]!,
      tlds: parseCsvFlag(commandArgs, '--tlds') || config.defaultSearchTlds,
      registrars: parseCsvFlag(commandArgs, '--registrars'),
      verification_mode: parseVerificationMode(commandArgs),
    },
    output: commandArgs.includes('--json') ? 'json' : 'table',
  };
}

export async function tryHandleDirectCliCommand(
  args: string[],
  invokedAs: string | undefined = process.argv[1],
): Promise<boolean> {
  const command = resolveDirectCliSearchCommand(args, invokedAs);
  if (!command) {
    return false;
  }

  setLogOutputMode('plain');

  const result =
    command.command === 'help'
      ? renderHelpText()
      : command.command === 'search_domain'
      ? await executeRegisteredTool('search_domain', command.input as SearchDomainInput)
      : command.command === 'search_domain_multi'
      ? await (async () => {
          const limiter = new ConcurrencyLimiter(MULTI_SEARCH_CONCURRENCY);
          return Promise.all(
            command.domains.map((domain) =>
              limiter.run(() =>
                executeRegisteredTool('search_domain', {
                  domain_name: domain,
                  tlds: command.tlds,
                  registrars: command.registrars,
                  verification_mode: command.verification_mode,
                }),
              ),
            ),
          );
        })()
      : command.command === 'check_socials'
      ? await executeRegisteredTool('check_socials', command.input as CheckSocialsInput)
      : await executeRegisteredTool('purchase_domain', command.input as PurchaseDomainInput);

  if (command.command === 'purchase_domain' && command.openBrowser) {
    const purchase = result as PurchaseResult;
    const url = purchase.checkout_url;
    if (url) {
      openUrlInBrowser(url);
    }
  }

  const output =
    command.command === 'help'
      ? (result as string)
      : command.command === 'search_domain_multi' && command.output === 'json'
      ? formatMultiSearchJson(
          command.domains,
          command.tlds || config.defaultSearchTlds,
          result as SearchResponse[],
        )
      : command.output === 'json'
      ? JSON.stringify(result, null, 2)
      : command.command === 'search_domain_multi'
      ? formatMultiSearchTable(
          command.domains,
          command.tlds || config.defaultSearchTlds,
          result as SearchResponse[],
        )
      : command.command === 'purchase_domain' && !command.showPrice
      ? formatToolResult(
          command.command,
          {
            ...(result as PurchaseResult),
            price_first_year: null,
            price_renewal: null,
          },
          'table',
        )
      : formatToolResult(command.command, result, 'table');

  process.stdout.write(`${output}\n`);
  return true;
}
