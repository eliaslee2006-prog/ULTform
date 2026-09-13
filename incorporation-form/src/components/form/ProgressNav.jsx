import React from 'react';

function shortLabel(title) {
  return title.replace(/^Part\s*\d+:\s*/i, '');
}

export default function ProgressNav({ sections, activeId, onJump }) {
  return (
    <nav className="if-progress-nav">
      {sections.map((section) => (
        <button
          key={section.id}
          className={`if-progress-pill${activeId === section.id ? ' active' : ''}`}
          onClick={() => onJump(section.id)}
          type="button"
        >
          {shortLabel(section.title)}
        </button>
      ))}
    </nav>
  );
}
