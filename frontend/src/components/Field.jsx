import './Field.css';

function FieldWrapper({ label, htmlFor, error, hint, required, children }) {
  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required && <span className="field__required" aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error" role="alert">{error}</span>}
    </div>
  );
}

export function Input({ label, id, error, hint, required, className = '', ...rest }) {
  const fieldId = id || rest.name;
  return (
    <FieldWrapper label={label} htmlFor={fieldId} error={error} hint={hint} required={required}>
      <input
        id={fieldId}
        className={`field__control ${error ? 'field__control--error' : ''} ${className}`}
        {...rest}
      />
    </FieldWrapper>
  );
}

export function TextArea({ label, id, error, hint, required, rows = 4, className = '', ...rest }) {
  const fieldId = id || rest.name;
  return (
    <FieldWrapper label={label} htmlFor={fieldId} error={error} hint={hint} required={required}>
      <textarea
        id={fieldId}
        rows={rows}
        className={`field__control field__control--textarea ${error ? 'field__control--error' : ''} ${className}`}
        {...rest}
      />
    </FieldWrapper>
  );
}

export function Select({ label, id, error, hint, required, children, className = '', ...rest }) {
  const fieldId = id || rest.name;
  return (
    <FieldWrapper label={label} htmlFor={fieldId} error={error} hint={hint} required={required}>
      <select
        id={fieldId}
        className={`field__control field__control--select ${error ? 'field__control--error' : ''} ${className}`}
        {...rest}
      >
        {children}
      </select>
    </FieldWrapper>
  );
}
