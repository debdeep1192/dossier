// The Home "Expedition Desk" — a READ-ONLY summary of where the
// traveller stands: which trip matters right now, what is still
// undecided, and what to do next.
//
// Nothing here writes anything or introduces a new rule. Every
// number is derived from data the app already stores, by the
// functions that already own the rules:
//   - Needs Attention + Must-see audit  -> lib/planningAwareness.js
//   - "is this item part of the current itinerary" -> lib/planningCosts.js
//   - items orphaned by an old Option-group deletion read as the
//     ordinary items they revert to -> lib/optionGroupIntegrity.js
// so the desk can never disagree with the Planning screen it links to.
//
// DATES. A Planning's start/end are date-only YYYY-MM-DD strings and
// "today" is the traveller's LOCAL calendar day. Everything here
// compares those as calendar dates (year/month/day components); an
// instant is never turned into a date by slicing its UTC ISO string,
// which would shift the day for anyone east or west of UTC.
//
// Plain .js (no JSX) so plain Node can import and test it.

import { listDestinations } from '../db/stores/destinations.js';
import { listPlannings, planningDayCount } from '../db/stores/plannings.js';
import { listTimelineItems } from '../db/stores/timelineItems.js';
import { listOptionGroupsForPlanning } from '../db/stores/planningOptionGroups.js';
import { listAlternativesForItem } from '../db/stores/itemAlternatives.js';
import { listReviewFlagsForPlanning } from '../db/stores/planningReviewFlags.js';
import { listAttractions } from '../db/stores/attractions.js';
import { listRestaurantEntries } from '../db/stores/restaurants.js';
import { listAccommodations } from '../db/stores/accommodations.js';
import { listTransportEntries } from '../db/stores/transport.js';
import { buildNeedsAttention, summarizeNeedsAttention, auditMustSeeAttractions } from './planningAwareness.js';
import { isTimelineItemCurrentlyIncluded } from './planningCosts.js';
import { detachOrphanedGroupItems } from './optionGroupIntegrity.js';

// --- Calendar-date helpers (local, date-only) ---------------------------------------------

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

// The LOCAL calendar day of an instant, as YYYY-MM-DD.
export function localDateString(date = new Date()) {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseYmd(value) {
  const m = typeof value === 'string' ? YMD.exec(value) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Reject impossible dates such as 2026-02-31.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return Date.UTC(y, mo - 1, d);
}

// Whole calendar days from `fromYmd` to `toYmd` (negative if `to` is
// earlier). Computed on UTC midnights of the two calendar dates, so DST
// changes and the machine's time zone cannot add or remove a day.
export function dayDifference(fromYmd, toYmd) {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
}

// -> { phase: 'underway' | 'upcoming' | 'past' | 'undated', ... }
//   underway : dayNumber (1-based), totalDays
//   upcoming : daysUntilStart (>= 1), totalDays
//   past     : daysSinceEnd (>= 1), totalDays
export function classifyPlanning(planning, todayYmd) {
  const start = planning?.startDate;
  const end = planning?.endDate;
  const sinceStart = dayDifference(start, todayYmd);
  const untilEnd = dayDifference(todayYmd, end);
  if (sinceStart === null || untilEnd === null) return { phase: 'undated', totalDays: 0 };
  const totalDays = planningDayCount(planning);
  if (sinceStart < 0) return { phase: 'upcoming', daysUntilStart: -sinceStart, totalDays };
  if (untilEnd < 0) return { phase: 'past', daysSinceEnd: -untilEnd, totalDays };
  return { phase: 'underway', dayNumber: sinceStart + 1, totalDays };
}

// The one trip that deserves the hero position:
//   1. a trip that is underway today (if several, the one that started most recently)
//   2. otherwise the nearest upcoming trip
//   3. otherwise the most recently finished trip
// Undated Plannings are never featured (they have no "when").
export function pickFeaturedPlanning(plannings, todayYmd) {
  const classified = (plannings || []).map(planning => ({ planning, ...classifyPlanning(planning, todayYmd) }));
  const underway = classified.filter(c => c.phase === 'underway').sort((a, b) => b.planning.startDate.localeCompare(a.planning.startDate));
  if (underway.length) return underway[0];
  const upcoming = classified.filter(c => c.phase === 'upcoming').sort((a, b) => a.daysUntilStart - b.daysUntilStart);
  if (upcoming.length) return upcoming[0];
  const past = classified.filter(c => c.phase === 'past').sort((a, b) => a.daysSinceEnd - b.daysSinceEnd);
  return past[0] || null;
}

// Short label for the hero's eyebrow line, e.g. "Underway · Day 3 of 5".
export function describePhase(c) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  switch (c.phase) {
    case 'underway': return `Underway · Day ${c.dayNumber} of ${c.totalDays}`;
    case 'upcoming': return c.daysUntilStart === 1 ? 'Upcoming · Starts tomorrow' : `Upcoming · In ${plural(c.daysUntilStart, 'day')}`;
    case 'past': return c.daysSinceEnd === 1 ? 'Most recent · Ended yesterday' : `Most recent · Ended ${plural(c.daysSinceEnd, 'day')} ago`;
    default: return 'Undated';
  }
}

// --- Next steps ---------------------------------------------

