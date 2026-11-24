import { DEFAULT_DOMAIN, type ExtensionSettings } from './types';

const HOSTNAME_REGEX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * Normalizes a user-entered domain or URL into a lowercase hostname.
 * Returns null if the input is invalid or not a standard domain name.
 */
export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  let candidate = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME_REGEX.test(host)) {
    return null;
  }

  return host;
}

export function toOriginPattern(domain: string): string {
  return `https://${domain}/*`;
}

export function getActiveDomains(settings: ExtensionSettings): string[] {
  if (!settings.enabled) {
    return [];
  }

  const domains = new Set<string>();
  if (settings.linuxDoEnabled) {
    domains.add(DEFAULT_DOMAIN);
  }
  for (const raw of settings.customDomains) {
    const normalized = normalizeDomain(raw);
    if (normalized) {
      domains.add(normalized);
    }
  }
  return Array.from(domains);
}

export function isHostnameEnabled(
  hostname: string,
  settings: ExtensionSettings,
): boolean {
  if (!settings.enabled) {
    return false;
  }
  const normalizedHost = hostname.toLowerCase().replace(/\.$/, '');
  if (normalizedHost === DEFAULT_DOMAIN) {
    return settings.linuxDoEnabled;
  }
  return settings.customDomains.some(
    (domain) => domain.toLowerCase() === normalizedHost,
  );
}
