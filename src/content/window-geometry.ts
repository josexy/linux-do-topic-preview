import type { ResizeDirection, WindowGeometry } from '../shared/types';

export const MIN_WIDTH = 420;
export const MIN_HEIGHT = 320;
export const VIEWPORT_MARGIN = 12;
export const MIN_VISIBLE_TITLEBAR_X = 140;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

export function getMaxBounds(viewport: ViewportSize): {
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
} {
  const maxWidth = Math.max(280, viewport.width - VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(240, viewport.height - VIEWPORT_MARGIN * 2);
  return {
    maxWidth,
    maxHeight,
    minWidth: Math.min(MIN_WIDTH, maxWidth),
    minHeight: Math.min(MIN_HEIGHT, maxHeight),
  };
}

export function getDefaultRect(viewport: ViewportSize): WindowRect {
  const { maxWidth, maxHeight, minWidth, minHeight } = getMaxBounds(viewport);
  const width = clamp(Math.round(viewport.width * 0.8), minWidth, Math.min(1080, maxWidth));
  const height = clamp(Math.round(viewport.height * 0.84), minHeight, Math.min(820, maxHeight));
  const x = Math.round((viewport.width - width) / 2);
  const y = Math.round((viewport.height - height) / 2);
  return { x, y, width, height };
}

export function clampRect(rect: WindowRect, viewport: ViewportSize): WindowRect {
  const { maxWidth, maxHeight, minWidth, minHeight } = getMaxBounds(viewport);
  const width = Math.round(clamp(rect.width, minWidth, maxWidth));
  const height = Math.round(clamp(rect.height, minHeight, maxHeight));

  const maxX = Math.max(VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, viewport.height - height - VIEWPORT_MARGIN);

  const x = Math.round(clamp(rect.x, VIEWPORT_MARGIN, maxX));
  const y = Math.round(clamp(rect.y, VIEWPORT_MARGIN, maxY));

  return { x, y, width, height };
}

export function resolveInitialRect(
  saved: WindowGeometry | null,
  viewport: ViewportSize,
): WindowRect {
  const fallback = getDefaultRect(viewport);
  if (!saved) {
    return fallback;
  }

  const { maxWidth, maxHeight, minWidth, minHeight } = getMaxBounds(viewport);
  const width = Math.round(clamp(saved.width, minWidth, maxWidth));
  const height = Math.round(clamp(saved.height, minHeight, maxHeight));
  const x = saved.x ?? Math.round((viewport.width - width) / 2);
  const y = saved.y ?? Math.round((viewport.height - height) / 2);

  return clampRect({ x, y, width, height }, viewport);
}

export function computeDraggedRect(
  start: WindowRect,
  dx: number,
  dy: number,
  viewport: ViewportSize,
): WindowRect {
  const minX = -start.width + Math.min(MIN_VISIBLE_TITLEBAR_X, start.width);
  const maxX = viewport.width - Math.min(MIN_VISIBLE_TITLEBAR_X, start.width);
  const minY = VIEWPORT_MARGIN;
  const maxY = Math.max(VIEWPORT_MARGIN, viewport.height - 56);

  return {
    x: Math.round(clamp(start.x + dx, minX, maxX)),
    y: Math.round(clamp(start.y + dy, minY, maxY)),
    width: start.width,
    height: start.height,
  };
}

export function computeResizedRect(
  start: WindowRect,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  viewport: ViewportSize,
): WindowRect {
  const { minWidth, minHeight } = getMaxBounds(viewport);
  const startRight = start.x + start.width;
  const startBottom = start.y + start.height;

  let left = start.x;
  let right = startRight;
  let top = start.y;
  let bottom = startBottom;

  if (direction.includes('e')) {
    right = clamp(
      startRight + dx,
      left + minWidth,
      viewport.width - VIEWPORT_MARGIN,
    );
  }

  if (direction.includes('w')) {
    left = clamp(
      start.x + dx,
      VIEWPORT_MARGIN,
      right - minWidth,
    );
  }

  if (direction.includes('s')) {
    bottom = clamp(
      startBottom + dy,
      top + minHeight,
      viewport.height - VIEWPORT_MARGIN,
    );
  }

  if (direction.includes('n')) {
    top = clamp(
      start.y + dy,
      VIEWPORT_MARGIN,
      bottom - minHeight,
    );
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

export function toWindowGeometry(rect: WindowRect): WindowGeometry {
  return {
    width: rect.width,
    height: rect.height,
    x: rect.x,
    y: rect.y,
  };
}
