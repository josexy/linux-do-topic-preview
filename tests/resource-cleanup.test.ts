// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverTrigger } from '../src/content/hover-trigger';
import { PreviewModal } from '../src/content/preview-modal';
import { DEFAULT_SETTINGS, type IframeToParentMessage } from '../src/shared/types';
import { getPreviewNavigationId } from '../src/shared/iframe-navigation';

function installMockWebExtApi(): void {
  const listeners = new Set<(...args: unknown[]) => void>();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: {
        addListener: vi.fn((fn: (...args: unknown[]) => void) => listeners.add(fn)),
        removeListener: vi.fn((fn: (...args: unknown[]) => void) => listeners.delete(fn)),
      },
    },
  };
}

function dispatchIframeMessage(
  iframe: HTMLIFrameElement,
  data: IframeToParentMessage,
  navigationId = getPreviewNavigationId(iframe.name),
): void {
  const event = new MessageEvent('message', {
    origin: window.location.origin,
    source: iframe.contentWindow,
    data: { ...data, navigationId },
  });
  window.dispatchEvent(event);
}

function createPointerEvent(
  type: string,
  init: MouseEventInit & { pointerId?: number } = {},
): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'pointerId', {
    configurable: true,
    value: init.pointerId ?? 1,
  });
  return event as unknown as PointerEvent;
}

