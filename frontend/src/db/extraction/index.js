// ============================================================
// Extraction adapter interface.
//
// This is the seam between "raw pasted text" and "candidate records for
// review" — the one place a real parser plugs in. Nothing outside this
// file (the research_intake/research_candidates schema, the review
// query layer in ../queries/researchIntake.js, or the review UI) knows
// or cares which adapter produced a candidate; they only deal in the
// candidate shape below.
//
// An adapter's contract:
//   extract(rawText) -> Array<{
//     sourceExcerpt: string,       // the exact text this candidate came from
//     proposedItemKind: string|null,   // one of ITEM_KINDS, or null if unknown
//     proposedTitle: string|null,
//     proposedContent: string|null,
//     proposedPrice: {amount, currency, unit, note}|null,
//     uncertaintyNote: string|null,
//   }>
//
// PLAIN_TEXT_ADAPTER (the only adapter shipped right now) does NOT
// attempt to understand the text. It only splits pasted input into
// reviewable chunks (paragraphs) and leaves every proposed field empty
// — no guessed title, no guessed category, no keyword-matching dressed
// up as classification. The person reviewing candidates fills in every
// field themselves. This is a conscious choice, not a placeholder: a
// keyword heuristic ("contains 'hotel' -> accommodation") would look
// like classification but would actually just be wrong often enough to
// erode trust in the review screen, which defeats the point of a review
// step in the first place. A chunk with no proposed anything is
// obviously incomplete and demands review; a chunk with a plausible-but-
// wrong guess invites rubber-stamping.
//
// A genuine semantic extractor — recognizing "Galle Fort is best
// visited at sunset" as a fact ABOUT Galle Fort, an attraction — needs
// a language model, which means a network call to an external API. In
// this local-first, no-backend architecture, that's a real, deliberate
// boundary, not an oversight: adding it means either bundling a large
// local model (a much bigger, separate project) or accepting a network
// dependency for this one feature specifically. Neither is in scope for
// Phase 0. What Phase 0 establishes is the adapter interface and the
// full review pipeline around it, so a real extractor can be dropped in
// later as a second adapter (e.g. an LLM-backed one behind an explicit
// "connect an AI service" opt-in) without touching anything else —
// schema, review queries, or UI.
// ============================================================

function splitIntoParagraphs(rawText) {
  return rawText
    .split(/\n\s*\n/) // blank-line-separated paragraphs
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0);
}

export const PLAIN_TEXT_ADAPTER = {
  id: 'plain-text-paragraphs',
  label: 'Split into paragraphs (no automatic classification)',
  extract(rawText) {
    const paragraphs = splitIntoParagraphs(rawText);
    // Fall back to the whole input as one chunk if it has no blank-line
    // breaks (e.g. a single pasted sentence or a no-paragraph note) —
    // still produces one candidate to review rather than nothing.
    const chunks = paragraphs.length > 0 ? paragraphs : [rawText.trim()].filter(Boolean);
    return chunks.map(excerpt => ({
      sourceExcerpt: excerpt,
      proposedItemKind: null,
      proposedTitle: null,
      proposedContent: excerpt,
      proposedPrice: null,
      uncertaintyNote: 'Not yet classified — split from the pasted text only. Choose a type and title to accept this as a research item.',
    }));
  },
};

// The adapter currently in effect. A future real extractor would be
// selected here (or made user-selectable), without any other file in
// the codebase needing to change.
export const ACTIVE_ADAPTER = PLAIN_TEXT_ADAPTER;
