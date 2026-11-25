import { PREVIEW_IFRAME_NAME } from './types';

export const PREVIEW_ACTIVE_ATTRIBUTE = 'data-ldp-active';

export type PreviewFrameMessage<T> = T & { navigationId: number };

export function createPreviewFrameName(navigationId: number): string {
  return `${PREVIEW_IFRAME_NAME}:${navigationId}`;
}

export function getPreviewNavigationId(name: string): number | null {
  const prefix = `${PREVIEW_IFRAME_NAME}:`;
  if (!name.startsWith(prefix)) return null;
  const value = name.slice(prefix.length);
  if (!/^\d+$/.test(value)) return null;
  const navigationId = Number(value);
  return Number.isSafeInteger(navigationId) && navigationId > 0 ? navigationId : null;
}
