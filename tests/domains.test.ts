import { describe, expect, it } from 'vitest';
import {
  getActiveDomains,
  isHostnameEnabled,
  normalizeDomain,
  toOriginPattern,
} from '../src/shared/domains';
import { DEFAULT_SETTINGS } from '../src/shared/types';

describe('domains utilities', () => {
  it('normalizes bare domains, full URLs, paths, and mixed case', () => {
    expect(normalizeDomain('linux.do')).toBe('linux.do');
    expect(normalizeDomain('  HTTPS://Meta.Discourse.ORG/latest?foo=1  ')).toBe(
      'meta.discourse.org',
    );
    expect(normalizeDomain('forum.example.com/t/topic/123')).toBe(
      'forum.example.com',
    );
    expect(normalizeDomain('sub.forum.example.co.uk.')).toBe(
      'sub.forum.example.co.uk',
    );
  });

  it('rejects invalid hostnames and non-http protocols', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('   ')).toBeNull();
    expect(normalizeDomain('chrome://extensions')).toBeNull();
    expect(normalizeDomain('javascript:alert(1)')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeDomain('-bad.example.com')).toBeNull();
  });

  it('creates https origin match patterns', () => {
    expect(toOriginPattern('linux.do')).toBe('https://linux.do/*');
    expect(toOriginPattern('meta.discourse.org')).toBe(
      'https://meta.discourse.org/*',
    );
  });

  it('computes active domains and hostname enablement accurately', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      customDomains: ['meta.discourse.org'],
    };

    expect(getActiveDomains(settings)).toEqual([
      'linux.do',
      'meta.discourse.org',
    ]);
    expect(isHostnameEnabled('linux.do', settings)).toBe(true);
    expect(isHostnameEnabled('META.DISCOURSE.ORG', settings)).toBe(true);
    expect(isHostnameEnabled('other.site.org', settings)).toBe(false);

    const disabledGlobal = { ...settings, enabled: false };
    expect(getActiveDomains(disabledGlobal)).toEqual([]);
    expect(isHostnameEnabled('linux.do', disabledGlobal)).toBe(false);

    const disabledLinuxDo = { ...settings, linuxDoEnabled: false };
    expect(getActiveDomains(disabledLinuxDo)).toEqual(['meta.discourse.org']);
    expect(isHostnameEnabled('linux.do', disabledLinuxDo)).toBe(false);
    expect(isHostnameEnabled('meta.discourse.org', disabledLinuxDo)).toBe(true);
  });
});
