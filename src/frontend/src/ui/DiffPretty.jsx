import React, { useEffect, useState } from 'react';
import * as Diff2Html from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

export default function DiffPretty({ diff, mode = 'unified' }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    try {
      const htmlStr = Diff2Html.html(diff || '', {
        inputFormat: 'diff',
        showFiles: true,
        matching: 'lines',
        outputFormat: mode === 'side-by-side' ? 'side-by-side' : 'line-by-line',
        drawFileList: false
      });
      setHtml(htmlStr);
    } catch (e) {
      setHtml('<em>Pretty diff failed to load. Showing raw.</em>');
    }
  }, [diff, mode]);
  if (!diff || !diff.trim()) return null;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
