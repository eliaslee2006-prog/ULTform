import React from 'react';
import SignatureField from './SignatureField.jsx';

export default function FieldRenderer({ field, value, error, onChange, onToggleOption }) {
  const wrapperClass = `if-field${field.required ? ' required' : ''}${error ? ' invalid' : ''}`;
  const style = field.span === 1 ? undefined : { gridColumn: '1 / -1' };

  if (field.type === 'signature') {
    return (
      <div className={wrapperClass} style={{ gridColumn: '1 / -1' }} id={field.id}>
        <label>{field.label}</label>
        <SignatureField value={value} onChange={onChange} />
        {error && <div className="if-error-text">{error}</div>}
      </div>
    );
  }

  if (field.type === 'checkbox-group') {
    return (
      <div className={wrapperClass} style={style} id={field.id}>
        <label>
          {field.label}
          {field.hint && <span className="if-hint">{field.hint}</span>}
        </label>
        <div className="if-checkbox-group">
          {field.options.map((opt) => (
            <label className="if-checkbox-option" key={opt.value}>
              <input
                type="checkbox"
                checked={Array.isArray(value) && value.includes(opt.value)}
                onChange={() => onToggleOption(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
        {error && <div className="if-error-text">{error}</div>}
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div className={wrapperClass} style={style} id={field.id}>
        <label htmlFor={`${field.id}-input`}>
          {field.label}
          {field.hint && <span className="if-hint">{field.hint}</span>}
        </label>
        <select id={`${field.id}-input`} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>
            Select…
          </option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <div className="if-error-text">{error}</div>}
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className={wrapperClass} style={style} id={field.id}>
        <label htmlFor={`${field.id}-input`}>{field.label}</label>
        <textarea id={`${field.id}-input`} value={value} onChange={(e) => onChange(e.target.value)} />
        {error && <div className="if-error-text">{error}</div>}
      </div>
    );
  }

  return (
    <div className={wrapperClass} style={style} id={field.id}>
      <label htmlFor={`${field.id}-input`}>
        {field.label}
        {field.hint && <span className="if-hint">{field.hint}</span>}
      </label>
      <input id={`${field.id}-input`} type={field.type} value={value} onChange={(e) => onChange(e.target.value)} />
      {error && <div className="if-error-text">{error}</div>}
    </div>
  );
}
