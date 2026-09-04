import './Disclosure.css';

// Wraps a block of "advanced"/secondary form fields behind a single
// toggle, so every section form can adopt progressive disclosure by
// wrapping its existing secondary fields in this component — no
// per-page collapse/expand state, no duplicated show/hide logic.
//
// `defaultOpen` should be true whenever the record being edited
// already has data in the wrapped fields (see hasAdvancedContent()
// below) — an already-detailed record must never look artificially
// empty or collapsed. For a brand-new record it should be false, so
// quick capture / a fresh "New X" form stays small by default.
//
// Built on the native <details>/<summary> elements: no extra React
// state, keyboard/accessibility behavior comes for free, and nothing
// closes/reopens on re-render since openness lives in the DOM.
export default function Disclosure({ label = 'Add more details', defaultOpen = false, children }) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary className="disclosure__summary">
        <span>{label}</span>
        <span className="disclosure__chevron" aria-hidden="true">▾</span>
      </summary>
      <div className="disclosure__content">
        {children}
      </div>
    </details>
  );
}

