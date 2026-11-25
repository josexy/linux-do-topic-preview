import { getSettings } from '../shared/storage';
import {
  PREVIEW_IFRAME_NAME,
  type IframeToParentMessage,
  type ParentToIframeMessage,
} from '../shared/types';
import {
  isSameTopicTarget,
  parseTopicIdentity,
  type TopicIdentity,
} from './topic-matcher';

const CLEAN_CLASS = 'ldp-clean-mode';
const STYLE_ID = 'ldp-iframe-enhancer-style';
const ENHANCER_GUARD_KEY = '__ldpIframeEnhancerMounted__';
const INITIAL_READY_FALLBACK_MS = 4000;
const SPA_READY_FALLBACK_MS = 4000;
const SPA_URL_SETTLE_MS = 120;

type GuardedWindow = Window & {
  [ENHANCER_GUARD_KEY]?: boolean;
};

const IFRAME_CSS = `
html.${CLEAN_CLASS} {
  --header-offset: 0px !important;
  --d-sidebar-width: 0px !important;
}

html.${CLEAN_CLASS} .d-header-wrap,
html.${CLEAN_CLASS} .d-header,
html.${CLEAN_CLASS} .sidebar-wrapper,
html.${CLEAN_CLASS} .header-sidebar-toggle,
html.${CLEAN_CLASS} .below-site-header-outlet {
  display: none !important;
}

html.${CLEAN_CLASS} #main-outlet-wrapper {
  grid-template-columns: 0 minmax(0, 1fr) !important;
  padding-left: 16px !important;
  padding-right: 16px !important;
}

html.${CLEAN_CLASS} #main-outlet {
  padding-top: 16px !important;
}
`;

const CONTENT_READY_SELECTOR = [
  '#topic-title',
  '.topic-post .cooked',
  '.topic-post',
  '.page-not-found',
  '.not-found-container',
  '.login-required',
  '.topic-list-body tr',
  '#main-outlet .regular.contents',
].join(', ');

const ERROR_OR_AUTH_SELECTOR = [
  '.page-not-found',
  '.not-found-container',
  '.login-required',
].join(', ');

const CHALLENGE_SELECTOR = [
  '#challenge-running',
  '#cf-wrapper',
  '.cf-browser-verification',
  '#turnstile-wrapper',
].join(', ');

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = IFRAME_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

function setCleanMode(enabled: boolean): void {
  document.documentElement.classList.toggle(CLEAN_CLASS, enabled);
}

function postToParent(message: IframeToParentMessage): void {
  try {
    window.parent.postMessage(message, window.location.origin);
  } catch {
    // Ignore when parent origin mismatches
  }
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return target.isContentEditable;
}

function hasOpenDiscourseOverlay(): boolean {
  return Boolean(
    document.querySelector(
      '.pswp--open, .d-modal.is-open, .modal.in, #reply-control.open',
    ),
  );
}

function isChallengeOrNonDiscoursePage(): boolean {
  if (document.querySelector(CHALLENGE_SELECTOR)) {
    return true;
  }
  const hasDiscourseMarkers = Boolean(
    document.querySelector(
      'meta[name="generator"][content*="Discourse"], meta[name="discourse_theme_id"], #d-splash, #main-outlet, #data-preloaded, #main',
    ),
  );
  return !hasDiscourseMarkers;
}

function isDiscourseSplashVisible(): boolean {
  const splash = document.getElementById('d-splash');
  if (!splash || !splash.isConnected) {
    return false;
  }
  const style = window.getComputedStyle(splash);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  const opacity = Number.parseFloat(style.opacity);
  return Number.isNaN(opacity) || opacity > 0.05;
}

function isDiscourseLoadingActive(): boolean {
  return Boolean(
    document.querySelector(
      '.loading-indicator-container.loading, #main-outlet > .spinner, .topic-area > .spinner',
    ),
  );
}

function hasRenderedContent(): boolean {
  if (isDiscourseSplashVisible()) {
    return false;
  }
  return Boolean(document.querySelector(CONTENT_READY_SELECTOR));
}

function getRenderedTopicId(): string | null {
  const topicEl = document.querySelector<HTMLElement>(
    '#topic[data-topic-id], .container.posts[data-topic-id], [data-topic-id]',
  );
  return topicEl?.getAttribute('data-topic-id') ?? null;
}

function getFirstPostSignature(): string {
  const post = document.querySelector<HTMLElement>('.topic-post[data-post-id], article[data-post-id]');
  if (post?.dataset.postId) {
    return post.dataset.postId;
  }
  const titleText = document.querySelector('#topic-title')?.textContent?.trim() ?? '';
  return titleText;
}

