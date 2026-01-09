import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

export default function ClaudeTerminal({ repoPath }) {
  const ref = useRef(null);
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const fitRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [manualFullscreen, setManualFullscreen] = useState(false);
  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  // Track WebSocket connection state to prevent orphaned connections
  const wsStateRef = useRef('closed'); // 'closed' | 'connecting' | 'open'

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
    // Mark component as mounted
    isMountedRef.current = true;

    // Smaller default font on mobile phones; tablet a bit larger
    const baseFontSize = (() => {
      try {
        const mq = (q) => (window.matchMedia ? window.matchMedia(q).matches : false);
        const isPhone = mq('(max-width: 480px)');
        const isTablet = !isPhone && mq('(max-width: 820px)');
        return isPhone ? 11 : (isTablet ? 12 : 13);
      } catch { return 13; }
    })();
    const term = new Terminal({ cursorBlink: true, fontSize: baseFontSize });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    // Make URLs clickable - opens in new tab
    const webLinks = new WebLinksAddon((event, uri) => {
      window.open(uri, '_blank', 'noopener,noreferrer');
    });
    term.loadAddon(webLinks);
    termRef.current = term;
    term.open(ref.current);
    // Fit to container after mount
    try { fit.fit(); } catch {}
    // Refit on window resize
    const onResize = () => { try { fitRef.current && fitRef.current.fit(); } catch {} };
    window.addEventListener('resize', onResize);
    term.writeln('\x1b[1;34mweb-claude\x1b[0m — attaching to Claude CLI...');

    // Create WebSocket with state tracking
    const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
    wsStateRef.current = 'connecting';
    const ws = new WebSocket(`${proto}://${location.host}/ws/terminal?repoPath=${encodeURIComponent(repoPath||'')}`);
    wsRef.current = ws;

    ws.onmessage = async (ev) => {
      // Skip if component unmounted
      if (!isMountedRef.current) return;
      let s;
      if (typeof ev.data === 'string') {
        s = ev.data;
      } else if (ev.data instanceof Blob) {
        s = await ev.data.text();
      } else if (ev.data instanceof ArrayBuffer) {
        s = new TextDecoder().decode(ev.data);
      } else {
        s = String(ev.data);
      }
      term.write(s);
    };

    ws.onclose = () => {
      wsStateRef.current = 'closed';
      // Only write to terminal if still mounted
      if (isMountedRef.current) {
        term.writeln('\r\n[session closed]\r\n');
      }
    };

    ws.onerror = (err) => {
      wsStateRef.current = 'closed';
      console.error('WebSocket error:', err);
    };

    ws.onopen = () => {
      wsStateRef.current = 'open';
      // Skip if component unmounted during connection
      if (!isMountedRef.current) {
        ws.close();
        return;
      }
      // Send initial terminal size
      try {
        const { cols, rows } = term;
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      } catch {}
    };

    term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Sync terminal size changes to PTY
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'resize', cols, rows })); } catch {}
      }
    });

    return () => {
      // Mark component as unmounted first
      isMountedRef.current = false;

      // Close WebSocket regardless of state
      try {
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      } catch {}
      wsStateRef.current = 'closed';
      wsRef.current = null;

      window.removeEventListener('resize', onResize);
      term.dispose();
    };
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
        <div className="muted" style={{display:'flex', alignItems:'center', gap: 6}}>
          <button
            type="button"
            className="secondary"
            onClick={(e) => {
              e.preventDefault();
              const t = termRef.current; if (!t) return;
              const cur = Number(t.options?.fontSize || 14);
              t.options.fontSize = cur + 1;
              try { fitRef.current && fitRef.current.fit(); } catch {}
            }}
          >A+</button>
          <button
            type="button"
            className="secondary"
            onClick={(e) => {
              e.preventDefault();
              const t = termRef.current; if (!t) return;
              const cur = Number(t.options?.fontSize || 14);
              const next = Math.max(10, cur - 1);
              t.options.fontSize = next;
              try { fitRef.current && fitRef.current.fit(); } catch {}
            }}
          >A-</button>
          <button
            type="button"
            className="secondary icon"
            onClick={(e) => {
              e.preventDefault();
              pasteFromClipboard();
            }}
            title="Paste clipboard into terminal"
          >📥</button>
          <button
            type="button"
            className="secondary icon"
            onClick={(e) => {
              e.preventDefault();
              const t = termRef.current;
              if (t && typeof t.scrollToBottom === 'function') {
                t.scrollToBottom();
              }
            }}
            title="Scroll to bottom"
          >⬇</button>
          <span style={{ marginLeft: 6, borderLeft: '1px solid #444', paddingLeft: 12, display: 'inline-flex', gap: 6 }}>
            {[1, 2].map(n => (
              <button
                key={n}
                type="button"
                className="secondary"
                style={{ minWidth: 32 }}
                onClick={(e) => {
                  e.preventDefault();
                  const t = termRef.current;
                  const ws = wsRef.current;
                  if (t) {
                    t.focus();
                  }
                  if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(String(n));
                  }
                }}
                title={`Send ${n}`}
              >{n}</button>
            ))}
          </span>
        </div>
        <div>
          <button
            type="button"
            className={"secondary icon" + (fullscreenActive ? " active" : "")}
            onClick={(e) => {
              e.preventDefault();
              toggleFullscreen();
            }}
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
