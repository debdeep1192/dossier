export const PACKING_CATEGORIES = [
  'Documents',
  'Money',
  'Clothing',
  'Health',
  'Electronics',
  'Child / Family',
  'Destination-specific',
  'Other',
];

// A starting catalog the person can tap to quickly add — not a
// mandatory list. Anything not on here can still be added as a custom
// item under any category.
export const PACKING_PRESETS = {
  'Documents': ['Passport', 'Visa', 'ID', 'Tickets', 'Hotel booking', 'Travel insurance', 'Copies of important documents'],
  'Money': ['Cash', 'Cards', 'Foreign currency', 'Backup payment method'],
  'Clothing': ['Regular clothes', 'Warm clothes', 'Rainwear', 'Comfortable footwear', 'Sleepwear', 'Child clothing'],
  'Health': ['Medicines', 'First-aid kit', 'Prescription medicines', 'Basic toiletries'],
  'Electronics': ['Phone', 'Chargers', 'Power bank', 'Adapters', 'Camera', 'Memory card'],
  'Child / Family': ['Diapers', 'Toddler food', 'Snacks', 'Water bottle', 'Toys', 'Child medicines', 'Extra clothing'],
  'Destination-specific': [],
  'Other': [],
};
