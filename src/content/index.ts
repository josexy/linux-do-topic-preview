import { isHostnameEnabled } from '../shared/domains';
import { getSettings, subscribeSettings } from '../shared/storage';
import type { ExtensionSettings } from '../shared/types';
import { HoverTrigger } from './hover-trigger';
import { PreviewModal } from './preview-modal';
import { SHADOW_STYLES } from './styles';
import { detectPageDarkTheme } from './theme-detector';

const ROOT_HOST_ID = 'ldp-preview-root';
const BOOTSTRAP_GUARD_KEY = '__ldpContentBootstrapped__';

type GuardedWindow = Window & {
  [BOOTSTRAP_GUARD_KEY]?: boolean;
};

async function bootstrap(): Promise<void> {
  // Only mount floating trigger & modal in the top-level browsing context
  if (window.self !== window.top) {
    return;
  }

  const guardedWindow = window as GuardedWindow;
  // Synchronous guard to prevent duplicate injection races across async awaits
  if (guardedWindow[BOOTSTRAP_GUARD_KEY] || document.getElementById(ROOT_HOST_ID)) {
    return;
  }
  guardedWindow[BOOTSTRAP_GUARD_KEY] = true;

  let settings: ExtensionSettings;
  try {
    settings = await getSettings();
  } catch {
    guardedWindow[BOOTSTRAP_GUARD_KEY] = false;
    return;
  }

  // Re-check DOM after await in case another context mounted the host
  if (document.getElementById(ROOT_HOST_ID)) {
    return;
  }

  const host = document.createElement('div');
  host.id = ROOT_HOST_ID;
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '0';
  host.style.height = '0';

  const shadowRoot = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = SHADOW_STYLES;
  shadowRoot.appendChild(styleEl);

  const syncTheme = () => {
    host.setAttribute('data-theme', detectPageDarkTheme() ? 'dark' : 'light');
  };

  syncTheme();
  document.documentElement.appendChild(host);

  const modal = new PreviewModal(shadowRoot, settings);
  const trigger = new HoverTrigger(
    shadowRoot,
    (url, title) => {
      syncTheme();
      modal.open(url, title);
    },
    (url) => {
      modal.preload(url);
    },
  );

  // Watch for Discourse theme class / attribute changes only while active on this site
  const themeObserver = new MutationObserver(() => syncTheme());
  let isObservingTheme = false;

  const startThemeObserver = () => {
    if (isObservingTheme) return;
    isObservingTheme = true;
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-color-scheme', 'style'],
    });
    if (document.body) {
      themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'data-color-scheme', 'style'],
      });
    }
  };

  const stopThemeObserver = () => {
    if (!isObservingTheme) return;
    isObservingTheme = false;
    themeObserver.disconnect();
  };

  const applySettings = (next: ExtensionSettings) => {
    settings = next;
    const activeHere = isHostnameEnabled(window.location.hostname, settings);
    trigger.setEnabled(activeHere);
    modal.setEnabled(activeHere);
    modal.updateSettings(settings);
    if (activeHere) {
      syncTheme();
      startThemeObserver();
    } else {
      stopThemeObserver();
    }
  };

  applySettings(settings);

  const unsubscribeSettings = subscribeSettings((next) => {
    applySettings(next);
  });

  let isTornDown = false;
  const teardown = () => {
    if (isTornDown) return;
    isTornDown = true;
    stopThemeObserver();
    unsubscribeSettings();
    trigger.destroy();
    modal.destroy();
    host.remove();
    window.removeEventListener('pagehide', handlePageHide);
    guardedWindow[BOOTSTRAP_GUARD_KEY] = false;
  };

  const handlePageHide = (event: PageTransitionEvent) => {
    // Only fully tear down on non-persisted pagehide so BFCache restores keep working
    if (!event.persisted) {
      teardown();
    }
  };

  window.addEventListener('pagehide', handlePageHide);
}

void bootstrap();
