import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { formatToolResult } from './utils/format.js';
import type { PurchaseResult, SearchResponse } from './types.js';
import { ConcurrencyLimiter } from './utils/concurrency.js';
import {
  config,
  getActiveConfigPath,
  loadRawConfigFile,
  saveRawConfigFile,
  setPersistedConfigPath,
} from './config.js';
import { CLI_COMMAND } from './utils/cli-command.js';
import { setLogOutputMode } from './utils/logger.js';
import { CLI_VERSION } from './utils/version.js';
import { executeRegisteredTool } from './app/tool-registry.js';
import type { SearchDomainInput } from './tools/search_domain.js';
import type { CheckSocialsInput } from './tools/check_socials.js';
import type { PurchaseDomainInput } from './tools/purchase_domain.js';
import type { Config } from './types.js';

type OutputMode = 'json' | 'table';
type HelpTopic = 'top' | 'search' | 'check_socials' | 'buy' | 'skills' | 'config';

const MULTI_SEARCH_CONCURRENCY = 8;
const KNOWN_VALUE_FLAGS = new Set([
  '--config',
  '--tlds',
  '--registrars',
  '--platforms',
  '--registrar',
]);
const REPO_URL = 'https://github.com/thellimist/tldbot';
const ISSUES_URL = 'https://github.com/thellimist/tldbot/issues';
const SKILL_PATH = join(__dirname, '..', 'skills', 'tldbot-domain-selector', 'SKILL.md');

function normalizeHelpTopic(value: string | undefined): HelpTopic {
  switch ((value || '').toLowerCase()) {
    case 'search':
      return 'search';
    case 'social':
    case 'socials':
    case 'check_socials':
      return 'check_socials';
    case 'buy':
      return 'buy';
    case 'skill':
    case 'skills':
    case 'domain-selection':
      return 'skills';
    case 'config':
      return 'config';
    default:
      return 'top';
  }
}

