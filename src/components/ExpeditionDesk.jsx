import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { loadExpeditionDesk, describePhase } from '../lib/expeditionDesk';
import './ExpeditionDesk.css';

// Home — "The Expedition Desk". A read-only summary of the traveller's
// current position: the trip that matters now, what is still
// undecided, what to do next, and how much research backs it. All
// figures come from lib/expeditionDesk.js, which reuses the Planning
// screen's own rules, so this can never disagree with the page it
// links to. It adds no data and changes no workflow; everything below
// it on the Home route (the destination library) is unchanged.

const PLURAL = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const DATE_RANGE = (p) => (p.startDate && p.endDate ? `${p.startDate} – ${p.endDate}` : 'Dates not set');

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ExpeditionDesk() {
  const fetcher = useCallback(() => loadExpeditionDesk(), []);
  const { data, error, loading } = useCachedQuery('expedition-desk', fetcher);

  return (
    <section className="desk" aria-labelledby="desk-title">
      <header className="desk__intro">
        <p className="eyebrow">{todayLabel()}</p>
        <h1 id="desk-title" className="desk__heading">Expedition Desk</h1>
      </header>

      {error && !data && <p className="desk__note" role="status">The desk couldn’t be loaded right now. Your research below is unaffected.</p>}
      {loading && !data && <div className="desk__skeleton" aria-busy="true" aria-label="Loading the desk" />}
      {data && <DeskBody desk={data} />}
    </section>
  );
}

function DeskBody({ desk }) {
  if (!desk.featured) return <EmptyDesk desk={desk} />;
  const f = desk.featured;
  const planningPath = `/plannings/${f.planning.id}`;
  const open = f.summary.totalWarnings;
  const shown = f.attention.slice(0, 4);
  const hidden = f.attention.length - shown.length;
  const mustSeePct = f.mustSee.total ? Math.round((f.mustSee.resolved / f.mustSee.total) * 100) : 0;

  return (
    <>
      <article className="desk__hero" aria-label="Featured trip">
        <div className="desk__hero-body">
          <p className={`desk__phase desk__phase--${f.phase}`}>
            <span className="desk__phase-dot" aria-hidden="true" />
            {describePhase(f)}
          </p>
          <h2 className="desk__trip">{f.planning.name}</h2>
          <p className="desk__where">
            {f.destinationName && <span>{f.destinationName}</span>}
            <span className="mono">{DATE_RANGE(f.planning)}</span>
          </p>
        </div>

        <dl className="desk__stats">
          <div className="desk__stat">
            <dt>Days planned</dt>
            <dd className="mono">{f.stats.daysPlanned}<span className="desk__stat-of">/{f.stats.totalDays}</span></dd>
          </div>
          <div className={`desk__stat${open > 0 ? ' desk__stat--alert' : ''}`}>
            <dt>Open decisions</dt>
            <dd className="mono">{open}</dd>
          </div>
          <div className="desk__stat">
            <dt>Must-see covered</dt>
            <dd className="mono">{f.mustSee.total ? <>{f.mustSee.resolved}<span className="desk__stat-of">/{f.mustSee.total}</span></> : '—'}</dd>
          </div>
        </dl>

        <Link to={planningPath} className="desk__cta">Open itinerary <span aria-hidden="true">›</span></Link>
      </article>

      <div className="desk__panels">
        <section className="desk__panel desk__panel--attention" aria-labelledby="desk-attention">
          <h3 id="desk-attention" className="desk__panel-title">Needs attention</h3>
          {shown.length === 0 ? (
            <p className="desk__clear">No unresolved decisions or conflicts in this itinerary.</p>
          ) : (
            <ul className="desk__attention-list">
              {shown.map((a, i) => (
                <li key={`${a.kind}-${a.itemId || a.groupId || a.attractionId || i}`} className="desk__attention-item">
                  <span className="desk__attention-mark" aria-hidden="true" />
                  <span className="desk__attention-text">{a.message}</span>
                  {a.dayNumber ? <span className="desk__attention-day mono">D{a.dayNumber}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {hidden > 0 && <p className="desk__more">+{hidden} more in the itinerary</p>}
        </section>

        <section className="desk__panel" aria-labelledby="desk-next">
          <h3 id="desk-next" className="desk__panel-title">Next steps</h3>
          <ol className="desk__steps">
            {f.nextSteps.map((s, i) => (
              <li key={s.key} className="desk__step">
                <span className="desk__step-no mono">{String(i + 1).padStart(2, '0')}</span>
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="desk__panel" aria-labelledby="desk-research">
          <h3 id="desk-research" className="desk__panel-title">Research{f.destinationName ? ` · ${f.destinationName}` : ''}</h3>
          <ul className="desk__holdings">
            <li><span className="mono">{f.research.attractions}</span> Attractions</li>
            <li><span className="mono">{f.research.restaurants}</span> Food</li>
            <li><span className="mono">{f.research.accommodations}</span> Stays</li>
            <li><span className="mono">{f.research.transport}</span> Transport</li>
          </ul>
          {f.mustSee.total > 0 && (
            <div className="desk__coverage">
              <div className="desk__coverage-label">
                <span>Must-see coverage</span>
                <span className="mono">{f.mustSee.resolved}/{f.mustSee.total}</span>
              </div>
              <div className="desk__bar" role="img" aria-label={`${f.mustSee.resolved} of ${PLURAL(f.mustSee.total, 'Must-see attraction')} placed or reviewed`}>
                <div className="desk__bar-fill" style={{ width: `${mustSeePct}%` }} />
              </div>
            </div>
          )}
          <Link to={`/destinations/${f.planning.destinationId}`} className="desk__link">Open {f.destinationName || 'destination'} research ›</Link>
        </section>
      </div>

      {desk.others.length > 0 && (
        <section className="desk__others" aria-labelledby="desk-others">
          <h3 id="desk-others" className="desk__panel-title">Also on the desk</h3>
          <ul className="desk__other-list">
            {desk.others.slice(0, 4).map(o => (
              <li key={o.planning.id}>
                <Link to={`/plannings/${o.planning.id}`} className="desk__other">
                  <span className="desk__other-name">{o.planning.name}</span>
                  <span className="desk__other-meta">
                    {o.destinationName && <span>{o.destinationName}</span>}
                    <span className="mono">{DATE_RANGE(o.planning)}</span>
                  </span>
                  <span className="desk__other-phase mono">{describePhase(o)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function EmptyDesk({ desk }) {
  return (
    <div className="desk__empty">
      <h2 className="desk__empty-title">{desk.destinationCount === 0 ? 'No expedition on the desk yet' : 'No trip on the desk yet'}</h2>
      <p className="desk__empty-text">
        {desk.destinationCount === 0
          ? 'Start with a destination in your research below. Once you plan a trip from it, the current or next one appears here, with what still needs deciding.'
          : 'Plan a trip from your research and the current or next one appears here, with what still needs deciding.'}
      </p>
      {desk.destinationCount > 0 && <Link to="/plannings/new" className="desk__link">Start a Planning ›</Link>}
    </div>
  );
}
