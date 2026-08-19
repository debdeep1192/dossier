import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';

// This file runs inside a dedicated Web Worker, not the main UI thread.
// Running PGlite here (rather than on the main thread) keeps heavy queries
// from ever blocking the UI — this matters especially on a phone.
//
// 'idb://dossier-data' persists the database to the browser's IndexedDB,
// which is what makes data survive page reloads, app restarts, and closing
// the browser entirely. This is the local-first "primary source of truth"
// storage the approved architecture calls for.
worker({
  async init() {
    return new PGlite('idb://dossier-data');
  },
});
