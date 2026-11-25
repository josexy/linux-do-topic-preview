// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreviewFrameName, PREVIEW_ACTIVE_ATTRIBUTE } from '../src/shared/iframe-navigation';
import type { ParentToIframeMessage } from '../src/shared/types';

const navigationId = 7;
let parentWindow: { postMessage: ReturnType<typeof vi.fn> };
let frameElement: HTMLIFrameElement;
let testController: AbortController;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  document.head.innerHTML = '<title>Topic</title><meta name="generator" content="Discourse">';
  document.body.innerHTML = '<div id="main-outlet"><div id="topic" data-topic-id="901"><h1 id="topic-title">Topic</h1></div></div>';
  window.history.replaceState({}, '', '/t/topic/901');
  parentWindow = { postMessage: vi.fn() };
  frameElement = document.createElement('iframe');
  frameElement.name = createPreviewFrameName(navigationId);
  testController = new AbortController();
  vi.stubGlobal('parent', parentWindow);
  vi.stubGlobal('self', {});
  vi.stubGlobal('frameElement', frameElement);
  // Chromium can retain the browsing context's original name after iframe.name changes.
  vi.stubGlobal('name', 'ldp-preview-iframe');
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  // Vitest's global window proxy is not a native jsdom UIEvent view.
  const NativeMouseEvent = MouseEvent;
  vi.stubGlobal('MouseEvent', class extends NativeMouseEvent {
    constructor(type: string, init: MouseEventInit = {}) {
      super(type, { ...init, view: null });
    }
  });
});

afterEach(() => {
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  testController.abort();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.documentElement.classList.remove('ldp-clean-mode');
});

async function startEnhancer(active = false): Promise<void> {
  frameElement.setAttribute(PREVIEW_ACTIVE_ATTRIBUTE, String(active));
  await import('../src/content/iframe-enhancer');
}

function send(data: ParentToIframeMessage, generation = navigationId): void {
  window.dispatchEvent(new MessageEvent('message', {
    origin: window.location.origin,
    source: parentWindow as unknown as Window,
    data: { ...data, navigationId: generation },
  }));
}

function addPlayingVideo() {
  const video = document.createElement('video');
  let paused = false;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => { paused = true; });
  document.body.append(video);
  return {
    video,
    pause,
    play: () => {
      paused = false;
      video.dispatchEvent(new Event('play')); // Does not bubble.
    },
  };
}

function addExternalFrame(src = 'https://player.example/embed/123'): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = src;
  document.body.append(iframe);
  return iframe;
}

