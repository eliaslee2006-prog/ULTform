// Ported from ULTform's js/share.js — native Web Share sheet (so a Record can be sent to
// other mobile apps directly) with a plain-download fallback for desktop/unsupported browsers.
export async function sharePdf(pdfBlob, fileName) {
  const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
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
