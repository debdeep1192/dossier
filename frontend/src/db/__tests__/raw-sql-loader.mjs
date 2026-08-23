// Minimal Node ESM loader hook, used only by the test runner (see
// package.json's "test" script). Its one job: let plain Node understand
// the `import x from './schema.sql?raw'` syntax that db/index.js uses,
// which is Vite-specific syntax the browser build already handles
// natively. This exists so the test suite can import the REAL db/index.js
// unmodified — the same file the browser build uses — rather than
// maintaining a second, parallel copy of it just for tests (which would
// risk the test suite silently drifting from what actually ships).
// Deliberately narrow: it only intercepts the exact `?raw` suffix
// pattern, not a general asset-loading system.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function load(url, context, nextLoad) {
  if (url.endsWith('?raw')) {
    const filePath = fileURLToPath(url.slice(0, -4));
    const source = await readFile(filePath, 'utf-8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};`,
    };
  }
  return nextLoad(url, context);
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('?raw')) {
    const resolved = await nextResolve(specifier.slice(0, -4), context);
    return { ...resolved, url: resolved.url + '?raw', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
