// Module 1: Tab Navigation System
const tabs = document.querySelectorAll('.hud-btn');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', (e) => {
    // UI Feedback
    e.target.style.animation = 'none';
    setTimeout(() => e.target.style.animation = 'pulse 0.3s', 10);

    // Switch Tabs
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// Module 2: Native iOS Export & Web Share API
document.getElementById('exportBtn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.innerText = 'Preparing...';

  try {
    // In V2, pdf-lib flattening goes here. Using a mock text file for V1 testing.
    const mockFileContent = "Intake Form Export Data\nName: Elias\nDate: 2026-09-11";
    const blob = new Blob([mockFileContent], { type: 'text/plain' });
    const file = new File([blob], 'Intake_Export.txt', { type: 'text/plain' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: 'Intake Document',
        text: 'Please find the attached intake document.',
        files: [file]
      });
      btn.innerText = 'Shared Successfully';
    } else {
      // Fallback for desktop browsers
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Intake_Export.txt';
      a.click();
      URL.revokeObjectURL(url);
      btn.innerText = 'Downloaded';
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      alert(`Export failed: ${error.message}`);
      btn.innerText = 'Export Failed';
    } else {
      btn.innerText = 'Export / Share'; // User cancelled share sheet
    }
  }

  setTimeout(() => btn.innerText = 'Export / Share', 3000);
});

// Module 3: Mock DOM Overlay Injector (Prep for V2)
const overlay = document.getElementById('interactive-overlay');

document.getElementById('addTextBtn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type here...';
  input.style.position = 'absolute';
  input.style.top = '10%';
  input.style.left = '10%';
  input.style.padding = '8px';
  input.style.border = '2px dashed var(--primary-accent)';
  input.style.borderRadius = '6px';
  input.style.background = 'rgba(255,255,255,0.8)';
  input.style.fontSize = '16px';
  
  // Basic touch dragging logic to be expanded in V2
  overlay.appendChild(input);
  input.focus();
});
