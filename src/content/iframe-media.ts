function isExternalFrame(frame: HTMLIFrameElement): boolean {
  const src = frame.getAttribute('src');
  if (!src) return false;
  try {
    const url = new URL(src, window.location.href);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

export function hasEmbeddedExternalIframe(): boolean {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src]'))
    .some(isExternalFrame);
}

/** Pause hidden media without discarding the preloaded Discourse document. */
export function createPreviewMediaController(initiallyActive: boolean, signal: AbortSignal) {
  let active = initiallyActive;
  const suspendedSources = new Map<HTMLIFrameElement, string>();

  const restoreFrame = (frame: HTMLIFrameElement, src: string) => {
    // Do not overwrite a source changed by the site before the observer ran.
    if (frame.getAttribute('src') === 'about:blank') frame.setAttribute('src', src);
    suspendedSources.delete(frame);
  };

  const suspendFrame = (frame: HTMLIFrameElement) => {
    if (!isExternalFrame(frame)) return;
    suspendedSources.set(frame, frame.getAttribute('src')!);
    frame.src = 'about:blank';
  };

  const suspendFramesIn = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLIFrameElement) suspendFrame(node);
    node.querySelectorAll<HTMLIFrameElement>('iframe[src]').forEach(suspendFrame);
  };

  // Observe only while inactive, and inspect changed subtrees rather than the whole page.
  const frameObserver = new MutationObserver((records) => {
    if (active || signal.aborted) return;
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLIFrameElement) {
        suspendFrame(record.target);
      } else {
        record.addedNodes.forEach(suspendFramesIn);
      }
    }
    if (records.some((record) => record.removedNodes.length > 0)) {
      for (const [frame, src] of suspendedSources) {
        // Release removed nodes, restoring their source in case the site reuses them.
        if (!frame.isConnected) restoreFrame(frame, src);
      }
    }
  });

  const pause = (media: HTMLMediaElement) => {
    try {
      if (!media.paused) media.pause();
    } catch {
      // The media may have been removed while its play event was queued.
    }
  };

  // play does not bubble; capture also catches media inserted after READY.
  document.addEventListener('play', (event) => {
    if (!active && event.target instanceof HTMLMediaElement) pause(event.target);
  }, { capture: true, signal });

  const suspend = () => {
    document.querySelectorAll<HTMLMediaElement>('video, audio').forEach(pause);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    frameObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    suspendFramesIn(document.documentElement);
  };

  if (!active) suspend();
  signal.addEventListener('abort', () => {
    frameObserver.disconnect();
    suspendedSources.clear();
  }, { once: true });

  return {
    setActive(nextActive: boolean): void {
      if (signal.aborted || active === nextActive) return;
      active = nextActive;
      if (!active) {
        suspend();
        return;
      }

      frameObserver.disconnect();
      for (const [frame, src] of suspendedSources) restoreFrame(frame, src);
    },
  };
}