function renderHelpText(topic: HelpTopic = 'top'): string {
  if (topic === 'search') {
    return [
      `${CLI_COMMAND} search`,
      '',
      'Search one or more names across a default or custom TLD set.',
      '',
      'Usage:',
      `  ${CLI_COMMAND} search <name...> [--tlds com,io,dev] [--verify|--fast] [--json]`,
      '',
      'Options:',
      '  --tlds CSV          Override the default TLD set',
      '  --verify, --strict  Run stricter verification on hot TLDs',
      '  --fast              Skip extra verification when possible',
      '  --registrars CSV    Preferred registrars for pricing/buy paths',
      '  --json              Output compact JSON',
      '  -h, --help          Show this help',
      '',
      'Examples:',
      `  ${CLI_COMMAND} search tldbot`,
      `  ${CLI_COMMAND} search tldbot namecli --tlds com,io,dev,app,co`,
      `  ${CLI_COMMAND} search tldbot --tlds ai,io,sh,app,dev,bot --verify`,
      '',
      'Notes:',
      '  Hot TLDs are searched fast first. Verify only the shortlist you actually like.',
    ].join('\n');
  }

  if (topic === 'check_socials') {
    return [
      `${CLI_COMMAND} check_socials`,
      '',
      'Check focused social handle availability for a shortlist name.',
      '',
      'Usage:',
      `  ${CLI_COMMAND} check_socials <name> [--platforms github,x,reddit] [--json]`,
      '',
      'Options:',
      '  --platforms CSV     Limit to specific platforms',
      '  --json              Output JSON',
      '  -h, --help          Show this help',
      '',
      'Example:',
      `  ${CLI_COMMAND} check_socials tldbot --platforms github,x,reddit,npm`,
    ].join('\n');
  }

  if (topic === 'buy') {
    return [
      `${CLI_COMMAND} buy`,
      '',
      'Show the next buy command for an available or for-sale domain.',
      '',
      'Usage:',
      `  ${CLI_COMMAND} buy <domain.tld> [--registrar namecheap|godaddy|cloudflare] [--price] [--json]`,
      '',
      'Options:',
      '  --registrar NAME    Open or print a registrar-specific buy path',
      '  --price             Include price context when available',
      '  --json              Output JSON',
      '  -h, --help          Show this help',
      '',
      'Examples:',
      `  ${CLI_COMMAND} buy tldbot.com`,
      `  ${CLI_COMMAND} buy tldbot.com --price`,
      `  ${CLI_COMMAND} buy tldbot.com --registrar godaddy`,
    ].join('\n');
  }

  if (topic === 'skills') {
    return [
      `${CLI_COMMAND} skills`,
      '',
      'Print the installable domain-selection skill.',
      '',
      'Usage:',
      `  ${CLI_COMMAND} skills`,
      '',
      'Tip:',
      `  ${CLI_COMMAND} skills > ~/.codex/skills/tldbot-domain-selector/SKILL.md`,
    ].join('\n');
  }

  if (topic === 'config') {
    return [
      `${CLI_COMMAND} config`,
      '',
      'Show or update saved CLI settings.',
      '',
      'Usage:',
      `  ${CLI_COMMAND} config show`,
      `  ${CLI_COMMAND} config set <key> <value>`,
      `  ${CLI_COMMAND} config path [path/to/config.json]`,
      '',
      'Keys:',
      '  defaultSearchTlds     CSV list of default search TLDs',
      '  allowedTlds           CSV list of allowed TLDs',
      '  cache.availabilityTtl Seconds before search cache expires',
      '',
      'Examples:',
      `  ${CLI_COMMAND} config set defaultSearchTlds com,io,dev,app,co,net,ai,sh,so`,
      `  ${CLI_COMMAND} config set allowedTlds com,io,dev,app,co,net,org,xyz,ai,sh,so,bot`,
      `  ${CLI_COMMAND} config path ./tldbot.config.json`,
    ].join('\n');
  }

  return [
    `${CLI_COMMAND} ${CLI_VERSION}`,
    '',
    'CLI-first domain finder for AI agents.',
    '',
    'Usage:',
    `  ${CLI_COMMAND} <command> [options]`,
    `  ${CLI_COMMAND} buy <domain.tld> [options]`,
    '',
    'Commands:',
    '  search          Search one or more names across TLDs',
    '  check_socials   Check social handle availability for a shortlist name',
    '  buy             Show the next buy command for a domain',
    '  config          Show or update saved CLI settings',
    '  skills          Print the installable domain-selection skill',
    '  help            Show top-level or command help',
    '  mcp             Start the stdio MCP server explicitly',
    '',
    'Global options:',
    '  -h, --help      Show help',
    '  -V, --version   Show version',
    '  --config PATH   Use a JSON config file',
    '',
    'Examples:',
    `  ${CLI_COMMAND} search tldbot --tlds com,io,dev,app,co`,
    `  ${CLI_COMMAND} search tldbot --tlds ai,io,sh --verify`,
    `  ${CLI_COMMAND} check_socials tldbot`,
    `  ${CLI_COMMAND} buy tldbot.com --price`,
    `  ${CLI_COMMAND} config set defaultSearchTlds com,io,dev,app,co,net,ai,sh,so`,
    `  ${CLI_COMMAND} skills`,
    '',
    'Agent workflow:',
    `  ${CLI_COMMAND} skills`,
    '',
    'More:',
    `  Docs:   ${REPO_URL}`,
    `  Issues: ${ISSUES_URL}`,
  ].join('\n');
}

export type DirectCliCommand =
  | {
      command: 'help';
      topic: HelpTopic;
      output: 'table';
    }
  | {
      command: 'version';
      output: 'table';
    }
  | {
      command: 'skills';
      output: 'table';
    }
  | {
      command: 'config_show' | 'config_set' | 'config_path';
      output: 'table';
      key?: string;
      value?: string;
      path?: string;
    }
  | {
      command: 'search';
      input: SearchDomainInput;
      output: OutputMode;
    }
  | {
      command: 'search_multi';
      domains: string[];
      tlds?: string[];
      registrars?: string[];
      verification_mode?: SearchDomainInput['verification_mode'];
      output: OutputMode;
    }
  | {
      command: 'buy';
      input: PurchaseDomainInput;
      output: OutputMode;
      openBrowser: boolean;
      showPrice: boolean;
    }
  | {
      command: 'check_socials';
      input: CheckSocialsInput;
      output: OutputMode;
    };

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

