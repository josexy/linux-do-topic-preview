import { extApi } from './browser-api';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type ExtensionSettings,
  type WindowGeometry,
} from './types';

function mergeSettings(raw: unknown): ExtensionSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS, customDomains: [] };
  }
  const obj = raw as Partial<ExtensionSettings>;
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_SETTINGS.enabled,
    linuxDoEnabled:
      typeof obj.linuxDoEnabled === 'boolean'
        ? obj.linuxDoEnabled
        : DEFAULT_SETTINGS.linuxDoEnabled,
    hideIframeHeader:
      typeof obj.hideIframeHeader === 'boolean'
        ? obj.hideIframeHeader
        : DEFAULT_SETTINGS.hideIframeHeader,
    closeOnBackdropClick:
      typeof obj.closeOnBackdropClick === 'boolean'
        ? obj.closeOnBackdropClick
        : DEFAULT_SETTINGS.closeOnBackdropClick,
    customDomains: Array.isArray(obj.customDomains)
      ? obj.customDomains.filter((d): d is string => typeof d === 'string')
      : [],
  };
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await extApi.storageLocalGet<Record<string, unknown>>(
    STORAGE_KEYS.SETTINGS,
  );
  return mergeSettings(result[STORAGE_KEYS.SETTINGS]);
}

export async function saveSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = {
    ...current,
    ...patch,
    customDomains: patch.customDomains
      ? Array.from(new Set(patch.customDomains))
      : current.customDomains,
  };
  await extApi.storageLocalSet({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

export async function getWindowGeometry(): Promise<WindowGeometry | null> {
  const result = await extApi.storageLocalGet<Record<string, unknown>>(
    STORAGE_KEYS.GEOMETRY,
  );
  const raw = result[STORAGE_KEYS.GEOMETRY];
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const geo = raw as Partial<WindowGeometry>;
  if (typeof geo.width !== 'number' || typeof geo.height !== 'number') {
    return null;
  }
  return {
    width: geo.width,
    height: geo.height,
    x: typeof geo.x === 'number' ? geo.x : null,
    y: typeof geo.y === 'number' ? geo.y : null,
  };
}

export async function saveWindowGeometry(
  geometry: WindowGeometry | null,
): Promise<void> {
  if (geometry === null) {
    await extApi.storageLocalRemove(STORAGE_KEYS.GEOMETRY);
    return;
  }
  await extApi.storageLocalSet({ [STORAGE_KEYS.GEOMETRY]: geometry });
}

export function subscribeSettings(
  callback: (settings: ExtensionSettings) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return;
    if (STORAGE_KEYS.SETTINGS in changes) {
      callback(mergeSettings(changes[STORAGE_KEYS.SETTINGS].newValue));
    }
  };
  extApi.raw.storage.onChanged.addListener(listener);
  return () => {
    extApi.raw.storage.onChanged.removeListener(listener);
  };
}

export function subscribeWindowGeometry(
  callback: (geometry: WindowGeometry | null) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return;
    if (!(STORAGE_KEYS.GEOMETRY in changes)) return;

    const raw = changes[STORAGE_KEYS.GEOMETRY].newValue;
    if (!raw || typeof raw !== 'object') {
      callback(null);
      return;
    }
    const geo = raw as Partial<WindowGeometry>;
    if (typeof geo.width !== 'number' || typeof geo.height !== 'number') {
      callback(null);
      return;
    }
    callback({
      width: geo.width,
      height: geo.height,
      x: typeof geo.x === 'number' ? geo.x : null,
      y: typeof geo.y === 'number' ? geo.y : null,
    });
  };
  extApi.raw.storage.onChanged.addListener(listener);
  return () => {
    extApi.raw.storage.onChanged.removeListener(listener);
  };
}
