import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

test("the browser never imports the AWS S3 SDK", () => {
  const files = [
    path.join("src", "lib", "browser-upload.ts"),
    ...walk(path.join("src", "components")),
  ];
  assert.ok(files.length > 1);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(
      /from\s+["']@aws-sdk(?:\/[^"']+)?["']/.test(source),
      false,
      `${file} imports @aws-sdk`,
    );
    assert.equal(
      /from\s+["']@\/lib\/r2["']/.test(source),
      false,
      `${file} imports server R2 client`,
    );
  }
});

test("the upload token route does not statically import R2 or jobs", () => {
  const source = readFileSync(path.join("src", "app", "api", "upload", "token", "route.ts"), "utf8");
  assert.equal(/from\s+["']@\/lib\/r2["']/.test(source), false, "static @/lib/r2 import");
  assert.equal(/from\s+["']@\/lib\/authz["']/.test(source), false, "static @/lib/authz import");
  assert.equal(/from\s+["']@\/lib\/jobs["']/.test(source), false, "static @/lib/jobs import");
  assert.equal(/from\s+["']@aws-sdk/.test(source), false, "static @aws-sdk import");
});