describe('PreviewModal resource cleanup & leak prevention', () => {
  const instances: PreviewModal[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    installMockWebExtApi();
    document.body.innerHTML = '';
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    instances.splice(0).forEach((modal) => modal.destroy());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function setupModal() {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);

    const modal = new PreviewModal(shadow, { ...DEFAULT_SETTINGS });
    instances.push(modal);
    const iframe = shadow.querySelector('iframe.ldp-iframe') as HTMLIFrameElement;
    const modalEl = shadow.querySelector('.ldp-modal') as HTMLDivElement;
    const header = shadow.querySelector('.ldp-header') as HTMLDivElement;
    const resizeSe = shadow.querySelector('.ldp-resize-se') as HTMLDivElement;
    const copyBtn = shadow.querySelector('button[aria-label="复制帖子链接"]') as HTMLButtonElement;

    const postMessageSpy = vi.fn();
    const replaceSpy = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: {
        postMessage: postMessageSpy,
        location: { reload: vi.fn(), replace: replaceSpy },
      },
    });

    return {
      modal,
      iframe,
      modalEl,
      header,
      resizeSe,
      copyBtn,
      postMessageSpy,
      replaceSpy,
      overlay: shadow.querySelector('.ldp-overlay') as HTMLDivElement,
      backdrop: shadow.querySelector('.ldp-backdrop') as HTMLDivElement,
      loadingMask: shadow.querySelector('.ldp-loading-mask') as HTMLDivElement,
    };
  }

  it('evicts idle warm iframe after TTL and cancels eviction if reopened', () => {
    const { modal, iframe, replaceSpy } = setupModal();
    const urlA = `${window.location.origin}/t/topic/101`;

    modal.open(urlA, 'Topic A');
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url: urlA });
    dispatchIframeMessage(iframe, {
      type: 'LDP_READY',
      title: 'Topic A',
      url: urlA,
      spaCapable: true,
    });

    modal.close();
    vi.advanceTimersByTime(179_000);
    // Still warm just before 180s idle TTL
    expect(iframe.src).toBe(urlA);

    // Reopen cancels the pending idle eviction
    modal.open(urlA, 'Topic A');
    vi.advanceTimersByTime(200_000);
    expect(iframe.src).toBe(urlA);

    // Close again and let TTL expire
    modal.close();
    vi.advanceTimersByTime(181_000);
    expect(replaceSpy).toHaveBeenCalledWith('about:blank');
    expect(iframe.src).toBe('about:blank');

    modal.destroy();
  });

  it('evicts unused preloaded iframe after idle TTL', () => {
    const { modal, iframe } = setupModal();
    const urlA = `${window.location.origin}/t/topic/102`;

    modal.preload(urlA);
    expect(iframe.src).toBe(urlA);

    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url: urlA });
    dispatchIframeMessage(iframe, {
      type: 'LDP_READY',
      title: 'Topic A',
      url: urlA,
      spaCapable: true,
    });

    vi.advanceTimersByTime(181_000);
    expect(iframe.src).toBe('about:blank');

    modal.destroy();
  });

  it('aborts and unloads iframe when closed while still loading', () => {
    const { modal, iframe } = setupModal();
    const urlA = `${window.location.origin}/t/topic/103`;

    modal.open(urlA, 'Slow Topic');
    expect(iframe.src).toBe(urlA);

    // User closes before LDP_READY arrives
    modal.close();
    vi.advanceTimersByTime(200);
    expect(iframe.src).toBe('about:blank');

    modal.destroy();
  });

  it('unloads warm iframe sooner when tab becomes hidden and immediately on pagehide', () => {
    const { modal, iframe } = setupModal();
    const urlA = `${window.location.origin}/t/topic/104`;

    modal.open(urlA, 'Topic A');
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url: urlA });
    dispatchIframeMessage(iframe, {
      type: 'LDP_READY',
      title: 'Topic A',
      url: urlA,
      spaCapable: true,
    });
    modal.close();
    vi.advanceTimersByTime(200);
    expect(iframe.src).toBe(urlA);

    // Hide tab -> unloads after 30s
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(31_000);
    expect(iframe.src).toBe('about:blank');

    // Open again, close, then fire pagehide -> immediate unload
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
    modal.open(urlA, 'Topic A');
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url: urlA });
    dispatchIframeMessage(iframe, {
      type: 'LDP_READY',
      title: 'Topic A',
      url: urlA,
      spaCapable: true,
    });
    modal.close();
    vi.advanceTimersByTime(200);
    expect(iframe.src).toBe(urlA);

    window.dispatchEvent(new Event('pagehide'));
    expect(iframe.src).toBe('about:blank');

    modal.destroy();
  });

  it('unloads iframe on LDP_REQUEST_UNLOAD (e.g. embedded cross-origin media)', () => {
    const { modal, iframe } = setupModal();
    const urlA = `${window.location.origin}/t/topic/105`;

    modal.open(urlA, 'Video Topic');
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url: urlA });
    dispatchIframeMessage(iframe, {
      type: 'LDP_READY',
      title: 'Video Topic',
      url: urlA,
      spaCapable: true,
    });

    modal.close();
    // Iframe responds to LDP_DEACTIVATE requesting unload because of cross-origin embed
    dispatchIframeMessage(iframe, { type: 'LDP_REQUEST_UNLOAD' });
    vi.advanceTimersByTime(200);
    expect(iframe.src).toBe('about:blank');

    modal.destroy();
  });

  it('cleans up drag & resize listeners on lostpointercapture and close()', () => {
    const { modal, modalEl, header, resizeSe } = setupModal();
    const urlA = `${window.location.origin}/t/topic/106`;
    modal.open(urlA, 'Topic A');

    // Start dragging header
    header.dispatchEvent(
      createPointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 }),
    );
    expect(modalEl.classList.contains('is-interacting')).toBe(true);

    // Lost pointer capture must clean up interaction class and listeners
    header.dispatchEvent(createPointerEvent('lostpointercapture'));
    expect(modalEl.classList.contains('is-interacting')).toBe(false);

    const leftAfterAbort = modalEl.style.left;
    header.dispatchEvent(
      createPointerEvent('pointermove', { clientX: 300, clientY: 300 }),
    );
    expect(modalEl.style.left).toBe(leftAfterAbort);

    // Start resizing, then close modal mid-resize
    resizeSe.dispatchEvent(
      createPointerEvent('pointerdown', { button: 0, clientX: 500, clientY: 500 }),
    );
    expect(modalEl.classList.contains('is-interacting')).toBe(true);

    modal.close();
    expect(modalEl.classList.contains('is-interacting')).toBe(false);

    modal.destroy();
  });

  function markReady(iframe: HTMLIFrameElement, url: string): void {
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url });
    dispatchIframeMessage(iframe, { type: 'LDP_READY', url, title: 'Topic', spaCapable: true });
  }

  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('finishes the original close animation after repeated backdrop clicks', () => {
    const { modal, iframe, overlay, backdrop } = setupModal();
    const url = `${window.location.origin}/t/topic/301`;
    modal.open(url, 'Topic');
    markReady(iframe, url);

    backdrop.click();
    vi.advanceTimersByTime(80);
    backdrop.click();
    vi.advanceTimersByTime(81);

    expect(overlay.classList.contains('is-open')).toBe(false);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(iframe.src).toBe(url);
    vi.advanceTimersByTime(180_000);
    expect(iframe.src).toBe('about:blank');
  });

  it.each(['embedded media', 'loading', 'disable'])('preserves pending unload on repeated close: %s', (reason) => {
    const { modal, iframe, overlay } = setupModal();
    const url = `${window.location.origin}/t/topic/302`;
    modal.open(url, 'Topic');
    if (reason !== 'loading') markReady(iframe, url);
    modal.close();
    if (reason === 'embedded media') {
      dispatchIframeMessage(iframe, { type: 'LDP_REQUEST_UNLOAD' });
    }
    vi.advanceTimersByTime(80);
    // Completing the load must not weaken the unload decision made at close time.
    if (reason === 'loading') markReady(iframe, url);
    if (reason === 'disable') modal.setEnabled(false);
    modal.close();
    vi.advanceTimersByTime(81);

    expect(iframe.src).toBe('about:blank');
    expect(overlay.classList.contains('is-open')).toBe(false);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not renew the idle lifetime on repeated tab switches', () => {
    const { modal, iframe } = setupModal();
    const url = `${window.location.origin}/t/topic/303`;
    modal.open(url, 'Topic');
    markReady(iframe, url);
    modal.close();
    vi.advanceTimersByTime(200);

    for (let i = 0; i < 15; i++) {
      setHidden(true);
      vi.advanceTimersByTime(20_000);
      setHidden(false);
      vi.advanceTimersByTime(20_000);
    }
    expect(iframe.src).toBe('about:blank');
  });

  it('keeps the earlier deadline when entering the background near expiry', () => {
    const { modal, iframe } = setupModal();
    const url = `${window.location.origin}/t/topic/304`;
    modal.preload(url);
    markReady(iframe, url);
    vi.advanceTimersByTime(170_000);
    setHidden(true);
    vi.advanceTimersByTime(10_001);
    expect(iframe.src).toBe('about:blank');
  });

  it('checks the absolute deadline on return even if background timers were suspended', () => {
    const { modal, iframe } = setupModal();
    const url = `${window.location.origin}/t/topic/305`;
    modal.preload(url);
    markReady(iframe, url);
    setHidden(true);
    vi.setSystemTime(Date.now() + 60_000);
    setHidden(false);
    expect(iframe.src).toBe('about:blank');
  });

  it('does not renew the idle lifetime merely because a slow preload finished', () => {
    const { modal, iframe } = setupModal();
    const url = `${window.location.origin}/t/topic/306`;
    modal.preload(url);
    vi.advanceTimersByTime(120_000);
    markReady(iframe, url);
    vi.advanceTimersByTime(60_001);
    expect(iframe.src).toBe('about:blank');
  });

  it('allows a new explicit preload interaction to renew the warm cache without reloading', () => {
    const { modal, iframe } = setupModal();
    const url = `${window.location.origin}/t/topic/307`;
    modal.preload(url);
    markReady(iframe, url);
    vi.advanceTimersByTime(170_000);
    const srcSpy = vi.spyOn(iframe, 'src', 'set');
    modal.preload(url);
    vi.advanceTimersByTime(20_000);
    expect(srcSpy).not.toHaveBeenCalled();
    expect(iframe.src).toBe(url);
    vi.advanceTimersByTime(160_001);
    expect(iframe.src).toBe('about:blank');
  });

  it('ignores late boot, ready and metadata messages after unloading', () => {
    const { modal, iframe, loadingMask } = setupModal();
    const url = `${window.location.origin}/t/topic/308`;
    modal.preload(url);
    markReady(iframe, url);
    const oldNavigationId = getPreviewNavigationId(iframe.name);
    modal.close({ unload: true });
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url }, oldNavigationId);
    dispatchIframeMessage(iframe, { type: 'LDP_READY', url, title: 'Late', spaCapable: true }, oldNavigationId);
    dispatchIframeMessage(iframe, { type: 'LDP_META_UPDATE', url, title: 'Late' }, oldNavigationId);
    expect(vi.getTimerCount()).toBe(0);

    modal.open(url, 'Topic');
    expect(iframe.src).toBe(url);
    expect(getPreviewNavigationId(iframe.name)).not.toBe(oldNavigationId);
    expect(loadingMask.classList.contains('is-active')).toBe(true);
    markReady(iframe, url);
    expect(loadingMask.classList.contains('is-active')).toBe(false);
  });

  it('guards async clipboard copy against scheduling timers after destroy()', async () => {
    const { modal, copyBtn } = setupModal();
    const urlA = `${window.location.origin}/t/topic/107`;

    let resolveWrite!: () => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    modal.open(urlA, 'Topic A');
    copyBtn.click();
    expect(writeText).toHaveBeenCalledWith(urlA);

    modal.destroy();
    resolveWrite();
    await Promise.resolve();
    await Promise.resolve();

    expect(copyBtn.classList.contains('is-active')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('HoverTrigger DOM release & listener lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('hides and releases active match on page click (SPA nav), blur, or disable', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);

    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="topic-list-item"><div class="main-link">
        <a class="title raw-topic-link" href="/t/topic/2001">测试帖子 B</a>
      </div></div>`,
    );

    const anchor = document.querySelector('a.raw-topic-link') as HTMLAnchorElement;
    anchor.getBoundingClientRect = () =>
      ({
        left: 20,
        top: 20,
        right: 200,
        bottom: 44,
        width: 180,
        height: 24,
        x: 20,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    anchor.getClientRects = () => [anchor.getBoundingClientRect()] as unknown as DOMRectList;

    const trigger = new HoverTrigger(shadow, vi.fn(), vi.fn());
    const btn = shadow.querySelector('.ldp-trigger') as HTMLButtonElement;

    anchor.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(btn.classList.contains('is-visible')).toBe(true);

    // Clicking the topic link itself immediately clears activeMatch & hides button
    anchor.dispatchEvent(createPointerEvent('pointerdown', { button: 0 }));
    expect(btn.classList.contains('is-visible')).toBe(false);

    // Hover again, then disable -> detaches global listeners so further hover does nothing
    anchor.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(btn.classList.contains('is-visible')).toBe(true);

    trigger.setEnabled(false);
    expect(btn.classList.contains('is-visible')).toBe(false);

    anchor.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(btn.classList.contains('is-visible')).toBe(false);

    // Re-enabling re-attaches global listeners
    trigger.setEnabled(true);
    anchor.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(btn.classList.contains('is-visible')).toBe(true);

    // Window blur hides trigger
    window.dispatchEvent(new Event('blur'));
    expect(btn.classList.contains('is-visible')).toBe(false);

    trigger.destroy();
  });
});