function pauseMediaAndBlur(): void {
  const mediaEls = document.querySelectorAll<HTMLMediaElement>('video, audio');
  for (const media of mediaEls) {
    try {
      if (!media.paused) {
        media.pause();
      }
    } catch {
      // Ignore media pause errors
    }
  }
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function hasEmbeddedExternalIframe(): boolean {
  const frames = document.querySelectorAll<HTMLIFrameElement>('iframe[src]');
  for (const frame of frames) {
    const rawSrc = frame.getAttribute('src')?.trim();
    if (!rawSrc || rawSrc === 'about:blank') continue;
    try {
      const parsed = new URL(rawSrc, window.location.href);
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.origin !== window.location.origin
      ) {
        return true;
      }
    } catch {
      // Ignore malformed iframe URLs
    }
  }
  return false;
}

/**
 * Triggers Discourse's built-in SPA click interceptor cleanly by dispatching
 * a synthetic click on a temporary internal anchor inside `#main-outlet` / `#main`.
 * A bubble-phase window guard detects whether Discourse intercepted the click
 * and prevents uncontrolled native navigation if it did not.
 */
function triggerDiscourseSpaClick(relativeHref: string): boolean {
  const container =
    document.querySelector('#main-outlet') ??
    document.querySelector('#main') ??
    document.body;
  if (!container) {
    return false;
  }

  const anchor = document.createElement('a');
  anchor.href = relativeHref;
  anchor.textContent = '';
  anchor.setAttribute('aria-hidden', 'true');
  anchor.tabIndex = -1;
  anchor.style.position = 'fixed';
  anchor.style.left = '-9999px';
  anchor.style.top = '-9999px';
  anchor.style.width = '1px';
  anchor.style.height = '1px';
  anchor.style.opacity = '0';
  anchor.style.pointerEvents = 'none';

  container.appendChild(anchor);

  let interceptedByPage = false;
  const guard = (event: MouseEvent) => {
    if (event.target === anchor) {
      interceptedByPage = event.defaultPrevented;
      if (!event.defaultPrevented) {
        event.preventDefault();
      }
    }
  };

  window.addEventListener('click', guard, false);
  try {
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      view: window,
    });
    anchor.dispatchEvent(clickEvent);
  } finally {
    window.removeEventListener('click', guard, false);
    queueMicrotask(() => {
      anchor.remove();
    });
  }

  return interceptedByPage;
}

