import {
  getWindowGeometry,
  saveWindowGeometry,
  subscribeWindowGeometry,
} from '../shared/storage';
import {
  PREVIEW_IFRAME_NAME,
  type ExtensionSettings,
  type IframeToParentMessage,
  type ParentToIframeMessage,
  type ResizeDirection,
  type WindowGeometry,
} from '../shared/types';
import { isSameTopicTarget } from './topic-matcher';
import {
  clampRect,
  computeDraggedRect,
  computeResizedRect,
  resolveInitialRect,
  toWindowGeometry,
  type WindowRect,
} from './window-geometry';

const RESIZE_DIRECTIONS: ResizeDirection[] = [
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
];

const ICONS = {
  reload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>`,
  clean: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  maximize: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
  restore: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

const LOAD_FALLBACK_TIMEOUT_MS = 10000;
const SPA_NAV_ACK_TIMEOUT_MS = 280;
const COLD_LOAD_GRACE_MS = 150;

type LoadState = 'idle' | 'loading' | 'ready';

export class PreviewModal {
  private readonly overlay: HTMLDivElement;
  private readonly backdrop: HTMLDivElement;
  private readonly modal: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly iframe: HTMLIFrameElement;
  private readonly loadingBar: HTMLDivElement;
  private readonly loadingMask: HTMLDivElement;
  private readonly fallbackBanner: HTMLDivElement;
  private readonly sizeBadge: HTMLDivElement;
  private readonly cleanBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly maxBtn: HTMLButtonElement;

  private settings: ExtensionSettings;
  private cleanMode: boolean;
  private cachedGeometry: WindowGeometry | null = null;
  private readonly unsubscribeGeometry: () => void;

  private isOpen = false;
  private isMaximized = false;
  private currentUrl = '';
  private loadedUrl = '';
  private pendingUrl = '';
  private loadState: LoadState = 'idle';
  private isIframeBooted = false;
  private hasBootingAck = false;
  private activeRequestId = 0;

  private currentRect: WindowRect | null = null;
  private restoreRect: WindowRect | null = null;
  private fallbackTimer: number | null = null;
  private navAckTimer: number | null = null;
  private coldLoadGraceTimer: number | null = null;
  private closeTimer: number | null = null;
  private copyFeedbackTimer: number | null = null;
  private saveTimer: number | null = null;
  private sizeBadgeTimer: number | null = null;

  constructor(shadowRoot: ShadowRoot, settings: ExtensionSettings) {
    this.settings = settings;
    this.cleanMode = settings.hideIframeHeader;

    this.overlay = document.createElement('div');
    this.overlay.className = 'ldp-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-hidden', 'true');

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'ldp-backdrop';
    this.backdrop.addEventListener('click', this.handleBackdropClick);

    this.modal = document.createElement('div');
    this.modal.className = 'ldp-modal';

    // Header
    this.header = document.createElement('div');
    this.header.className = 'ldp-header';
    this.header.addEventListener('pointerdown', this.handleHeaderPointerDown);
    this.header.addEventListener('dblclick', this.handleHeaderDoubleClick);

    const titleGroup = document.createElement('div');
    titleGroup.className = 'ldp-title-group';

    const brandDot = document.createElement('span');
    brandDot.className = 'ldp-brand-dot';

    this.titleEl = document.createElement('span');
    this.titleEl.className = 'ldp-title';
    this.titleEl.textContent = 'Topic 预览';

    titleGroup.append(brandDot, this.titleEl);

    const actions = document.createElement('div');
    actions.className = 'ldp-actions';

    const reloadBtn = this.createIconButton(ICONS.reload, '重新加载', () => {
      this.reload();
    });

    this.cleanBtn = this.createIconButton(
      ICONS.clean,
      '切换精简视图（隐藏顶栏与侧栏）',
      () => {
        this.toggleCleanMode();
      },
    );
    this.updateCleanButtonState();

    this.copyBtn = this.createIconButton(ICONS.copy, '复制帖子链接', () => {
      void this.copyCurrentUrl();
    });

    const openTabBtn = this.createIconButton(
      ICONS.external,
      '在新标签页打开',
      () => {
        this.openInNewTab();
      },
    );

    this.maxBtn = this.createIconButton(ICONS.maximize, '最大化 / 还原', () => {
      this.toggleMaximize();
    });

    const closeBtn = this.createIconButton(
      ICONS.close,
      '关闭预览 (Esc)',
      () => {
        this.close();
      },
      true,
    );

    actions.append(
      reloadBtn,
      this.cleanBtn,
      this.copyBtn,
      openTabBtn,
      this.maxBtn,
      closeBtn,
    );

    this.header.append(titleGroup, actions);

    // Body
    const body = document.createElement('div');
    body.className = 'ldp-body';

    this.loadingBar = document.createElement('div');
    this.loadingBar.className = 'ldp-loading-bar';

    this.loadingMask = document.createElement('div');
    this.loadingMask.className = 'ldp-loading-mask';
    const spinner = document.createElement('div');
    spinner.className = 'ldp-spinner';
    const loadingLabel = document.createElement('span');
    loadingLabel.textContent = '正在加载帖子内容...';
    this.loadingMask.append(spinner, loadingLabel);

    this.iframe = document.createElement('iframe');
    this.iframe.className = 'ldp-iframe';
    this.iframe.name = PREVIEW_IFRAME_NAME;
    this.iframe.setAttribute('title', 'Topic 预览内容');
    this.iframe.addEventListener('load', this.handleIframeLoad);

    const dragShield = document.createElement('div');
    dragShield.className = 'ldp-drag-shield';

    this.fallbackBanner = document.createElement('div');
    this.fallbackBanner.className = 'ldp-fallback';
    const fallbackText = document.createElement('span');
    fallbackText.textContent = '页面加载较慢或被站点安全策略拦截，可直接在新标签页查看。';
    const fallbackBtn = document.createElement('button');
    fallbackBtn.type = 'button';
    fallbackBtn.className = 'ldp-fallback-btn';
    fallbackBtn.textContent = '新标签页打开';
    fallbackBtn.addEventListener('click', () => this.openInNewTab());
    this.fallbackBanner.append(fallbackText, fallbackBtn);

    this.sizeBadge = document.createElement('div');
    this.sizeBadge.className = 'ldp-size-badge';

    body.append(
      this.loadingBar,
      this.loadingMask,
      this.iframe,
      dragShield,
      this.fallbackBanner,
      this.sizeBadge,
    );

    this.modal.append(this.header, body);

    // 8-direction resize handles
    for (const dir of RESIZE_DIRECTIONS) {
      const handle = document.createElement('div');
      handle.className = `ldp-resize ldp-resize-${dir}`;
      handle.dataset.dir = dir;
      handle.addEventListener('pointerdown', (e) =>
        this.handleResizePointerDown(e, dir),
      );
      this.modal.appendChild(handle);
    }

    this.overlay.append(this.backdrop, this.modal);
    shadowRoot.appendChild(this.overlay);

    // Pre-apply default geometry so preloaded iframes render at full desktop dimensions
    this.applyRect(resolveInitialRect(null, this.getViewport()));
    void this.primeCachedGeometry();
    this.unsubscribeGeometry = subscribeWindowGeometry((geo) => {
      this.cachedGeometry = geo;
      if (!this.isOpen && !this.isMaximized) {
        this.applyRect(resolveInitialRect(geo, this.getViewport()));
      }
    });

    window.addEventListener('keydown', this.handleKeyDown, true);
    window.addEventListener('message', this.handleWindowMessage);
    window.addEventListener('resize', this.handleWindowResize);
  }

  public updateSettings(settings: ExtensionSettings): void {
    const prevHide = this.settings.hideIframeHeader;
    this.settings = settings;
    if (prevHide !== settings.hideIframeHeader) {
      this.cleanMode = settings.hideIframeHeader;
      this.updateCleanButtonState();
      this.postCleanModeToIframe();
    }
  }

  /**
   * Silently begins loading or SPA-navigating to `url` before the user completes clicking,
   * while the modal remains hidden.
   */
  public preload(url: string): void {
    if (this.isOpen || !url) return;
    if (this.loadState === 'ready' && isSameTopicTarget(url, this.loadedUrl)) {
      return;
    }
    if (this.loadState === 'loading' && isSameTopicTarget(url, this.pendingUrl)) {
      return;
    }
    this.navigateTo(url, { silent: true, forceHardReload: false });
  }

  public open(url: string, title: string): void {
    this.clearCloseTimer();
    this.currentUrl = url;
    this.titleEl.textContent = title || 'Topic 预览';
    this.titleEl.title = title || url;

    if (!this.isOpen) {
      const viewport = this.getViewport();
      this.isMaximized = false;
      this.restoreRect = null;
      this.modal.classList.remove('is-maximized');
      this.updateMaximizeButtonState();
      this.applyRect(resolveInitialRect(this.cachedGeometry, viewport));

      this.isOpen = true;
      this.overlay.setAttribute('aria-hidden', 'false');
      this.overlay.classList.add('is-open');
      requestAnimationFrame(() => {
        if (this.isOpen) {
          this.overlay.classList.add('is-visible');
        }
      });
    }

    // 1. Instant open: requested topic is already loaded in the warm iframe
    if (this.loadState === 'ready' && isSameTopicTarget(url, this.loadedUrl)) {
      if (this.loadedUrl) {
        this.currentUrl = this.loadedUrl;
      }
      this.finishLoading();
      this.postCleanModeToIframe();
      return;
    }

    // 2. Reuse in-flight preload for the exact same topic without restarting navigation
    if (this.loadState === 'loading' && isSameTopicTarget(url, this.pendingUrl)) {
      this.showLoadingIndicators();
      return;
    }

    // 3. Navigate via warm Discourse SPA router when available, otherwise load iframe.src
    this.navigateTo(url, { silent: false, forceHardReload: false });
  }

  public close(options?: { unload?: boolean }): void {
    const shouldUnload = Boolean(options?.unload);
    this.clearCloseTimer();

    if (!this.isOpen) {
      if (shouldUnload) {
        this.resetIframe();
      }
      return;
    }

    this.isOpen = false;
    this.clearFallbackTimer();
    this.overlay.classList.remove('is-visible');
    this.postToIframe({ type: 'LDP_DEACTIVATE' });
    this.iframe.blur();

    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      if (!this.isOpen) {
        this.overlay.classList.remove('is-open');
        this.overlay.setAttribute('aria-hidden', 'true');
        this.fallbackBanner.classList.remove('is-visible');
        if (shouldUnload) {
          this.resetIframe();
        }
      }
    }, 160);
  }

  public destroy(): void {
    this.close({ unload: true });
    this.clearCloseTimer();
    this.clearFallbackTimer();
    this.clearNavAckTimer();
    this.clearColdLoadGraceTimer();
    this.resetIframe();
    this.unsubscribeGeometry();
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    if (this.copyFeedbackTimer !== null) window.clearTimeout(this.copyFeedbackTimer);
    if (this.sizeBadgeTimer !== null) window.clearTimeout(this.sizeBadgeTimer);

    window.removeEventListener('keydown', this.handleKeyDown, true);
    window.removeEventListener('message', this.handleWindowMessage);
    window.removeEventListener('resize', this.handleWindowResize);
    this.overlay.remove();
  }

  private async primeCachedGeometry(): Promise<void> {
    try {
      const saved = await getWindowGeometry();
      this.cachedGeometry = saved;
      if (!this.isOpen && !this.isMaximized) {
        this.applyRect(resolveInitialRect(saved, this.getViewport()));
      }
    } catch {
      // Ignore storage read errors; default geometry already applied
    }
  }

  private createIconButton(
    svg: string,
    tooltip: string,
    onClick: () => void,
    isDanger = false,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = isDanger ? 'ldp-icon-btn is-danger' : 'ldp-icon-btn';
    btn.title = tooltip;
    btn.setAttribute('aria-label', tooltip);
    btn.innerHTML = svg;
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private getViewport(): { width: number; height: number } {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  private applyRect(rect: WindowRect): void {
    this.currentRect = rect;
    this.modal.style.left = `${rect.x}px`;
    this.modal.style.top = `${rect.y}px`;
    this.modal.style.width = `${rect.width}px`;
    this.modal.style.height = `${rect.height}px`;
  }

  private schedulePersistGeometry(): void {
    if (!this.currentRect || this.isMaximized) return;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    const snapshot = toWindowGeometry(this.currentRect);
    this.cachedGeometry = snapshot;
    this.saveTimer = window.setTimeout(() => {
      void saveWindowGeometry(snapshot);
    }, 200);
  }

  private showLoadingIndicators(): void {
    this.clearFallbackTimer();
    this.fallbackBanner.classList.remove('is-visible');
    this.loadingBar.classList.add('is-active');
    this.loadingMask.classList.add('is-active');

    this.fallbackTimer = window.setTimeout(() => {
      if (this.isOpen && this.loadingMask.classList.contains('is-active')) {
        this.loadingMask.classList.remove('is-active');
        this.fallbackBanner.classList.add('is-visible');
      }
    }, LOAD_FALLBACK_TIMEOUT_MS);
  }

  private navigateTo(
    url: string,
    options: { silent: boolean; forceHardReload: boolean },
  ): void {
    const requestId = ++this.activeRequestId;
    this.clearNavAckTimer();
    this.clearColdLoadGraceTimer();
    this.clearFallbackTimer();

    this.pendingUrl = url;
    this.loadState = 'loading';
    this.fallbackBanner.classList.remove('is-visible');

    if (!options.silent) {
      this.showLoadingIndicators();
    }

    const canTrySpa =
      !options.forceHardReload &&
      this.isIframeBooted &&
      Boolean(this.iframe.contentWindow);

    if (canTrySpa) {
      const posted = this.postToIframe({
        type: 'LDP_NAVIGATE',
        url,
        requestId,
      });
      if (posted) {
        this.navAckTimer = window.setTimeout(() => {
          this.navAckTimer = null;
          if (this.activeRequestId === requestId && this.loadState === 'loading') {
            this.loadViaIframeSrc(url, requestId, false);
          }
        }, SPA_NAV_ACK_TIMEOUT_MS);
        return;
      }
    }

    this.loadViaIframeSrc(url, requestId, options.forceHardReload);
  }

  private loadViaIframeSrc(
    url: string,
    requestId: number,
    forceReload: boolean,
  ): void {
    if (this.activeRequestId !== requestId) return;
    this.clearNavAckTimer();
    this.clearColdLoadGraceTimer();
    this.isIframeBooted = false;
    this.hasBootingAck = false;

    if (forceReload && this.iframe.src === url && this.iframe.contentWindow) {
      try {
        this.iframe.contentWindow.location.reload();
        return;
      } catch {
        // Fall through to assigning iframe.src directly
      }
    }
    this.iframe.src = url;
  }

  private resetIframe(): void {
    this.activeRequestId += 1;
    this.clearNavAckTimer();
    this.clearColdLoadGraceTimer();
    this.clearFallbackTimer();
    this.isIframeBooted = false;
    this.hasBootingAck = false;
    this.loadState = 'idle';
    this.loadedUrl = '';
    this.pendingUrl = '';
    this.iframe.src = 'about:blank';
  }

  private finishLoading(): void {
    this.clearFallbackTimer();
    this.loadingBar.classList.remove('is-active');
    this.loadingMask.classList.remove('is-active');
    this.fallbackBanner.classList.remove('is-visible');
  }

  private clearFallbackTimer(): void {
    if (this.fallbackTimer !== null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private clearNavAckTimer(): void {
    if (this.navAckTimer !== null) {
      window.clearTimeout(this.navAckTimer);
      this.navAckTimer = null;
    }
  }

  private clearColdLoadGraceTimer(): void {
    if (this.coldLoadGraceTimer !== null) {
      window.clearTimeout(this.coldLoadGraceTimer);
      this.coldLoadGraceTimer = null;
    }
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private reload(): void {
    if (!this.currentUrl) return;
    this.navigateTo(this.currentUrl, { silent: false, forceHardReload: true });
  }

  private toggleCleanMode(): void {
    this.cleanMode = !this.cleanMode;
    this.updateCleanButtonState();
    this.postCleanModeToIframe();
  }

  private updateCleanButtonState(): void {
    this.cleanBtn.classList.toggle('is-active', this.cleanMode);
    this.cleanBtn.title = this.cleanMode
      ? '精简视图已开启（点击恢复论坛完整顶栏）'
      : '切换为精简视图（隐藏顶栏与侧栏）';
  }

  private postToIframe(message: ParentToIframeMessage): boolean {
    if (!this.iframe.contentWindow) return false;
    try {
      this.iframe.contentWindow.postMessage(message, window.location.origin);
      return true;
    } catch {
      return false;
    }
  }

  private postCleanModeToIframe(): void {
    this.postToIframe({
      type: 'LDP_SET_CLEAN_MODE',
      enabled: this.cleanMode,
    });
  }

  private async copyCurrentUrl(): Promise<void> {
    if (!this.currentUrl) return;
    try {
      await navigator.clipboard.writeText(this.currentUrl);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = this.currentUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }

    this.copyBtn.innerHTML = ICONS.check;
    this.copyBtn.classList.add('is-active');
    if (this.copyFeedbackTimer !== null) {
      window.clearTimeout(this.copyFeedbackTimer);
    }
    this.copyFeedbackTimer = window.setTimeout(() => {
      this.copyBtn.innerHTML = ICONS.copy;
      this.copyBtn.classList.remove('is-active');
    }, 1400);
  }

  private openInNewTab(): void {
    if (!this.currentUrl) return;
    window.open(this.currentUrl, '_blank', 'noopener,noreferrer');
  }

  private toggleMaximize(): void {
    if (!this.currentRect) return;
    if (!this.isMaximized) {
      this.restoreRect = { ...this.currentRect };
      this.isMaximized = true;
      this.modal.classList.add('is-maximized');
      this.applyRect({
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    } else {
      this.isMaximized = false;
      this.modal.classList.remove('is-maximized');
      const target = this.restoreRect
        ? clampRect(this.restoreRect, this.getViewport())
        : resolveInitialRect(null, this.getViewport());
      this.applyRect(target);
      this.restoreRect = null;
    }
    this.updateMaximizeButtonState();
  }

  private updateMaximizeButtonState(): void {
    this.maxBtn.innerHTML = this.isMaximized ? ICONS.restore : ICONS.maximize;
    this.maxBtn.title = this.isMaximized ? '还原窗口大小' : '最大化窗口';
  }

  private showSizeBadge(width: number, height: number): void {
    this.sizeBadge.textContent = `${width} × ${height}`;
    this.sizeBadge.classList.add('is-visible');
    if (this.sizeBadgeTimer !== null) {
      window.clearTimeout(this.sizeBadgeTimer);
    }
  }

  private hideSizeBadgeSoon(): void {
    if (this.sizeBadgeTimer !== null) {
      window.clearTimeout(this.sizeBadgeTimer);
    }
    this.sizeBadgeTimer = window.setTimeout(() => {
      this.sizeBadge.classList.remove('is-visible');
    }, 450);
  }

  private readonly handleBackdropClick = (): void => {
    if (this.settings.closeOnBackdropClick) {
      this.close();
    }
  };

  private readonly handleHeaderDoubleClick = (event: MouseEvent): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    this.toggleMaximize();
  };

  private readonly handleHeaderPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.isMaximized || !this.currentRect) return;
    if ((event.target as HTMLElement).closest('button')) return;

    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = { ...this.currentRect };

    this.modal.classList.add('is-interacting');
    this.header.setPointerCapture(pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      this.applyRect(computeDraggedRect(startRect, dx, dy, this.getViewport()));
    };

    const onUp = () => {
      this.modal.classList.remove('is-interacting');
      this.header.removeEventListener('pointermove', onMove);
      this.header.removeEventListener('pointerup', onUp);
      this.header.removeEventListener('pointercancel', onUp);
      if (this.header.hasPointerCapture(pointerId)) {
        this.header.releasePointerCapture(pointerId);
      }
      this.schedulePersistGeometry();
    };

    this.header.addEventListener('pointermove', onMove);
    this.header.addEventListener('pointerup', onUp);
    this.header.addEventListener('pointercancel', onUp);
  };

  private handleResizePointerDown(
    event: PointerEvent,
    direction: ResizeDirection,
  ): void {
    if (event.button !== 0 || this.isMaximized || !this.currentRect) return;

    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget as HTMLDivElement;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = { ...this.currentRect };

    this.modal.classList.add('is-interacting');
    handle.setPointerCapture(pointerId);
    this.showSizeBadge(startRect.width, startRect.height);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const next = computeResizedRect(
        startRect,
        direction,
        dx,
        dy,
        this.getViewport(),
      );
      this.applyRect(next);
      this.showSizeBadge(next.width, next.height);
    };

    const onUp = () => {
      this.modal.classList.remove('is-interacting');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      this.hideSizeBadgeSoon();
      this.schedulePersistGeometry();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  private readonly handleIframeLoad = (): void => {
    if (!this.iframe.src || this.iframe.src === 'about:blank') return;
    if (this.loadState !== 'loading') return;

    this.postCleanModeToIframe();

    // If iframe-enhancer is active, wait for its LDP_READY (post-Ember render)
    if (this.hasBootingAck) {
      return;
    }

    // Fallback for non-enhancer pages (e.g. Cloudflare challenge / cross-origin error page)
    const requestId = this.activeRequestId;
    this.clearColdLoadGraceTimer();
    this.coldLoadGraceTimer = window.setTimeout(() => {
      this.coldLoadGraceTimer = null;
      if (
        this.activeRequestId !== requestId ||
        this.hasBootingAck ||
        this.loadState !== 'loading'
      ) {
        return;
      }
      this.isIframeBooted = false;
      this.loadState = 'ready';
      this.loadedUrl = this.pendingUrl;
      this.pendingUrl = '';
      if (this.isOpen) {
        this.finishLoading();
      }
    }, COLD_LOAD_GRACE_MS);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  };

  private readonly handleWindowMessage = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== this.iframe.contentWindow) return;

    const msg = event.data as Partial<IframeToParentMessage> | null;
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'LDP_CLOSE') {
      if (this.isOpen) {
        this.close();
      }
      return;
    }

    if (msg.type === 'LDP_BOOTING') {
      this.hasBootingAck = true;
      this.clearColdLoadGraceTimer();
      this.postCleanModeToIframe();
      return;
    }

    if (msg.type === 'LDP_NAV_ACK') {
      if (msg.requestId !== this.activeRequestId) return;
      this.clearNavAckTimer();
      if (msg.mode === 'fallback' && this.pendingUrl) {
        this.loadViaIframeSrc(this.pendingUrl, msg.requestId, false);
      }
      return;
    }

    if (msg.type === 'LDP_READY') {
      if (
        typeof msg.requestId === 'number' &&
        msg.requestId !== this.activeRequestId
      ) {
        return;
      }
      // Ignore stale initial LDP_READY from an aborted cold load before the new frame boots
      if (
        msg.requestId === undefined &&
        this.loadState === 'loading' &&
        !this.hasBootingAck
      ) {
        return;
      }

      this.clearNavAckTimer();
      this.clearColdLoadGraceTimer();
      this.isIframeBooted = msg.spaCapable !== false;
      this.loadState = 'ready';

      if (typeof msg.url === 'string' && msg.url.startsWith(window.location.origin)) {
        this.loadedUrl = msg.url;
        if (this.isOpen) {
          this.currentUrl = msg.url;
        }
      } else if (this.pendingUrl) {
        this.loadedUrl = this.pendingUrl;
      }
      this.pendingUrl = '';

      if (this.isOpen) {
        this.finishLoading();
        if (typeof msg.title === 'string' && msg.title.trim()) {
          this.titleEl.textContent = msg.title.trim();
          this.titleEl.title = msg.title.trim();
        }
      }
      this.postCleanModeToIframe();
      return;
    }

    if (msg.type === 'LDP_META_UPDATE') {
      if (typeof msg.url === 'string' && msg.url.startsWith(window.location.origin)) {
        this.loadedUrl = msg.url;
        if (this.isOpen) {
          this.currentUrl = msg.url;
        }
      }
      if (this.isOpen && typeof msg.title === 'string' && msg.title.trim()) {
        this.titleEl.textContent = msg.title.trim();
        this.titleEl.title = msg.title.trim();
      }
    }
  };

  private readonly handleWindowResize = (): void => {
    if (!this.isOpen || !this.currentRect) return;
    if (this.isMaximized) {
      this.applyRect({
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      });
      return;
    }
    this.applyRect(clampRect(this.currentRect, this.getViewport()));
  };
}
