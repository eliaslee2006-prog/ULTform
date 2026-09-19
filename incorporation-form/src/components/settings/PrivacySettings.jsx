import React from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';

export default function PrivacySettings() {
  const { settings, updateSettings } = useSettings();

  return (
    <div>
      <div className="if-settings-group">
        <h3>Local record retention</h3>
        <p style={{ fontSize: 12.5, color: 'var(--if-text-muted)', marginTop: 0 }}>
          Once a submission has synced to SharePoint (the permanent copy), how long should it stay
          on this device before it's automatically removed? Records that haven't synced yet are
          never auto-removed.
        </p>
        <div className="if-settings-row">
          <label>Keep synced records for</label>
          <select
            value={settings.recordRetentionDays}
            onChange={(e) => updateSettings({ recordRetentionDays: parseInt(e.target.value, 10) })}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={0}>Keep forever</option>
          </select>
        </div>
      </div>

      <div className="if-settings-group">
        <h3>About this data</h3>
        <p style={{ fontSize: 12.5, color: 'var(--if-text-muted)' }}>
          This form collects NRIC/FIN/passport numbers, addresses, contact details, and a signature
          for the purpose of preparing your company incorporation filing. Submissions are uploaded
          to company SharePoint storage and are only accessible to authorised staff. You can request
          access to, correction of, or deletion of your submitted data by contacting the staff member
          who assisted you.
        </p>
      </div>
    </div>
  );
}
