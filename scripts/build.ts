import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { createManifest, type BrowserTarget } from './manifest.ts';

const ROOT_DIR = process.cwd();
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const PUBLIC_ICONS_DIR = path.resolve(ROOT_DIR, 'public/icons');

interface PackageJson {
  version: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(ROOT_DIR, 'package.json'), 'utf8'),
) as PackageJson;

async function buildBundle(target: BrowserTarget): Promise<void> {
  const outDir = path.resolve(DIST_DIR, target);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n[build] Building ${target} extension into ${outDir}...`);

  // 1. Build popup HTML + assets
  await build({
    configFile: false,
    root: path.resolve(ROOT_DIR, 'src/popup'),
    base: './',
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: false,
      rollupOptions: {
        input: path.resolve(ROOT_DIR, 'src/popup/popup.html'),
      },
    },
  });

  // 2. Build top-frame content script as self-contained IIFE
  await build({
    configFile: false,
    root: ROOT_DIR,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: path.resolve(ROOT_DIR, 'src/content/index.ts'),
        name: 'LinuxDoPreviewContent',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: {
          extend: true,
        },
      },
    },
  });

  // 3. Build iframe enhancer script as self-contained IIFE
  await build({
    configFile: false,
    root: ROOT_DIR,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: path.resolve(ROOT_DIR, 'src/content/iframe-enhancer.ts'),
        name: 'LinuxDoPreviewIframeEnhancer',
        formats: ['iife'],
        fileName: () => 'iframe-enhancer.js',
      },
      rollupOptions: {
        output: {
          extend: true,
        },
      },
    },
  });

  // 4. Build background script as self-contained ES module
  await build({
    configFile: false,
    root: ROOT_DIR,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: path.resolve(ROOT_DIR, 'src/background/index.ts'),
        formats: ['es'],
        fileName: () => 'background.js',
      },
    },
  });

  // 5. Copy icons
  const targetIconsDir = path.resolve(outDir, 'icons');
  fs.mkdirSync(targetIconsDir, { recursive: true });
  for (const file of fs.readdirSync(PUBLIC_ICONS_DIR)) {
    if (file.endsWith('.png') || file.endsWith('.svg')) {
      fs.copyFileSync(
        path.resolve(PUBLIC_ICONS_DIR, file),
        path.resolve(targetIconsDir, file),
      );
    }
  }

  // 6. Write target-specific manifest.json
  const manifest = createManifest(target, pkg.version);
  fs.writeFileSync(
    path.resolve(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  // 7. Verify all files referenced in manifest exist
  const requiredFiles = [
    'manifest.json',
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((cs) => cs.js),
    'service_worker' in manifest.background
      ? manifest.background.service_worker
      : manifest.background.scripts[0],
  ];

  for (const relPath of requiredFiles) {
    const absPath = path.resolve(outDir, relPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`[build] Missing expected artifact for ${target}: ${relPath}`);
    }
  }

  console.log(`[build] ${target} build verified (${requiredFiles.length} referenced assets).`);
}

const arg = (process.argv[2] ?? 'all').toLowerCase();
const targets: BrowserTarget[] =
  arg === 'chromium'
    ? ['chromium']
    : arg === 'firefox'
      ? ['firefox']
      : ['chromium', 'firefox'];

for (const target of targets) {
  await buildBundle(target);
}
