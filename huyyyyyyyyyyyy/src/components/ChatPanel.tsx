import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleSlash2,
  File as FileIcon,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  Monitor,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Sparkles,
  Square,
  Upload,
} from 'lucide-react';
import type { FileNode, ModelInfo } from '@/types';

type Role = 'user' | 'assistant';
type Message = { id: string; role: Role; content: string; pending?: boolean; error?: boolean };

let idCounter = 0;
const uid = () => `m${++idCounter}`;

function fileIcon(name: string) {
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return <FileIcon size={14} />;
  if (/\.(md|txt|rtf)$/i.test(name)) return <FileText size={14} />;
  return <FileCode2 size={14} />;
}

function buildTree(entries: { name: string; isFolder: boolean; path: string; size: number }[]): FileNode[] {
  const root: FileNode = { name: '', path: '', isFolder: true, children: [], size: 0 };
  for (const e of entries) {
    const parts = e.path.split('/').filter(Boolean);
    let cur = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      let next = cur.children.find((c) => c.name === part);
      if (!next) {
        next = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isFolder: isLast ? e.isFolder : true,
          children: [],
          size: isLast && !e.isFolder ? e.size : 0,
        };
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const sort = (n: FileNode): FileNode => ({
    ...n,
    children: n.children
      .map(sort)
      .sort((a, b) => (a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1)),
  });
  return sort(root).children;
}

function flattenFolders(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  const walk = (n: FileNode) => {
    if (n.isFolder) {
      out.push(n);
      n.children.forEach(walk);
    }
  };
  nodes.forEach(walk);
  return out;
}

function countFiles(nodes: FileNode[]): number {
  let c = 0;
  const walk = (n: FileNode) => {
    if (n.isFolder) n.children.forEach(walk);
    else c++;
  };
  nodes.forEach(walk);
  return c;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  model: ModelInfo;
  files: FileNode[];
  setFiles: React.Dispatch<React.SetStateAction<FileNode[]>>;
  engine: any;
  engineReady: boolean;
  onSelectModel: () => void;
};

function ChatPanel({ model, files, setFiles, engine, engineReady, onSelectModel }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const modelConnected = model.status === 'connected';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const close = () => {
      setAttachOpen(false);
      setModelMenuOpen(false);
    };
    if (attachOpen || modelMenuOpen) {
      window.addEventListener('click', close);
      return () => window.removeEventListener('click', close);
    }
  }, [attachOpen, modelMenuOpen]);

  const toggleFolder = (path: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const flattenToEntries = (nodes: FileNode[]): { name: string; isFolder: boolean; path: string; size: number }[] => {
    const out: { name: string; isFolder: boolean; path: string; size: number }[] = [];
    const walk = (n: FileNode) => {
      if (n.isFolder) n.children.forEach(walk);
      else out.push({ name: n.name, isFolder: false, path: n.path, size: n.size });
    };
    nodes.forEach(walk);
    return out;
  };

  const addSystemFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const entries = Array.from(list).map((f) => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      return { name: f.name, isFolder: false, path: rel, size: f.size };
    });
    setFiles((prev) => buildTree([...flattenToEntries(prev), ...entries]));
  };

  const addStorageFile = () => {
    const samples = [
      { name: 'README.md', isFolder: false, path: 'storage/README.md', size: 2400 },
      { name: 'app.tsx', isFolder: false, path: 'storage/src/app.tsx', size: 8200 },
      { name: 'config.json', isFolder: false, path: 'storage/config.json', size: 512 },
    ];
    setFiles((prev) => buildTree([...flattenToEntries(prev), ...samples]));
    setAttachOpen(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || isResponding || !modelConnected || !engine || !engineReady) return;

    const userMsg: Message = { id: uid(), role: 'user', content: text };
    const pendingId = uid();
    setMessages((m) => [...m, userMsg, { id: pendingId, role: 'assistant', content: '', pending: true }]);
    setInput('');
    setIsResponding(true);

    try {
      const chatMessages = [
        { role: 'system' as const, content: 'You are a helpful AI assistant running locally on the user device.' },
        ...messages
          .filter((m) => !m.error)
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: text },
      ];

      const chunks = await engine.chat.completions.create({
        messages: chatMessages,
        temperature: 0.7,
        stream: true,
      });

      let reply = '';
      for await (const chunk of chunks) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          reply += delta;
          setMessages((m) =>
            m.map((msg) => (msg.id === pendingId ? { ...msg, content: reply, pending: false } : msg))
          );
        }
      }

      const fullReply = await engine.getMessage();
      setMessages((m) =>
        m.map((msg) => (msg.id === pendingId ? { ...msg, content: fullReply || reply, pending: false } : msg))
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate a response.';
      setMessages((m) =>
        m.map((msg) => (msg.id === pendingId ? { ...msg, content: errorMsg, pending: false, error: true } : msg))
      );
    } finally {
      setIsResponding(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const hasMessages = messages.length > 0;
  const hasFiles = files.length > 0;
  const totalFiles = countFiles(files);

  const renderTree = (nodes: FileNode[], depth = 0): React.ReactNode =>
    nodes.map((n) => {
      if (n.isFolder) {
        const open = expanded.has(n.path);
        return (
          <div key={n.path}>
            <button
              className={`file-row ${selectedFile === n.path ? 'selected' : ''}`}
              style={{ paddingLeft: 14 + depth * 16 }}
              onClick={() => {
                toggleFolder(n.path);
                setSelectedFile(n.path);
              }}
            >
              {open ? <FolderOpen size={14} /> : <Folder size={14} />}
              <span className="file-name">{n.name}</span>
              <span className="file-count">{countFiles(n.children)}</span>
            </button>
            {open && renderTree(n.children, depth + 1)}
          </div>
        );
      }
      return (
        <button
          key={n.path}
          className={`file-row ${selectedFile === n.path ? 'selected' : ''}`}
          style={{ paddingLeft: 14 + depth * 16 }}
          onClick={() => setSelectedFile(n.path)}
        >
          {fileIcon(n.name)}
          <span className="file-name">{n.name}</span>
          <span className="file-size">{formatSize(n.size)}</span>
        </button>
      );
    });

  const selectedNode = (() => {
    const find = (nodes: FileNode[]): FileNode | null => {
      for (const n of nodes) {
        if (n.path === selectedFile) return n;
        if (n.isFolder) {
          const f = find(n.children);
          if (f) return f;
        }
      }
      return null;
    };
    return find(files);
  })();

  return (
    <div className={`chat-layout ${previewCollapsed ? 'preview-collapsed' : ''}`}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addSystemFiles(e.target.files);
          setAttachOpen(false);
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        // @ts-expect-error non-standard but widely supported
        webkitdirectory=""
        directory=""
        onChange={(e) => {
          addSystemFiles(e.target.files);
          setAttachOpen(false);
        }}
      />

      <div className="chat-column">
        <div className="chat-topbar">
          <div className="chat-title">
            <span className="chat-emblem"><Sparkles size={14} /></span>
            <span>Chat</span>
          </div>
          <div className="chat-topbar-actions">
            <div className="model-picker-wrap" onClick={(e) => e.stopPropagation()}>
              <button
                className={`chat-model-picker ${modelConnected ? 'is-active' : ''}`}
                onClick={() => setModelMenuOpen((open) => !open)}
                disabled={model.status === 'empty' || model.status === 'loading'}
                aria-haspopup="listbox"
                aria-expanded={modelMenuOpen}
              >
                <Boxes size={13} />
                <span>{model.status === 'empty' ? 'Choose model' : model.status === 'loading' ? 'Loading model…' : model.name}</span>
                <ChevronDown size={13} />
              </button>
              {modelMenuOpen && model.status !== 'empty' && model.status !== 'loading' && (
                <div className="model-picker-menu" role="listbox">
                  <button className="model-picker-option" onClick={onSelectModel} role="option" aria-selected={modelConnected}>
                    <Boxes size={14} />
                    <span>
                      <strong>{model.name}</strong>
                      <small>{modelConnected ? 'Selected for chat' : 'Select this model'}</small>
                    </span>
                    {modelConnected && <span className="model-picker-dot" />}
                  </button>
                </div>
              )}
            </div>
            {previewCollapsed && (
              <button
                className="panel-toggle"
                onClick={() => setPreviewCollapsed(false)}
                aria-label="Show file panel"
              >
                <PanelRightOpen size={15} />
              </button>
            )}
          </div>
        </div>

        {!modelConnected ? (
          <div className="chat-empty">
            <div className="chat-empty-icon"><Boxes size={22} /></div>
            <h3>No model connected</h3>
            <p>Upload a model in the Model tab, then click "Connect to chat" to start talking with it.</p>
          </div>
        ) : (
          <>
            <div className="chat-scroll" ref={scrollRef}>
              {!hasMessages && (
                <div className="chat-empty">
                  <div className="chat-empty-icon"><Sparkles size={22} /></div>
                  <h3>Start a conversation</h3>
                  <p>Your model is running locally on your device. Ask anything — replies come from the model on your machine.</p>
                  <div className="chat-suggestions">
                    {['Hello, what can you do?', 'Write a short poem', 'Explain how AI works'].map((s) => (
                      <button key={s} className="suggestion-chip" onClick={() => setInput(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
                  <div className="msg-avatar">
                    {m.role === 'user' ? 'A' : <Sparkles size={13} />}
                  </div>
                  <div className="msg-body">
                    <div className="msg-meta">{m.role === 'user' ? 'You' : model.name}</div>
                    {m.pending ? (
                      <div className="msg-pending"><Loader2 size={13} className="spin" /> Generating…</div>
                    ) : (
                      <p className="msg-text">{m.content}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="chat-input-area">
              <div className="chat-input-row">
                <div className="attach-wrap">
                  <button
                    className="chat-attach"
                    aria-label="Attach file"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAttachOpen((o) => !o);
                    }}
                  >
                    <Paperclip size={16} />
                  </button>
                  {attachOpen && (
                    <div className="attach-menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => fileInputRef.current?.click()}>
                        <Monitor size={14} /> Upload from system
                      </button>
                      <button onClick={() => folderInputRef.current?.click()}>
                        <Folder size={14} /> Upload a folder
                      </button>
                      <button onClick={addStorageFile}>
                        <HardDrive size={14} /> Add from app storage
                      </button>
                    </div>
                  )}
                </div>
                <textarea
                  className="chat-input"
                  placeholder="Ask your local model…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  disabled={!modelConnected}
                />
                <button
                  className="chat-send"
                  onClick={send}
                  disabled={!input.trim() || isResponding || !modelConnected}
                  aria-label="Send message"
                >
                  {isResponding ? <Square size={15} /> : <ArrowUp size={17} />}
                </button>
              </div>
              <p className="chat-hint">
                Press Enter to send · Shift + Enter for a new line · Replies from your local model
              </p>
            </div>
          </>
        )}
      </div>

      <div className="preview-column">
        <div className="preview-topbar">
          <div className="preview-title">
            <FolderOpen size={14} /> Uploaded files
          </div>
          <div className="preview-topbar-actions">
            <div className="preview-status">
              {hasFiles ? `${totalFiles} file${totalFiles === 1 ? '' : 's'}` : 'Empty'}
            </div>
            <button
              className="panel-toggle"
              onClick={() => setPreviewCollapsed(true)}
              aria-label="Collapse file panel"
            >
              <PanelRightClose size={15} />
            </button>
          </div>
        </div>

        <div className="preview-body">
          {!hasFiles ? (
            <div className="preview-empty">
              <Upload size={28} />
              <p>Use the paperclip in the chat to upload files or a folder. They'll appear here so you can pick any one to include.</p>
            </div>
          ) : (
            <div className="file-tree">
              <div className="file-tree-head">
                <span><Folder size={13} /> Name</span>
                <span>Size</span>
              </div>
              <div className="file-tree-body">{renderTree(files)}</div>
            </div>
          )}
        </div>

        <div className="preview-footer">
          {selectedNode ? (
            <>
              <ChevronRight size={12} />
              <span className="selected-path">{selectedNode.path}</span>
            </>
          ) : (
            <>
              <CircleSlash2 size={12} /> Select a file to attach it to your next message
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;
