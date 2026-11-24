import { getSettings } from '../shared/storage';
import {
  PREVIEW_IFRAME_NAME,
  type IframeToParentMessage,
  type ParentToIframeMessage,
} from '../shared/types';

const CLEAN_CLASS = 'ldp-clean-mode';
const STYLE_ID = 'ldp-iframe-enhancer-style';

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

function initIframeEnhancer(): void {
  // Fast exit on regular top-level pages or unrelated iframes
  if (window.self === window.top || window.name !== PREVIEW_IFRAME_NAME) {
    return;
  }

  injectStyle();
  // Enable clean mode optimistically to prevent header flash before async storage resolves
  setCleanMode(true);

  void getSettings().then((settings) => {
    setCleanMode(settings.hideIframeHeader);
  });

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const msg = event.data as Partial<ParentToIframeMessage> | null;
    if (msg?.type === 'LDP_SET_CLEAN_MODE' && typeof msg.enabled === 'boolean') {
      setCleanMode(msg.enabled);
    }
  });

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
    true,
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
    true,
  );

  let lastTitle = '';
  let lastUrl = '';

  const emitMeta = (isReady = false) => {
    const title = document.title.trim();
    const url = window.location.href;
    if (!isReady && title === lastTitle && url === lastUrl) {
      return;
    }
    lastTitle = title;
    lastUrl = url;
    postToParent({
      type: isReady ? 'LDP_READY' : 'LDP_META_UPDATE',
      title,
      url,
    });
  };

  const attachObservers = () => {
    emitMeta(true);

    const titleNode = document.querySelector('title');
    if (titleNode) {
      const observer = new MutationObserver(() => emitMeta(false));
      observer.observe(titleNode, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    window.addEventListener('popstate', () => emitMeta(false));
    window.addEventListener('hashchange', () => emitMeta(false));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachObservers, { once: true });
  } else {
    attachObservers();
  }
}

initIframeEnhancer();