function hasHelpFlag(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

function hasVersionFlag(args: string[]): boolean {
  return args.includes('--version') || args.includes('-V');
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

function parseVerificationMode(args: string[]): SearchDomainInput['verification_mode'] {
  if (args.includes('--verify') || args.includes('--strict')) {
    return 'strict';
  }
  if (args.includes('--fast')) {
    return 'fast';
  }
  return 'smart';
}

function extractPositionals(args: string[], startIndex: number): string[] {
  const values: string[] = [];

  for (let index = startIndex; index < args.length; index += 1) {
    const value = args[index]!;

    if (KNOWN_VALUE_FLAGS.has(value)) {
      index += 1;
      continue;
    }

    if (value === '--help' || value === '-h' || value === '--json' || value === '--verify' || value === '--strict' || value === '--fast' || value === '--price' || value === '--prices') {
      continue;
    }

    if (value.startsWith('-')) {
      continue;
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

function formatMultiSearchTable(domains: string[], tlds: string[], results: SearchResponse[]): string {
  const headers = ['Name', ...tlds.map((tld) => `.${tld}`)];
  const rows = domains.map((domain, index) => [
    domain,
    ...tlds.map((tld) => formatMatrixStatus(results[index]!, tld)),
  ]);

  const totalDuration = results.reduce((sum, result) => sum + result.duration_ms, 0);
  const nonVerified = [...new Set(results.flatMap((result) => result.non_verified_domains || []))];
  const nextCommands = [
    `${CLI_COMMAND} search <domain> --tlds ${tlds.join(',')}`,
    `${CLI_COMMAND} check_socials <domain>`,
    `${CLI_COMMAND} buy <domain.tld> --price`,
    ...(nonVerified.length > 0
      ? [`${CLI_COMMAND} search <domain> --tlds ${[...new Set(nonVerified.map((domain) => domain.split('.').pop()).filter(Boolean))].join(',')} --verify`]
      : []),
  ];

  return [
    `Search matrix: ${domains.length} names x ${tlds.length} TLDs | ${Math.max(0.1, Math.round(totalDuration / 100) / 10)}s`,
    'Legend: A=available, FS=for sale, T=taken',
    renderTable(headers, rows),
    ...(nonVerified.length > 0 ? [`Non-verified: ${nonVerified.join(', ')}`] : []),
    ...(nextCommands.length > 0 ? [`\nNext commands:\n- ${nextCommands.join('\n- ')}`] : []),
  ].join('\n');
}

function formatMultiSearchJson(domains: string[], tlds: string[], results: SearchResponse[]): string {
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
        `${CLI_COMMAND} search <domain> --tlds ${tlds.join(',')}`,
        `${CLI_COMMAND} check_socials <domain>`,
        `${CLI_COMMAND} buy <domain.tld> --price`,
        ...([...new Set(results.flatMap((result) => result.non_verified_domains || []))].length > 0
          ? [`${CLI_COMMAND} search <domain> --tlds ${[...new Set(results.flatMap((result) => result.non_verified_domains || []).map((domain) => domain.split('.').pop()).filter(Boolean))].join(',')} --verify`]
          : []),
      ],
    },
    null,
    2,
  );
}

function readSkillMarkdown(): string {
  return readFileSync(SKILL_PATH, 'utf8');
}

function setNestedValue(target: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split('.');
  let cursor = target;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]!;
    const current = cursor[part];
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]!] = value;
}

