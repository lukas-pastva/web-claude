import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function FileTree({ repoPath, onOpen }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!repoPath) return;
    axios.get('/api/git/tree', { params: { repoPath, depth: 6, max: 2000 } })
      .then(r => setItems(r.data.files || []))
      .catch(()=> setItems([]));
  }, [repoPath]);

  const listed = items.slice(0, 500);

  return (
    <div className="pane">
      <div style={{maxHeight:'40vh',overflow:'auto'}}>
        {listed.map((f,i)=>(
          <div key={i} className="repo" onClick={()=> f.type==='file' && onOpen(f.path)} style={{cursor: f.type==='file'?'pointer':'default'}}>
            <div><strong>{f.name}</strong> <span className="muted">({f.type})</span></div>
            <div className="muted">{f.path}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
