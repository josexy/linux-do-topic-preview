const TOPIC_PATH_REGEX = /^\/t\/(?:[^/]+\/)?\d+(?:\/\d+)?\/?$/;

export const TOPIC_TITLE_SELECTORS = [
  '.topic-list-item .main-link a.raw-topic-link',
  '.topic-list-item .main-link a.title',
  '.topic-list a.raw-topic-link',
  '.latest-topic-list-item a.title',
  '.featured-topic a.title',
  '.search-results a.search-link',
  '.user-stream-item .title a',
  'a.raw-topic-link',
].join(', ');

const EXCLUDED_LINK_SELECTOR = [
  '.badge-notification',
  '.topic-post-badges a',
  '.discourse-tags a',
  '.badge-wrapper',
  '.posters a',
  '#ldp-preview-root',
].join(', ');

export interface MatchedTopicLink {
  element: HTMLAnchorElement;
  url: string;
  title: string;
}

/**
 * Validates and normalizes a same-origin Discourse topic URL.
 * Returns normalized URL string (origin + pathname) or null if not a valid topic link.
 */
export function parseTopicUrl(href: string, baseOrigin: string): string | null {
  if (!href) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(href, baseOrigin);
  } catch {
    return null;
  }

  if (parsed.origin !== baseOrigin) {
    return null;
  }

  if (!TOPIC_PATH_REGEX.test(parsed.pathname)) {
    return null;
  }

  const cleanPath =
    parsed.pathname.length > 1 && parsed.pathname.endsWith('/')
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;

  return `${parsed.origin}${cleanPath}`;
}

export function isTopicTitleAnchor(anchor: HTMLAnchorElement): boolean {
  if (anchor.matches(EXCLUDED_LINK_SELECTOR)) {
    return false;
  }
  if (anchor.closest('#ldp-preview-root, .topic-post-badges, .posters')) {
    return false;
  }
  if (anchor.matches(TOPIC_TITLE_SELECTORS)) {
    return true;
  }
  return Boolean(
    anchor.closest(
      '.topic-list-item .main-link, .latest-topic-list-item .main-link, .featured-topic, .search-result-topic .topic-title',
    ),
  );
}

export function findTopicLinkFromTarget(
  target: EventTarget | null,
  baseOrigin: string,
): MatchedTopicLink | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const anchor = target.closest<HTMLAnchorElement>('a[href]');
  if (!anchor) {
    return null;
  }

  if (!isTopicTitleAnchor(anchor)) {
    return null;
  }

  const href = anchor.getAttribute('href') ?? anchor.href;
  const url = parseTopicUrl(href, baseOrigin);
  if (!url) {
    return null;
  }

  const title =
    anchor.textContent?.replace(/\s+/g, ' ').trim() ||
    anchor.getAttribute('title')?.trim() ||
    'Topic 预览';

  return { element: anchor, url, title };
}
