import { useRef } from 'react';
import {
  Boxes,
  CheckCircle2,
  Cpu,
  Loader2,
  MessageSquare,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import type { ModelInfo } from '@/types';

type Props = {
  model: ModelInfo;
  setModel: React.Dispatch<React.SetStateAction<ModelInfo>>;
  onConnect: () => void;
  onDelete: () => void;
  onLoadFile: (file: File) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function ModelPanel({ model, setModel, onConnect, onDelete, onLoadFile }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoadFile(file);
    e.target.value = '';
  };

  const isLoading = model.status === 'loading';
  const isReady = model.status === 'ready';
  const isConnected = model.status === 'connected';
  const isEmpty = model.status === 'empty';

  return (
    <div className="model-panel">
      <input
        ref={fileInputRef}
        type="file"
        accept=".gguf,.bin,.safetensors,.onnx,.pt,.pth,.mlc"
        hidden
        onChange={handleFileChange}
      />

      <div className="model-header">
        <div className="model-header-left">
          <p className="eyebrow">LOCAL MODELS</p>
          <h2>Model library</h2>
          <p className="model-sub">Upload a local model file. It runs entirely on your device using WebGPU — no cloud, no server.</p>
        </div>
        <div className="model-header-right">
          <div className="stat-pill"><Cpu size={14} /> On-device</div>
          <div className="stat-pill"><Zap size={14} /> WebGPU</div>
        </div>
      </div>

      <div className="model-card">
        {isEmpty && (
          <div className="model-upload-zone" onClick={() => fileInputRef.current?.click()}>
            <div className="upload-icon"><Upload size={32} /></div>
            <h3>Upload a local model</h3>
            <p>Click to select a model file from your device</p>
            <p className="upload-formats">GGUF · BIN · Safetensors · ONNX · PT</p>
          </div>
        )}

        {isLoading && (
          <div className="model-loading-zone">
            <div className="model-card-top">
              <div className="model-emblem"><Loader2 size={22} className="spin" /></div>
              <div className="model-id">
                <div className="model-name-row">
                  <h3>{model.name}</h3>
                  <span className="status-chip downloading"><Loader2 size={12} className="spin" /> Loading</span>
                </div>
                <p className="model-tagline">Loading model into WebGPU memory…</p>
              </div>
            </div>
            <div className="download-progress">
              <div className="progress-track"><span style={{ width: `${model.progress}%` }} /></div>
              <div className="progress-meta">
                <span>{Math.round(model.progress)}% · loading</span>
                <span>{model.size}</span>
              </div>
            </div>
          </div>
        )}

        {(isReady || isConnected) && (
          <>
            <div className="model-card-top">
              <div className="model-emblem"><Boxes size={22} /></div>
              <div className="model-id">
                <div className="model-name-row">
                  <h3>{model.name}</h3>
                  {isConnected ? (
                    <span className="status-chip active"><span className="dot" /> Connected</span>
                  ) : (
                    <span className="status-chip ready"><CheckCircle2 size={12} /> Ready</span>
                  )}
                </div>
                <p className="model-tagline">
                  {isConnected
                    ? 'Model is connected to chat. Go to the Chat tab to start talking.'
                    : 'Model loaded successfully. Connect it to chat to start using it.'}
                </p>
              </div>
            </div>

            <div className="model-specs">
              <div className="spec"><Boxes size={14} /><span>Size</span><strong>{model.size}</strong></div>
              <div className="spec"><Cpu size={14} /><span>Runtime</span><strong>WebGPU</strong></div>
              <div className="spec"><Zap size={14} /><span>Status</span><strong>{isConnected ? 'Connected' : 'Ready'}</strong></div>
            </div>

            <div className="model-actions">
              {!isConnected && (
                <button className="btn-primary" onClick={onConnect}>
                  <MessageSquare size={15} /> Connect to chat
                </button>
              )}
              {isConnected && (
                <button className="btn-primary" onClick={onConnect} disabled>
                  <CheckCircle2 size={15} /> Connected
                </button>
              )}
              <button className="btn-ghost danger" onClick={onDelete}>
                <Trash2 size={15} /> Delete model
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { formatBytes };
export default ModelPanel;
