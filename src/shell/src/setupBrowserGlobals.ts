/**
 * pdfjs-dist (react-pdf) expects Node's `process` global in some code paths.
 * Vite does not provide it in the browser by default.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — no types for process/browser
import processBrowser from 'process/browser';

const shim = processBrowser as {
  env: Record<string, string | undefined>;
};

if (!shim.env) {
  shim.env = {};
}
shim.env.MODE = import.meta.env.MODE;
shim.env.DEV = import.meta.env.DEV ? 'true' : 'false';
shim.env.PROD = import.meta.env.PROD ? 'true' : 'false';

const g = globalThis as typeof globalThis & { process?: typeof shim };
if (g.process === undefined) {
  g.process = shim;
}
