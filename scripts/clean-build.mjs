import { mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(root, "dist");
const rendererDir = join(distDir, "renderer");

async function ensureDistRoot() {
  await mkdir(distDir, { recursive: true });
}

async function cleanRendererOutput() {
  await rm(rendererDir, { recursive: true, force: true });
}

async function removeLooseDistArtifacts() {
  const entries = await readdir(distDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const lower = entry.name.toLowerCase();
    if (!lower.endsWith(".exe") && !lower.endsWith(".blockmap")) {
      continue;
    }

    try {
      await rm(join(distDir, entry.name), { force: true });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "EBUSY" || error.code === "EPERM")
      ) {
        continue;
      }
      throw error;
    }
  }
}

await ensureDistRoot();
await cleanRendererOutput();
await removeLooseDistArtifacts();
