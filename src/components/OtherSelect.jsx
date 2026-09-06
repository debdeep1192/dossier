import { Select, Input } from './Field';

// Wherever a Select's options include "Other", picking it must reveal
// a "Please specify" field and the typed value must be preserved (see
// item 9). Rather than re-implementing this per field (as the old
// AttractionsPage did once, inconsistently, for bestTimeOfDay only —
// category had the same "Other" option with no way to explain it),
// every field with an "Other" option uses this one component.
//
// `value` is the selected option (e.g. "Other"); `otherValue` is the
// free-text explanation, stored as a SEPARATE field on the record
// (e.g. category + categoryOther) so the controlled value and the
// person's own words are never conflated into one string.
export default function OtherSelect({ label, value, otherValue, onChange, onOtherChange, options, placeholder = 'Choose…', otherPlaceholder = 'Please specify' }) {
  return (
    <>
      <Select label={label} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </Select>
      {value === 'Other' && (
        <Input label="" aria-label={`${label} — please specify`} placeholder={otherPlaceholder} value={otherValue || ''} onChange={e => onOtherChange(e.target.value)} />
      )}
    </>
  );
}
