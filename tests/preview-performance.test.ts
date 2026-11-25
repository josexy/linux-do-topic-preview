// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverTrigger } from '../src/content/hover-trigger';
import { PreviewModal } from '../src/content/preview-modal';
import { DEFAULT_SETTINGS, type IframeToParentMessage } from '../src/shared/types';
import { getPreviewNavigationId, PREVIEW_ACTIVE_ATTRIBUTE } from '../src/shared/iframe-navigation';

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

describe('HoverTrigger preloading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('preloads after brief button hover dwell, cancels on quick leave, and preloads immediately on pointerdown', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);

    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="topic-list-item"><div class="main-link">
        <a class="title raw-topic-link" href="/t/topic/1001">测试帖子 A</a>
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

    const onPreview = vi.fn();
    const onPreload = vi.fn();
    const trigger = new HoverTrigger(shadow, onPreview, onPreload);

    // Hovering topic title alone must NOT trigger preload
    anchor.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(onPreload).not.toHaveBeenCalled();

    const btn = shadow.querySelector('.ldp-trigger') as HTMLButtonElement;
    expect(btn.classList.contains('is-visible')).toBe(true);

    // Quick brush over button (< 65ms) must cancel preload
    btn.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(30);
    btn.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(100);
    expect(onPreload).not.toHaveBeenCalled();

    // Hovering button >= 65ms triggers preload
    btn.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(70);
    expect(onPreload).toHaveBeenCalledTimes(1);
    expect(onPreload).toHaveBeenCalledWith(
      `${window.location.origin}/t/topic/1001`,
      '测试帖子 A',
    );

    // Pointerdown triggers immediate preload without waiting
    onPreload.mockClear();
    btn.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }));
    expect(onPreload).toHaveBeenCalledTimes(1);

    // Click triggers preview
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPreview).toHaveBeenCalledWith(
      `${window.location.origin}/t/topic/1001`,
      '测试帖子 A',
    );

    trigger.destroy();
  });
});

