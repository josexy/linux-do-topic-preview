import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT_DIR = process.cwd();
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const RELEASE_DIR = path.resolve(ROOT_DIR, 'release');

interface PackageJson {
  name: string;
  version: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(ROOT_DIR, 'package.json'), 'utf8'),
) as PackageJson;

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function collectFiles(dir: string, baseDir = dir): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(abs, baseDir));
    } else if (entry.isFile()) {
      files.push(path.relative(baseDir, abs));
    }
  }
  return files.sort();
}

/**
 * Pure Node.js ZIP builder using Deflate compression and POSIX forward-slash entry paths
 * (required by Chrome Web Store, Edge Add-ons, and Firefox AMO).
 */
function createZipFromDirectory(sourceDir: string, outZipPath: string): number {
  const relFiles = collectFiles(sourceDir);
  if (relFiles.length === 0) {
    throw new Error(`[package] No files found in ${sourceDir}`);
  }

  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const rel of relFiles) {
    const absPath = path.join(sourceDir, rel);
    const entryName = rel.split(path.sep).join('/');
    const nameBuf = Buffer.from(entryName, 'utf8');
    const rawData = fs.readFileSync(absPath);
    const stat = fs.statSync(absPath);
    const { dosTime, dosDate } = toDosTimeDate(stat.mtime);

    const compressed = zlib.deflateRawSync(rawData, { level: 9 });
    const useDeflate = compressed.length < rawData.length;
    const payload = useDeflate ? compressed : rawData;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(rawData);

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localChunks.push(localHeader, nameBuf, payload);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 filename flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralChunks);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(relFiles.length, 8);
  eocd.writeUInt16LE(relFiles.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const archive = Buffer.concat([...localChunks, centralDir, eocd]);
  fs.mkdirSync(path.dirname(outZipPath), { recursive: true });
  fs.writeFileSync(outZipPath, archive);
  return archive.length;
}

fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
fs.mkdirSync(RELEASE_DIR, { recursive: true });

for (const target of ['chromium', 'firefox'] as const) {
  const srcDir = path.resolve(DIST_DIR, target);
  if (!fs.existsSync(path.join(srcDir, 'manifest.json'))) {
    throw new Error(
      `[package] Missing build output for ${target}. Run "pnpm run build" first.`,
    );
  }
  const zipName = `${pkg.name}-${target}-v${pkg.version}.zip`;
  const zipPath = path.resolve(RELEASE_DIR, zipName);
  const sizeBytes = createZipFromDirectory(srcDir, zipPath);
  console.log(
    `[package] Created ${path.relative(ROOT_DIR, zipPath)} (${(sizeBytes / 1024).toFixed(1)} KB)`,
  );
}
