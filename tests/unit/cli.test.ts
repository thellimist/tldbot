import { resolveDirectCliSearchCommand } from '../../src/cli.js';
import { config } from '../../src/config.js';

describe('resolveDirectCliSearchCommand', () => {
  it('parses search_domain subcommand args', () => {
    const result = resolveDirectCliSearchCommand([
      'search_domain',
      'tldscout',
      '--tlds',
      'com,io,dev',
      '--registrars',
      'porkbun,namecheap',
      '--json',
    ]);

    expect(result).toEqual({
      command: 'search_domain',
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

    expect(result).toEqual({
      command: 'search_domain',
      input: {
        domain_name: 'namecli',
        tlds: ['com', 'ai'],
        registrars: undefined,
        verification_mode: 'smart',
      },
      output: 'table',
    });
  });

  it('returns null for unknown top-level args', () => {
    const result = resolveDirectCliSearchCommand(['--stdio']);
    expect(result).toBeNull();
  });

  it('parses help flag', () => {
    const result = resolveDirectCliSearchCommand(['--help']);

    expect(result).toEqual({
      command: 'help',
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

  it('treats removed compare_registrars command as non-cli', () => {
    const result = resolveDirectCliSearchCommand(['compare_registrars', 'tldscout.com']);

    expect(result).toBeNull();
  });

  it('parses multi-name search_domain args', () => {
    const result = resolveDirectCliSearchCommand([
      'search_domain',
      'tldscout',
      'namecli',
      'domscout',
      '--tlds',
      'com,dev,ai',
    ]);

    expect(result).toEqual({
      command: 'search_domain_multi',
      domains: ['tldscout', 'namecli', 'domscout'],
      tlds: ['com', 'dev', 'ai'],
      registrars: undefined,
      verification_mode: 'smart',
      output: 'table',
    });
  });

  it('defaults search_domain to configured allowed tlds', () => {
    const result = resolveDirectCliSearchCommand([
      'search_domain',
      'tldscout',
    ]);

    expect(result).toEqual({
      command: 'search_domain',
      input: {
        domain_name: 'tldscout',
        tlds: config.defaultSearchTlds,
        registrars: undefined,
        verification_mode: 'smart',
      },
      output: 'table',
    });
  });

  it('parses verify mode for search_domain', () => {
    const result = resolveDirectCliSearchCommand([
      'search_domain',
      'tldscout',
      '--tlds',
      'io,sh',
      '--verify',
    ]);

    expect(result).toEqual({
      command: 'search_domain',
      input: {
        domain_name: 'tldscout',
        tlds: ['io', 'sh'],
        registrars: undefined,
        verification_mode: 'strict',
      },
      output: 'table',
    });
  });

  it('parses buy alias as purchase_domain', () => {
    const result = resolveDirectCliSearchCommand([
      '--buy',
      'tldscout.com',
      '--registrar',
      'godaddy',
      '--price',
    ]);

    expect(result).toEqual({
      command: 'purchase_domain',
      input: {
        domain: 'tldscout.com',
        registrar: 'godaddy',
      },
      output: 'table',
      openBrowser: true,
      showPrice: true,
    });
  });
});
