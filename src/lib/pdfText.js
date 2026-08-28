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
// pdfjs-dist is loaded via a dynamic import() inside
// extractTextFromPdf(), not a top-level import — it's a large library
// (~450KB) that most sessions never touch (most imports are pasted
// text, not PDFs), so it must not be part of the initial bundle. This
// keeps first paint fast for everyone, and only pays the download cost
// for someone who actually uses the PDF upload button.
//
// The PDF file itself is never stored — see the Import page: this
// function's output feeds directly into the same createIntake() text
// pipeline manual pasting uses, so the PDF is purely an input method,
// not a stored source. The person can attach the PDF's filename as the
// intake's sourceLabel for their own reference, but the file bytes
// themselves are discarded once text has been extracted.
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

export async function extractTextFromPdf(file) {
  const [{ GlobalWorkerOptions, getDocument }, { default: pdfWorkerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;

  const pageTexts = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str || '').join(' ').trim();
    pageTexts.push(text);
  }

  const fullText = pageTexts.join('\n\n');

  if (!isTextUsable(fullText)) {
    throw new ScannedPdfError();
  }

  return fullText;
}
