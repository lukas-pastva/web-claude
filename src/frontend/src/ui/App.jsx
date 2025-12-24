import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import CodexTerminal from "./Terminal.jsx";
import FileTree from "./FileTree.jsx";
import DiffPretty from "./DiffPretty.jsx";
import { ToastProvider, useToast } from "./ToastContext.jsx";

function GroupTabs({ providers, current, setCurrent }) {
  const items = [];
  if (providers.github) {
    for (const key of Object.keys(providers.github)) items.push({ provider: "github", key });
  }
  if (providers.gitlab) {
    for (const key of Object.keys(providers.gitlab)) items.push({ provider: "gitlab", key });
  }
  return (
    <div className="tabs">
      {items.map((it, idx) => {
        const id = `${it.provider}:${it.key}`;
        const active = current === id;
        const count = (providers[it.provider]?.[it.key] || []).length;
        return (
          <div
            key={idx}
            className={"tab " + (active ? "active" : "")}
            onClick={() => setCurrent(id)}
            aria-current={active ? 'page' : undefined}
            title={`${it.provider} / ${it.key}`}
          >
            {active && <span className="current-dot" />}
            <span style={{fontWeight: active ? 600 : 500}}>{it.provider} / {it.key}</span>
            <span className="tag" style={{marginLeft: 6}}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function RepoList({ repos, onSelect, currentId }) {
  const [q, setQ] = useState("");
  const sorted = [...repos].sort((a,b)=>{
    const an = (a.name || '').toLowerCase();
    const bn = (b.name || '').toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });
  const ql = (q || '').trim().toLowerCase();
  const filtered = ql
    ? sorted.filter(r => {
        const fields = [r.name, r.full_name, r.path_with_namespace];
        return fields.some(v => (v || '').toLowerCase().includes(ql));
      })
    : sorted;
  return (
    <div className="pane">
      <input
        placeholder="Search repos..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      {filtered.map((r, i) => (
        <div key={i} className="repo" onClick={() => onSelect(r)} style={{cursor:'pointer'}}>
          <div>
            <div><strong>{r.name}</strong></div>
            <div className="muted">{r.full_name || r.path_with_namespace}</div>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button onClick={(e) => { e.stopPropagation(); onSelect(r); }}>Open</button>
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="muted">No repos match your search</div>
      )}
    </div>
  )
}

function RepoActions({ repo, meta, setMeta }) {
  const toast = useToast();
  const [branches, setBranches] = useState([]);
  const [current, setCurrent] = useState("");
  const [log, setLog] = useState([]);
  const [patch, setPatch] = useState("");
  const [showPretty, setShowPretty] = useState(false);
  const [prettyMode, setPrettyMode] = useState('unified'); // unified | side-by-side
  const [threeWayActive, setThreeWayActive] = useState(false);
  const [threeWayData, setThreeWayData] = useState(null);
  const [threeWayLoading, setThreeWayLoading] = useState(false);
  const [threeWayError, setThreeWayError] = useState('');
  const [openFile, setOpenFile] = useState(null);
  const [openFileContent, setOpenFileContent] = useState("");
  // Patch preview interactions
  const [selectedDiffFile, setSelectedDiffFile] = useState("");
  const diffPaneRef = useRef(null);
  const [isDiffFullscreen, setIsDiffFullscreen] = useState(false);
  const [manualDiffFullscreen, setManualDiffFullscreen] = useState(false);
  // Always auto-refresh patch every 5 seconds (mobile-friendly)
  const [pullInfo, setPullInfo] = useState({ at: null, upToDate: null, behind: 0 });
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  // Only show the latest commit
  const [changedFiles, setChangedFiles] = useState([]);
  const [showAllChanged, setShowAllChanged] = useState(false);
  // Copy feedback state for the copy-hash button
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef(null);
  // Haptics: vibrate on new changes when supported (mobile)
  const prevChangedCountRef = useRef(0);
  const lastVibeAtRef = useRef(0);

  const loadBranches = async () => {
    const r = await axios.get("/api/git/branches", { params: { repoPath: meta.repoPath }});
    setBranches(r.data.all || []);
    setCurrent(r.data.current || "");
  };

  const refreshLog = async () => {
    const r = await axios.get("/api/git/log", { params: { repoPath: meta.repoPath }});
    setLog(r.data.commits || []);
  };
  const refreshStatus = async () => {
    const r = await axios.get("/api/git/status", { params: { repoPath: meta.repoPath }});
    const behind = Number(r.data.status?.behind || 0);
    setPullInfo(p => ({ ...p, upToDate: behind === 0, behind }));
  };

  // Keyboard shortcuts removed for simplicity and mobile friendliness

  useEffect(() => {
    if (meta.repoPath) {
      loadBranches();
      refreshLog();
      refreshStatus();
      refreshDiff();
    }
  }, [meta.repoPath]);

  // Terminal is always visible

  const doPull = async () => {
    try {
      setPulling(true);
      const r = await axios.post("/api/git/pull", { repoPath: meta.repoPath });
      const up = Boolean(r.data?.status?.upToDate);
      const beforeBehind = Number(r.data?.status?.before?.behind || 0);
      const afterBehind = Number(r.data?.status?.after?.behind || 0);
      const behind = afterBehind;
      setPullInfo({ at: new Date().toISOString(), upToDate: up, behind });
      await refreshLog();
      await refreshDiff();
      try { await refreshStatus(); } catch {}
      const pulled = Math.max(0, beforeBehind - afterBehind);
      const msg = up
        ? "Already up to date ✅"
        : (pulled > 0 ? `Pulled ${pulled} commit${pulled===1?'':'s'} ✅` : "Pull complete ✅");
      toast && toast(msg);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Pull failed";
      try { toast && toast(`Pull failed: ${msg}`); } catch {}
      try { alert(`Pull failed: ${msg}`); } catch {}
    } finally {
      setPulling(false);
    }
  };

  const doCheckout = async (b) => {
    await axios.post("/api/git/checkout", { repoPath: meta.repoPath, branch: b });
    await loadBranches();
    await refreshDiff();
  };

  const refreshDiff = async () => {
    if (!meta.repoPath) return;
    const r = await axios.get("/api/git/diff", { params: { repoPath: meta.repoPath } });
    setPatch(r.data.diff || "");
  };

  // Parse changed files from unified diff
  useEffect(() => {
    try {
      const diff = patch || '';
      const lines = diff.split(/\n/);
      const out = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
        if (m) {
          let from = m[1];
          let to = m[2];
          let status = 'modified';
          let j = i + 1;
          while (j < lines.length && !lines[j].startsWith('diff --git ')) {
            const l = lines[j];
            if (/^new file mode /.test(l)) status = 'added';
            if (/^deleted file mode /.test(l)) status = 'deleted';
            const rnTo = /^rename to (.+)$/.exec(l);
            const rnFrom = /^rename from (.+)$/.exec(l);
            if (rnTo || rnFrom) status = 'renamed';
            if (rnTo) to = rnTo[1];
            j++;
          }
          const path = status === 'deleted' ? from : to;
          out.push({ path, status });
          i = j;
          continue;
        }
        i++;
      }
      setChangedFiles(out);
      setShowAllChanged(false);
    } catch { setChangedFiles([]); setShowAllChanged(false); }
  }, [patch]);

  // Auto refresh diff every 5 seconds
  useEffect(() => {
    if (!meta.repoPath) return;
    const id = setInterval(() => { refreshDiff().catch(()=>{}); }, 5000);
    return () => clearInterval(id);
  }, [meta.repoPath]);

  // Mobile haptic: vibrate when changes appear/increase
  useEffect(() => {
    try {
      const isTouch = (() => {
        try { return (('ontouchstart' in window) || (navigator.maxTouchPoints > 0)); } catch { return false; }
      })();
      if (!isTouch) return; // only try on mobile/touch devices
      const canVibrate = Boolean(navigator && typeof navigator.vibrate === 'function');
      if (!canVibrate) return;
      const prev = Number(prevChangedCountRef.current || 0);
      const cur = Number((changedFiles || []).length || 0);
      const now = Date.now();
      // Vibrate when count increases, or when first change appears from 0
      if ((cur > 0 && prev === 0) || (cur > prev)) {
        // Rate limit to avoid spam during rapid refreshes
        if (now - (lastVibeAtRef.current || 0) > 5000) {
          try { navigator.vibrate([30, 40, 30]); } catch {}
          lastVibeAtRef.current = now;
        }
      }
      prevChangedCountRef.current = cur;
    } catch {}
  }, [changedFiles]);

  // Periodically refresh upstream status to enable/disable pull button
  useEffect(() => {
    if (!meta.repoPath) return;
    const id = setInterval(() => { refreshStatus().catch(()=>{}); }, 5000); // 5s
    return () => clearInterval(id);
  }, [meta.repoPath]);

  const doApplyCommitPush = async () => {
    try {
      setPushing(true);
      const message = "codex-" + new Date().toISOString();
      await axios.post("/api/git/commitPush", { repoPath: meta.repoPath, message });
      await refreshLog();
      await refreshDiff();
      toast && toast("Pushed ✅");
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Push failed";
      try { toast && toast(`Push failed: ${msg}`); } catch {}
      try { alert(`Push failed: ${msg}`); } catch {}
    } finally {
      setPushing(false);
    }
  };

  // Keep selected file in sync with changed files list
  useEffect(() => {
    if (!selectedDiffFile) return;
    const exists = changedFiles.some(f => f.path === selectedDiffFile);
    if (!exists) setSelectedDiffFile("");
  }, [changedFiles, selectedDiffFile]);

  // Extract only the diff block for a given file
  const extractFileDiff = (diffText, filePath) => {
    try {
      if (!diffText || !filePath) return diffText || "";
      const lines = String(diffText).split(/\n/);
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith('diff --git ')) {
          const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
          const from = m ? m[1] : '';
          const to = m ? m[2] : '';
          let j = i + 1;
          while (j < lines.length && !lines[j].startsWith('diff --git ')) j++;
          if (from === filePath || to === filePath) {
            return lines.slice(i, j).join('\n');
          }
          i = j; continue;
        }
        i++;
      }
      return ""; // no match
    } catch { return diffText || ""; }
  };

  const displayedPatch = useMemo(() => {
    if (!selectedDiffFile) return patch || "";
    return extractFileDiff(patch || "", selectedDiffFile) || "";
  }, [patch, selectedDiffFile]);

  // Load three-way contents when activated and a file is selected
  useEffect(() => {
    const run = async () => {
      if (!threeWayActive || !meta.repoPath || !selectedDiffFile) return;
      setThreeWayLoading(true); setThreeWayError('');
      try {
        const r = await axios.get('/api/git/threeway', { params: { repoPath: meta.repoPath, path: selectedDiffFile } });
        setThreeWayData(r.data);
      } catch (e) {
        setThreeWayError(e?.response?.data?.error || e?.message || 'Failed to load three-way');
      } finally { setThreeWayLoading(false); }
    };
    run().catch(()=>{});
  }, [threeWayActive, meta.repoPath, selectedDiffFile]);

  // Fullscreen handling for diff pane
  useEffect(() => {
    const onFsChange = () => {
      try {
        const cur = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        const active = Boolean(cur && (cur === diffPaneRef.current));
        setIsDiffFullscreen(active);
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

  const toggleDiffFullscreen = async () => {
    try {
      const node = diffPaneRef.current;
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
          setManualDiffFullscreen(m => !m);
        }
      } else {
        // No native support: use manual fullscreen overlay
        setManualDiffFullscreen(m => !m);
      }
    } catch {}
  };

  // Prevent background scroll on manual fullscreen
  useEffect(() => {
    try {
      const el = document.documentElement; const body = document.body;
      if (manualDiffFullscreen) {
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
  }, [manualDiffFullscreen]);

  const copyHash = async (hash) => {
    try {
      await navigator.clipboard.writeText(hash);
      // Visual feedback on the button
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopied(true);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
      // Toast feedback (also works across the app)
      toast && toast("Commit hash copied ✅");
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = hash;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
        toast && toast("Commit hash copied ✅");
      } catch {
        alert("Failed to copy commit hash");
      }
    }
  };

  return (
    <div className="row">
      <div className="col main-col">
        <div className="pane">
          <div className="actions" style={{marginBottom:8, display:'flex', flexWrap:'wrap', gap:8, alignItems:'center'}}>
            {(() => { const disabled = pulling; return (
              <button
                className={"secondary"}
                onClick={doPull}
                disabled={disabled}
                title={pulling ? 'Pulling…' : 'Fetch and pull latest'}
                style={disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
              >
                {pulling
                  ? (<><span className="spinner" aria-hidden="true" /> Pulling…</>)
                  : (pullInfo.upToDate ? 'Up to date' : 'git pull')}
              </button>
            ); })()}
            <span className="muted">
              {pullInfo.at
                ? `Last pull: ${new Date(pullInfo.at).toLocaleTimeString()}`
                : (pullInfo.upToDate === null ? 'Never pulled' : (pullInfo.behind > 0 ? `Behind ${pullInfo.behind}` : ''))}
            </span>
            <select id="branch-select" value={current} onChange={e => doCheckout(e.target.value)}>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            {(() => { const canPush = Boolean((patch||"").trim()); return (
              <button onClick={doApplyCommitPush} disabled={!canPush || pushing} style={(!canPush || pushing) ? {opacity:0.6, cursor:'not-allowed'} : {}}>
                {pushing ? '⏳ Pushing…' : 'Apply & Push'}
              </button>
            );})()}
          </div>
          {/* Last commit info moved into the same pane as git pull */}
          <div className="muted" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}>
            <span>Last commit</span>
            <span></span>
          </div>
          <div className="repo">
            {log && log.length ? (
              <>
                <div className="muted">
                  <a href={log[0].web_url || '#'} target="_blank" rel="noreferrer" title="Open in provider">
                    {log[0].hash.slice(0, 8)}
                  </a>
                  {` · ${new Date(log[0].date).toLocaleString()}`}
                </div>
                <div style={{display:'flex', gap:8, alignItems:'center'}}>
                  <button
                    className={"secondary" + (copied ? " copied" : "")}
                    onClick={() => copyHash(log[0].hash)}
                    title="Copy full commit hash"
                    aria-live="polite"
                  >
                    {copied ? '✓ Copied' : 'copy hash'}
                  </button>
                </div>
              </>
            ) : (
              <div className="muted">No commits</div>
            )}
          </div>
        </div>

        <FileTree repoPath={meta.repoPath} onOpen={async (p)=>{ const r=await axios.get("/api/git/file",{params:{repoPath:meta.repoPath,path:p}}); setOpenFile(p); setOpenFileContent(r.data.text||""); }} />
        {/* Patch preview moved here so that on desktop the terminal can occupy the left column alone */}
        <div
          ref={diffPaneRef}
          className="pane"
          style={(isDiffFullscreen || manualDiffFullscreen)
            ? { height: '100vh', display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, borderRadius: 0, margin: 0 }
            : { marginTop: 16 }}
        >
          <div className="muted" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:8}}>
              <span>Patch preview</span>
              {changedFiles.length > 0 && (
                <span className="tag" title="Changed files count">{changedFiles.length} changed</span>
              )}
            </span>
            <span style={{display:'inline-flex',alignItems:'center',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
              <span className="muted" style={{marginRight:4}}>View:</span>
              <button
                className={"secondary" + (!showPretty && !threeWayActive ? " active" : "")}
                onClick={() => { setThreeWayActive(false); setShowPretty(false); }}
                title="Raw unified diff"
              >Raw</button>
              <button
                className={"secondary" + (showPretty && prettyMode==='unified' && !threeWayActive ? " active" : "")}
                onClick={() => { setThreeWayActive(false); setShowPretty(true); setPrettyMode('unified'); }}
                title="Pretty diff (unified)"
              >Pretty</button>
              <button
                className={"secondary" + (showPretty && prettyMode==='side-by-side' && !threeWayActive ? " active" : "")}
                onClick={() => { setThreeWayActive(false); setShowPretty(true); setPrettyMode('side-by-side'); }}
                title="Pretty diff (side-by-side)"
              >Side-by-side</button>
              <button
                className={"secondary" + (threeWayActive ? " active" : "")}
                onClick={() => setThreeWayActive(v => !v)}
                disabled={!selectedDiffFile}
                title={selectedDiffFile ? 'Three-way (base / HEAD / upstream)' : 'Select a file to enable three-way'}
                style={!selectedDiffFile ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
              >3‑way</button>
              <button
                className={"secondary icon" + ((isDiffFullscreen || manualDiffFullscreen) ? " active" : "")}
                onClick={toggleDiffFullscreen}
                title={(isDiffFullscreen || manualDiffFullscreen) ? 'Exit fullscreen' : 'Fullscreen patch'}
              >{(isDiffFullscreen || manualDiffFullscreen) ? '⤡' : '⤢'}</button>
            </span>
          </div>
          {changedFiles.length > 0 && (
            <div className="muted" style={{margin:"6px 0 8px 0"}}>
              <div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {(showAllChanged ? changedFiles : changedFiles.slice(0, 15)).map((f, idx) => {
                    const active = selectedDiffFile === f.path;
                    const cls = "badge " + (f.status==='added'?'green':(f.status==='deleted'?'red':'gray')) + (active ? " selected" : " interactive");
                    const onClick = () => setSelectedDiffFile(p => (p === f.path ? "" : f.path));
                    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } };
                    return (
                      <span
                        key={idx}
                        className={cls}
                        title={(f.status||'') + (active ? ' • selected' : '')}
                        role="button"
                        tabIndex={0}
                        onClick={onClick}
                        onKeyDown={onKey}
                        aria-pressed={active ? 'true' : 'false'}
                      >{f.path}</span>
                    );
                  })}
                  {(!showAllChanged && changedFiles.length > 15) && (
                    <button className="secondary" onClick={() => setShowAllChanged(true)}>+{changedFiles.length - 15} more</button>
                  )}
                </div>
              </div>
            </div>
          )}
          {(threeWayActive && selectedDiffFile) ? (
            <div style={isDiffFullscreen ? { flex: 1, display:'flex', flexDirection:'column', minHeight:0 } : {}}>
              {threeWayLoading ? (
                <div className="muted">Loading 3‑way…</div>
              ) : threeWayError ? (
                <div className="muted">{threeWayError}</div>
              ) : (threeWayData ? (
                <div>
                  <div className="muted" style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                    <span>Base: {threeWayData.baseRef?.slice?.(0,8) || 'n/a'}</span>
                    <span>Ours: {threeWayData.oursRef || 'HEAD'}</span>
                    <span>Theirs: {threeWayData.theirsRef || ''}</span>
                  </div>
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, alignItems:'stretch'}}>
                    <div>
                      <div className="muted" style={{marginBottom:4}}>Base</div>
                      <code className="diff" style={{maxHeight:isDiffFullscreen? 'none':'50vh'}}>{threeWayData.base || ''}</code>
                    </div>
                    <div>
                      <div className="muted" style={{marginBottom:4}}>Ours (HEAD)</div>
                      <code className="diff" style={{maxHeight:isDiffFullscreen? 'none':'50vh'}}>{threeWayData.ours || ''}</code>
                    </div>
                    <div>
                      <div className="muted" style={{marginBottom:4}}>Theirs (upstream)</div>
                      <code className="diff" style={{maxHeight:isDiffFullscreen? 'none':'50vh'}}>{threeWayData.theirs || ''}</code>
                    </div>
                  </div>
                </div>
              ) : null)}
            </div>
          ) : ((displayedPatch || '').trim() ? (
            showPretty
              ? <DiffPretty diff={displayedPatch} mode={prettyMode === 'side-by-side' ? 'side-by-side' : 'unified'} />
              : <code className="diff" style={isDiffFullscreen ? { flex: 1, minHeight: 0, maxHeight: 'none' } : {}}>{displayedPatch}</code>
          ) : null)}
        </div>
      </div>

      <div className="col cli-col">
        <CodexTerminal repoPath={meta.repoPath} />
      </div>
    </div>
  )
}

export default function App() {
  const [phase, setPhase] = useState("repos"); // repos only
  const [providers, setProviders] = useState({ github: {}, gitlab: {} });
  const [activePane, setActivePane] = useState("actions"); // actions | terminal | diff | files
  const [current, setCurrent] = useState("");
  const [currentRepo, setCurrentRepo] = useState(null);
  const [meta, setMeta] = useState({ repoPath: "" });
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('themeMode') || 'auto'); // auto | dark | light
  const [loadingRepos, setLoadingRepos] = useState(false);
  const routeRef = useRef({});
  const [pendingRepoId, setPendingRepoId] = useState("");

  const handleGoHome = () => {
    setPhase('repos');
    setCurrentRepo(null);
    setMeta({ repoPath: "" });
    updateHashFromState('repos', current, null);
  };

  // --- Simple hash router ---
  function parseHash() {
    const h = (location.hash || '').replace(/^#/, '');
    if (!h) return { page: 'repos' };
    const [page, qs] = h.split('?');
    const params = {};
    if (qs) {
      for (const part of qs.split('&')) {
        const [k, v=''] = part.split('=');
        params[decodeURIComponent(k)] = decodeURIComponent(v);
      }
    }
    return { page: page || 'repos', params };
  }
  function buildHash(next) {
    const { page = 'repos', params = {} } = next || {};
    const qs = Object.entries(params)
      .filter(([,v]) => v !== undefined && v !== '' && v !== null)
      .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `#${page}${qs ? '?' + qs : ''}`;
  }
  function updateHashFromState(p = phase, cur = current, repo = currentRepo) {
    const params = {};
    if (p === 'repos') {
      const [prov, key] = (cur||'').split(':');
      if (prov) params.provider = prov;
      if (key) params.key = key;
      if (repo) {
        const id = repo.full_name || repo.path_with_namespace || repo.name;
        if (id) params.repo = id;
      }
    }
    const target = buildHash({ page: p, params });
    if (location.hash !== target) location.hash = target;
  }
  function applyRoute(route) {
    routeRef.current = route;
    const { page, params } = route;
    setPhase('repos');
    if (page === 'repos') {
      const prov = params?.provider;
      const key = params?.key;
      if (prov && key) setCurrent(`${prov}:${key}`);
      const rid = params?.repo || '';
      if (!rid) { setCurrentRepo(null); setMeta({ repoPath: '' }); setPendingRepoId(''); }
      else setPendingRepoId(rid);
    }
  }

  // Initial route parse
  useEffect(() => {
    applyRoute(parseHash());
    const onHash = () => applyRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    localStorage.setItem('themeMode', themeMode);
    const root = document.documentElement;
    if (themeMode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  const cycleTheme = () => setThemeMode(m => m === 'auto' ? 'dark' : (m === 'dark' ? 'light' : 'auto'));
  const themeIcon = themeMode === 'auto' ? '🖥️' : (themeMode === 'dark' ? '🌙' : '☀️');

  // CLI-only mode: no config fetch needed

  const load = async () => {
    setLoadingRepos(true);
    try {
      const r = await axios.get("/api/providers");
      setProviders(r.data);
      const route = routeRef.current || {};
      const prov = route.params?.provider;
      const key = route.params?.key;
      const repoId = route.params?.repo;
      if (prov && key) setCurrent(`${prov}:${key}`);
      else {
        const gh = Object.keys(r.data.github || {})[0];
        const gl = Object.keys(r.data.gitlab || {})[0];
        const first = gh ? `github:${gh}` : (gl ? `gitlab:${gl}` : "");
        if (first) setCurrent(first);
      }
      // If route includes a repo, open it after providers load
      if (prov && key && (repoId || pendingRepoId)) {
        const want = repoId || pendingRepoId;
        const group = r.data[prov]?.[key] || [];
        const match = group.find(item => (item.full_name || item.path_with_namespace || item.name) === want);
        if (match) {
          await openRepo(match, prov, key); // pass explicit to avoid race with current
          setPendingRepoId('');
        }
      }
    } finally {
      setLoadingRepos(false);
    }
  };

  // If route changes after providers already loaded, try to open/close accordingly
  useEffect(() => {
    const route = routeRef.current || {};
    if (phase !== 'repos') return;
    const prov = route.params?.provider;
    const key = route.params?.key;
    const rid = route.params?.repo || pendingRepoId;
    if (!prov || !key) return;
    const group = providers[prov]?.[key] || [];
    if (!rid) {
      setCurrentRepo(null); setMeta({ repoPath: '' }); return;
    }
    const match = group.find(item => (item.full_name || item.path_with_namespace || item.name) === rid);
    if (match && (!currentRepo || (currentRepo.full_name||currentRepo.path_with_namespace||currentRepo.name)!==rid)) {
      openRepo(match, prov, key).then(()=> setPendingRepoId('')).catch(()=>{});
    }
  }, [providers, current, phase, pendingRepoId]);
  useEffect(() => { if (phase === "repos") load(); }, [phase]);

  // If user switches group tabs while a repo is open, go back to the group list
  useEffect(() => {
    if (currentRepo) {
      setCurrentRepo(null);
      setMeta({ repoPath: '' });
      updateHashFromState('repos', current, null);
    }
  }, [current]);

  const reposForCurrent = useMemo(() => {
    if (!current) return [];
    const [provider, key] = current.split(":");
    const group = providers[provider]?.[key] || [];
    return group;
  }, [providers, current]);

  const openRepo = async (repo, providerOverride, keyOverride) => {
    // Optimistically set; revert if clone fails
    setCurrentRepo(repo);
    // Derive provider & owner from full_name/path
    const [providerAuto, keyAuto] = (current || '').split(":");
    const provider = providerOverride || providerAuto;
    const key = keyOverride || keyAuto;
    const owner = (repo.full_name || repo.path_with_namespace || "").split("/")[0];
    const name = repo.name;
    const clone_url = repo.clone_url || repo.http_url_to_repo;
    try {
      const r = await axios.post("/api/git/clone", { provider, owner, name, clone_url });
      setMeta({ repoPath: r.data.repoPath, provider, owner, name, clone_url });
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Failed to open repo';
      try { alert(msg); } catch {}
      setCurrentRepo(null);
      setMeta({ repoPath: '' });
    }
  };

  // Keep URL in sync with state for bookmarking
  useEffect(() => {
    updateHashFromState();
  }, [phase, current, currentRepo]);

  return (
    <div>
      
      <header>
        <div style={{cursor:'pointer'}} onClick={handleGoHome} title="Home (repos)"><strong>web-codex</strong></div>
        
        <div style={{marginLeft:'auto', display:'flex', gap:8, alignItems:'center'}}>
          <button className="secondary icon" onClick={cycleTheme} title={`Theme: ${themeMode}`}>{themeIcon}</button>
        </div>
      </header>
      <div className="container">
        <GroupTabs providers={providers} current={current} setCurrent={setCurrent} />
        {!currentRepo ? (
          loadingRepos ? (
            <div className="pane"><div className="muted">Loading repos…</div></div>
          ) : (
            <RepoList
              key={current}
              repos={reposForCurrent}
              onSelect={openRepo}
              currentId={current}
            />
          )
        ) : (
          <>
            <div className="pane" style={{marginBottom:12}}>
              <div className="actions" style={{display:'flex',alignItems:'center',gap:8}}>
                <div className="muted">
                  {(() => { const [prov, key] = (current||'').split(':'); return `${prov||''}${key? ' / ' + key : ''}`; })()}
                  {currentRepo ? ` / ${currentRepo.name}` : ''}
                </div>
              </div>
            </div>
            <RepoActions
              repo={currentRepo}
              meta={meta}
              setMeta={setMeta}
            />
          </>
        )}
      </div>
      {null}
    </div>
  );
}