describe('iframe enhancer activity and navigation lifecycle', () => {
  it('tags BOOTING and READY with the document generation captured before async work', async () => {
    await startEnhancer();
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { type: 'LDP_BOOTING', url: window.location.href, navigationId }, window.location.origin,
    );
    window.name = createPreviewFrameName(navigationId + 1);
    frameElement.name = createPreviewFrameName(navigationId + 1);
    vi.advanceTimersByTime(16);
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LDP_READY', navigationId, spaCapable: true }), window.location.origin,
    );
  });

  it('pauses unused preload media before READY and restores external players on activation', async () => {
    const first = addPlayingVideo();
    const player = addExternalFrame();
    const src = player.src;
    await startEnhancer();
    expect(first.pause).toHaveBeenCalledTimes(1);
    expect(player.src).toBe('about:blank');
    vi.advanceTimersByTime(16);
    send({ type: 'LDP_DEACTIVATE', preserveIframe: true });
    expect(parentWindow.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LDP_REQUEST_UNLOAD' }), expect.anything(),
    );

    const late = addPlayingVideo();
    late.play();
    expect(late.pause).toHaveBeenCalledTimes(1);
    send({ type: 'LDP_ACTIVATE' });
    expect(player.src).toBe(src);
    late.play();
    expect(late.pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause media in an initially open preview and retains unload-on-close for embeds', async () => {
    const media = addPlayingVideo();
    const player = addExternalFrame();
    const src = player.src;
    await startEnhancer(true);
    expect(media.pause).not.toHaveBeenCalled();
    expect(player.src).toBe(src);
    send({ type: 'LDP_DEACTIVATE' });
    expect(media.pause).toHaveBeenCalledTimes(1);
    expect(player.src).toBe('about:blank');
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { type: 'LDP_REQUEST_UNLOAD', navigationId }, window.location.origin,
    );
    media.play();
    expect(media.pause).toHaveBeenCalledTimes(2);
  });

  it('suspends late external frames and source changes, while leaving same-origin frames intact', async () => {
    await startEnhancer();
    vi.advanceTimersByTime(16);
    const player = addExternalFrame();
    const internal = addExternalFrame(`${window.location.origin}/internal`);
    await Promise.resolve();
    expect(player.src).toBe('about:blank');
    expect(internal.src).toBe(`${window.location.origin}/internal`);
    player.src = 'https://player.example/embed/456';
    await Promise.resolve();
    expect(player.src).toBe('about:blank');
    send({ type: 'LDP_ACTIVATE' });
    expect(player.src).toBe('https://player.example/embed/456');
  });

  it('releases suspended frames removed by the site and preserves their source for reuse', async () => {
    const player = addExternalFrame();
    const src = player.src;
    await startEnhancer();
    expect(player.src).toBe('about:blank');
    player.remove();
    await Promise.resolve();
    expect(player.src).toBe(src);
    send({ type: 'LDP_ACTIVATE' });
    document.body.append(player);
    expect(player.src).toBe(src);
  });

  it('does not overwrite a site source change made immediately before activation', async () => {
    const player = addExternalFrame();
    await startEnhancer();
    player.src = 'https://player.example/embed/new';
    send({ type: 'LDP_ACTIVATE' });
    expect(player.src).toBe('https://player.example/embed/new');
  });

  it('rejects parent activity and navigation commands for an older document', async () => {
    const player = addExternalFrame();
    const src = player.src;
    await startEnhancer();
    vi.advanceTimersByTime(16);
    parentWindow.postMessage.mockClear();
    send({ type: 'LDP_ACTIVATE' }, navigationId - 1);
    send({ type: 'LDP_NAVIGATE', url: `${window.location.origin}/t/topic/902`, requestId: 5 }, navigationId - 1);
    expect(player.src).toBe('about:blank');
    expect(parentWindow.postMessage).not.toHaveBeenCalled();
    send({ type: 'LDP_ACTIVATE' });
    expect(player.src).toBe(src);
  });

  it('completes SPA navigation in the same document generation without a new handshake', async () => {
    await startEnhancer(true);
    vi.advanceTimersByTime(16);
    document.addEventListener('click', (event) => {
      const anchor = event.target as HTMLAnchorElement;
      if (anchor.tagName !== 'A') return;
      event.preventDefault();
      window.history.pushState({}, '', anchor.href);
      document.querySelector('#topic')!.setAttribute('data-topic-id', '902');
      document.querySelector('#topic-title')!.textContent = 'Next topic';
    }, { signal: testController.signal });
    parentWindow.postMessage.mockClear();
    send({ type: 'LDP_NAVIGATE', url: `${window.location.origin}/t/topic/902`, requestId: 5 });
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { type: 'LDP_NAV_ACK', mode: 'spa', requestId: 5, navigationId }, window.location.origin,
    );
    await Promise.resolve();
    vi.advanceTimersByTime(66);
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LDP_READY', requestId: 5, navigationId, url: `${window.location.origin}/t/topic/902` }),
      window.location.origin,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes media observers, listeners and boot callbacks on pagehide', async () => {
    await startEnhancer();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    parentWindow.postMessage.mockClear();
    const media = addPlayingVideo();
    const player = addExternalFrame();
    media.play();
    await Promise.resolve();
    vi.advanceTimersByTime(5000);
    expect(media.pause).not.toHaveBeenCalled();
    expect(player.src).toBe('https://player.example/embed/123');
    expect(parentWindow.postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