function initIframeEnhancer(): void {
  // Fast exit on regular top-level pages or unrelated iframes
  if (window.self === window.top || window.name !== PREVIEW_IFRAME_NAME) {
    return;
  }

  // Prevent duplicate listener / observer attachment on re-injection
  const guardedWindow = window as GuardedWindow;
  if (guardedWindow[ENHANCER_GUARD_KEY]) {
    return;
  }
  guardedWindow[ENHANCER_GUARD_KEY] = true;

  injectStyle();
  // Enable clean mode optimistically to prevent header flash before async storage resolves
  setCleanMode(true);

  const listenerController = new AbortController();
  const { signal } = listenerController;
  let isTornDown = false;

  void getSettings()
    .then((settings) => {
      if (!isTornDown) {
        setCleanMode(settings.hideIframeHeader);
      }
    })
    .catch(() => {
      // Ignore storage read errors when extension context is invalidated
    });

  let hasInitialBootCompleted = false;
  let lastTitle = '';
  let lastUrl = '';
  let cancelPendingSpaWatch: (() => void) | null = null;
  let cancelInitialBootWatch: (() => void) | null = null;
  let titleObserver: MutationObserver | null = null;

  const emitMeta = (
    isReady = false,
    requestId?: number,
    spaCapable?: boolean,
  ) => {
    if (isTornDown) return;
    const title = document.title.trim();
    const url = window.location.href;
    if (!isReady && title === lastTitle && url === lastUrl) {
      return;
    }
    lastTitle = title;
    lastUrl = url;
    if (isReady) {
      postToParent({
        type: 'LDP_READY',
        title,
        url,
        ...(requestId !== undefined ? { requestId } : {}),
        ...(spaCapable !== undefined ? { spaCapable } : {}),
      });
    } else {
      postToParent({
        type: 'LDP_META_UPDATE',
        title,
        url,
      });
    }
  };

  const watchSpaTransition = (
    requestId: number,
    targetIdentity: TopicIdentity | null,
    prevHref: string,
    prevTopicId: string | null,
    prevFirstPostSig: string,
  ) => {
    if (cancelPendingSpaWatch) {
      cancelPendingSpaWatch();
      cancelPendingSpaWatch = null;
    }

    let finished = false;
    let urlMatchedAt: number | null = null;
    let rafId: number | null = null;
    const startedAt = Date.now();

    const stopWatching = () => {
      observer.disconnect();
      window.clearInterval(pollTimer);
      window.clearTimeout(fallbackTimer);
    };

    const cleanup = () => {
      finished = true;
      stopWatching();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (cancelPendingSpaWatch === cleanup) {
        cancelPendingSpaWatch = null;
      }
    };

    const complete = () => {
      if (finished) return;
      finished = true;
      stopWatching();
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (cancelPendingSpaWatch === cleanup) {
          cancelPendingSpaWatch = null;
        }
        emitMeta(true, requestId, true);
      });
    };

    const checkReady = () => {
      if (finished) return;

      const currentHref = window.location.href;
      const currentIdentity = parseTopicIdentity(currentHref);
      const loadingActive = isDiscourseLoadingActive();

      // Same topic (e.g. jumping to a post number within current topic)
      if (targetIdentity && prevTopicId === targetIdentity.topicId) {
        const hrefChanged = currentHref !== prevHref;
        if (
          !loadingActive &&
          hasRenderedContent() &&
          (hrefChanged || Date.now() - startedAt >= 180)
        ) {
          complete();
        }
        return;
      }

      // Navigated to a different topic or redirected to another page
      const targetTopicMatched = Boolean(
        targetIdentity && currentIdentity?.topicId === targetIdentity.topicId,
      );
      const hrefChanged = currentHref !== prevHref;

      if (hrefChanged && document.querySelector(ERROR_OR_AUTH_SELECTOR)) {
        complete();
        return;
      }

      if (targetTopicMatched || (hrefChanged && !loadingActive)) {
        if (urlMatchedAt === null) {
          urlMatchedAt = Date.now();
        }
        if (loadingActive || !hasRenderedContent()) {
          return;
        }

        const renderedTopicId = getRenderedTopicId();
        const topicAttrMatched = Boolean(
          targetIdentity && renderedTopicId === targetIdentity.topicId,
        );
        const contentChanged = getFirstPostSignature() !== prevFirstPostSig;
        const settled = Date.now() - urlMatchedAt >= SPA_URL_SETTLE_MS;

        if (topicAttrMatched || contentChanged || settled) {
          complete();
        }
      }
    };

    const observer = new MutationObserver(() => {
      checkReady();
    });
    const observeTarget = document.querySelector('#main-outlet') ?? document.body ?? document.documentElement;
    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-topic-id', 'data-post-id'],
    });

    const pollTimer = window.setInterval(checkReady, 50);
    const fallbackTimer = window.setTimeout(complete, SPA_READY_FALLBACK_MS);
    cancelPendingSpaWatch = cleanup;
  };

  const handleNavigateMessage = (url: string, requestId: number) => {
    let parsed: URL;
    try {
      parsed = new URL(url, window.location.origin);
    } catch {
      postToParent({ type: 'LDP_NAV_ACK', requestId, mode: 'fallback' });
      return;
    }

    if (parsed.origin !== window.location.origin) {
      postToParent({ type: 'LDP_NAV_ACK', requestId, mode: 'fallback' });
      return;
    }

    if (!hasInitialBootCompleted || isChallengeOrNonDiscoursePage()) {
      postToParent({ type: 'LDP_NAV_ACK', requestId, mode: 'fallback' });
      return;
    }

    // Already on the requested topic and rendered
    if (
      isSameTopicTarget(parsed.href, window.location.href) &&
      hasRenderedContent() &&
      !isDiscourseLoadingActive()
    ) {
      postToParent({ type: 'LDP_NAV_ACK', requestId, mode: 'same' });
      emitMeta(true, requestId, true);
      return;
    }

    const prevHref = window.location.href;
    const prevTopicId = parseTopicIdentity(prevHref)?.topicId ?? null;
    const prevFirstPostSig = getFirstPostSignature();
    const targetIdentity = parseTopicIdentity(parsed.href);
    const relativeHref = `${parsed.pathname}${parsed.search}${parsed.hash}`;

    const intercepted = triggerDiscourseSpaClick(relativeHref);
    if (!intercepted) {
      postToParent({ type: 'LDP_NAV_ACK', requestId, mode: 'fallback' });
      return;
    }

    postToParent({ type: 'LDP_NAV_ACK', requestId, mode: 'spa' });
    watchSpaTransition(
      requestId,
      targetIdentity,
      prevHref,
      prevTopicId,
      prevFirstPostSig,
    );
  };

  window.addEventListener(
    'message',
    (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;
      const msg = event.data as Partial<ParentToIframeMessage> | null;
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'LDP_SET_CLEAN_MODE' && typeof msg.enabled === 'boolean') {
        setCleanMode(msg.enabled);
        return;
      }

      if (msg.type === 'LDP_DEACTIVATE') {
        pauseMediaAndBlur();
        // Cross-origin embedded players (e.g. YouTube/Bilibili) cannot be paused from JS;
        // ask parent to unload the warm iframe so audio/video stops immediately.
        if (hasEmbeddedExternalIframe()) {
          postToParent({ type: 'LDP_REQUEST_UNLOAD' });
        }
        return;
      }

      if (
        msg.type === 'LDP_NAVIGATE' &&
        typeof msg.url === 'string' &&
        typeof msg.requestId === 'number'
      ) {
        handleNavigateMessage(msg.url, msg.requestId);
      }
    },
    { signal },
  );

  // Forward Esc key to close modal unless user is typing or dismissing a Discourse dialog
  window.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isEditableElement(event.target) || hasOpenDiscourseOverlay()) {
        return;
      }
      event.preventDefault();
      postToParent({ type: 'LDP_CLOSE' });
    },
    { capture: true, signal },
  );

  // Open external-origin links in a new tab so they are not blocked inside the preview iframe
  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor) return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) {
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(rawHref, window.location.href);
      } catch {
        return;
      }

      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.origin !== window.location.origin
      ) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }
    },
    { capture: true, signal },
  );

  const attachObservers = () => {
    if (isTornDown) return;
    postToParent({ type: 'LDP_BOOTING', url: window.location.href });

    // Fast-path for non-Discourse pages or Cloudflare challenges so they aren't masked
    // and no unnecessary observers/listeners are attached
    if (isChallengeOrNonDiscoursePage()) {
      hasInitialBootCompleted = true;
      emitMeta(true, undefined, false);
      return;
    }

    const titleNode = document.querySelector('title');
    if (titleNode) {
      titleObserver = new MutationObserver(() => emitMeta(false));
      titleObserver.observe(titleNode, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    window.addEventListener('popstate', () => emitMeta(false), { signal });
    window.addEventListener('hashchange', () => emitMeta(false), { signal });

    let initialReadyEmitted = false;
    let bootRafId: number | null = null;

    const cancelBootWatch = () => {
      initialReadyEmitted = true;
      bootObserver.disconnect();
      window.clearTimeout(fallbackTimer);
      if (bootRafId !== null) {
        window.cancelAnimationFrame(bootRafId);
        bootRafId = null;
      }
      if (cancelInitialBootWatch === cancelBootWatch) {
        cancelInitialBootWatch = null;
      }
    };

    const finishInitialBoot = () => {
      if (initialReadyEmitted) return;
      initialReadyEmitted = true;
      hasInitialBootCompleted = true;
      bootObserver.disconnect();
      window.clearTimeout(fallbackTimer);
      const spaCapable = Boolean(document.querySelector('#main-outlet, #main'));
      bootRafId = window.requestAnimationFrame(() => {
        bootRafId = null;
        if (cancelInitialBootWatch === cancelBootWatch) {
          cancelInitialBootWatch = null;
        }
        emitMeta(true, undefined, spaCapable);
      });
    };

    const bootObserver = new MutationObserver(() => {
      if (hasRenderedContent()) {
        finishInitialBoot();
      }
    });

    const fallbackTimer = window.setTimeout(
      finishInitialBoot,
      INITIAL_READY_FALLBACK_MS,
    );
    cancelInitialBootWatch = cancelBootWatch;

    if (hasRenderedContent()) {
      finishInitialBoot();
      return;
    }

    const root = document.body ?? document.documentElement;
    bootObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  };

  window.addEventListener(
    'pagehide',
    (event: PageTransitionEvent) => {
      cancelPendingSpaWatch?.();
      cancelInitialBootWatch?.();
      if (!event.persisted) {
        isTornDown = true;
        titleObserver?.disconnect();
        titleObserver = null;
        listenerController.abort();
        guardedWindow[ENHANCER_GUARD_KEY] = false;
      }
    },
    { signal },
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachObservers, {
      once: true,
      signal,
    });
  } else {
    attachObservers();
  }
}

initIframeEnhancer();
