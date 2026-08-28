import { useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getDestination } from '../db/stores/destinations';
import { createIntake } from '../db/stores/intake';
import { extractTextFromPdf, ScannedPdfError } from '../lib/pdfText.js';
import { useCachedQuery } from '../hooks/useCachedQuery';
import Button from '../components/Button';
import { Input, TextArea } from '../components/Field';
import { LoadingState, ErrorState } from '../components/States';
import '../components/SectionPageLayout.css';
import './ImportPage.css';

export default function ImportPage() {
  const { destinationId } = useParams();
  const navigate = useNavigate();
  const [rawText, setRawText] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [extractingPdf, setExtractingPdf] = useState(false);

  const fetcher = useCallback(() => getDestination(destinationId), [destinationId]);
  const { data: destination, error: loadError, loading } = useCachedQuery(`destination-name:${destinationId}`, fetcher);

  async function handlePdfSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setError('');
    setExtractingPdf(true);
    try {
      const text = await extractTextFromPdf(file);
      setRawText(prev => (prev ? `${prev}\n\n${text}` : text));
      if (!sourceLabel) setSourceLabel(file.name.replace(/\.pdf$/i, ''));
    } catch (err) {
      if (err instanceof ScannedPdfError) {
        setError(err.message);
      } else {
        setError('Could not read this PDF. It may be corrupted or in an unsupported format.');
      }
    } finally {
      setExtractingPdf(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { intake } = await createIntake({ destinationId, rawText, sourceLabel });
      navigate(`/destinations/${destinationId}/review/${intake.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <ErrorState description={loadError} />;
  if (loading && !destination) return <LoadingState label="Loading…" />;

  return (
    <div className="import-page">
      <div className="section-page__breadcrumb">
        <Link to="/">Research</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/destinations/${destinationId}`}>{destination?.name}</Link>
        <span aria-hidden="true">/</span>
        <span>Import</span>
      </div>
      <h1>Import from text</h1>
      <p className="import-page__hint">
        Paste travel notes, an article, or a guide — or upload a text-based PDF below to pull its text in automatically.
        Dossier will split it into candidates for you to review, edit, and classify — nothing is added to your research automatically.
      </p>

      <div className="import-page__pdf-upload">
        <label className="import-page__pdf-label">
          <input type="file" accept="application/pdf" onChange={handlePdfSelected} disabled={extractingPdf} />
          <span>{extractingPdf ? 'Reading PDF…' : '📄 Upload a text-based PDF'}</span>
        </label>
        <p className="import-page__pdf-hint">Only PDFs with selectable text are supported — scanned/image-only PDFs are rejected, not OCR'd. The PDF itself isn't kept, only the text pulled from it.</p>
      </div>

      <form onSubmit={handleSubmit}>
        <Input label="Source (optional)" value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} placeholder="e.g. Lonely Planet article" />
        <TextArea
          label="Text"
          required
          rows={14}
          value={rawText}
          onChange={e => setRawText(e.target.value)}
          placeholder={'Tip: headings (e.g. "Attractions", "Where to Stay") and bullet lists help Dossier propose the right section for each item.'}
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting || extractingPdf}>{submitting ? 'Processing…' : 'Split into candidates'}</Button>
      </form>
    </div>
  );
}
