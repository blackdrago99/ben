import { useCallback, useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Image,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PlaySquare,
  Settings2,
  Sparkles,
  Upload,
  Video,
  AudioLines,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ModelPanel, { formatBytes } from '@/components/ModelPanel';
import ChatPanel from '@/components/ChatPanel';
import type { FileNode, ModelInfo } from '@/types';

type NavItem = { label: string; icon: LucideIcon };

const navItems: NavItem[] = [
  { label: 'Model', icon: Sparkles },
  { label: 'Chat', icon: MessageSquare },
  { label: 'Storage', icon: Box },
  { label: 'Video generation', icon: Video },
  { label: 'Photo generation', icon: Image },
  { label: 'Video editing', icon: Clapperboard },
  { label: 'Photo editing', icon: LayoutGrid },
];

const EMPTY_MODEL: ModelInfo = {
  id: '',
  name: '',
  size: '',
  status: 'empty',
  progress: 0,
};

const PREBUILT_MODELS: Record<string, string> = {
  'llama-3.2-1b': 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'llama-3.2-3b': 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  'qwen2.5-0.5b': 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  'qwen2.5-1.5b': 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  'qwen2.5-3b': 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
  'qwen2.5-coder': 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
  'phi-3.5': 'Phi-3.5-mini-instruct-q4f16_1-MLC',
  'gemma-2-2b': 'gemma-2-2b-it-q4f16_1-MLC',
  'smollm2': 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
  'tinyllama': 'TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC',
};

function matchModel(fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const [key, modelId] of Object.entries(PREBUILT_MODELS)) {
    if (lower.includes(key)) return modelId;
  }
  return 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
}

function App() {
  const [activeItem, setActiveItem] = useState('Model');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [model, setModel] = useState<ModelInfo>(EMPTY_MODEL);
  const [files, setFiles] = useState<FileNode[]>([]);
  const engineRef = useRef<any>(null);
  const [engine, setEngine] = useState<any>(null);
  const [engineReady, setEngineReady] = useState(false);
  const isChat = activeItem === 'Chat';

  const handleNavClick = (label: string) => {
    setActiveItem(label);
    if (label !== 'Chat') setSidebarCollapsed(false);
  };

  const loadModel = useCallback(async (file: File) => {
    const modelId = matchModel(file.name);
    const displayName = file.name.replace(/\.[^.]+$/, '');
    setModel({
      id: modelId,
      name: displayName,
      size: formatBytes(file.size),
      status: 'loading',
      progress: 0,
    });

    try {
      const webllm = await import('@mlc-ai/web-llm');

      if (engineRef.current) {
        try { await engineRef.current.unload(); } catch { /* ignore */ }
        engineRef.current = null;
        setEngine(null);
        setEngineReady(false);
      }

      const eng = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (info: any) => {
          setModel((m) => ({
            ...m,
            progress: Math.round((info.progress || 0) * 100),
          }));
        },
      });

      engineRef.current = eng;
      setEngine(eng);
      setEngineReady(true);

      setModel((m) => ({
        ...m,
        status: 'ready',
        progress: 100,
      }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load model.';
      setModel({
        ...EMPTY_MODEL,
        name: displayName,
        status: 'empty',
      });
      alert(`Failed to load model: ${errorMsg}\n\nMake sure your browser supports WebGPU (Chrome/Edge 113+).`);
    }
  }, []);

  const connectToChat = useCallback(() => {
    setModel((m) => (m.status === 'ready' ? { ...m, status: 'connected' } : m));
  }, []);

  const deleteModel = useCallback(async () => {
    if (engineRef.current) {
      try { await engineRef.current.unload(); } catch { /* ignore */ }
      engineRef.current = null;
      setEngine(null);
      setEngineReady(false);
    }
    setModel({ ...EMPTY_MODEL });
  }, []);

  return (
    <main className={`app-shell ${isChat ? 'chat-active' : ''} ${sidebarCollapsed && isChat ? 'sidebar-collapsed' : ''}`}>
      <div className="backdrop" aria-hidden="true" />
      <div className="backdrop-shade" aria-hidden="true" />

      {!isChat && <header className="topbar">
        <div className="brand-mark">
          <div className="brand-emblem"><Sparkles size={15} strokeWidth={2.2} /></div>
          <span>BLACKDRAGON</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Help"><CircleHelp size={17} /></button>
          <button className="profile-button" aria-label="Open profile menu">
            <span className="profile-avatar">A</span>
            <span className="profile-name">Alex Morgan</span>
            <ChevronDown size={14} />
          </button>
        </div>
      </header>}

      <aside className="sidebar">
        <div className="workspace-switcher">
          <span className="workspace-icon"><Sparkles size={15} /></span>
          <span className="workspace-label">Workspace</span>
          <ChevronDown size={14} className="workspace-chevron" />
        </div>

        <div className="menu-heading">CREATE</div>
        <nav className="navigation" aria-label="Creation tools">
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${activeItem === label ? 'active' : ''}`}
              onClick={() => handleNavClick(label)}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {label === 'Model' && <span className="new-badge">NEW</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="utility-item"><Settings2 size={17} /><span>Settings</span></button>
          <button className="utility-item"><CircleHelp size={17} /><span>Help center</span></button>
          <div className="storage-card">
            <div className="storage-title"><span>Storage</span><span>0%</span></div>
            <div className="storage-track"><span /></div>
            <p>0 GB of 10 GB used</p>
            <button className="upgrade-button">Upgrade storage <Sparkles size={13} /></button>
          </div>
        </div>
      </aside>

      {isChat && (
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      )}

      <section className="content-area">
        {activeItem === 'Model' ? (
          <ModelPanel
            model={model}
            setModel={setModel}
            onConnect={connectToChat}
            onDelete={deleteModel}
            onLoadFile={loadModel}
          />
        ) : activeItem === 'Chat' ? (
          <ChatPanel
            model={model}
            files={files}
            setFiles={setFiles}
            engine={engine}
            engineReady={engineReady}
            onSelectModel={connectToChat}
          />
        ) : (
          <>
            <div className="content-topline">
              <span>CREATE</span>
              <MoreHorizontal size={18} />
            </div>
            <div className="welcome-copy">
              <p className="eyebrow">WELCOME TO YOUR CREATIVE SUITE</p>
              <h1>Make something<br /><em>unforgettable.</em></h1>
              <p className="intro">Choose a tool from the menu to begin bringing your ideas to life.</p>
            </div>
            <div className="empty-state">
              <div className="empty-icon"><Upload size={20} /></div>
              <div>
                <strong>Your canvas awaits</strong>
                <p>Select any creative tool to get started</p>
              </div>
            </div>
            <div className="quick-tools">
              <span>QUICK ACCESS</span>
              <div className="quick-tool-row">
                <button className="quick-tool"><PlaySquare size={16} /> Recent projects</button>
                <button className="quick-tool"><AudioLines size={16} /> Brand sounds</button>
              </div>
            </div>
          </>
        )}
      </section>

      {model.status !== 'connected' && isChat && (
        <div className="chat-locked-banner">
          Upload and connect a model from the Model tab to start chatting.
        </div>
      )}
    </main>
  );
}

export default App;
