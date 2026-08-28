export const RESTAURANT_PRICE_UNITS = [
  'Per person',
  'For 2 persons',
  'For 3 persons',
  'For 4 persons',
  'Per dish',
  'Per meal',
  'Per item',
  'Other',
];
export const RESTAURANT_DEFAULT_UNIT = 'For 2 persons';

export const ACCOMMODATION_TYPES = ['Hotel / Resort', 'Homestay', 'Other'];
export const ACCOMMODATION_PRICE_BASIS = ['Per room per night', 'Per person per night'];
export const ACCOMMODATION_DEFAULT_PRICE_BASIS = 'Per room per night';

export const TRANSPORT_MODES = ['Train', 'Bus', 'Flight', 'Shared cab', 'Private hired cab', 'Other'];
// Sensible default pricing unit per mode — the person can always change
// it, this just saves a tap for the common case.
export const TRANSPORT_DEFAULT_UNIT_BY_MODE = {
  'Train': 'Per person',
  'Bus': 'Per person',
  'Flight': 'Per person',
  'Shared cab': 'Per person',
  'Private hired cab': 'Per vehicle',
};
export const TRANSPORT_PRICE_UNITS = ['Per person', 'Per vehicle', 'Other'];
