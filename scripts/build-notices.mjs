import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const directories = execFileSync(
  "npm",
  ["ls", "--omit=dev", "--all", "--parseable"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .slice(1);
const sections = [
  "FRC Driver Lab: third-party runtime software notices\nExact versions are locked in package-lock.json. Original procedural visual assets are authored for this project.",
];
for (const directory of [...new Set(directories)].sort()) {
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const licenses = readdirSync(directory).filter((name) =>
    /^(license|licence|copying|copyright)(\.|$)/i.test(name),
  );
  const fallback = {
    "@dimforge/rapier3d-compat@0.19.3": "scripts/licenses/rapier-0.19.3.txt",
    "@pdf-lib/fontkit@1.1.1": "scripts/licenses/fontkit-1.1.1.txt",
  }[`${pkg.name}@${pkg.version}`];
  if (!licenses.length && !fallback)
    throw new Error(`Missing upstream license for ${pkg.name}`);
  const licenseText = licenses.length
    ? licenses
        .map((name) => readFileSync(join(directory, name), "utf8"))
        .join("\n\n")
    : readFileSync(fallback, "utf8");
  sections.push(
    `${pkg.name} ${pkg.version}\nDeclared license: ${pkg.license}\n\n${licenseText}`,
  );
  if (pkg.name === "@pdf-lib/fontkit") {
    const source = readFileSync(join(directory, "dist/fontkit.es.js"), "utf8");
    const comments = source.match(/\/\*[\s\S]*?\*\//g) ?? [];
    const notices = [...new Set(comments.filter((c) => /copyright/i.test(c)))];
    const nodeNotice = source.match(
      /\/\/ Copyright Joyent[\s\S]*?\/\/ SOFTWARE\./,
    );
    sections.push(
      "Notices retained from the prebundled fontkit sources\n\n" +
        [...notices, nodeNotice?.[0] ?? ""].join("\n\n"),
    );
  }
}
writeFileSync(
  "public/THIRD_PARTY_NOTICES.txt",
  sections
    .join("\n\n" + "=".repeat(72) + "\n\n")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd() + "\n",
);
