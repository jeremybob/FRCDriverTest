import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}
const sourceHash = createHash("sha256");
for (const path of [
  ...files("src"),
  ...files("content"),
  "package-lock.json",
  "vite.config.ts",
].sort())
  sourceHash.update(path).update(readFileSync(path));
const buildId = `frc-driver-lab-1.0.0-${sourceHash.digest("hex").slice(0, 12)}`;
export default defineConfig({
  plugins: [react()],
  define: { "import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId) },
  test: { include: ["tests/**/*.test.ts"] },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          physics: ["@dimforge/rapier3d-compat"],
          three: ["three"],
          reports: ["pdf-lib", "@pdf-lib/fontkit"],
        },
      },
    },
  },
});
