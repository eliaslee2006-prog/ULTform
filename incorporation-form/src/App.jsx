import React, { useEffect, useState } from 'react';
import { SettingsProvider } from './context/SettingsContext.jsx';
import { initSyncEngine } from './lib/syncEngine.js';
import FormPage from './components/FormPage.jsx';
import ThankYouScreen from './components/ThankYouScreen.jsx';

export default function App() {
  const [submittedRecord, setSubmittedRecord] = useState(null);

  useEffect(() => {
    initSyncEngine();
  }, []);

  return (
    <SettingsProvider>
      {submittedRecord ? (
        <ThankYouScreen record={submittedRecord} onStartNew={() => setSubmittedRecord(null)} />
      ) : (
        <FormPage onSubmitted={setSubmittedRecord} />
      )}
    </SettingsProvider>
  );
}
