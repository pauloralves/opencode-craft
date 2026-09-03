import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8")
);
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/npm-publish.yml"),
  "utf8"
);

test("publish: workflow pins Node 24 (npm 11+) for trusted publishing", () => {
  // npm trusted publishing (OIDC) requires npm v11+, bundled with Node 24.
  // Node 22 ships npm v10 which silently fails the OIDC handshake.
  assert.match(workflow, /node-version:\s*'24'/);
  assert.match(workflow, /registry-url:\s*'https:\/\/registry\.npmjs\.org'/);
});

test("publish: package.json declares public access for npm publishing", () => {
  assert.strictEqual(pkg.publishConfig?.access, "public");
  assert.strictEqual(pkg.name, "opencode-craft");
});

test("publish: declared engines range must not exclude the CI-pinned Node 24", () => {
  // Guard against a stale/accidental engines bump that would let CI publish
  // on a version the package claims not to support (or vice versa).
  const range = pkg.engines?.node;
  assert.ok(typeof range === "string" && range.length > 0, "engines.node is set");
  const floor = Number.parseInt(range.match(/>=(\d+)/)?.[1] ?? "", 10);
  assert.ok(Number.isInteger(floor), `engines.node "${range}" has a >= floor`);
  assert.ok(floor <= 24, `engines floor (${floor}) does not exclude Node 24`);
});