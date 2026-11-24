/**
 * Cross-browser WebExtension API accessor (Chrome, Edge, Firefox MV3).
 * Prefers standard `browser` namespace when present (Firefox) and falls back to `chrome`.
 */

type BrowserNamespace = typeof chrome;

function getApi(): BrowserNamespace {
  const globalObj = globalThis as unknown as {
    browser?: BrowserNamespace;
    chrome?: BrowserNamespace;
  };
  const api = globalObj.browser ?? globalObj.chrome;
  if (!api) {
    throw new Error('[linux-do-preview] WebExtension API is not available.');
  }
  return api;
}

export const extApi = {
  get raw(): BrowserNamespace {
    return getApi();
  },

  storageLocalGet<T extends Record<string, unknown>>(
    keys: string | string[],
  ): Promise<T> {
    return getApi().storage.local.get(keys) as Promise<T>;
  },

  storageLocalSet(items: Record<string, unknown>): Promise<void> {
    return getApi().storage.local.set(items);
  },

  storageLocalRemove(keys: string | string[]): Promise<void> {
    return getApi().storage.local.remove(keys);
  },

  permissionsRequest(origins: string[]): Promise<boolean> {
    return getApi().permissions.request({ origins });
  },

  permissionsContains(origins: string[]): Promise<boolean> {
    return getApi().permissions.contains({ origins });
  },

  permissionsRemove(origins: string[]): Promise<boolean> {
    return getApi().permissions.remove({ origins });
  },

  async sendMessage<TResponse = unknown>(message: unknown): Promise<TResponse | undefined> {
    try {
      return (await getApi().runtime.sendMessage(message)) as TResponse;
    } catch {
      return undefined;
    }
  },
};
