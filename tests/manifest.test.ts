import { describe, expect, it } from 'vitest';
import { createManifest } from '../scripts/manifest';

describe('cross-browser manifest generation', () => {
  it('generates valid Chromium MV3 manifest with service_worker', () => {
    const manifest = createManifest('chromium', '1.0.0');
    expect(manifest.manifest_version).toBe(3);
    expect('service_worker' in manifest.background).toBe(true);
    if ('service_worker' in manifest.background) {
      expect(manifest.background.service_worker).toBe('background.js');
    }
    expect(manifest.browser_specific_settings).toBeUndefined();
    expect(manifest.host_permissions).toEqual(['https://linux.do/*']);
    expect(manifest.optional_host_permissions).toEqual([
      'https://*/*',
      'http://*/*',
    ]);
    expect(manifest.content_scripts).toHaveLength(2);
    expect(manifest.content_scripts[0].all_frames).toBe(false);
    expect(manifest.content_scripts[1].all_frames).toBe(true);
  });

  it('generates valid Firefox MV3 manifest with background.scripts and gecko settings', () => {
    const manifest = createManifest('firefox', '1.0.0');
    expect(manifest.manifest_version).toBe(3);
    expect('scripts' in manifest.background).toBe(true);
    if ('scripts' in manifest.background) {
      expect(manifest.background.scripts).toEqual(['background.js']);
    }
    expect(manifest.browser_specific_settings?.gecko.id).toBeTruthy();
    expect(manifest.browser_specific_settings?.gecko.strict_min_version).toBe(
      '128.0',
    );
  });
});
