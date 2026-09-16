import React from 'react';

const SHARED_FIELDS = ['address', 'nationality', 'country_of_birth', 'tel', 'mobile', 'email'];

export default function CopyFromFirstButton({ role, index, roleLabel, formState, setValues }) {
  if (index <= 1) return null;

  const copy = () => {
    const updates = {};
    for (const field of SHARED_FIELDS) {
      updates[`${role}${index}_${field}`] = formState[`${role}1_${field}`];
    }
    setValues(updates);
  };

  return (
    <button type="button" className="if-btn if-btn-ghost if-copy-first-btn" onClick={copy}>
      Same as {roleLabel} 1
    </button>
  );
}
