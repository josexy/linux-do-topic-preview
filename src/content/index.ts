import { isHostnameEnabled } from '../shared/domains';
import { getSettings, subscribeSettings } from '../shared/storage';
import type { ExtensionSettings } from '../shared/types';
import { HoverTrigger } from './hover-trigger';
import { PreviewModal } from './preview-modal';
import { SHADOW_STYLES } from './styles';
import { detectPageDarkTheme } from './theme-detector';

const ROOT_HOST_ID = 'ldp-preview-root';

async function bootstrap(): Promise<void> {
  // Only mount floating trigger & modal in the top-level browsing context
  if (window.self !== window.top) {
    return;
  }

  // Prevent duplicate injection
  if (document.getElementById(ROOT_HOST_ID)) {
    return;
  }

  let settings = await getSettings();

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

  const applySettings = (next: ExtensionSettings) => {
    settings = next;
    const activeHere = isHostnameEnabled(window.location.hostname, settings);
    trigger.setEnabled(activeHere);
    modal.updateSettings(settings);
    if (!activeHere) {
      modal.close({ unload: true });
    }
  };

  applySettings(settings);

  // Watch for Discourse theme class / attribute changes
  const themeObserver = new MutationObserver(() => syncTheme());
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

  subscribeSettings((next) => {
    applySettings(next);
  });
}

void bootstrap();
