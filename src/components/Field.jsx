export function Input({ label, hint, error, required, id, ...rest }) {
  const fieldId = id || rest.name || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="field">
      {label && <label className="field__label" htmlFor={fieldId}>{label}{required && <span className="field__required"> *</span>}</label>}
      <input id={fieldId} className={`field__control ${error ? 'field__control--error' : ''}`} {...rest} />
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

export function TextArea({ label, hint, error, required, id, rows = 4, ...rest }) {
  const fieldId = id || rest.name || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="field">
      {label && <label className="field__label" htmlFor={fieldId}>{label}{required && <span className="field__required"> *</span>}</label>}
      <textarea id={fieldId} rows={rows} className={`field__control field__control--textarea ${error ? 'field__control--error' : ''}`} {...rest} />
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

export function Select({ label, hint, error, required, id, children, ...rest }) {
  const fieldId = id || rest.name || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="field">
      {label && <label className="field__label" htmlFor={fieldId}>{label}{required && <span className="field__required"> *</span>}</label>}
      <select id={fieldId} className={`field__control field__control--select ${error ? 'field__control--error' : ''}`} {...rest}>
        {children}
      </select>
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

export function Checkbox({ label, ...rest }) {
  return (
    <label className="field field--checkbox">
      <input type="checkbox" className="field__checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}