function parseConfigValue(key: string, value: string): unknown {
  if (key === 'defaultSearchTlds' || key === 'allowedTlds') {
    return value
      .split(',')
      .map((item) => item.trim().replace(/^\./, ''))
      .filter(Boolean);
  }

  if (key === 'cache.availabilityTtl') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('cache.availabilityTtl must be a positive number of seconds.');
    }
    return parsed;
  }

  if (
    key === 'pricingApi.enabled' ||
    key === 'aftermarket.sedoEnabled' ||
    key === 'aftermarket.nsEnabled' ||
    key === 'checkout.enabled'
  ) {
    if (value !== 'true' && value !== 'false') {
      throw new Error(`${key} must be true or false.`);
    }
    return value === 'true';
  }

  return value;
}

function updateConfigFile(key: string, value: string): string {
  const configPath = getActiveConfigPath();
  const raw = loadRawConfigFile(configPath) as Record<string, unknown>;
  setNestedValue(raw, key, parseConfigValue(key, value));
  saveRawConfigFile(configPath, raw as Partial<Config>);
  return configPath;
}

function moveConfigPath(nextPath: string): string {
  const currentPath = getActiveConfigPath();
  const resolvedPath = resolve(process.cwd(), nextPath);

  mkdirSync(dirname(resolvedPath), { recursive: true });

  if (existsSync(currentPath) && currentPath !== resolvedPath) {
    renameSync(currentPath, resolvedPath);
  }

  setPersistedConfigPath(resolvedPath);
  return resolvedPath;
}

function renderConfigShow(): string {
  return JSON.stringify(
    {
      path: getActiveConfigPath(),
      config,
    },
    null,
    2,
  );
}

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

