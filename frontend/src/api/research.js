// This module preserves the exact function names/shapes the UI already
// calls (destinationsApi.list(), researchItemsApi.create(), etc.) from
// Phase 1 — only the internals changed, from "issue an HTTP request to
// Express" to "run a query against the local PGlite database directly."
// This is the data-access abstraction seam the approved local-first
// architecture explicitly asked to preserve, both for UI continuity now
// and to leave a clean seam for any future sync work.
import * as destinationQueries from '../db/queries/destinations';
import * as itemQueries from '../db/queries/researchItems';

export const destinationsApi = {
  list: async () => ({ destinations: await destinationQueries.listDestinations() }),
  recentlyUpdated: async (limit = 8) => ({ items: await destinationQueries.recentlyUpdatedItems(limit) }),
  search: async (q) => ({ results: await destinationQueries.searchResearch(q) }),
  get: async (id) => destinationQueries.getDestination(id),
  create: async (data) => ({ destination: await destinationQueries.createDestination(data) }),
  update: async (id, data) => ({ destination: await destinationQueries.updateDestination(id, data) }),
  remove: async (id) => { await destinationQueries.deleteDestination(id); return { success: true }; },
};

export const sectionsApi = {
  create: async (data) => ({ section: await destinationQueries.createSection(data) }),
  update: async (id, data) => ({ section: await destinationQueries.updateSection(id, data) }),
  remove: async (id) => { await destinationQueries.deleteSection(id); return { success: true }; },
};

export const researchItemsApi = {
  get: async (id) => ({ item: await itemQueries.getResearchItem(id) }),
  create: async (data) => ({ item: await itemQueries.createResearchItem(data) }),
  update: async (id, data) => ({ item: await itemQueries.updateResearchItem(id, data) }),
  remove: async (id) => { await itemQueries.deleteResearchItem(id); return { success: true }; },
  addTag: async (id, label) => ({ tag: await itemQueries.addTag(id, label) }),
  removeTag: async (id, tagId) => { await itemQueries.removeTag(id, tagId); return { success: true }; },
  addSource: async (id, data) => ({ source: await itemQueries.addSource(id, data) }),
  removeSource: async (itemId, sourceId) => { await itemQueries.removeSource(itemId, sourceId); return { success: true }; },
  addRelation: async (id, relatedItemId) => { await itemQueries.addRelation(id, relatedItemId); return { success: true }; },
  removeRelation: async (id, relatedItemId) => { await itemQueries.removeRelation(id, relatedItemId); return { success: true }; },
};

export const tagsApi = {
  list: async () => ({ tags: await itemQueries.listTags() }),
};
