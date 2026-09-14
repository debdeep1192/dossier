export const PRACTICAL_INFO_TOPICS = [
  'Visa', 'Passport', 'Permits', 'Connectivity', 'SIM', 'Internet',
  'Safety', 'Emergency', 'Healthcare', 'Hospitals', 'Police',
  'Embassy / Consulate', 'Money / ATM', 'Banking', 'Local transport',
  'Language', 'Electricity', 'Customs', 'Local rules', 'Useful contacts', 'Other',
];

// A small icon per predefined topic, for the compact topic-grid UI
// (Phase 3 Chunk 8). Purely cosmetic — never used to drive any logic,
// so a topic missing from this map (a custom "Other" topic, or a
// legacy record whose topic somehow isn't in the list above) simply
// falls back to a generic icon in the UI rather than breaking.
export const PRACTICAL_INFO_TOPIC_ICONS = {
  'Visa': '🛂',
  'Passport': '📘',
  'Permits': '📄',
  'Connectivity': '📶',
  'SIM': '📱',
  'Internet': '🌐',
  'Safety': '🛡️',
  'Emergency': '🚨',
  'Healthcare': '⚕️',
  'Hospitals': '🏥',
  'Police': '👮',
  'Embassy / Consulate': '🏛️',
  'Money / ATM': '💵',
  'Banking': '🏦',
  'Local transport': '🚌',
  'Language': '🗣️',
  'Electricity': '🔌',
  'Customs': '🛃',
  'Local rules': '📜',
  'Useful contacts': '📇',
  'Other': '➕',
};
