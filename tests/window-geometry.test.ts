import { describe, expect, it } from 'vitest';
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  VIEWPORT_MARGIN,
  clampRect,
  computeDraggedRect,
  computeResizedRect,
  getDefaultRect,
  resolveInitialRect,
  type WindowRect,
} from '../src/content/window-geometry';

const VIEWPORT = { width: 1440, height: 900 };

describe('window geometry calculations', () => {
  it('produces a centered default rect within reasonable bounds', () => {
    const rect = getDefaultRect(VIEWPORT);
    expect(rect.width).toBe(1080);
    expect(rect.height).toBe(756);
    expect(rect.x).toBe(180);
    expect(rect.y).toBe(72);
  });

  it('restores saved geometry and clamps to smaller viewports', () => {
    const restored = resolveInitialRect(
      { width: 920, height: 640, x: 100, y: 80 },
      VIEWPORT,
    );
    expect(restored).toEqual({ width: 920, height: 640, x: 100, y: 80 });

    const shrunk = resolveInitialRect(
      { width: 1200, height: 900, x: 400, y: 300 },
      { width: 800, height: 600 },
    );
    expect(shrunk.width).toBe(800 - VIEWPORT_MARGIN * 2);
    expect(shrunk.height).toBe(600 - VIEWPORT_MARGIN * 2);
    expect(shrunk.x).toBe(VIEWPORT_MARGIN);
    expect(shrunk.y).toBe(VIEWPORT_MARGIN);
  });

  it('resizes from east and south edges cleanly while enforcing min bounds', () => {
    const start: WindowRect = { x: 200, y: 120, width: 600, height: 500 };

    const enlarged = computeResizedRect(start, 'se', 150, 100, VIEWPORT);
    expect(enlarged).toEqual({ x: 200, y: 120, width: 750, height: 600 });

    const shrunk = computeResizedRect(start, 'se', -400, -400, VIEWPORT);
    expect(shrunk).toEqual({
      x: 200,
      y: 120,
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
    });
  });

  it('anchors opposite right/bottom edges when resizing from west/north without drift', () => {
    const start: WindowRect = { x: 300, y: 200, width: 600, height: 500 };
    const startRight = start.x + start.width;
    const startBottom = start.y + start.height;

    // Expand north-west
    const expanded = computeResizedRect(start, 'nw', -80, -60, VIEWPORT);
    expect(expanded.x + expanded.width).toBe(startRight);
    expect(expanded.y + expanded.height).toBe(startBottom);
    expect(expanded.width).toBe(680);
    expect(expanded.height).toBe(560);

    // Over-shrink past minimum size should not push the right/bottom anchor
    const clamped = computeResizedRect(start, 'nw', 500, 500, VIEWPORT);
    expect(clamped.x + clamped.width).toBe(startRight);
    expect(clamped.y + clamped.height).toBe(startBottom);
    expect(clamped.width).toBe(MIN_WIDTH);
    expect(clamped.height).toBe(MIN_HEIGHT);
  });

  it('keeps dragged window titlebar reachable within the viewport', () => {
    const start: WindowRect = { x: 200, y: 100, width: 600, height: 500 };

    const pushedUp = computeDraggedRect(start, 0, -500, VIEWPORT);
    expect(pushedUp.y).toBe(VIEWPORT_MARGIN);

    const pushedRight = computeDraggedRect(start, 2000, 0, VIEWPORT);
    expect(pushedRight.x).toBeLessThan(VIEWPORT.width);

    const clamped = clampRect({ x: -100, y: -50, width: 600, height: 500 }, VIEWPORT);
    expect(clamped.x).toBe(VIEWPORT_MARGIN);
    expect(clamped.y).toBe(VIEWPORT_MARGIN);
  });
});