export function resolveDirectCliSearchCommand(
  args: string[],
  _invokedAs: string | undefined = process.argv[1],
): DirectCliCommand | null {
  let commandArgs = stripGlobalArgs(args);
  const explicitCommands = new Set([
    'search',
    'check_socials',
    'buy',
    'suggest_domains',
    'suggest_domains_smart',
    'bulk_search',
    'tld_info',
    'analyze_project',
    'hunt_domains',
    'help',
    'config',
    'skills',
    'buy',
    'mcp',
    'stdio',
    'version',
  ]);

  if (commandArgs.length === 0) {
    if (process.stdout.isTTY) {
      return {
        command: 'help',
        topic: 'top',
        output: 'table',
      };
    }
    return null;
  }

  const command = commandArgs[0];

  if (hasVersionFlag(commandArgs) || command === 'version') {
    return {
      command: 'version',
      output: 'table',
    };
  }

  if (command === 'help') {
    return {
      command: 'help',
      topic: normalizeHelpTopic(commandArgs[1]),
      output: 'table',
    };
  }

  if (command === 'skills') {
    return {
      command: 'skills',
      output: 'table',
    };
  }

  if (command === 'config') {
    if (hasHelpFlag(commandArgs)) {
      return {
        command: 'help',
        topic: 'config',
        output: 'table',
      };
    }

    const subcommand = commandArgs[1];

    if (!subcommand || subcommand === 'show') {
      return {
        command: 'config_show',
        output: 'table',
      };
    }

    if (subcommand === 'set') {
      const key = commandArgs[2];
      const value = commandArgs[3];
      if (!key || !value) {
        throw new Error(renderHelpText('config'));
      }
      return {
        command: 'config_set',
        key,
        value,
        output: 'table',
      };
    }

    if (subcommand === 'path' || subcommand === '--path') {
      return {
        command: 'config_path',
        path: commandArgs[2],
        output: 'table',
      };
    }

    throw new Error(renderHelpText('config'));
  }

  if (hasHelpFlag(commandArgs) || command === '--help' || command === '-h') {
    if (command === 'search') {
      return { command: 'help', topic: 'search', output: 'table' };
    }
    if (command === 'check_socials') {
      return { command: 'help', topic: 'check_socials', output: 'table' };
    }
    if (command === 'buy') {
      return { command: 'help', topic: 'buy', output: 'table' };
    }
    if (command === 'skills') {
      return { command: 'skills', output: 'table' };
    }
    if (command === 'config') {
      return { command: 'help', topic: 'config', output: 'table' };
    }
    return {
      command: 'help',
      topic: 'top',
      output: 'table',
    };
  }

  if (command === 'buy') {
    const domain = extractPositionals(commandArgs, 1)[0];
    if (!domain) {
      throw new Error(renderHelpText('buy'));
    }

    return {
      command: 'buy',
      input: {
        domain,
        registrar: getFlagValue(commandArgs, '--registrar') as PurchaseDomainInput['registrar'],
      },
      output: commandArgs.includes('--json') ? 'json' : 'table',
      openBrowser: Boolean(getFlagValue(commandArgs, '--registrar')),
      showPrice: commandArgs.includes('--price') || commandArgs.includes('--prices'),
    };
  }

  if (command === 'check_socials') {
    const name = extractPositionals(commandArgs, 1)[0];
    if (!name) {
      throw new Error(renderHelpText('check_socials'));
    }

    return {
      command: 'check_socials',
      input: {
        name,
        platforms: parseCsvFlag(commandArgs, '--platforms') as CheckSocialsInput['platforms'],
      },
      output: commandArgs.includes('--json') ? 'json' : 'table',
    };
  }

  if (command !== 'search') {
    return null;
  }

  const domainNames = extractPositionals(commandArgs, 1);

  if (domainNames.length === 0) {
    throw new Error(renderHelpText('search'));
  }

  if (domainNames.length > 1) {
    return {
      command: 'search_multi',
      domains: domainNames,
      tlds: parseCsvFlag(commandArgs, '--tlds') || config.defaultSearchTlds,
      registrars: parseCsvFlag(commandArgs, '--registrars'),
      verification_mode: parseVerificationMode(commandArgs),
      output: commandArgs.includes('--json') ? 'json' : 'table',
    };
  }

  return {
    command: 'search',
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

  let result: unknown;

  if (command.command === 'help') {
    result = renderHelpText(command.topic);
  } else if (command.command === 'version') {
    result = CLI_VERSION;
  } else if (command.command === 'skills') {
    result = readSkillMarkdown();
  } else if (command.command === 'config_show') {
    result = renderConfigShow();
  } else if (command.command === 'config_set') {
    result = `Saved ${command.key} to ${updateConfigFile(command.key!, command.value!)}`;
  } else if (command.command === 'config_path') {
    result = command.path ? `Saved config path: ${moveConfigPath(command.path)}` : getActiveConfigPath();
  } else if (command.command === 'search') {
    result = await executeRegisteredTool('search', command.input as SearchDomainInput);
  } else if (command.command === 'search_multi') {
    const limiter = new ConcurrencyLimiter(MULTI_SEARCH_CONCURRENCY);
    result = await Promise.all(
      command.domains.map((domain) =>
        limiter.run(() =>
          executeRegisteredTool('search', {
            domain_name: domain,
            tlds: command.tlds,
            registrars: command.registrars,
            verification_mode: command.verification_mode,
          }),
        ),
      ),
    );
  } else if (command.command === 'check_socials') {
    result = await executeRegisteredTool('check_socials', command.input as CheckSocialsInput);
  } else if (command.command === 'buy') {
    result = await executeRegisteredTool('buy', command.input as PurchaseDomainInput);
  } else {
    throw new Error('Unknown CLI command.');
  }

  if (command.command === 'buy' && command.openBrowser) {
    const purchase = result as PurchaseResult;
    const url = purchase.checkout_url;
    if (url) {
      openUrlInBrowser(url);
    }
  }

  const output =
    command.command === 'help' ||
    command.command === 'version' ||
    command.command === 'skills' ||
    command.command === 'config_show' ||
    command.command === 'config_set' ||
    command.command === 'config_path'
      ? (result as string)
      : command.command === 'search_multi' && command.output === 'json'
        ? formatMultiSearchJson(
            command.domains,
            command.tlds || config.defaultSearchTlds,
            result as SearchResponse[],
          )
        : command.output === 'json'
          ? JSON.stringify(result, null, 2)
          : command.command === 'search_multi'
            ? formatMultiSearchTable(
                command.domains,
                command.tlds || config.defaultSearchTlds,
                result as SearchResponse[],
              )
            : command.command === 'buy' && !command.showPrice
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
