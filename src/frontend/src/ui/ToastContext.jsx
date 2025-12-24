import React, { useContext, useState } from 'react';

const Ctx = React.createContext(() => {});

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = (msg, type='info') => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setItems(prev => prev.filter(i => i.id !== id)), 3000);
  };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div style={{position:'fixed',right:12,bottom:12,display:'flex',flexDirection:'column',gap:8,zIndex:9999}}>
        {items.map(i => (
          <div key={i.id} style={{background:'#111827',border:'1px solid #1f2937',padding:10,borderRadius:8,minWidth:220}}>
            <div style={{color:'#e6edf3'}}>{i.msg}</div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);