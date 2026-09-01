import { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
  FileCode2,
  FileText,
  File as FileIcon,
} from 'lucide-react';

export type FileCardData = {
  id: string;
  path: string;
  content: string;
  status: 'writing' | 'done';
};

function fileIconFor(name: string) {
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return <FileIcon size={14} />;
  if (/\.(md|txt|rtf)$/i.test(name)) return <FileText size={14} />;
  return <FileCode2 size={14} />;
}

function getLangFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', css: 'css', html: 'html', json: 'json', md: 'markdown',
    sh: 'bash', yml: 'yaml', yaml: 'yaml', go: 'go', rs: 'rust',
    java: 'java', c: 'c', cpp: 'cpp', sql: 'sql', xml: 'xml',
  };
  return langMap[ext] || 'text';
}

type Props = {
  file: FileCardData;
  defaultOpen?: boolean;
};

function FileCard({ file, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen && file.status === 'writing');
  const fileName = file.path.split('/').pop() || file.path;

  useEffect(() => {
    if (file.status === 'done') {
      const t = setTimeout(() => setOpen(false), 1500);
      return () => clearTimeout(t);
    }
  }, [file.status]);
  const lang = getLangFromPath(file.path);
  const isWriting = file.status === 'writing';

  return (
    <div className={`file-card ${isWriting ? 'writing' : 'done'}`}>
      <button
        className="file-card-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="file-card-icon">{fileIconFor(fileName)}</span>
        <span className="file-card-name">{file.path}</span>
        <span className="file-card-lang">{lang}</span>
        <span className="file-card-status">
          {isWriting ? (
            <><Loader2 size={12} className="spin" /> Writing…</>
          ) : (
            <><Check size={12} /> Created</>
          )}
        </span>
      </button>
      {open && (
        <div className="file-card-code-wrap">
          <pre className="file-card-code">
            <code>{file.content || (isWriting ? '  ' : '')}</code>
          </pre>
          {isWriting && (
            <div className="file-card-cursor" />
          )}
        </div>
      )}
    </div>
  );
}

export default FileCard;
