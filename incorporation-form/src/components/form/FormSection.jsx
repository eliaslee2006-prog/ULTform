import React from 'react';
import FieldRenderer from './FieldRenderer.jsx';

function FieldGrid({ fields, formState, errors, isFieldVisible, setValue, toggleCheckboxOption }) {
  return (
    <div className="if-section-body">
      {fields
        .filter((f) => isFieldVisible(f, formState))
        .map((field) => (
          <FieldRenderer
            key={field.id}
            field={field}
            value={formState[field.id]}
            error={errors[field.id]}
            onChange={(v) => setValue(field.id, v)}
            onToggleOption={(optionValue) => toggleCheckboxOption(field.id, optionValue)}
          />
        ))}
    </div>
  );
}

export default function FormSection({ section, sectionRef, headerExtra, renderSubExtra, ...rest }) {
  return (
    <section className="if-section" id={section.id} ref={sectionRef}>
      <div className="if-section-header if-section-header-row">
        <span>{section.title}</span>
        {headerExtra}
      </div>
      {section.hint && <div className="if-section-sub">{section.hint}</div>}

      {section.fields && <FieldGrid fields={section.fields} {...rest} />}

      {section.subsections &&
        section.subsections.map((sub, index) => (
          <React.Fragment key={sub.id}>
            <div className="if-section-sub if-section-sub-row">
              <span>{sub.title}</span>
              {renderSubExtra && renderSubExtra(sub, index)}
            </div>
            <FieldGrid fields={sub.fields} {...rest} />
          </React.Fragment>
        ))}
    </section>
  );
}
