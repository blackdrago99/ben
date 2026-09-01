export type ModelStatus = 'empty' | 'loading' | 'ready' | 'connected';

export type ModelInfo = {
  id: string;
  name: string;
  size: string;
  status: ModelStatus;
  progress: number;
};

export type FileNode = {
  name: string;
  path: string;
  isFolder: boolean;
  children: FileNode[];
  size: number;
  blob?: string;
};
