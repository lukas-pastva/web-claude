import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function CodexTerminal({ repoPath }) {
  const ref = useRef(null);
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const fitRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [manualFullscreen, setManualFullscreen] = useState(false);

  const copySelectionUnwrapped = async () => {
    try {
      const t = termRef.current;
      let text = '';
      if (t && typeof t.getSelection === 'function') {
        text = t.getSelection() || '';
      }
      if (!text && typeof window !== 'undefined' && window.getSelection) {
        text = String(window.getSelection()?.toString() || '');
      }
      if (!text && ref.current) {
        try {
          const rows = ref.current.querySelectorAll('.xterm-rows > div');
          if (rows && rows.length) {
            text = Array.from(rows).map(r => r.textContent || '').join('\n');
          }
        } catch {}
      }
      if (!text) return;
      // Strip ANSI escapes, CR, and join all newlines (soft wraps) without spaces
      const ansiRe = /\x1b\[[0-9;]*[A-Za-z]/g;
      const out = text.replace(ansiRe, '').replace(/\r/g, '').replace(/\n+/g, '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(out);
      } else {
        const ta = document.createElement('textarea');
        ta.value = out; ta.style.position = 'fixed'; ta.style.left = '-1000px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
    } catch {}
  };

  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteBuffer, setPasteBuffer] = useState("");
  const pasteFromClipboard = async () => {
    try {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      let text = '';
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          text = await navigator.clipboard.readText();
        } catch (e) {
          // fall through to manual modal
        }
      }
      if (!text) {
        // Open a multiline modal to allow manual paste
        setPasteBuffer("");
        setShowPasteModal(true);
        return;
      }
      ws.send(text);
    } catch {}
  };

  useEffect(() => {
    // Smaller default font on mobile phones; tablet a bit larger
    const baseFontSize = (() => {
      try {
        const mq = (q) => (window.matchMedia ? window.matchMedia(q).matches : false);
        const isPhone = mq('(max-width: 480px)');
        const isTablet = !isPhone && mq('(max-width: 820px)');
        return isPhone ? 11 : (isTablet ? 12 : 13);
      } catch { return 13; }
    })();
    const term = new Terminal({ convertEol: true, cursorBlink: true, fontSize: baseFontSize });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    termRef.current = term;
    term.open(ref.current);
    // Fit to container after mount
    try { fit.fit(); } catch {}
    // Refit on window resize
    const onResize = () => { try { fitRef.current && fitRef.current.fit(); } catch {} };
    window.addEventListener('resize', onResize);
    term.writeln('\x1b[1;34mweb-codex\x1b[0m — attaching to Codex CLI...');
    const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/terminal?repoPath=${encodeURIComponent(repoPath||'')}`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      let s = typeof ev.data === 'string' ? ev.data : String(ev.data);
      term.write(s);
    };
    ws.onclose = () => term.writeln('\r\n[session closed]\r\n');
    term.onData(data => ws.readyState === 1 && ws.send(data));
    return () => { try { ws.close(); } catch {}; window.removeEventListener('resize', onResize); term.dispose(); };
  }, [repoPath]);

  // Track fullscreen state changes and refit terminal
  useEffect(() => {
    const onFsChange = () => {
      try {
        const cur = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        const active = Boolean(cur && (cur === containerRef.current));
        setIsFullscreen(active);
        setTimeout(() => { try { fitRef.current && fitRef.current.fit(); } catch {} }, 50);
      } catch {}
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('mozfullscreenchange', onFsChange);
    document.addEventListener('MSFullscreenChange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('mozfullscreenchange', onFsChange);
      document.removeEventListener('MSFullscreenChange', onFsChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      const node = containerRef.current;
      if (!node) return;
      const cur = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
      const canNative = Boolean(
        node.requestFullscreen || node.webkitRequestFullscreen || node.mozRequestFullScreen || node.msRequestFullscreen
      );
      if (canNative) {
        try {
          if (cur) {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
            else if (document.mozCancelFullScreen) await document.mozCancelFullScreen();
            else if (document.msExitFullscreen) await document.msExitFullscreen();
          } else {
            if (node.requestFullscreen) await node.requestFullscreen();
            else if (node.webkitRequestFullscreen) await node.webkitRequestFullscreen();
            else if (node.mozRequestFullScreen) await node.mozRequestFullScreen();
            else if (node.msRequestFullscreen) await node.msRequestFullscreen();
          }
        } catch (e) {
          // Native fullscreen failed (common on older mobile). Fallback to manual.
          setManualFullscreen(m => !m);
        }
      } else {
        // No native support: use manual fullscreen overlay
        setManualFullscreen(m => !m);
      }
      setTimeout(() => { try { fitRef.current && fitRef.current.fit(); } catch {} }, 100);
    } catch {}
  };

  // Prevent background scroll when using manual fullscreen
  useEffect(() => {
    try {
      const el = document.documentElement;
      const body = document.body;
      if (manualFullscreen) {
        if (el) el.style.overflow = 'hidden';
        if (body) body.style.overflow = 'hidden';
      } else {
        if (el) el.style.overflow = '';
        if (body) body.style.overflow = '';
      }
    } catch {}
    return () => {
      try {
        const el = document.documentElement; const body = document.body;
        if (el) el.style.overflow = '';
        if (body) body.style.overflow = '';
      } catch {}
    };
  }, [manualFullscreen]);

  const fullscreenActive = isFullscreen || manualFullscreen;

  return (
    <div
      ref={containerRef}
      className="pane"
      style={fullscreenActive
        ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, height: '100vh', display: 'flex', flexDirection: 'column', zIndex: 9999, borderRadius: 0, margin: 0 }
        : {}}
    >
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
        <div className="muted" style={{display:'flex', alignItems:'center', gap: 12}}>
          <span style={{display:'inline-flex', alignItems:'center'}}>
            <button
              className="secondary"
              onClick={() => {
                const t = termRef.current; if (!t) return;
                const cur = Number(t.options?.fontSize || 14);
                t.options.fontSize = cur + 1;
                try { fitRef.current && fitRef.current.fit(); } catch {}
              }}
            >A+</button>
            <button
              className="secondary"
              style={{ marginLeft: 6 }}
              onClick={() => {
                const t = termRef.current; if (!t) return;
                const cur = Number(t.options?.fontSize || 14);
                const next = Math.max(10, cur - 1);
                t.options.fontSize = next;
                try { fitRef.current && fitRef.current.fit(); } catch {}
              }}
            >A-</button>
            <button
              className="secondary icon"
              style={{ marginLeft: 6 }}
              onClick={copySelectionUnwrapped}
              title="Copy selection without line wraps"
            >📋</button>
            <button
              className="secondary icon"
              style={{ marginLeft: 6 }}
              onClick={pasteFromClipboard}
              title="Paste clipboard into terminal"
            >📥</button>
          </span>
        </div>
        <div>
          <button
            className={"secondary icon" + (fullscreenActive ? " active" : "")}
            onClick={toggleFullscreen}
            title={fullscreenActive ? 'Exit fullscreen' : 'Fullscreen terminal'}
          >{fullscreenActive ? '⤡' : '⤢'}</button>
        </div>
      </div>
      <div ref={ref} className="term" style={fullscreenActive ? { flex: 1, minHeight: 0, height: 'auto' } : {}} />
      {showPasteModal && (
        <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div style={{background:'#1e1e1e',border:'1px solid #444',borderRadius:6,width:'min(800px, 95vw)',maxWidth:'95vw',padding:12,boxShadow:'0 6px 24px rgba(0,0,0,0.5)'}}>
            <div style={{marginBottom:8,fontWeight:600}}>Paste text to send to terminal</div>
            <textarea
              value={pasteBuffer}
              onChange={e => setPasteBuffer(e.target.value)}
              placeholder="Paste here..."
              style={{width:'100%',height:'40vh',resize:'vertical',background:'#111',color:'#eee',border:'1px solid #333',borderRadius:4,padding:8,fontFamily:'monospace',fontSize:13}}
              autoFocus
            />
            <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:10}}>
              <button className="secondary" onClick={() => { setShowPasteModal(false); setPasteBuffer(''); }}>Cancel</button>
              <button
                onClick={() => {
                  try {
                    const ws = wsRef.current;
                    if (ws && ws.readyState === 1 && pasteBuffer) ws.send(pasteBuffer);
                  } catch {}
                  setShowPasteModal(false);
                  setPasteBuffer('');
                }}
              >Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
