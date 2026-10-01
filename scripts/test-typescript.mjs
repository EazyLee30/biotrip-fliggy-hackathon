import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";

// Production bundlers resolve extensionless TypeScript imports; Node's test
// runner needs that resolution plus transformation of parameter properties.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (specifier.startsWith(".") && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), {
        mode: "transform", sourceMap: false, sourceUrl: url,
      }) };
    }
    return next(url, context);
  },
});
