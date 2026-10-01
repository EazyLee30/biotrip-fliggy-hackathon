import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";

/**
 * Loads a TypeScript module for tests without a bundler.
 *
 * `node --test` runs in strip-only mode, which cannot handle parameter
 * properties, extensionless imports or the `@/` alias, so modules are compiled
 * with the TypeScript compiler and evaluated in a fresh context with an
 * explicit dependency map. Tests therefore inject real collaborators — an
 * in-memory database, a real sibling module — instead of stubbing behaviour out.
 */
const nativeRequire = createRequire(import.meta.url);

export function loadModule(name, dependencies = {}, extra = {}) {
  const source = readFileSync(new URL(name, sourceRoot), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require: (dependency) => dependencies[dependency] ?? nativeRequire(dependency),
    crypto: webcrypto,
    Buffer, URL, Intl, TextDecoder, TextEncoder,
    AbortController, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval,
    process: { env: { AUTH_SECRET: "local-test-pepper-with-more-than-thirty-two-characters" } },
    ...extra,
  });
  return exports;
}

/**
 * Re-homes a value loaded in a vm context so `assert/strict` prototype checks
 * succeed. Only used for structural comparisons in tests.
 */
export function plain(value) {
  return value === null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value));
}

/** Repository root, so fixtures can address project files without guessing. */
export const projectRoot = new URL("../../../", import.meta.url);
const sourceRoot = new URL("src/", projectRoot);

/** Reads a project file by repo-relative path, e.g. `migrations/0001_accounts.sql`. */
export function readProjectFile(relativePath) {
  return readFileSync(new URL(relativePath, projectRoot), "utf8");
}
