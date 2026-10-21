import { useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPlannings, deletePlanning, planningDayCount } from '../db/stores/plannings';
import { listDestinations } from '../db/stores/destinations';
import { listPeople } from '../db/stores/people';
import { listTimelineItems } from '../db/stores/timelineItems';
import { listOptionGroupsForPlanning } from '../db/stores/planningOptionGroups';
import { detachOrphanedGroupItems } from '../lib/optionGroupIntegrity';
import { listAlternativesForItem } from '../db/stores/itemAlternatives';
import { listReviewFlagsForPlanning } from '../db/stores/planningReviewFlags';
import { listAttractions } from '../db/stores/attractions';
import { listRestaurantEntries } from '../db/stores/restaurants';
import { listAccommodations } from '../db/stores/accommodations';
import { listTransportEntries } from '../db/stores/transport';
import { ageAsOf, calculatePlanningCostBreakdown, convertTotalToHomeCurrency } from '../lib/planningCosts';
import { buildNeedsAttention, summarizeNeedsAttention } from '../lib/planningAwareness';
import { getHomeCurrency } from '../db/appSettings';
import { convertAmount } from '../db/currency';
import { useCachedQuery, invalidateCachedQuery } from '../hooks/useCachedQuery';
import Card from '../components/Card';
import Button from '../components/Button';
import { EmptyState, LoadingState, ErrorState } from '../components/States';
import '../components/SectionPageLayout.css';
import './PlanningsPage.css';

