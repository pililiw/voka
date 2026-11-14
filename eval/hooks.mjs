// Node loader hook: resolves the extensionless relative imports in the transpiled TypeScript (`./ranker`
// -> `./ranker.js`), so the engine and the evaluation scripts run on plain Node without a bundler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(spec, ctx, next) {
  if ((spec.startsWith('.') || spec.startsWith('/')) && !path.extname(spec) && ctx.parentURL) {
    const p = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec) + '.js';
    if (fs.existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true };
  }
  return next(spec, ctx);
}
