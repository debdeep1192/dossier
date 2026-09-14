import { commonMetadata } from '../shared.js';
import { listActive, getActive, save, patch, softDelete } from './crud.js';
import { WEATHER_RECOMMENDATIONS, WEATHER_DEFAULT_PRECIPITATION } from '../../lib/weatherOptions.js';

const STORE = 'weatherNotes';

// period stays free text (not forced into a single month) — a person
// should be able to describe "January–April" as one record just as
// easily as "December" alone; see lib/weatherOptions.js for the month
// list the UI offers as a starting point.
//
// startDate/endDate (Phase 3 Chunk 3) are additive, optional, exact
// dates for when `period` alone isn't precise enough — e.g. "Safari
// season: 1 July - 15 September" rather than just "July-September".
// Plain YYYY-MM-DD strings, no timezone handling at all (deliberately
// — this is a description of a season/period, not a scheduled event
// with a specific instant). `period` remains the required, always-
// present field; the dates are an optional precision layer on top of
// it, not a replacement — a record with only `period` set (as every
// pre-Chunk-3 record necessarily is) remains completely valid and is
// never required to have dates.
export function emptyWeatherNote() {
  return {
    period: '',
    startDate: '',
    endDate: '',
    description: '',
    temperatureMin: '',
    temperatureMax: '',
    temperatureUnit: 'C',
    rain: WEATHER_DEFAULT_PRECIPITATION,
    snow: WEATHER_DEFAULT_PRECIPITATION,
    recommendation: '', // one of WEATHER_RECOMMENDATIONS' values, or '' for not set
    recommendationNotes: '',
  };
}

export function listWeatherNotes(destinationId) {
  return listActive(STORE, destinationId);
}

export function getWeatherNote(id) {
  return getActive(STORE, id);
}

export function createWeatherNote(destinationId, fields) {
  const record = { ...commonMetadata({ destinationId }), ...emptyWeatherNote(), ...fields };
  if (!record.period?.trim()) throw new Error('Give this a period.');
  return save(STORE, record);
}

export function updateWeatherNote(id, fields) {
  return patch(STORE, id, fields);
}

export function deleteWeatherNote(id) {
  return softDelete(STORE, id);
}

// Backward compatibility: earlier records stored `recommendation` as
// free text (e.g. "Great time to visit, dry and clear"). If the stored
// value isn't one of the current controlled options, treat it as
// legacy explanatory text and surface it as recommendationNotes instead
// — nothing is lost, and the person can pick a proper structured rating
// next time they edit.
export function normalizeWeatherNote(record) {
  if (!record) return record;
  const validValues = WEATHER_RECOMMENDATIONS.map(r => r.value);
  if (record.recommendation && !validValues.includes(record.recommendation)) {
    return {
      ...record,
      recommendation: '',
      recommendationNotes: record.recommendationNotes || record.recommendation,
    };
  }
  return record;
}
