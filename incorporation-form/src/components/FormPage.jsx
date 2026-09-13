import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FORM_SCHEMA } from '../data/formSchema.js';
import { useFormState } from '../hooks/useFormState.js';
import { useRecords } from '../hooks/useRecords.js';
import { generateSummaryPdf } from '../lib/pdfSummary.js';
import TopBar from './layout/TopBar.jsx';
import SettingsDrawer from './settings/SettingsDrawer.jsx';
import ProgressNav from './form/ProgressNav.jsx';
import FormSection from './form/FormSection.jsx';

export default function FormPage({ onSubmitted }) {
  const { formState, setValue, toggleCheckboxOption, errors, validate, isFieldVisible } = useFormState();
  const { submitRecord } = useRecords();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeId, setActiveId] = useState(FORM_SCHEMA[0].id);
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
  }, []);

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
      const pdfBlob = await generateSummaryPdf(formState);
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

        <ProgressNav sections={FORM_SCHEMA} activeId={activeId} onJump={jumpTo} />

        {FORM_SCHEMA.map((section) => (
          <FormSection
            key={section.id}
            section={section}
            sectionRef={(el) => (sectionRefs.current[section.id] = el)}
            {...fieldProps}
          />
        ))}

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
