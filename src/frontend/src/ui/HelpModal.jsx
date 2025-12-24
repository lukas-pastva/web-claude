import React from 'react';

export default function HelpModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'grid',placeItems:'center',zIndex:9998}} onClick={onClose}>
      <div className="pane" style={{width:'min(720px,90vw)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <strong>Keyboard shortcuts</strong>
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
        <ul>
          <li><code>p</code> — git pull</li>
          <li><code>b</code> — focus branch dropdown</li>
          <li><code>d</code> — refresh diff</li>
          <li><code>c</code> — apply & push</li>
          <li><code>?</code> — toggle this help</li>
        </ul>
      </div>
    </div>
  );
}
