import { useEffect, useRef, useState, useCallback } from 'react';
import JSZip from 'jszip';
import {
  ArrowUp,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleSlash2,
  Download,
  File as FileIcon,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Search,
  FileText as FileTextIcon,
  Code2,
  Sparkles as SparklesIcon,
  Sparkles,
  Square,
  Upload,
  Eye,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { FileNode, ModelInfo } from '@/types';
import FileCard, { type FileCardData } from './FileCard';

type Role = 'user' | 'assistant';
type Message = {
  id: string;
  role: Role;
  content: string;
  pending?: boolean;
  error?: boolean;
  fileCards?: FileCardData[];
};

type ProcessStep = 'idle' | 'planning' | 'searching' | 'found' | 'extracting' | 'refining' | 'generating' | 'done' | 'error';
type StatusEvent =
  | { step: 'searching'; message: string; query: string }
  | { step: 'found'; count: number; urls: string[]; query: string }
  | { step: 'extracting'; message: string }
  | { step: 'done'; snippets: string[]; urls: string[]; titles: string[] }
  | { step: 'error'; message: string };

const STEP_CONFIG: Record<ProcessStep, { label: string; icon: typeof Search }> = {
  idle: { label: '', icon: Search },
  planning: { label: 'Planning...', icon: SparklesIcon },
  searching: { label: 'Searching the web...', icon: Search },
  found: { label: 'Found sources', icon: FileTextIcon },
  extracting: { label: 'Extracting content...', icon: Code2 },
  refining: { label: 'Evaluating results...', icon: SparklesIcon },
  generating: { label: 'Local model generating...', icon: SparklesIcon },
  done: { label: '', icon: SparklesIcon },
  error: { label: 'Search failed', icon: CircleSlash2 },
};

let idCounter = 0;
const uid = () => `m${++idCounter}`;

function fileIcon(name: string) {
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return <FileIcon size={14} />;
  if (/\.(md|txt|rtf)$/i.test(name)) return <FileText size={14} />;
  return <FileCode2 size={14} />;
}

function isImageFile(name: string) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

function isHtmlFile(name: string) {
  return /\.(html?|svg)$/i.test(name);
}

function isTextFile(name: string) {
  return /\.(md|txt|rtf|css|js|jsx?|tsx?|json|xml|csv|py|rb|go|rs|java|c|cpp|h|sh|yml|yaml|toml|ini|env|sql)$/i.test(name);
}

function buildTree(entries: { name: string; isFolder: boolean; path: string; size: number; blob?: string }[]): FileNode[] {
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
          blob: isLast && !e.isFolder ? e.blob : undefined,
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

function flattenToEntries(nodes: FileNode[]): { name: string; isFolder: boolean; path: string; size: number; blob?: string }[] {
  const out: { name: string; isFolder: boolean; path: string; size: number; blob?: string }[] = [];
  const walk = (n: FileNode) => {
    if (n.isFolder) n.children.forEach(walk);
    else out.push({ name: n.name, isFolder: false, path: n.path, size: n.size, blob: n.blob });
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

type ParsedFile = { path: string; content: string };

function parseCodeBlocks(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const seen = new Set<string>();

  // Pattern 1: ```language:filename or ```filename
  // e.g. ```tsx:src/App.tsx or ```python:main.py
  const codeBlockRegex = /```(?:[a-zA-Z]+:)?([^\n```]+)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const rawName = match[1]?.trim();
    const content = match[2].trim();
    if (!rawName || !content) continue;

    let filePath = rawName;
    // Strip leading/trailing quotes or backticks
    filePath = filePath.replace(/^[`"']|[`"']$/g, '');
    // If it looks like a filename with extension, use it
    if (/\.[a-zA-Z0-9]+$/.test(filePath) || filePath.includes('/')) {
      if (!seen.has(filePath)) {
        seen.add(filePath);
        files.push({ path: filePath, content });
      }
    }
  }

  // Pattern 2: Explicit file markers like "File: path/to/file.tsx" followed by a code block
  const fileMarkerRegex = /(?:File|Create|Write):\s*([\w\/.\-]+)\s*\n```[a-zA-Z]*\n([\s\S]*?)```/gi;
  while ((match = fileMarkerRegex.exec(text)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    if (filePath && content && !seen.has(filePath)) {
      seen.add(filePath);
      files.push({ path: filePath, content });
    }
  }

  return files;
}

function inferFileName(text: string, content: string): string {
  // Try to find a filename hint in the text before the code block
  const hints = [
    /(?:create|write|save|file|new)\s+(?:a\s+)?(?:file\s+)?(?:called\s+|named\s+)?[`"']?([\w\/.\-]+\.[a-zA-Z0-9]+)[`"']?/i,
    /([\w\/.\-]+\.(?:tsx?|jsx?|py|css|html|json|md|txt|sh|yml|yaml|toml|go|rs|java|c|cpp))/i,
  ];
  for (const hint of hints) {
    const m = text.match(hint);
    if (m && m[1]) return m[1];
  }
  // Infer from content
  if (/^import\s+React/.test(content) || /<\w+\s.*>/.test(content)) return 'component.tsx';
  if (/^<!DOCTYPE/.test(content) || /^<html/.test(content)) return 'index.html';
  if (/^[\s]*\{/.test(content) && /[\s]*\}/.test(content)) return 'config.json';
  if (/^(import|from|def|class|print)\s/m.test(content)) return 'script.py';
  if (/^\.\w+\s*\{/.test(content)) return 'styles.css';
  return 'code.txt';
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
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [textContent, setTextContent] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<ProcessStep>('idle');
  const [foundCount, setFoundCount] = useState(0);
  const [searchRound, setSearchRound] = useState(0);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [filesCreated, setFilesCreated] = useState(0);
  const [activeFileCards, setActiveFileCards] = useState<FileCardData[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const modelConnected = model.status === 'connected';

  const checkInternet = useCallback(async (): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/code-search`, {
        method: 'OPTIONS',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const doCheck = async () => {
      const online = await checkInternet();
      setIsOnline(online);
    };
    doCheck();
    const interval = setInterval(doCheck, 30000);
    return () => clearInterval(interval);
  }, [checkInternet]);

  const runCodeSearch = async (query: string): Promise<{ snippets: string[]; urls: string[] } | null> => {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/code-search`;
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ query }),
      });
      if (!res.ok || !res.body) return null;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result: { snippets: string[]; urls: string[] } = { snippets: [], urls: [] };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const block of lines) {
          const dataLine = block.trim();
          if (!dataLine.startsWith('data: ')) continue;
          const json = dataLine.slice(6);
          try {
            const event: StatusEvent = JSON.parse(json);
            if (event.step === 'searching') {
              setCurrentStep('searching');
            } else if (event.step === 'found') {
              setCurrentStep('found');
              setFoundCount(event.count);
            } else if (event.step === 'extracting') {
              setCurrentStep('extracting');
            } else if (event.step === 'done') {
              result = { snippets: event.snippets, urls: event.urls };
            } else if (event.step === 'error') {
              setCurrentStep('error');
              return null;
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
      return result;
    } catch {
      setCurrentStep('error');
      return null;
    }
  };

  const generateText = async (messages: { role: string; content: string }[]): Promise<string> => {
    const chunks = await engine.chat.completions.create({
      messages: messages as any,
      temperature: 0.1,
      stream: true,
    });
    let result = '';
    for await (const chunk of chunks) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) result += delta;
    }
    return result.trim();
  };

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

  useEffect(() => {
    if (!selectedFile) {
      setTextContent('');
      return;
    }
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
    const node = find(files);
    if (node && !node.isFolder && node.blob && isTextFile(node.name)) {
      fetch(node.blob)
        .then((r) => r.text())
        .then(setTextContent)
        .catch(() => setTextContent(''));
    } else {
      setTextContent('');
    }
  }, [selectedFile, files]);

  const toggleFolder = (path: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const addSystemFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const entries = Array.from(list).map((f) => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      return { name: f.name, isFolder: false, path: rel, size: f.size, blob: URL.createObjectURL(f) };
    });
    setFiles((prev) => buildTree([...flattenToEntries(prev), ...entries]));
  };

  const saveFileToTree = (filePath: string, content: string) => {
    const cleanPath = filePath.startsWith('project/') ? filePath : `project/${filePath}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(blob);
    const name = cleanPath.split('/').pop() || cleanPath;

    setFiles((prev) => {
      const existing = flattenToEntries(prev);
      const filtered = existing.filter((e) => e.path !== cleanPath);
      return buildTree([...filtered, {
        name, isFolder: false, path: cleanPath, size: content.length, blob: blobUrl,
      }]);
    });
    setFilesCreated((c) => c + 1);
  };

  const updateFileCard = (msgId: string, updater: (cards: FileCardData[]) => FileCardData[]) => {
    setMessages((m) => m.map((msg) =>
      msg.id === msgId ? { ...msg, fileCards: updater(msg.fileCards || []) } : msg
    ));
  };

  const downloadAsZip = async () => {
    const allEntries = flattenToEntries(files);
    if (allEntries.length === 0) return;

    const zip = new JSZip();
    for (const entry of allEntries) {
      const zipPath = entry.path.replace(/^project\//, '');
      if (entry.blob) {
        try {
          const res = await fetch(entry.blob);
          const text = await res.text();
          zip.file(zipPath, text);
        } catch {
          // skip unreadable files
        }
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project-files.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    setCurrentStep('planning');
    setFoundCount(0);
    setSearchRound(0);

    let searchContext = '';

    try {
      // Step 1: Planning — local model decides if web search is needed
      const planAnswer = await generateText([
        { role: 'system', content: 'You are a planning assistant. Does the user question need current information from the web to answer accurately? Questions about current events, latest documentation, recent news, real-time data, or recent releases need web search. Questions about general knowledge, math, coding syntax, or creative writing do NOT need web search. Reply ONLY "YES" or "NO".' },
        { role: 'user', content: text },
      ]);
      const needsSearch = planAnswer.toUpperCase().startsWith('YES');

      if (needsSearch) {
        // Step 2: Real internet connectivity check
        const online = await checkInternet();
        setIsOnline(online);

        if (online) {
          // Step 3: Search with refine loop (max 3 rounds, top 5 each time)
          const maxRounds = 3;
          let allSnippets: string[] = [];
          let allUrls: string[] = [];
          let currentQuery = text;

          for (let round = 0; round < maxRounds; round++) {
            setSearchRound(round + 1);
            const searchResult = await runCodeSearch(currentQuery);

            if (!searchResult || searchResult.snippets.length === 0) break;

            // Merge and deduplicate
            for (const s of searchResult.snippets) {
              if (!allSnippets.includes(s)) allSnippets.push(s);
            }
            for (const u of searchResult.urls) {
              if (!allUrls.includes(u)) allUrls.push(u);
            }

            if (round < maxRounds - 1) {
              // Step 4: Local model checks if results are sufficient
              setCurrentStep('refining');
              const checkAnswer = await generateText([
                { role: 'system', content: 'You are evaluating whether search results contain enough information to answer the user question. If the results provide enough relevant information, reply ONLY "SUFFICIENT". If important information is still missing, reply "NEEDS_MORE:" followed by a shorter, more specific search query that targets the missing information. Be concise.' },
                { role: 'user', content: `Question: ${text}\n\nSearch results so far:\n${allSnippets.join('\n\n---\n\n')}` },
              ]);

              if (checkAnswer.toUpperCase().startsWith('SUFFICIENT')) break;

              const match = checkAnswer.match(/NEEDS_MORE:\s*(.+)/i);
              if (match && match[1].trim()) {
                currentQuery = match[1].trim();
              } else {
                break;
              }
            }
          }

          if (allSnippets.length > 0) {
            searchContext = allSnippets
              .map((s, i) => `--- Reference ${i + 1} ---\n${s}`)
              .join('\n\n');
          }
        }
      }
    } catch {
      // planning or search failure is non-fatal; continue with local model only
    }

    // Step 5: Generate final answer with local model
    setCurrentStep('generating');

    try {
      const codeRules = `You are also a software developer. Whenever the user asks you to build, create, make, or fix ANYTHING that can be turned into a running project (a website, a web app, a landing page, a game, a tool, a calculator, a form, a component, a script, etc.), you MUST automatically decide the file and folder structure the project needs and write EVERY file yourself — the user will NOT tell you which files or folders to create. You decide that, exactly like a developer would.\n\nRules for writing code:\n1. Write each file as its own fenced code block. Put the FULL path (including folders) as the filename on the opening fence line.\n2. Use this exact format:\n\`\`\`html:index.html\n<full code here>\n\`\`\`\n\`\`\`css:src/styles.css\n<full code here>\n\`\`\`\n\`\`\`js:src/main.js\n<full code here>\n\`\`\`\n3. Pick the right structure for the project. Examples: a website needs index.html + styles.css + maybe script.js; a bigger app needs src/ folders with separate components.\n4. Write COMPLETE, working code in every file — never placeholders, never "..." or "// rest of code".\n5. The main HTML file should be named index.html so it can be previewed.\n6. Link your files together (CSS via <link>, JS via <script src>) so the project actually runs.\n7. When the user later asks to CHANGE something, re-write the full updated file(s) with the same filename so they get replaced.`;

      const systemContent = searchContext
        ? `You are a helpful AI assistant running locally on the user device. The following reference information was found via a real-time web search:\n\n${searchContext}\n\nUse this information to produce an accurate answer, and adapt it to the user's request.\n\n${codeRules}`
        : `You are a helpful AI assistant running locally on the user device.\n\n${codeRules}`;

      const chatMessages = [
        { role: 'system' as const, content: systemContent },
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
      let firstChunk = true;

      // Streaming code parser state
      let currentFile: { path: string; content: string } | null = null;
      let codeFenceLang = '';
      let inCodeFence = false;
      let codeBuffer = '';
      let textBeforeCode = '';
      let cardCounter = 0;

      const finishCurrentFile = () => {
        if (currentFile && currentFile.content.trim()) {
          const cardId = `fc-${pendingId}-${++cardCounter}`;
          const finalContent = currentFile.content.trim();
          // Mark existing card as done, save to tree
          updateFileCard(pendingId, (cards) =>
            cards.map((c) =>
              c.path === currentFile!.path ? { ...c, content: finalContent, status: 'done' as const } : c
            )
          );
          saveFileToTree(currentFile.path, finalContent);
          // Auto-open in preview if it's an HTML file, otherwise just select it in tree
          const cleanPath = currentFile.path.startsWith('project/') ? currentFile.path : `project/${currentFile.path}`;
          if (isHtmlFile(currentFile.path)) {
            setSelectedFile(cleanPath);
          }
          // Expand the project folder
          setExpanded((s) => { const next = new Set(s); next.add('project'); return next; });
        }
        currentFile = null;
        codeBuffer = '';
        codeFenceLang = '';
      };

      for await (const chunk of chunks) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (!delta) continue;
        if (firstChunk) {
          firstChunk = false;
          setCurrentStep('done');
        }
        reply += delta;

        // Real-time code block parsing
        // We need to detect ```language:path or ```path patterns
        // and stream content into file cards
        const lines = delta.split('\n');
        for (const line of lines) {
          // Detect code fence start with filename
          const fenceStartMatch = line.match(/^```(?:([a-zA-Z]+)?:?)?\s*([\w\/.\-]+\.[a-zA-Z0-9]+)?\s*$/);
          if (fenceStartMatch && !inCodeFence) {
            const lang = fenceStartMatch[1] || '';
            const filename = fenceStartMatch[2] || '';
            if (filename) {
              // This is a code block with a filename → start a file card
              finishCurrentFile();
              currentFile = { path: filename, content: '' };
              inCodeFence = true;
              codeFenceLang = lang;
              cardCounter++;
              const cardId = `fc-${pendingId}-${cardCounter}`;
              updateFileCard(pendingId, (cards) => [...cards, {
                id: cardId,
                path: filename,
                content: '',
                status: 'writing' as const,
              }]);
              continue;
            }
          }
          // Detect code fence end
          if (line.trim() === '```' && inCodeFence) {
            finishCurrentFile();
            inCodeFence = false;
            continue;
          }
          // Accumulate code into current file
          if (inCodeFence && currentFile) {
            currentFile.content += (currentFile.content ? '\n' : '') + line;
            // Update the file card in real-time
            updateFileCard(pendingId, (cards) =>
              cards.map((c) =>
                c.path === currentFile!.path && c.status === 'writing'
                  ? { ...c, content: currentFile!.content }
                  : c
              )
            );
          }
        }

        setMessages((m) =>
          m.map((msg) => (msg.id === pendingId ? { ...msg, content: reply, pending: false } : msg))
        );
      }

      // Finish any remaining open file
      finishCurrentFile();

      const fullReply = await engine.getMessage();
      const finalText = fullReply || reply;

      // Also run the batch parser as a fallback for code blocks we might have missed
      const parsedFiles = parseCodeBlocks(finalText);
      if (parsedFiles.length > 0) {
        const existingCardPaths = new Set<string>();
        setMessages((m) => m.map((msg) => {
          if (msg.id !== pendingId) return msg;
          (msg.fileCards || []).forEach((c) => existingCardPaths.add(c.path));
          return msg;
        }));
        for (const pf of parsedFiles) {
          if (!existingCardPaths.has(pf.path)) {
            saveFileToTree(pf.path, pf.content);
          }
        }
      }

      setMessages((m) =>
        m.map((msg) => (msg.id === pendingId ? { ...msg, content: finalText, pending: false } : msg))
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate a response.';
      setMessages((m) =>
        m.map((msg) => (msg.id === pendingId ? { ...msg, content: errorMsg, pending: false, error: true } : msg))
      );
    } finally {
      setIsResponding(false);
      setCurrentStep('done');
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

  const gridClass = `chat-layout${filesCollapsed ? ' files-collapsed' : ''}${chatCollapsed ? ' chat-collapsed' : ''}${previewCollapsed ? ' preview-collapsed' : ''}`;

  return (
    <div className={gridClass}>
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

      {/* LEFT: Uploaded files */}
      <div className={`files-column${filesCollapsed ? ' collapsed' : ''}`}>
        <div className="files-topbar">
          <div className="files-title">
            <FolderOpen size={14} /> Uploaded files
          </div>
          <div className="files-topbar-actions">
            <div className="files-status">
              {hasFiles ? `${totalFiles} file${totalFiles === 1 ? '' : 's'}` : 'Empty'}
            </div>
            {hasFiles && (
              <button
                className="download-zip-button"
                onClick={downloadAsZip}
                aria-label="Download all files as ZIP"
                title="Download all files as ZIP"
              >
                <Download size={14} />
              </button>
            )}
            <button
              className="panel-toggle workspace-style-toggle"
              onClick={() => setFilesCollapsed((c) => !c)}
              aria-label={filesCollapsed ? 'Expand uploaded files' : 'Collapse uploaded files'}
              title={filesCollapsed ? 'Expand uploaded files' : 'Collapse uploaded files'}
              aria-expanded={!filesCollapsed}
            >
              {filesCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          </div>
        </div>

        <div className="files-body">
          {!hasFiles ? (
            <div className="files-empty">
              <Upload size={28} />
              <p>Use the paperclip in the chat to upload files or a folder. They'll appear here.</p>
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

        <div className="files-footer">
          {selectedNode ? (
            <>
              <ChevronRight size={12} />
              <span className="selected-path">{selectedNode.path}</span>
            </>
          ) : (
            <>
              <CircleSlash2 size={12} /> Select a file to preview
            </>
          )}
        </div>
      </div>

      {/* MIDDLE: Chat */}
      <div className={`chat-column${chatCollapsed ? ' collapsed' : ''}`}>
        <div className="chat-topbar">
          <div className="chat-title">
            <span className="chat-emblem"><Sparkles size={14} /></span>
            <span>Chat</span>
            <div className={`online-indicator ${isOnline === null ? 'checking' : isOnline ? 'online' : 'offline'}`}>
              {isOnline === null ? (
                <Loader2 size={11} className="spin" />
              ) : isOnline ? (
                <Wifi size={11} />
              ) : (
                <WifiOff size={11} />
              )}
              <span>{isOnline === null ? 'Checking…' : isOnline ? 'Online' : 'Offline'}</span>
            </div>
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
            <button
              className="panel-toggle workspace-style-toggle"
              onClick={() => setChatCollapsed((c) => !c)}
              aria-label={chatCollapsed ? 'Expand chat' : 'Collapse chat'}
              title={chatCollapsed ? 'Expand chat' : 'Collapse chat'}
              aria-expanded={!chatCollapsed}
            >
              {chatCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
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
            {currentStep !== 'idle' && currentStep !== 'done' && (
              <div className="process-status-bar">
                {currentStep === 'planning' && (
                  <span className="status-chip planning">
                    <SparklesIcon size={12} className="pulse" />
                    Local model planning…
                  </span>
                )}
                {currentStep === 'searching' && (
                  <span className="status-chip searching">
                    <Search size={12} className="pulse" />
                    {searchRound > 1 ? `Searching (round ${searchRound})…` : 'Searching the web…'}
                  </span>
                )}
                {currentStep === 'found' && (
                  <span className="status-chip found">
                    <FileTextIcon size={12} />
                    {searchRound > 1 ? `Round ${searchRound}: ` : ''}Found {foundCount} sources
                  </span>
                )}
                {currentStep === 'extracting' && (
                  <span className="status-chip extracting">
                    <Code2 size={12} className="pulse" />
                    Extracting & filtering content…
                  </span>
                )}
                {currentStep === 'refining' && (
                  <span className="status-chip refining">
                    <SparklesIcon size={12} className="pulse" />
                    Local model evaluating results…
                  </span>
                )}
                {currentStep === 'generating' && (
                  <span className="status-chip generating">
                    <SparklesIcon size={12} className="pulse" />
                    Local model generating…
                  </span>
                )}
                {currentStep === 'error' && (
                  <span className="status-chip error">
                    <CircleSlash2 size={12} />
                    Search failed — proceeding with local model only
                  </span>
                )}
              </div>
            )}
            <div className="chat-scroll" ref={scrollRef}>
              {!hasMessages && (
                <div className="chat-empty">
                  <div className="chat-empty-icon"><Sparkles size={22} /></div>
                  <h3>Start a conversation</h3>
                  <p>Your model is running locally on your device. Ask anything — replies come from the model on your machine. When internet is available, it can search the web for current information.</p>
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
                    {m.pending && !m.fileCards?.length ? (
                      <div className="msg-pending"><Loader2 size={13} className="spin" /> Generating…</div>
                    ) : (
                      <>
                        {m.fileCards && m.fileCards.length > 0 && (
                          <div className="file-cards-container">
                            {m.fileCards.map((fc) => (
                              <FileCard key={fc.id} file={fc} defaultOpen={fc.status === 'writing'} />
                            ))}
                          </div>
                        )}
                        {m.content && <p className="msg-text">{m.content}</p>}
                      </>
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
                Press Enter to send · Shift + Enter for a new line · Replies from your local model{isOnline ? ' + web search' : ''}
              </p>
            </div>
          </>
        )}
      </div>

      {/* RIGHT: Live preview */}
      <div className={`preview-column${previewCollapsed ? ' collapsed' : ''}`}>
        <div className="preview-topbar">
          <div className="preview-title">
            <Eye size={14} /> Live preview
          </div>
          <div className="preview-topbar-actions">
            <div className="preview-status">
              {selectedNode && !selectedNode.isFolder ? selectedNode.name : 'No file selected'}
            </div>
            <button
              className="panel-toggle workspace-style-toggle"
              onClick={() => setPreviewCollapsed((c) => !c)}
              aria-label={previewCollapsed ? 'Expand live preview' : 'Collapse live preview'}
              title={previewCollapsed ? 'Expand live preview' : 'Collapse live preview'}
              aria-expanded={!previewCollapsed}
            >
              {previewCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
            </button>
          </div>
        </div>

        <div className="preview-body">
          {!selectedNode || selectedNode.isFolder ? (
            <div className="preview-empty">
              <Eye size={28} />
              <p>Select a file from the left panel to see a live preview here.</p>
            </div>
          ) : selectedNode.blob && isImageFile(selectedNode.name) ? (
            <div className="preview-image-wrap">
              <img src={selectedNode.blob} alt={selectedNode.name} className="preview-image" />
            </div>
          ) : selectedNode.blob && isHtmlFile(selectedNode.name) ? (
            <iframe
              src={selectedNode.blob}
              title="File preview"
              className="preview-iframe"
              sandbox="allow-scripts"
            />
          ) : selectedNode.blob && isTextFile(selectedNode.name) ? (
            <pre className="preview-text">{textContent || 'Loading…'}</pre>
          ) : (
            <div className="preview-empty">
              <FileIcon size={28} />
              <p>No preview available for this file type.</p>
            </div>
          )}
        </div>

        <div className="preview-footer">
          {selectedNode && !selectedNode.isFolder ? (
            <>
              <ChevronRight size={12} />
              <span className="selected-path">{selectedNode.path}</span>
              <span className="preview-size">{formatSize(selectedNode.size)}</span>
            </>
          ) : (
            <>
              <CircleSlash2 size={12} /> No file selected
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;