describe('PreviewModal warm iframe reuse & SPA routing', () => {
  const instances: PreviewModal[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    installMockWebExtApi();
    document.body.innerHTML = '';
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
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
    const loadingMask = shadow.querySelector('.ldp-loading-mask') as HTMLDivElement;
    const overlay = shadow.querySelector('.ldp-overlay') as HTMLDivElement;

    const postMessageSpy = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: {
        postMessage: postMessageSpy,
        location: { reload: vi.fn() },
      },
    });

    return { modal, iframe, loadingMask, overlay, postMessageSpy };
  }

  it('keeps iframe warm on close and reopens same topic instantaneously (including slug redirect)', () => {
    const { modal, iframe, loadingMask, postMessageSpy } = setupModal();
    const urlA = `${window.location.origin}/t/topic/123`;
    const canonicalUrlA = `${window.location.origin}/t/actual-slug/123`;

    modal.open(urlA, 'Topic A');
    expect(iframe.src).toBe(urlA);
    expect(loadingMask.classList.contains('is-active')).toBe(true);

    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url: canonicalUrlA });
    dispatchIframeMessage(iframe, {
      type: 'LDP_READY',
      title: 'Topic A - Linux.do',
      url: canonicalUrlA,
      spaCapable: true,
    });
    expect(loadingMask.classList.contains('is-active')).toBe(false);

    // Close modal -> should keep iframe warm (NOT reset to about:blank) and deactivate media
    modal.close();
    vi.advanceTimersByTime(200);
    expect(iframe.src).toBe(urlA);
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'LDP_DEACTIVATE', navigationId: getPreviewNavigationId(iframe.name) },
      window.location.origin,
    );

    // Reopen same topic -> 0ms instant display, no loading mask, no reload
    postMessageSpy.mockClear();
    modal.open(urlA, 'Topic A');
    expect(loadingMask.classList.contains('is-active')).toBe(false);
    expect(postMessageSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LDP_NAVIGATE' }),
      expect.anything(),
    );

    // Unload explicitly resets to about:blank
    modal.close({ unload: true });
    vi.advanceTimersByTime(200);
    expect(iframe.src).toBe('about:blank');

    modal.destroy();
  });

  it('uses SPA navigation via LDP_NAVIGATE when warm and falls back to iframe.src on fallback ack or timeout', () => {
    const { modal, iframe, loadingMask, postMessageSpy } = setupModal();
    const urlA = `${window.location.origin}/t/topic/100`;
    const urlB = `${window.location.origin}/t/topic/200`;
    const urlC = `${window.location.origin}/t/topic/300`;

    // Initial cold boot on Topic A
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

    // Switch to Topic B -> uses SPA postMessage, does NOT overwrite iframe.src
    postMessageSpy.mockClear();
    modal.open(urlB, 'Topic B');
    expect(iframe.src).toBe(urlA);
    const navCall = postMessageSpy.mock.calls.find(
      ([msg]) => msg && msg.type === 'LDP_NAVIGATE',
    );
    expect(navCall).toBeDefined();
    const reqIdB = navCall![0].requestId as number;
    expect(navCall![0].url).toBe(urlB);

    dispatchIframeMessage(iframe, {
      type: 'LDP_NAV_ACK',
      requestId: reqIdB,
      mode: 'spa',
    });
    dispatchIframeMessage(iframe, {
      type: 'LDP_READY',
      requestId: reqIdB,
      title: 'Topic B',
      url: urlB,
      spaCapable: true,
    });
    expect(loadingMask.classList.contains('is-active')).toBe(false);

    // Switch to Topic C, iframe replies mode: 'fallback' -> falls back to iframe.src
    postMessageSpy.mockClear();
    modal.open(urlC, 'Topic C');
    const navCallC = postMessageSpy.mock.calls.find(
      ([msg]) => msg && msg.type === 'LDP_NAVIGATE',
    );
    const reqIdC = navCallC![0].requestId as number;
    dispatchIframeMessage(iframe, {
      type: 'LDP_NAV_ACK',
      requestId: reqIdC,
      mode: 'fallback',
    });
    expect(iframe.src).toBe(urlC);

    modal.destroy();
  });

  it('reuses an in-flight preload when open() is called for the same topic', () => {
    const { modal, iframe, loadingMask } = setupModal();
    const urlA = `${window.location.origin}/t/topic/555`;

    // Preload while closed
    modal.preload(urlA);
    expect(iframe.src).toBe(urlA);

    const srcSetterSpy = vi.spyOn(iframe, 'src', 'set');

    // Open while preload is still in flight -> must NOT reassign iframe.src
    modal.open(urlA, 'Topic 555');
    expect(srcSetterSpy).not.toHaveBeenCalled();
    expect(loadingMask.classList.contains('is-active')).toBe(true);

    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url: urlA });
    dispatchIframeMessage(iframe, {
      type: 'LDP_READY',
      title: 'Topic 555',
      url: urlA,
      spaCapable: true,
    });
    expect(loadingMask.classList.contains('is-active')).toBe(false);

    modal.destroy();
  });

  it('ignores stale initial LDP_READY from an aborted cold load', () => {
    const { modal, iframe, loadingMask } = setupModal();
    const urlA = `${window.location.origin}/t/topic/701`;
    const urlB = `${window.location.origin}/t/topic/702`;

    // Preload A starts, then user opens B before A finishes
    modal.preload(urlA);
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url: urlA });
    const navigationIdA = getPreviewNavigationId(iframe.name);

    modal.open(urlB, 'Topic 702');
    expect(iframe.src).toBe(urlB);
    expect(loadingMask.classList.contains('is-active')).toBe(true);

    // Late initial LDP_READY from A arrives before B sends LDP_BOOTING -> must be ignored
    dispatchIframeMessage(iframe, {
      type: 'LDP_READY',
      title: 'Topic 701',
      url: urlA,
      spaCapable: true,
    }, navigationIdA);
    expect(loadingMask.classList.contains('is-active')).toBe(true);

    // Now B boots and finishes
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url: urlB });
    dispatchIframeMessage(iframe, {
      type: 'LDP_READY',
      title: 'Topic 702',
      url: urlB,
      spaCapable: true,
    });
    expect(loadingMask.classList.contains('is-active')).toBe(false);

    modal.destroy();
  });

  it('opens a completed inactive preload immediately without reloading or SPA navigation', () => {
    const { modal, iframe, loadingMask, postMessageSpy } = setupModal();
    const url = `${window.location.origin}/t/topic/801`;
    modal.preload(url);
    expect(iframe.getAttribute(PREVIEW_ACTIVE_ATTRIBUTE)).toBe('false');
    const navigationId = getPreviewNavigationId(iframe.name);
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url });
    dispatchIframeMessage(iframe, { type: 'LDP_READY', url, title: 'Topic', spaCapable: true });
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'LDP_DEACTIVATE', preserveIframe: true, navigationId }, window.location.origin,
    );

    const srcSpy = vi.spyOn(iframe, 'src', 'set');
    postMessageSpy.mockClear();
    modal.open(url, 'Topic');
    expect(loadingMask.classList.contains('is-active')).toBe(false);
    expect(iframe.getAttribute(PREVIEW_ACTIVE_ATTRIBUTE)).toBe('true');
    expect(srcSpy).not.toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'LDP_ACTIVATE', navigationId }, window.location.origin);
    expect(postMessageSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'LDP_NAVIGATE' }), expect.anything());
  });

  it('activates an in-flight preload without restarting it or waiting for another handshake', () => {
    const { modal, iframe, loadingMask, postMessageSpy } = setupModal();
    const url = `${window.location.origin}/t/topic/802`;
    modal.preload(url);
    const srcSpy = vi.spyOn(iframe, 'src', 'set');
    modal.open(url, 'Topic');
    expect(iframe.getAttribute(PREVIEW_ACTIVE_ATTRIBUTE)).toBe('true');
    postMessageSpy.mockClear();
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url });
    dispatchIframeMessage(iframe, { type: 'LDP_READY', url, title: 'Topic', spaCapable: true });
    expect(srcSpy).not.toHaveBeenCalled();
    expect(loadingMask.classList.contains('is-active')).toBe(false);
    expect(postMessageSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'LDP_DEACTIVATE' }), expect.anything());
  });

  it('preserves warm reuse when reopened during the closing animation', () => {
    const { modal, iframe, overlay, loadingMask } = setupModal();
    const url = `${window.location.origin}/t/topic/803`;
    modal.open(url, 'Topic');
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url });
    dispatchIframeMessage(iframe, { type: 'LDP_READY', url, title: 'Topic', spaCapable: true });
    modal.close();
    vi.advanceTimersByTime(80);
    modal.close();
    const srcSpy = vi.spyOn(iframe, 'src', 'set');
    modal.open(url, 'Topic');
    vi.advanceTimersByTime(181_000);
    expect(srcSpy).not.toHaveBeenCalled();
    expect(overlay.classList.contains('is-open')).toBe(true);
    expect(loadingMask.classList.contains('is-active')).toBe(false);
  });

  it('rejects messages from an earlier cold load of the same URL, even after the new boot', () => {
    const { modal, iframe, loadingMask } = setupModal();
    const url = `${window.location.origin}/t/topic/804`;
    modal.preload(url);
    const oldNavigationId = getPreviewNavigationId(iframe.name);
    modal.close({ unload: true });
    modal.open(url, 'Topic');

    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url }, oldNavigationId);
    dispatchIframeMessage(iframe, { type: 'LDP_READY', url, title: 'Old', spaCapable: true }, oldNavigationId);
    expect(loadingMask.classList.contains('is-active')).toBe(true);
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url });
    dispatchIframeMessage(iframe, { type: 'LDP_READY', url, title: 'Old', spaCapable: true }, oldNavigationId);
    expect(loadingMask.classList.contains('is-active')).toBe(true);
    dispatchIframeMessage(iframe, { type: 'LDP_READY', url, title: 'New', spaCapable: true });
    expect(loadingMask.classList.contains('is-active')).toBe(false);
  });

  it('keeps the same document for SPA preload and still falls back after the existing ACK timeout', () => {
    const { modal, iframe, loadingMask, postMessageSpy } = setupModal();
    const urlA = `${window.location.origin}/t/topic/805`;
    const urlB = `${window.location.origin}/t/topic/806`;
    modal.preload(urlA);
    dispatchIframeMessage(iframe, { type: 'LDP_BOOTING', url: urlA });
    dispatchIframeMessage(iframe, { type: 'LDP_READY', url: urlA, title: 'A', spaCapable: true });
    const initialNavigationId = getPreviewNavigationId(iframe.name);
    const srcSpy = vi.spyOn(iframe, 'src', 'set');
    modal.preload(urlB);
    modal.open(urlB, 'B');
    expect(srcSpy).not.toHaveBeenCalled();
    expect(getPreviewNavigationId(iframe.name)).toBe(initialNavigationId);
    const nav = postMessageSpy.mock.calls.find(([msg]) => msg.type === 'LDP_NAVIGATE')![0];
    expect(nav).toMatchObject({ url: urlB, navigationId: initialNavigationId });
    // A duplicate initial READY from this document must not finish the SPA request.
    dispatchIframeMessage(iframe, { type: 'LDP_READY', url: urlA, title: 'A', spaCapable: true });
    expect(loadingMask.classList.contains('is-active')).toBe(true);
    vi.advanceTimersByTime(279);
    expect(srcSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(srcSpy).toHaveBeenCalledExactlyOnceWith(urlB);
    expect(getPreviewNavigationId(iframe.name)).not.toBe(initialNavigationId);
  });
});
