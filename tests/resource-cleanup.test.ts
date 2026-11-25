// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverTrigger } from '../src/content/hover-trigger';
import { PreviewModal } from '../src/content/preview-modal';
import { DEFAULT_SETTINGS, type IframeToParentMessage } from '../src/shared/types';

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
): void {
  const event = new MessageEvent('message', {
    origin: window.location.origin,
    source: iframe.contentWindow,
    data,
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function setupModal() {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);

    const modal = new PreviewModal(shadow, { ...DEFAULT_SETTINGS });
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
