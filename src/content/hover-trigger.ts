import { findTopicLinkFromTarget } from './topic-matcher';

const HIDE_DELAY_MS = 180;
const PRELOAD_HOVER_DELAY_MS = 65;

const EYE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12Z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

interface ActiveHoverMatch {
  elementRef: WeakRef<HTMLAnchorElement>;
  url: string;
  title: string;
}

export class HoverTrigger {
  private readonly button: HTMLButtonElement;
  private readonly onPreview: (url: string, title: string) => void;
  private readonly onPreload?: (url: string, title: string) => void;
  private activeMatch: ActiveHoverMatch | null = null;
  private hideTimer: number | null = null;
  private preloadTimer: number | null = null;
  private enabled = true;
  private globalListenersAttached = false;
  private isHoveringButton = false;

  constructor(
    shadowRoot: ShadowRoot,
    onPreview: (url: string, title: string) => void,
    onPreload?: (url: string, title: string) => void,
  ) {
    this.onPreview = onPreview;
    this.onPreload = onPreload;

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'ldp-trigger';
    this.button.setAttribute('aria-label', '预览 Topic 内容');
    this.button.innerHTML = `${EYE_ICON_SVG}<span>预览</span>`;
    shadowRoot.appendChild(this.button);

    this.button.addEventListener('pointerenter', this.handleButtonEnter);
    this.button.addEventListener('pointerleave', this.handleButtonLeave);
    this.button.addEventListener('pointerdown', this.handleButtonPointerDown);
    this.button.addEventListener('click', this.handleButtonClick);

    this.attachGlobalListeners();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.attachGlobalListeners();
    } else {
      this.hideImmediately();
      this.detachGlobalListeners();
    }
  }

  public hideImmediately(): void {
    this.clearHideTimer();
    this.clearPreloadTimer();
    this.activeMatch = null;
    this.isHoveringButton = false;
    this.button.classList.remove('is-visible');
  }

  public destroy(): void {
    this.enabled = false;
    this.hideImmediately();
    this.button.removeEventListener('pointerenter', this.handleButtonEnter);
    this.button.removeEventListener('pointerleave', this.handleButtonLeave);
    this.button.removeEventListener('pointerdown', this.handleButtonPointerDown);
    this.button.removeEventListener('click', this.handleButtonClick);
    this.detachGlobalListeners();
    this.button.remove();
  }

  private attachGlobalListeners(): void {
    if (this.globalListenersAttached) return;
    this.globalListenersAttached = true;
    document.addEventListener('pointerover', this.handleDocumentPointerOver, true);
    document.addEventListener('pointerout', this.handleDocumentPointerOut, true);
    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('scroll', this.handleViewportChange, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', this.handleViewportChange);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  private detachGlobalListeners(): void {
    if (!this.globalListenersAttached) return;
    this.globalListenersAttached = false;
    document.removeEventListener('pointerover', this.handleDocumentPointerOver, true);
    document.removeEventListener('pointerout', this.handleDocumentPointerOut, true);
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('scroll', this.handleViewportChange, true);
    window.removeEventListener('resize', this.handleViewportChange);
    window.removeEventListener('blur', this.handleWindowBlur);
  }

  private getActiveAnchor(): HTMLAnchorElement | null {
    const anchor = this.activeMatch?.elementRef.deref() ?? null;
    if (!anchor || !anchor.isConnected) {
      return null;
    }
    return anchor;
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private clearPreloadTimer(): void {
    if (this.preloadTimer !== null) {
      window.clearTimeout(this.preloadTimer);
      this.preloadTimer = null;
    }
  }

  private scheduleHide(): void {
    this.clearHideTimer();
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      if (!this.isHoveringButton) {
        this.clearPreloadTimer();
        this.activeMatch = null;
        this.button.classList.remove('is-visible');
      }
    }, HIDE_DELAY_MS);
  }

  private positionNearAnchor(anchor: HTMLAnchorElement): void {
    const rects = anchor.getClientRects();
    const targetRect =
      rects.length > 0 ? rects[rects.length - 1] : anchor.getBoundingClientRect();

    if (targetRect.width === 0 && targetRect.height === 0) {
      this.hideImmediately();
      return;
    }

    const btnWidth = this.button.offsetWidth || 64;
    const btnHeight = this.button.offsetHeight || 26;
    const gap = 8;

    let left = targetRect.right + gap;
    if (left + btnWidth > window.innerWidth - 10) {
      left = Math.max(10, Math.min(targetRect.right - btnWidth, window.innerWidth - btnWidth - 10));
    }

    let top = targetRect.top + (targetRect.height - btnHeight) / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - btnHeight - 8));

    this.button.style.left = `${Math.round(left)}px`;
    this.button.style.top = `${Math.round(top)}px`;
  }

  private readonly handleDocumentPointerOver = (event: PointerEvent): void => {
    if (!this.enabled) return;

    const matched = findTopicLinkFromTarget(event.target, window.location.origin);
    if (!matched) {
      return;
    }

    this.clearHideTimer();
    if (this.activeMatch?.url !== matched.url) {
      this.clearPreloadTimer();
    }
    this.activeMatch = {
      elementRef: new WeakRef(matched.element),
      url: matched.url,
      title: matched.title,
    };
    this.positionNearAnchor(matched.element);
    this.button.classList.add('is-visible');
  };

  private readonly handleDocumentPointerOut = (event: PointerEvent): void => {
    if (!this.activeMatch) return;
    const activeAnchor = this.getActiveAnchor();
    if (!activeAnchor) {
      this.hideImmediately();
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) return;

    if (activeAnchor.contains(target)) {
      const related = event.relatedTarget;
      if (related instanceof Node && activeAnchor.contains(related)) {
        return;
      }
      this.scheduleHide();
    }
  };

  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.activeMatch) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.includes(this.button) || event.target === this.button) {
      return;
    }
    // User clicked elsewhere (e.g. directly on the topic link for SPA navigation)
    this.hideImmediately();
  };

  private readonly handleWindowBlur = (): void => {
    if (this.activeMatch) {
      this.hideImmediately();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden && this.activeMatch) {
      this.hideImmediately();
    }
  };

  private readonly handleButtonEnter = (): void => {
    this.isHoveringButton = true;
    this.clearHideTimer();
    this.clearPreloadTimer();

    if (!this.activeMatch || !this.onPreload) {
      return;
    }
    if (!this.getActiveAnchor()) {
      this.hideImmediately();
      return;
    }

    const { url, title } = this.activeMatch;
    this.preloadTimer = window.setTimeout(() => {
      this.preloadTimer = null;
      if (this.isHoveringButton && this.activeMatch?.url === url) {
        this.onPreload?.(url, title);
      }
    }, PRELOAD_HOVER_DELAY_MS);
  };

  private readonly handleButtonLeave = (): void => {
    this.isHoveringButton = false;
    this.clearPreloadTimer();
    this.scheduleHide();
  };

  private readonly handleButtonPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.activeMatch || !this.onPreload) return;
    this.clearPreloadTimer();
    const { url, title } = this.activeMatch;
    this.onPreload(url, title);
  };

  private readonly handleButtonClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!this.activeMatch) return;

    const { url, title } = this.activeMatch;
    this.hideImmediately();
    this.onPreview(url, title);
  };

  private readonly handleViewportChange = (): void => {
    if (!this.activeMatch) return;
    const activeAnchor = this.getActiveAnchor();
    if (!activeAnchor) {
      this.hideImmediately();
      return;
    }
    this.positionNearAnchor(activeAnchor);
  };
}
