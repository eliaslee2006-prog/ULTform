import React, { useEffect, useState } from 'react';
import { SettingsProvider, useSettings } from './context/SettingsContext.jsx';
import { initSyncEngine } from './lib/syncEngine.js';
import { useRecords } from './hooks/useRecords.js';
import FormPage from './components/FormPage.jsx';
import ThankYouScreen from './components/ThankYouScreen.jsx';

function RetentionGuard() {
  const { settings, loaded } = useSettings();
  const { purgeExpiredRecords } = useRecords();

  useEffect(() => {
    if (!loaded) return;
    purgeExpiredRecords(settings.recordRetentionDays);
  }, [loaded, settings.recordRetentionDays, purgeExpiredRecords]);

  return null;
}

function AppShell() {
  const [submittedRecord, setSubmittedRecord] = useState(null);

  return (
    <>
      <RetentionGuard />
      {submittedRecord ? (
        <ThankYouScreen record={submittedRecord} onStartNew={() => setSubmittedRecord(null)} />
      ) : (
        <FormPage onSubmitted={setSubmittedRecord} />
      )}
    </>
  );
}

export default function App() {
  useEffect(() => {
    initSyncEngine();
  }, []);

  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
}
