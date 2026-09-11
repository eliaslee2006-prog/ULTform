export async function shareCompletedPDF(pdfBlob, fileName) {
  if (navigator.canShare && navigator.canShare({ files: [new File([pdfBlob], fileName, { type: 'application/pdf' })] })) {
    const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
    try {
      await navigator.share({ files: [file], title: fileName });
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Share failed', err);
      return false;
    }
  }
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return false;
}

// Free click-to-chat links — no WhatsApp Business API / Telegram Bot API needed.
// countryCode + number as digits only, no plus sign, e.g. "14155550123".
export function openWhatsAppShare(phoneDigits, message) {
  const text = encodeURIComponent(message);
  const url = phoneDigits
    ? `https://wa.me/${phoneDigits}?text=${text}`
    : `https://wa.me/?text=${text}`;
  window.open(url, '_blank');
}

export function openTelegramShare(username, message) {
  const text = encodeURIComponent(message);
  const url = username
    ? `https://t.me/${username}?text=${text}`
    : `https://t.me/share/url?url=&text=${text}`;
  window.open(url, '_blank');
}

// Note: click-to-chat links can't attach the file directly (browser security limit) —
// the practical flow is share the file via shareCompletedPDF()/native share sheet first,
// then use these to open a prefilled chat pointing at where the file was just saved.
