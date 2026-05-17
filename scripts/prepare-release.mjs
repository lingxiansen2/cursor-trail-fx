import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = join(root, "release");
const previousDir = join(root, "release-previous");

const releaseFiles = [
  "Cursor Trail FX Setup.exe",
  "Cursor Trail FX Setup.exe.blockmap",
  "Cursor Trail FX-portable.exe"
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function snapshotPreviousRelease() {
  const hasCurrentRelease = await exists(join(releaseDir, releaseFiles[0]));
  if (!hasCurrentRelease) {
    return;
  }

  await rm(previousDir, { recursive: true, force: true });
  await mkdir(previousDir, { recursive: true });

  for (const file of releaseFiles) {
    const source = join(releaseDir, file);
    if (await exists(source)) {
      await cp(source, join(previousDir, file));
    }
  }
}

async function removeExtraReleaseDirs() {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const name = entry.name;
    if (!name.startsWith("release") || name === "release" || name === "release-previous") {
      continue;
    }

    const target = resolve(root, name);
    if (!target.startsWith(root + "\\")) {
      throw new Error(`Refusing to remove unexpected path: ${target}`);
    }
    await rm(target, { recursive: true, force: true });
  }
}

await snapshotPreviousRelease();
await removeExtraReleaseDirs();
