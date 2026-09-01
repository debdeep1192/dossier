// ============================================================
// PDF text extraction — text-layer only.
//
// This deliberately does NOT do OCR and never will: pdfjs-dist's
// getTextContent() only reads text objects already embedded in the PDF
// (the selectable-text layer a real text-based PDF has). If a PDF is
// scanned/image-only, there is no such layer, and this returns
// essentially nothing — which is exactly how we detect and reject that
// case, rather than attempting to interpret pixels as text.
//
// LINE RECONSTRUCTION: pdfjs's getTextContent() returns one item per
// run of text, each with a `hasEOL` flag marking whether a genuine
// line break in the source follows it. An earlier version of this file
// ignored that flag entirely (`items.map(i => i.str).join(' ')`),
// which collapsed an ENTIRE PAGE into a single unbroken line — the
// root cause of the extraction pipeline previously surfacing whole
// pages as one giant candidate (it had no way to see line/paragraph
// boundaries at all). This version uses hasEOL to reconstruct actual
// visual lines, which the extraction pipeline (db/extraction.js) then
// works with the same way it works with pasted plain text.
//
// PAGE HEADERS/FOOTERS: multi-page PDFs commonly repeat a running
// header/footer on every page (e.g. "Darjeeling - The Complete Guide |
// 17/33"). These are detected conservatively by frequency — a line
// (normalized: digits replaced with '#', so a changing page number
// still matches) that recurs on a meaningful fraction of pages is
// treated as boilerplate and removed before the rest of the pipeline
// ever sees it, so it can never become or pollute a candidate.
//
// pdfjs-dist is loaded via a dynamic import() inside
// extractTextFromPdf(), not a top-level import — it's a large library
// most sessions never touch, so it must not be part of the initial
// bundle.
//
// The PDF file itself is never stored — this function's output feeds
// directly into the same createIntake() text pipeline manual pasting
// uses, so the PDF is purely an input method, not a stored source.
// ============================================================

// Below this many non-whitespace characters total, a PDF is treated as
// having no usable text layer — scanned pages typically produce zero
// or a handful of stray characters (headers/footers that happen to be
// real text objects), never a real document's worth of prose.
export const MIN_USABLE_TEXT_CHARS = 40;

export class ScannedPdfError extends Error {
  constructor() {
    super('This PDF does not contain selectable text. Scanned/image-only PDFs are not supported.');
    this.name = 'ScannedPdfError';
  }
}

// Pure, dependency-free check — split out from extractTextFromPdf so
// the rejection threshold itself can be unit tested without needing to
// construct a real PDF binary in a test environment.
export function isTextUsable(fullText) {
  const nonWhitespaceCount = fullText.replace(/\s/g, '').length;
  return nonWhitespaceCount >= MIN_USABLE_TEXT_CHARS;
}

// Turns one page's raw text items into an array of reconstructed
// lines, using hasEOL as the line-break signal. Consecutive items
// without hasEOL are runs of text pdfjs split up for its own layout
// reasons (different fonts/spacing within the same visual line) and
// are joined back into one line.
export function reconstructLines(items) {
  const lines = [];
  let current = '';
  for (const item of items) {
    current += (item.str || '');
    if (item.hasEOL) {
      lines.push(current);
      current = '';
    }
  }
  if (current.trim()) lines.push(current);
  return lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 0);
}

// Normalizes a line for repeated-header/footer comparison: digits
// collapse to '#' so a running page number ("17/33", "18/33", ...)
// still matches across pages, and whitespace/case differences don't
// prevent a match either.
function normalizeForBoilerplateComparison(line) {
  return line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

// Removes lines that repeat (near-)verbatim across a meaningful
// fraction of pages — running headers/footers, page-number lines. Only
// applied when there are enough pages for repetition to be meaningful
// (a 1-2 page document doesn't get this treatment, since a coincidental
// short repeated line there is more likely to be real content).
export function stripRepeatedPageBoilerplate(pageLines) {
  if (pageLines.length < 3) return pageLines;

  const countByNormalized = new Map();
  for (const lines of pageLines) {
    const seenThisPage = new Set();
    for (const line of lines) {
      const key = normalizeForBoilerplateComparison(line);
      if (!key || seenThisPage.has(key)) continue;
      seenThisPage.add(key);
      countByNormalized.set(key, (countByNormalized.get(key) || 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pageLines.length * 0.4));
  const boilerplateKeys = new Set(
    [...countByNormalized.entries()].filter(([, count]) => count >= threshold).map(([key]) => key)
  );
  if (boilerplateKeys.size === 0) return pageLines;

  return pageLines.map(lines => lines.filter(line => !boilerplateKeys.has(normalizeForBoilerplateComparison(line))));
}

export async function extractTextFromPdf(file) {
  const [{ GlobalWorkerOptions, getDocument }, { default: pdfWorkerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;

  const pageLines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    pageLines.push(reconstructLines(content.items));
  }

  const cleanedPageLines = stripRepeatedPageBoilerplate(pageLines);
  const fullText = cleanedPageLines.map(lines => lines.join('\n')).join('\n\n');

  if (!isTextUsable(fullText)) {
    throw new ScannedPdfError();
  }

  return fullText;
}
