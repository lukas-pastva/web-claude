import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import ClaudeTerminal from "./Terminal.jsx";
import FileTree from "./FileTree.jsx";
import DiffPretty from "./DiffPretty.jsx";
import { ToastProvider, useToast } from "./ToastContext.jsx";

// Helper to create cancellable axios requests
function createAbortController() {
  return new AbortController();
}

// Parse changed files from unified diff - extracted for caching
function parseChangedFiles(patch) {
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
    return out;
  } catch { return []; }
}

function getProviderItems(providers) {
  const items = [];
  if (providers.github) {
    for (const key of Object.keys(providers.github)) items.push({ provider: "github", key });
  }
  if (providers.gitlab) {
    for (const key of Object.keys(providers.gitlab)) items.push({ provider: "gitlab", key });
  }
  return items;
}

function GroupTabs({ providers, current, setCurrent }) {
  const items = getProviderItems(providers);
  // Don't render tabs if there's only one group
  if (items.length <= 1) return null;
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
  const [log, setLog] = useState([]);
  const [patch, setPatch] = useState("");
  const [showPretty, setShowPretty] = useState(true);
  const [prettyMode, setPrettyMode] = useState('unified');
  const [selectedDiffFile, setSelectedDiffFile] = useState("");
  const diffPaneRef = useRef(null);
  const [isDiffFullscreen, setIsDiffFullscreen] = useState(false);
  const [manualDiffFullscreen, setManualDiffFullscreen] = useState(false);
  const [pullInfo, setPullInfo] = useState({ at: null, upToDate: null, behind: 0 });
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [changedFiles, setChangedFiles] = useState([]);
  const [showAllChanged, setShowAllChanged] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef(null);
  const prevChangedCountRef = useRef(0);
  const lastVibeAtRef = useRef(0);

  // Branch management state
  const [branches, setBranches] = useState({ current: '', all: [] });
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showNewBranchModal, setShowNewBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchSource, setNewBranchSource] = useState('main');
  const [checkingOut, setCheckingOut] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const branchDropdownRef = useRef(null);

  // Abort controllers for cancelling pending requests
  const abortControllersRef = useRef({});
  // Track if a polling request is in flight to prevent stacking
  const diffPendingRef = useRef(false);
  const statusPendingRef = useRef(false);
  // Cache for parsed diff to avoid re-parsing
  const lastPatchRef = useRef('');

  // Cleanup abort controllers on unmount
  useEffect(() => {
    return () => {
      Object.values(abortControllersRef.current).forEach(ctrl => {
        try { ctrl.abort(); } catch {}
      });
    };
  }, []);

  const refreshLog = async (signal) => {
    const r = await axios.get("/api/git/log", {
      params: { repoPath: meta.repoPath },
      signal
    });
    setLog(r.data.commits || []);
  };

  const refreshStatus = async (signal) => {
    if (statusPendingRef.current) return; // Skip if already fetching
    statusPendingRef.current = true;
    try {
      const r = await axios.get("/api/git/status", {
        params: { repoPath: meta.repoPath },
        signal
      });
      const behind = Number(r.data.status?.behind || 0);
      setPullInfo(p => ({ ...p, upToDate: behind === 0, behind }));
    } finally {
      statusPendingRef.current = false;
    }
  };

  const refreshBranches = async (signal) => {
    if (!meta.repoPath) return;
    try {
      const r = await axios.get("/api/git/branches", {
        params: { repoPath: meta.repoPath },
        signal
      });
      setBranches({ current: r.data.current || '', all: r.data.all || [] });
      // Update source branch default to current if not set or not in list
      if (!newBranchSource || !r.data.all?.includes(newBranchSource)) {
        setNewBranchSource(r.data.current || 'main');
      }
    } catch (e) {
      if (e.name !== 'CanceledError' && e.name !== 'AbortError') {
        console.error("Failed to fetch branches:", e);
      }
    }
  };

  const doCheckout = async (branch) => {
    if (branch === branches.current) {
      setShowBranchDropdown(false);
      return;
    }
    try {
      setCheckingOut(true);
      await axios.post("/api/git/checkout", { repoPath: meta.repoPath, branch });
      await refreshBranches();
      await refreshDiff();
      await refreshLog();
      setShowBranchDropdown(false);
      toast && toast(`Switched to ${branch}`);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Checkout failed";
      toast && toast(`Checkout failed: ${msg}`);
    } finally {
      setCheckingOut(false);
    }
  };

  const doCreateBranch = async () => {
    if (!newBranchName.trim()) {
      toast && toast("Branch name is required");
      return;
    }
    try {
      setCreatingBranch(true);
      await axios.post("/api/git/createBranch", {
        repoPath: meta.repoPath,
        branchName: newBranchName.trim(),
        sourceBranch: newBranchSource || 'main'
      });
      await refreshBranches();
      await refreshDiff();
      setShowNewBranchModal(false);
      setNewBranchName('');
      toast && toast(`Created and switched to ${newBranchName.trim()}`);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Failed to create branch";
      toast && toast(`Create branch failed: ${msg}`);
    } finally {
      setCreatingBranch(false);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target)) {
        setShowBranchDropdown(false);
      }
    };
    if (showBranchDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showBranchDropdown]);

  // Initial data load when repo changes - with abort controller
  useEffect(() => {
    if (!meta.repoPath) return;
    const controller = createAbortController();
    abortControllersRef.current.init = controller;

    // Load all data with the abort signal
    Promise.all([
      refreshLog(controller.signal).catch(() => {}),
      refreshStatus(controller.signal).catch(() => {}),
      refreshDiff(controller.signal).catch(() => {}),
      refreshBranches(controller.signal).catch(() => {})
    ]);

    return () => {
      controller.abort();
      delete abortControllersRef.current.init;
    };
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

  const refreshDiff = async (signal) => {
    if (!meta.repoPath) return;
    if (diffPendingRef.current) return; // Skip if already fetching
    diffPendingRef.current = true;
    try {
      const r = await axios.get("/api/git/diff", {
        params: { repoPath: meta.repoPath },
        signal
      });
      const newDiff = r.data.diff || "";
      // Only update if diff actually changed (prevents unnecessary re-renders and re-parsing)
      setPatch(prev => prev === newDiff ? prev : newDiff);
    } finally {
      diffPendingRef.current = false;
    }
  };

  // Parse changed files from unified diff - use useMemo for caching
  const parsedChangedFiles = useMemo(() => parseChangedFiles(patch), [patch]);

  // Update changed files only when parsed result changes
  useEffect(() => {
    setChangedFiles(parsedChangedFiles);
    setShowAllChanged(false);
  }, [parsedChangedFiles]);

  // Auto refresh diff every 5 seconds with proper cleanup
  useEffect(() => {
    if (!meta.repoPath) return;
    const controller = createAbortController();
    abortControllersRef.current.diff = controller;

    const id = setInterval(() => {
      refreshDiff(controller.signal).catch(e => {
        if (e.name !== 'CanceledError' && e.name !== 'AbortError') {
          console.error('Diff refresh failed:', e);
        }
      });
    }, 5000);

    return () => {
      clearInterval(id);
      controller.abort();
      delete abortControllersRef.current.diff;
    };
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

  // Periodically refresh upstream status with proper cleanup
  useEffect(() => {
    if (!meta.repoPath) return;
    const controller = createAbortController();
    abortControllersRef.current.status = controller;

    const id = setInterval(() => {
      refreshStatus(controller.signal).catch(e => {
        if (e.name !== 'CanceledError' && e.name !== 'AbortError') {
          console.error('Status refresh failed:', e);
        }
      });
    }, 5000);

    return () => {
      clearInterval(id);
      controller.abort();
      delete abortControllersRef.current.status;
    };
  }, [meta.repoPath]);

  const doApplyCommitPush = async () => {
    try {
      setPushing(true);
      const message = "claude-" + new Date().toISOString();
      const res = await axios.post("/api/git/commitPush", { repoPath: meta.repoPath, message });
      const fullHash = res.data?.commit?.commit || '';
      await refreshLog();
      await refreshDiff();
      // Copy full commit hash to clipboard
      if (fullHash) {
        try {
          await navigator.clipboard.writeText(fullHash);
        } catch {
          try {
            const ta = document.createElement('textarea');
            ta.value = fullHash;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          } catch {}
        }
      }
      toast && toast(fullHash ? `Pushed ${fullHash.slice(0, 7)} (copied) ✅` : "Pushed ✅");
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Push failed";
      try { toast && toast(`Push failed: ${msg}`); } catch {}
      try { alert(`Push failed: ${msg}`); } catch {}
    } finally {
      setPushing(false);
    }
  };

  const doRollback = async () => {
    if (!confirm("Discard all uncommitted changes? This cannot be undone.")) return;
    try {
      setRolling(true);
      await axios.post("/api/git/rollback", { repoPath: meta.repoPath });
      await refreshDiff();
      toast && toast("Changes discarded ✅");
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Rollback failed";
      try { toast && toast(`Rollback failed: ${msg}`); } catch {}
      try { alert(`Rollback failed: ${msg}`); } catch {}
    } finally {
      setRolling(false);
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
    const onSuccess = () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopied(true);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
      toast && toast("Commit hash copied ✅");
    };
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(hash);
        onSuccess();
        return;
      } catch {}
    }
    // Fallback for mobile browsers (especially iOS Safari)
    try {
      const ta = document.createElement('textarea');
      ta.value = hash;
      ta.setAttribute('readonly', ''); // Prevent keyboard on mobile
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      ta.style.fontSize = '16px'; // Prevent iOS zoom
      document.body.appendChild(ta);
      // iOS Safari specific handling
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, hash.length); // For iOS
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        onSuccess();
      } else {
        alert("Failed to copy commit hash");
      }
    } catch {
      alert("Failed to copy commit hash");
    }
  };

  return (
    <div className="row">
      <div className="col main-col">
        {/* Git Actions Card */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Git Actions</span>
            {log && log.length > 0 && (
              <span className="commit-badge">
                <a href={log[0].web_url || '#'} target="_blank" rel="noreferrer">
                  {log[0].hash.slice(0, 7)}
                </a>
              </span>
            )}
          </div>
          <div className="card-actions">
            {/* Branch dropdown */}
            <div className="branch-dropdown-container" ref={branchDropdownRef} style={{position:'relative'}}>
              <button
                className={`btn btn-branch ${checkingOut ? 'btn-loading' : ''}`}
                onClick={() => setShowBranchDropdown(!showBranchDropdown)}
                disabled={checkingOut}
              >
                {checkingOut ? (
                  <><span className="spinner" /></>
                ) : (
                  <><span className="icon branch-icon">⎇</span> {branches.current || 'main'} <span className="dropdown-arrow">▼</span></>
                )}
              </button>
              {showBranchDropdown && (
                <div className="branch-dropdown">
                  <div className="branch-dropdown-header">Branches</div>
                  <div className="branch-list">
                    {branches.all.map((b, idx) => (
                      <div
                        key={idx}
                        className={`branch-item ${b === branches.current ? 'active' : ''}`}
                        onClick={() => doCheckout(b)}
                      >
                        {b === branches.current && <span className="check-icon">✓</span>}
                        <span className="branch-name">{b}</span>
                      </div>
                    ))}
                  </div>
                  <div className="branch-dropdown-footer">
                    <button
                      className="btn btn-new-branch"
                      onClick={() => { setShowBranchDropdown(false); setShowNewBranchModal(true); }}
                    >
                      <span className="icon">+</span> New Branch
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              className={`btn ${pulling ? 'btn-loading' : pullInfo.upToDate ? 'btn-success' : 'btn-secondary'}`}
              onClick={doPull}
              disabled={pulling}
            >
              {pulling ? (
                <><span className="spinner" /> Pulling...</>
              ) : pullInfo.upToDate ? (
                <><span className="icon">✓</span> Up to date</>
              ) : (
                <><span className="icon">↓</span> Pull</>
              )}
            </button>
            <button
              className={`btn ${pushing ? 'btn-loading' : 'btn-primary'}`}
              onClick={doApplyCommitPush}
              disabled={!(patch||"").trim() || pushing}
            >
              {pushing ? (
                <><span className="spinner" /> Pushing...</>
              ) : (
                <><span className="icon">↑</span> Push</>
              )}
            </button>
            <button
              className={`btn ${rolling ? 'btn-loading' : 'btn-danger'}`}
              onClick={doRollback}
              disabled={!(patch||"").trim() || rolling}
              title="Discard all uncommitted changes"
            >
              {rolling ? (
                <><span className="spinner" /> Rolling back...</>
              ) : (
                <><span className="icon">↩</span> Rollback</>
              )}
            </button>
            {log && log.length > 0 && (
              <button
                className={`btn btn-ghost ${copied ? 'btn-copied' : ''}`}
                onClick={() => copyHash(log[0].hash)}
                title="Copy commit hash"
              >
                {copied ? '✓' : '📋'}
              </button>
            )}
          </div>
          {pullInfo.behind > 0 && (
            <div className="status-bar warning">
              {pullInfo.behind} commit{pullInfo.behind > 1 ? 's' : ''} behind
            </div>
          )}
        </div>

        <FileTree repoPath={meta.repoPath} onOpen={async (p)=>{ const r=await axios.get("/api/git/file",{params:{repoPath:meta.repoPath,path:p}}); }} />
        {/* Diff Preview Card */}
        {(patch || "").trim() && (
          <div
            ref={diffPaneRef}
            className={`card diff-card ${(isDiffFullscreen || manualDiffFullscreen) ? 'fullscreen' : ''}`}
          >
            <div className="card-header">
              <span className="card-title">
                Changes
                {changedFiles.length > 0 && (
                  <span className="count-badge">{changedFiles.length}</span>
                )}
              </span>
              <div className="view-toggles">
                <button
                  className={`toggle-btn ${showPretty ? '' : 'active'}`}
                  onClick={() => setShowPretty(false)}
                >Raw</button>
                <button
                  className={`toggle-btn ${showPretty ? 'active' : ''}`}
                  onClick={() => setShowPretty(true)}
                >Pretty</button>
                <button
                  className="toggle-btn icon-btn"
                  onClick={toggleDiffFullscreen}
                >
                  {(isDiffFullscreen || manualDiffFullscreen) ? '✕' : '⤢'}
                </button>
              </div>
            </div>
            {changedFiles.length > 0 && (
              <div className="file-chips">
                {(showAllChanged ? changedFiles : changedFiles.slice(0, 10)).map((f, idx) => {
                  const active = selectedDiffFile === f.path;
                  return (
                    <button
                      key={idx}
                      className={`chip ${f.status} ${active ? 'active' : ''}`}
                      onClick={() => setSelectedDiffFile(p => (p === f.path ? "" : f.path))}
                    >
                      {f.path.split('/').pop()}
                    </button>
                  );
                })}
                {(!showAllChanged && changedFiles.length > 10) && (
                  <button className="chip more" onClick={() => setShowAllChanged(true)}>
                    +{changedFiles.length - 10}
                  </button>
                )}
              </div>
            )}
            <div className="diff-content">
              {showPretty ? (
                <DiffPretty diff={displayedPatch} mode="unified" />
              ) : (
                <code className="diff-raw">{displayedPatch}</code>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="col cli-col">
        <ClaudeTerminal repoPath={meta.repoPath} />
      </div>

      {/* New Branch Modal */}
      {showNewBranchModal && (
        <div className="modal-overlay" onClick={() => setShowNewBranchModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Branch</h3>
              <button className="modal-close" onClick={() => setShowNewBranchModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Branch name</label>
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="feature/my-branch"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && !creatingBranch) doCreateBranch(); }}
                />
              </div>
              <div className="form-group">
                <label>Create from</label>
                <select
                  value={newBranchSource}
                  onChange={(e) => setNewBranchSource(e.target.value)}
                >
                  {branches.all.map((b, idx) => (
                    <option key={idx} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNewBranchModal(false)}>Cancel</button>
              <button
                className={`btn btn-primary ${creatingBranch ? 'btn-loading' : ''}`}
                onClick={doCreateBranch}
                disabled={creatingBranch || !newBranchName.trim()}
              >
                {creatingBranch ? <><span className="spinner" /> Creating...</> : 'Create Branch'}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const openingFromUrlRef = useRef(false);

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
      // Mark that we're opening from URL to prevent the [current] effect from closing the repo
      const willOpenFromUrl = prov && key && (repoId || pendingRepoId);
      if (willOpenFromUrl) {
        openingFromUrlRef.current = true;
      }
      if (prov && key) setCurrent(`${prov}:${key}`);
      else {
        const gh = Object.keys(r.data.github || {})[0];
        const gl = Object.keys(r.data.gitlab || {})[0];
        const first = gh ? `github:${gh}` : (gl ? `gitlab:${gl}` : "");
        if (first) setCurrent(first);
      }
      // If route includes a repo, open it after providers load
      if (willOpenFromUrl) {
        const want = repoId || pendingRepoId;
        const group = r.data[prov]?.[key] || [];
        const match = group.find(item => (item.full_name || item.path_with_namespace || item.name) === want);
        if (match) {
          await openRepo(match, prov, key); // pass explicit to avoid race with current
          setPendingRepoId('');
        }
        // Reset after a tick to allow effects to run
        setTimeout(() => { openingFromUrlRef.current = false; }, 0);
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
    // Skip if we're opening from URL (to prevent closing the repo immediately after opening)
    if (openingFromUrlRef.current) return;
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

  // Update browser tab title with current repo name
  useEffect(() => {
    if (currentRepo?.name) {
      document.title = `${currentRepo.name} - web-claude`;
    } else {
      document.title = 'web-claude';
    }
  }, [currentRepo]);

  return (
    <div>
      
      <header>
        <div style={{cursor:'pointer', display:'flex', alignItems:'center', gap:8}} onClick={handleGoHome} title="Home (repos)">
          <strong>web-claude</strong>
          {(() => {
            const items = getProviderItems(providers);
            if (items.length === 1) {
              const it = items[0];
              const count = (providers[it.provider]?.[it.key] || []).length;
              return (
                <span className="muted" style={{fontSize:'0.9em'}}>
                  / {it.provider} / {it.key} <span className="tag">{count}</span>
                </span>
              );
            }
            return null;
          })()}
        </div>

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