// Top-level Plannings list, one level up from any single destination —
// a Planning always belongs to one destination, but a person may have
// Plannings across several destinations, so this mirrors ResearchHome's
// own top-level-list shape rather than living under a single
// destination's section grid.
//
// Phase 2 — each card now shows a compact state summary (pending
// decisions, Must-see gaps, schedule conflicts, an estimated cost)
// derived the exact same way PlanningDetailPage computes it for one
// Planning (lib/planningAwareness.js / lib/planningCosts.js), just run
// once per Planning here. Research records are fetched once PER
// DESTINATION and reused across every Planning for that destination
// (most people have at most a few Plannings, often sharing a
// destination), rather than once per Planning — a small, deliberate
// optimization within the existing "N+1 is fine for this data scale"
// precedent already established on this page (see the per-destination
// listPlannings calls below, unchanged from before this phase).
export default function PlanningsPage() {
  const navigate = useNavigate();

  const fetcher = useCallback(async () => {
    const destinations = await listDestinations();
    const perDestination = await Promise.all(destinations.map(d => listPlannings(d.id)));
    const plannings = perDestination.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const destinationsById = Object.fromEntries(destinations.map(d => [d.id, d]));
    const people = await listPeople();

    // Research records, fetched once per destination that actually has
    // a Planning, not once per Planning.
    const destinationIdsWithPlannings = [...new Set(plannings.map(p => p.destinationId))];
    const researchByDestinationId = {};
    await Promise.all(destinationIdsWithPlannings.map(async (destinationId) => {
      const [attractions, restaurants, accommodations, transport] = await Promise.all([
        listAttractions(destinationId), listRestaurantEntries(destinationId), listAccommodations(destinationId), listTransportEntries(destinationId),
      ]);
      researchByDestinationId[destinationId] = {
        attractions, byType: {
          attractions: Object.fromEntries(attractions.map(r => [r.id, r])),
          restaurants: Object.fromEntries(restaurants.map(r => [r.id, r])),
          accommodations: Object.fromEntries(accommodations.map(r => [r.id, r])),
          transport: Object.fromEntries(transport.map(r => [r.id, r])),
        },
      };
    }));

    // Per-Planning summary: timeline items, Option groups, review
    // flags, and every item's alternatives — the same shape
    // PlanningDetailPage loads for one Planning, computed here for
    // every Planning in the list.
    const summaryByPlanningId = {};
    await Promise.all(plannings.map(async (planning) => {
      const [loadedItems, optionGroups, reviewFlags] = await Promise.all([
        listTimelineItems(planning.id),
        listOptionGroupsForPlanning(planning.id),
        listReviewFlagsForPlanning(planning.id),
      ]);
      // Same read-time tolerance as the Planning page: an item left
      // pointing at a deleted Option group counts as the ordinary item
      // it reverts to, so this summary agrees with the Planning screen.
      const timelineItems = detachOrphanedGroupItems(loadedItems, optionGroups);
      const alternativesByItemId = {};
      await Promise.all(timelineItems.map(async (item) => {
        alternativesByItemId[item.id] = await listAlternativesForItem(item.id);
      }));

      const research = researchByDestinationId[planning.destinationId] || { attractions: [], byType: {} };
      const optionGroupsById = Object.fromEntries(optionGroups.map(g => [g.id, g]));
      const currentDayCount = planningDayCount(planning);
      const attentionItems = buildNeedsAttention({
        timelineItems, optionGroups, alternativesByItemId, attractions: research.attractions, reviewFlags, currentDayCount,
      });
      const attention = summarizeNeedsAttention(attentionItems);

      const travellerAges = people.filter(p => planning.travellerIds.includes(p.id)).map(p => ageAsOf(p.dob, planning.startDate)).filter(age => age !== null);
      const alternatives = Object.entries(alternativesByItemId).flatMap(([itemId, alts]) => {
        const parentItem = timelineItems.find(i => i.id === itemId);
        if (!parentItem) return [];
        return alts.map(alternative => ({ alternative, parentItem }));
      });
      const breakdown = calculatePlanningCostBreakdown({
        items: timelineItems, alternatives, optionGroupsById, travellerAges,
        getRecordForItem: (item) => (item.researchRefId ? research.byType[item.researchRefType]?.[item.researchRefId] : null),
      });

      summaryByPlanningId[planning.id] = { attention, overallByCurrency: breakdown.overallByCurrency };
    }));

    return { plannings, destinations, destinationsById, summaryByPlanningId };
  }, []);
  const { data, error, loading, refresh } = useCachedQuery('plannings', fetcher);

  function afterMutation() {
    invalidateCachedQuery('plannings');
    refresh();
  }

  async function handleDelete(planning) {
    if (!window.confirm(`Delete "${planning.name}"?`)) return;
    await deletePlanning(planning.id);
    afterMutation();
  }

  if (error && !data) return <ErrorState description={error} onRetry={refresh} />;
  if (loading && !data) return <LoadingState label="Loading plannings…" />;

  const { plannings, destinations, destinationsById, summaryByPlanningId } = data;
  const hasDestinations = destinations.length > 0;

  return (
    <div className="section-page">
      <header className="section-page__header">
        <div>
          <h1>Plannings</h1>
          <p className="section-page__subtitle">Build a trip from your Research.</p>
        </div>
        {hasDestinations && <Button onClick={() => navigate('/plannings/new')}>+ New Planning</Button>}
      </header>

      <div className="section-page__list">
        {!hasDestinations ? (
          <EmptyState icon="🗺️" title="No destinations yet" description="Add a Research destination first — a Planning is always built on top of one." />
        ) : plannings.length === 0 ? (
          <EmptyState icon="🗺️" title="No plannings yet" description="Create a Planning to start building a trip from your Research." actionLabel="+ New Planning" onAction={() => navigate('/plannings/new')} />
        ) : (
          plannings.map(planning => (
            <Card key={planning.id} interactive padding="sm" className="entry-card" onClick={() => navigate(`/plannings/${planning.id}`)}>
              <div className="entry-card__main">
                <span className="entry-card__title">{planning.name}</span>
                <p className="entry-card__meta">
                  {destinationsById[planning.destinationId]?.name || 'Unknown destination'} · <span className="mono">{planning.startDate} – {planning.endDate}</span>
                </p>
                <PlanningCardSummary summary={summaryByPlanningId[planning.id]} />
              </div>
              <button type="button" className="entry-card__delete" onClick={(e) => { e.stopPropagation(); handleDelete(planning); }}>Delete</button>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// The compact per-card summary line(s) — Phase 2. Shows the Needs
// Attention breakdown (only the categories that are actually nonzero)
// and, where the cost calculation has a REAL estimate, an
// approximate home-currency total. Per the explicit requirement, a
// missing/unestimated cost is never shown as a number (never
// interpreted as zero) — the cost line simply doesn't appear if
// nothing is estimated yet or no home-currency conversion is possible.
function PlanningCardSummary({ summary }) {
  const [homeTotal, setHomeTotal] = useState(undefined);

  const overallByCurrency = summary?.overallByCurrency || {};
  const hasAnyCost = Object.keys(overallByCurrency).length > 0;

  useEffect(() => {
    if (!hasAnyCost) { setHomeTotal(undefined); return; }
    let cancelled = false;
    getHomeCurrency().then(async (homeCurrency) => {
      const total = await convertTotalToHomeCurrency(overallByCurrency, homeCurrency, convertAmount);
      if (!cancelled) setHomeTotal(total === null ? null : { amount: total, currency: homeCurrency });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content (JSON.stringify), not object identity, deliberately
  }, [JSON.stringify(overallByCurrency), hasAnyCost]);

  if (!summary) return null;
  const { attention } = summary;

  const parts = [
    attention.pendingOptions + attention.pendingAlternatives > 0 && `⚠️ ${attention.pendingOptions + attention.pendingAlternatives} decision${attention.pendingOptions + attention.pendingAlternatives === 1 ? '' : 's'}`,
    attention.mustSeeUnresolved > 0 && `⚠️ ${attention.mustSeeUnresolved} Must-see`,
    attention.conflicts > 0 && `⚠️ ${attention.conflicts} conflict${attention.conflicts === 1 ? '' : 's'}`,
  ].filter(Boolean);

  return (
    <div className="planning-card-summary">
      {parts.length > 0 ? (
        <p className="planning-card-summary__attention">{parts.join(' · ')}</p>
      ) : (
        <p className="planning-card-summary__clear">✅ No outstanding issues</p>
      )}
      {homeTotal !== undefined && homeTotal !== null && (
        <p className="planning-card-summary__cost">Estimated {homeTotal.currency} {homeTotal.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
      )}
    </div>
  );
}
