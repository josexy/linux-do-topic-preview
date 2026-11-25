const TOPIC_PATH_REGEX = /^\/t\/(?:[^/]+\/)?(\d+)(?:\/(\d+))?\/?$/;

export interface TopicIdentity {
  origin: string;
  topicId: string;
  postNumber: string | null;
}

/**
 * Extracts canonical Discourse topic identity (origin, topicId, optional postNumber)
 * from a URL so slug redirects like `/t/topic/123` -> `/t/real-slug/123` match cleanly.
 */
export function parseTopicIdentity(
  href: string,
  baseOrigin?: string,
): TopicIdentity | null {
  if (!href) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = baseOrigin ? new URL(href, baseOrigin) : new URL(href);
  } catch {
    return null;
  }

  const match = parsed.pathname.match(TOPIC_PATH_REGEX);
  if (!match) {
    return null;
  }

  return {
    origin: parsed.origin,
    topicId: match[1],
    postNumber: match[2] ?? null,
  };
}

/**
 * Checks whether `currentUrl` already satisfies `requestedUrl`.
 * If `requestedUrl` does not specify a post number, any post position in the same topic matches.
 */
export function isSameTopicTarget(
  requestedUrl: string,
  currentUrl: string,
): boolean {
  if (!requestedUrl || !currentUrl) {
    return false;
  }
  if (requestedUrl === currentUrl) {
    return true;
  }

  const req = parseTopicIdentity(requestedUrl);
  const cur = parseTopicIdentity(currentUrl);
  if (!req || !cur) {
    return false;
  }
  if (req.origin !== cur.origin || req.topicId !== cur.topicId) {
    return false;
  }
  if (req.postNumber !== null && req.postNumber !== cur.postNumber) {
    return false;
  }
  return true;
}

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
