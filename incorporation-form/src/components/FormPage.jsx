import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MIN_PEOPLE, MAX_PEOPLE } from '../data/formSchema.js';
import { useFormState } from '../hooks/useFormState.js';
import { useRecords } from '../hooks/useRecords.js';
import { generateSummaryPdf } from '../lib/pdfSummary.js';
import TopBar from './layout/TopBar.jsx';
import SettingsDrawer from './settings/SettingsDrawer.jsx';
import ProgressNav from './form/ProgressNav.jsx';
import FormSection from './form/FormSection.jsx';
import CopyFromFirstButton from './form/CopyFromFirstButton.jsx';

function CountControl({ count, onChange, label }) {
  return (
    <span className="if-count-control">
      {label}
      <button type="button" className="if-count-btn" onClick={() => onChange(count - 1)} disabled={count <= MIN_PEOPLE} aria-label={`Remove ${label.toLowerCase()}`}>
        −
      </button>
      <span className="if-count-value">{count}</span>
      <button type="button" className="if-count-btn" onClick={() => onChange(count + 1)} disabled={count >= MAX_PEOPLE} aria-label={`Add ${label.toLowerCase()}`}>
        +
      </button>
    </span>
  );
}

export default function FormPage({ onSubmitted }) {
  const {
    schema,
    directorCount,
    shareholderCount,
    changeDirectorCount,
    changeShareholderCount,
    formState,
    setValue,
    setValues,
    toggleCheckboxOption,
    errors,
    validate,
    isFieldVisible
  } = useFormState();
  const { submitRecord } = useRecords();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeId, setActiveId] = useState(schema[0].id);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const sectionRefs = useRef({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] }
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [schema]);

  const jumpTo = (id) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const fieldProps = useMemo(
    () => ({ formState, errors, isFieldVisible, setValue, toggleCheckboxOption }),
    [formState, errors, isFieldVisible, setValue, toggleCheckboxOption]
  );

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!validate()) {
      const firstErrorId = Object.keys(errors)[0];
      if (firstErrorId) {
        document.getElementById(firstErrorId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    setSubmitting(true);
    try {
      const pdfBlob = await generateSummaryPdf(formState, { schema });
      const customerName = formState.company_name_1 || formState.signature_name || 'Incorporation Factsheet';
      const record = await submitRecord({ pdfBlob, customerName });
      onSubmitted(record);
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || 'Something went wrong generating your submission. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="if-shell">
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="if-container">
        <div className="if-masthead">
          <h1>Factsheet for Incorporation of New Company</h1>
          <p>Please complete every section below. Fields marked * are mandatory.</p>
        </div>

        <ProgressNav sections={schema} activeId={activeId} onJump={jumpTo} />

        {schema.map((section) => {
          let headerExtra = null;
          let renderSubExtra = null;

          if (section.id === 'part7') {
            headerExtra = <CountControl count={directorCount} onChange={changeDirectorCount} label="Directors" />;
            renderSubExtra = (sub, index) => (
              <CopyFromFirstButton role="director" index={index + 1} roleLabel="Director" formState={formState} setValues={setValues} />
            );
          } else if (section.id === 'part8') {
            headerExtra = <CountControl count={shareholderCount} onChange={changeShareholderCount} label="Shareholders" />;
            renderSubExtra = (sub, index) => (
              <CopyFromFirstButton role="shareholder" index={index + 1} roleLabel="Shareholder" formState={formState} setValues={setValues} />
            );
          }

          return (
            <FormSection
              key={section.id}
              section={section}
              sectionRef={(el) => (sectionRefs.current[section.id] = el)}
              headerExtra={headerExtra}
              renderSubExtra={renderSubExtra}
              {...fieldProps}
            />
          );
        })}

        {submitError && <div className="if-error-text" style={{ marginBottom: 12 }}>{submitError}</div>}

        <div className="if-submit-bar">
          <button className="if-btn if-btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Generating your copy…' : 'Submit'}
          </button>
        </div>
      </div>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
