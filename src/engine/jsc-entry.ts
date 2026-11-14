// Entry point of the single-file bundle (macos/Resources/engine.js) that native shells load into a
// plain JavaScript context. Built by scripts/build-engine-bundle.mjs.
import { createHost } from './host';

(globalThis as unknown as { Voka: unknown }).Voka = createHost();
