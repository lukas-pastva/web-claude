import React, { useEffect, useState } from 'react';

export default function DiffPretty({ diff, mode = 'unified' }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { Diff2Html } = await import('diff2html');
        const css = document.getElementById('d2h-css');
        if (!css) {
          const link = document.createElement('link');
          link.id = 'd2h-css';
          link.rel = 'stylesheet';
          link.href = 'https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css';
          document.head.appendChild(link);
        }
        const htmlStr = Diff2Html.getPrettyHtml(diff || '', {
          inputFormat: 'diff',
          showFiles: true,
          matching: 'lines',
          outputFormat: mode === 'side-by-side' ? 'side-by-side' : 'line-by-line'
        });
        if (mounted) setHtml(htmlStr);
      } catch (e) {
        setHtml('<em>Pretty diff failed to load. Showing raw.</em>');
      }
    })();
    return () => { mounted = false; }
  }, [diff, mode]);
  return <div className="pane" dangerouslySetInnerHTML={{ __html: html }} />;
}
