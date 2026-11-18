export interface ClipItem {
  id: string;
  sourceType?: 'youtube' | 'upload';
  videoId: string;
  url: string;
  title: string;
  channel: string;
  durationSeconds: number;
  thumbnailUrl: string;
  startTime: number;
  endTime: number;
  included: boolean;
  waveformPeaks: number[];
  uploadId?: string;
  uploadFilename?: string;
  fileSizeBytes?: number;
}

export interface ExportOptions {
  bitrate: 128 | 192 | 320;
  crossfadeSec: number;
  normalize: boolean;
  outputName: string;
}

export interface ClipRenderStatus {
  clipId: string;
  title: string;
  status: 'pending' | 'downloading' | 'trimming' | 'done' | 'error';
  message?: string;
}

export interface RenderJob {
  id: string;
  status: 'queued' | 'processing' | 'combining' | 'ready' | 'error';
  progress: number;
  stageLabel: string;
  error?: string;
  errorCode?: 'youtube_bot_check' | 'ffmpeg_error' | 'invalid_input' | 'unknown';
  failedClipId?: string;
  clips: ClipRenderStatus[];
  outputFilename: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  createdAt: number;
}
