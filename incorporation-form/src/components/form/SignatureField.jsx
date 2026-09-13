import React, { useState } from 'react';
import SignatureModal from '../signature/SignatureModal.jsx';

export default function SignatureField({ value, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="if-signature-box" onClick={() => setOpen(true)} role="button" tabIndex={0}>
        {value ? (
          <img src={value} alt="Your signature" />
        ) : (
          <div className="if-signature-placeholder">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 17l6-6 4 4L21 7" />
              <path d="M14 5h7v7" />
            </svg>
            Tap to sign
          </div>
        )}
      </div>
      <SignatureModal
        open={open}
        onClose={() => setOpen(false)}
        onSave={(dataUrl) => {
          onChange(dataUrl);
          setOpen(false);
        }}
      />
    </>
  );
}
