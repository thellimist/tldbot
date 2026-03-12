import { resolveDirectCliSearchCommand } from '../../src/cli.js';
import { config } from '../../src/config.js';

describe('resolveDirectCliSearchCommand', () => {
  it('parses search subcommand args', () => {
    const result = resolveDirectCliSearchCommand([
      'search',
      'tldscout',
      '--tlds',
      'com,io,dev',
      '--registrars',
      'porkbun,namecheap',
      '--json',
    ]);

    expect(result).toEqual({
      command: 'search',
      input: {
        domain_name: 'tldscout',
        tlds: ['com', 'io', 'dev'],
        registrars: ['porkbun', 'namecheap'],
        verification_mode: 'smart',
      },
      output: 'json',
    });
  });

  it('treats the package bin as a direct domain search invocation', () => {
    const result = resolveDirectCliSearchCommand(
      ['namecli', '--tlds', 'com,ai'],
      '/usr/local/bin/tldbot',
    );

    expect(result).toBeNull();
  });

  it('returns null for unknown top-level args', () => {
    const result = resolveDirectCliSearchCommand(['--stdio']);
    expect(result).toBeNull();
  });

  it('parses help flag', () => {
    const result = resolveDirectCliSearchCommand(['--help']);

    expect(result).toEqual({
      command: 'help',
      topic: 'top',
      output: 'table',
    });
  });

  it('parses subcommand help', () => {
    const result = resolveDirectCliSearchCommand(['help', 'skills']);

    expect(result).toEqual({
      command: 'help',
      topic: 'skills',
      output: 'table',
    });
  });

  it('parses version flag', () => {
    const result = resolveDirectCliSearchCommand(['--version']);

    expect(result).toEqual({
      command: 'version',
      output: 'table',
    });
  });

  it('parses check_socials command args', () => {
    const result = resolveDirectCliSearchCommand([
      'check_socials',
      'tldscout',
      '--platforms',
      'github,x,npm',
    ]);

    expect(result).toEqual({
      command: 'check_socials',
      input: {
        name: 'tldscout',
        platforms: ['github', 'x', 'npm'],
      },
      output: 'table',
    });
  });

  it('parses search args when flags come before names', () => {
    const result = resolveDirectCliSearchCommand([
      'search',
      '--tlds',
      'com,io',
      'tldscout',
      'namecli',
      '--json',
    ]);

    expect(result).toEqual({
      command: 'search_multi',
      domains: ['tldscout', 'namecli'],
      tlds: ['com', 'io'],
      registrars: undefined,
      verification_mode: 'smart',
      output: 'json',
    });
  });

  it('treats removed compare_registrars command as non-cli', () => {
    const result = resolveDirectCliSearchCommand(['compare_registrars', 'tldscout.com']);

    expect(result).toBeNull();
  });

  it('parses multi-name search args', () => {
    const result = resolveDirectCliSearchCommand([
      'search',
      'tldscout',
      'namecli',
      'domscout',
      '--tlds',
      'com,dev,ai',
    ]);

    expect(result).toEqual({
      command: 'search_multi',
      domains: ['tldscout', 'namecli', 'domscout'],
      tlds: ['com', 'dev', 'ai'],
      registrars: undefined,
      verification_mode: 'smart',
      output: 'table',
    });
  });

  it('defaults search to configured allowed tlds', () => {
    const result = resolveDirectCliSearchCommand([
      'search',
      'tldscout',
    ]);

    expect(result).toEqual({
      command: 'search',
      input: {
        domain_name: 'tldscout',
        tlds: config.defaultSearchTlds,
        registrars: undefined,
        verification_mode: 'smart',
      },
      output: 'table',
    });
  });

  it('parses verify mode for search', () => {
    const result = resolveDirectCliSearchCommand([
      'search',
      'tldscout',
      '--tlds',
      'io,sh',
      '--verify',
    ]);

    expect(result).toEqual({
      command: 'search',
      input: {
        domain_name: 'tldscout',
        tlds: ['io', 'sh'],
        registrars: undefined,
        verification_mode: 'strict',
      },
      output: 'table',
    });
  });

  it('parses buy subcommand', () => {
    const result = resolveDirectCliSearchCommand([
      'buy',
      'tldscout.com',
      '--registrar',
      'godaddy',
      '--price',
    ]);

    expect(result).toEqual({
      command: 'buy',
      input: {
        domain: 'tldscout.com',
        registrar: 'godaddy',
      },
      output: 'table',
      openBrowser: true,
      showPrice: true,
    });
  });

  it('parses buy args when flags come first', () => {
    const result = resolveDirectCliSearchCommand([
      'buy',
      '--registrar',
      'godaddy',
      'tldscout.com',
    ]);

    expect(result).toEqual({
      command: 'buy',
      input: {
        domain: 'tldscout.com',
        registrar: 'godaddy',
      },
      output: 'table',
      openBrowser: true,
      showPrice: false,
    });
  });
});
