import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mission = "हम JODLO इसलिए बना रहे हैं ताकि यह Finworkar ऐप से बेहतर हो।\n";
const ignore = new Set([".git", "node_modules", ".gradle", ".wrangler", "build", "dist", "out"]);
async function findWrittenNotes(path) {
  const found = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (ignore.has(item.name)) continue;
    const absolute = join(path, item.name);
    if (item.isDirectory()) found.push(...await findWrittenNotes(absolute));
    else if (item.isFile() && /\.(?:md|mdx|txt)$/i.test(item.name))
      found.push(relative(root, absolute).replaceAll("\\", "/"));
  }
  return found;
}
const markdown = (await findWrittenNotes(root)).sort();
assert.deepEqual(markdown, ["README.md"], "Obsolete JODLO notes/instructions must not be restored");
assert.equal(await readFile(join(root, "README.md"), "utf8"), mission,
  "Only the founder's exact JODLO mission belongs in project documentation");
process.stdout.write("JODLO mission-only written notes verified.\n");