// Ordered, plain-language suggestions derived ONLY from the
// attention summary and simple itinerary coverage — the same
// categories the Planning screen's Needs Attention already uses. At
// most `limit` are returned; if nothing is outstanding the single
// entry says so rather than inventing work.
export function deriveNextSteps(summary, { itemCount = 0, daysPlanned = 0, totalDays = 0 } = {}, limit = 3) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const steps = [];
  if (summary.conflicts > 0) steps.push({ key: 'conflicts', label: `Fix ${plural(summary.conflicts, 'schedule conflict')}` });
  if (summary.pendingOptions > 0) steps.push({ key: 'options', label: `Choose between options (${summary.pendingOptions} pending)` });
  if (summary.pendingAlternatives > 0) steps.push({ key: 'alternatives', label: `Pick ${plural(summary.pendingAlternatives, 'alternative')}` });
  if (summary.mustSeeUnresolved > 0) steps.push({ key: 'must-see', label: `Place or review ${plural(summary.mustSeeUnresolved, 'Must-see attraction')}` });
  if (steps.length === 0 && totalDays > 0) {
    if (itemCount === 0) steps.push({ key: 'start', label: 'Start the itinerary — add the first day’s plan' });
    else if (daysPlanned < totalDays) steps.push({ key: 'remaining', label: `Plan the remaining ${plural(totalDays - daysPlanned, 'day')}` });
  }
  if (steps.length === 0) steps.push({ key: 'clear', label: 'Nothing outstanding — the itinerary is clear' });
  return steps.slice(0, limit);
}

// --- Loader ---------------------------------------------

async function loadFeaturedDetail(featured, destination) {
  const { planning } = featured;
  const [rawItems, optionGroups, reviewFlags, attractions, restaurants, accommodations, transport] = await Promise.all([
    listTimelineItems(planning.id),
    listOptionGroupsForPlanning(planning.id),
    listReviewFlagsForPlanning(planning.id),
    listAttractions(planning.destinationId),
    listRestaurantEntries(planning.destinationId),
    listAccommodations(planning.destinationId),
    listTransportEntries(planning.destinationId),
  ]);
  const timelineItems = detachOrphanedGroupItems(rawItems, optionGroups);
  const alternativesByItemId = {};
  await Promise.all(timelineItems.map(async (item) => {
    alternativesByItemId[item.id] = await listAlternativesForItem(item.id);
  }));

  const totalDays = planningDayCount(planning);
  const optionGroupsById = Object.fromEntries(optionGroups.map(g => [g.id, g]));
  const attention = buildNeedsAttention({ timelineItems, optionGroups, alternativesByItemId, attractions, reviewFlags, currentDayCount: totalDays });
  const summary = summarizeNeedsAttention(attention);
  const audit = auditMustSeeAttractions({ attractions, timelineItems, alternativesByItemId, optionGroupsById, reviewFlags });

  // "Planned" = part of the CURRENT itinerary (an item inside an
  // unselected Option is a possibility, not a plan), on a day inside
  // the trip's current dates.
  const current = timelineItems.filter(item => isTimelineItemCurrentlyIncluded(item, optionGroupsById));
  const daysPlanned = new Set(current.filter(i => i.dayNumber >= 1 && i.dayNumber <= totalDays).map(i => i.dayNumber)).size;

  const stats = { itemCount: current.length, daysPlanned, totalDays };
  return {
    ...featured,
    destinationName: destination?.name || '',
    stats,
    summary,
    // Warnings only: unresolved decisions and genuine conflicts. The
    // informational out-of-range notes stay on the Planning screen.
    attention: attention.filter(a => a.severity === 'warning'),
    mustSee: { total: audit.length, resolved: audit.filter(a => a.status !== 'unresolved').length },
    nextSteps: deriveNextSteps(summary, stats),
    research: {
      attractions: attractions.length,
      restaurants: restaurants.length,
      accommodations: accommodations.length,
      transport: transport.length,
    },
  };
}

// Everything the Home screen needs, in one pass. `todayYmd` is
// injectable so the date logic is testable in any time zone.
export async function loadExpeditionDesk(todayYmd = localDateString()) {
  const destinations = await listDestinations();
  const destinationsById = Object.fromEntries(destinations.map(d => [d.id, d]));
  const plannings = (await Promise.all(destinations.map(d => listPlannings(d.id)))).flat();

  const featured = pickFeaturedPlanning(plannings, todayYmd);
  const phaseRank = { underway: 0, upcoming: 1, past: 2, undated: 3 };
  const others = plannings
    .filter(p => p.id !== featured?.planning.id)
    .map(planning => ({ planning, destinationName: destinationsById[planning.destinationId]?.name || '', ...classifyPlanning(planning, todayYmd) }))
    .sort((a, b) => {
      if (a.phase !== b.phase) return phaseRank[a.phase] - phaseRank[b.phase];
      if (a.phase === 'upcoming') return a.daysUntilStart - b.daysUntilStart;
      if (a.phase === 'past') return a.daysSinceEnd - b.daysSinceEnd;
      return (a.planning.name || '').localeCompare(b.planning.name || '');
    });

  return {
    today: todayYmd,
    destinationCount: destinations.length,
    planningCount: plannings.length,
    featured: featured ? await loadFeaturedDetail(featured, destinationsById[featured.planning.destinationId]) : null,
    others,
  };
}
