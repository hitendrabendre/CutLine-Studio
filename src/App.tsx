import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ListPlus, Loader2, Search, Scissors, Sparkles, Upload } from 'lucide-react';
import type { ClipItem, ExportOptions, RenderJob } from './types';
import {
  extractAudioWaveformPeaks,
  extractYoutubeUrls,
  formatBytes,
  formatTimecode,
  generateWaveformPeaks,
  parseYoutubeId,
} from './utils/time';
import { TopBar } from './components/TopBar';
import { YouTubePreviewPlayer } from './components/YouTubePreviewPlayer';
import { ClipCard } from './components/ClipCard';
import { MasterTimeline } from './components/MasterTimeline';
import { ExportPanel } from './components/ExportPanel';
import { BatchImportModal } from './components/BatchImportModal';
import { CookiesModal } from './components/CookiesModal';

const STORAGE_KEY = 'cutline_studio_state_v1';

const SAMPLE_YOUTUBE_LINKS = [
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
];

export default function App() {
  const [clips, setClips] = useState<ClipItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { clips?: ClipItem[] };
        if (Array.isArray(parsed.clips)) return parsed.clips;
      }
    } catch {
      // ignore storage parse failure
    }
    return [];
  });

  const [exportOptions, setExportOptions] = useState<ExportOptions>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { exportOptions?: ExportOptions };
        if (parsed.exportOptions) return parsed.exportOptions;
      }
    } catch {
      // ignore
    }
    return {
      bitrate: 192,
      crossfadeSec: 0.5,
      normalize: true,
      outputName: 'cutline-combined-mix',
    };
  });

  const [urlInput, setUrlInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [addingUrls, setAddingUrls] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  const [activeClipId, setActiveClipId] = useState<string | null>(() => clips[0]?.id ?? null);
  const [playRequestToken, setPlayRequestToken] = useState(0);
  const [auditionMode, setAuditionMode] = useState<'single' | 'sequence'>('single');
  const [playheadMap, setPlayheadMap] = useState<Record<string, number>>({});

  const [activeSection, setActiveSection] = useState<'workspace' | 'timeline' | 'export'>('workspace');
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [cookiesModalOpen, setCookiesModalOpen] = useState(false);
  const [cookiesConfigured, setCookiesConfigured] = useState(false);

  const [activeJob, setActiveJob] = useState<RenderJob | null>(null);
  const [exportHistory, setExportHistory] = useState<RenderJob[]>([]);

  const pollTimerRef = useRef<number | null>(null);
  const mp3InputRef = useRef<HTMLInputElement | null>(null);

  // Persist clips & export options
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ clips, exportOptions })
      );
    } catch {
      // ignore quota errors
    }
  }, [clips, exportOptions]);

  // Check initial cookies status
  useEffect(() => {
    fetch('/api/cookies')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { configured?: boolean } | null) => {
        if (d) setCookiesConfigured(Boolean(d.configured));
      })
      .catch(() => {});
  }, []);

  // Poll active render job
  useEffect(() => {
    if (!activeJob || activeJob.status === 'ready' || activeJob.status === 'error') {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${activeJob.id}`);
        if (!res.ok) return;
        const data = (await res.json()) as { job: RenderJob };
        setActiveJob(data.job);
        if (data.job.status === 'ready') {
          setExportHistory((prev) => {
            if (prev.some((h) => h.id === data.job.id)) return prev;
            return [data.job, ...prev].slice(0, 8);
          });
        }
      } catch {
        // retry on next tick
      }
    }, 600);

    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [activeJob?.id, activeJob?.status]);

  const includedClips = useMemo(() => clips.filter((c) => c.included), [clips]);

  const filteredClips = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return clips;
    return clips.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.channel.toLowerCase().includes(q) ||
        c.videoId.toLowerCase().includes(q)
    );
  }, [clips, searchQuery]);

  const activeClip = useMemo(
    () => clips.find((c) => c.id === activeClipId) || clips[0] || null,
    [clips, activeClipId]
  );

  const totalTrimmedDuration = useMemo(() => {
    const raw = includedClips.reduce((acc, c) => acc + Math.max(0.2, c.endTime - c.startTime), 0);
    const cf =
      includedClips.length > 1 && exportOptions.crossfadeSec > 0
        ? (includedClips.length - 1) * exportOptions.crossfadeSec
        : 0;
    return Math.max(0, raw - cf);
  }, [includedClips, exportOptions.crossfadeSec]);

  const isRendering =
    activeJob !== null &&
    (activeJob.status === 'queued' ||
      activeJob.status === 'processing' ||
      activeJob.status === 'combining');

  const importYoutubeUrls = useCallback(async (rawUrls: string[]) => {
    if (rawUrls.length === 0) return;
    setInputError(null);
    setAddingUrls(true);
    try {
      const res = await fetch('/api/youtube/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: rawUrls }),
      });
      const data = (await res.json()) as {
        results?: Array<
          | {
              ok: true;
              input: string;
              meta: {
                videoId: string;
                url: string;
                title: string;
                channel: string;
                durationSeconds: number;
                thumbnailUrl: string;
              };
            }
          | { ok: false; input: string; error: string }
        >;
        error?: string;
      };

      if (!res.ok || !data.results) {
        setInputError(data.error || 'Could not resolve YouTube links.');
        return;
      }

      const failures = data.results.filter((r) => !r.ok);
      const successes = data.results.filter((r) => r.ok);

      if (failures.length > 0 && successes.length === 0) {
        setInputError(failures[0].error);
        return;
      }

      if (failures.length > 0) {
        setInputError(
          `Added ${successes.length} clip(s). ${failures.length} link(s) could not be resolved.`
        );
      }

      const newItems: ClipItem[] = successes.map((item) => {
        const parsed = parseYoutubeId(item.input);
        const totalDur = Math.max(2, item.meta.durationSeconds || 180);
        const startHint = parsed?.startHint;
        const start =
          startHint !== undefined && startHint < totalDur - 1 ? startHint : 0;
        const end = totalDur;

        return {
          id: crypto.randomUUID(),
          videoId: item.meta.videoId,
          url: item.meta.url,
          title: item.meta.title,
          channel: item.meta.channel,
          durationSeconds: totalDur,
          thumbnailUrl: item.meta.thumbnailUrl,
          startTime: start,
          endTime: end,
          included: true,
          waveformPeaks: generateWaveformPeaks(`${item.meta.videoId}-${Math.random()}`),
        };
      });

      if (newItems.length > 0) {
        setClips((prev) => [...prev, ...newItems]);
        setActiveClipId((prev) => prev || newItems[0].id);
      }
    } catch (err) {
      setInputError(err instanceof Error ? err.message : 'Network error adding links.');
    } finally {
      setAddingUrls(false);
    }
  }, []);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const urls = extractYoutubeUrls(urlInput);
    if (urls.length === 0) {
      setInputError('Paste a valid YouTube URL (watch, youtu.be, shorts, or music.youtube.com).');
      return;
    }
    await importYoutubeUrls(urls);
    setUrlInput('');
  };

  const handleUpdateTrim = useCallback((id: string, startTime: number, endTime: number) => {
    setClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, startTime, endTime } : c))
    );
  }, []);

  const handleToggleIncluded = useCallback((id: string) => {
    setClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, included: !c.included } : c))
    );
  }, []);

  const handleMove = useCallback((id: string, direction: 'up' | 'down') => {
    setClips((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx < 0) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  }, []);

  const handleDuplicate = useCallback((id: string) => {
    setClips((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx < 0) return prev;
      const orig = prev[idx];
      const copy: ClipItem = {
        ...orig,
        id: crypto.randomUUID(),
        waveformPeaks: generateWaveformPeaks(`${orig.videoId}-${Date.now()}`),
      };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    setClips((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setActiveClipId((curr) => (curr === id ? next[0]?.id ?? null : curr));
      return next;
    });
  }, []);

  const handleAttachAudioFile = useCallback(async (id: string, file: File) => {
    const res = await fetch(`/api/upload-audio?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const data = (await res.json()) as {
      uploadId?: string;
      originalName?: string;
      size?: number;
      durationSeconds?: number;
      error?: string;
    };
    if (!res.ok || !data.uploadId) {
      setInputError(data.error || 'Failed to upload audio file.');
      return;
    }
    const peaks = await extractAudioWaveformPeaks(file);
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const dur =
          c.sourceType === 'upload' && data.durationSeconds
            ? Math.max(1, data.durationSeconds)
            : c.durationSeconds;
        return {
          ...c,
          uploadId: data.uploadId,
          uploadFilename: data.originalName || file.name,
          fileSizeBytes: data.size ?? file.size,
          durationSeconds: dur,
          endTime: c.sourceType === 'upload' ? dur : Math.min(c.endTime, dur),
          waveformPeaks: c.sourceType === 'upload' ? peaks : c.waveformPeaks,
        };
      })
    );
  }, []);

  const uploadMultipleMp3Files = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => {
      const ext = f.name.toLowerCase();
      return (
        f.type.startsWith('audio/') ||
        f.type === 'video/mp4' ||
        f.type === 'video/webm' ||
        /\.(mp3|m4a|wav|ogg|aac|flac|mp4|webm)$/i.test(ext)
      );
    });

    if (files.length === 0) {
      setInputError('Select one or more MP3 or audio files (.mp3, .m4a, .wav, .ogg, .aac, .flac).');
      return;
    }

    setInputError(null);
    setUploadProgress({ done: 0, total: files.length });

    const createdClips: ClipItem[] = [];
    let failedCount = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const [res, peaks] = await Promise.all([
            fetch(`/api/upload-audio?filename=${encodeURIComponent(file.name)}`, {
              method: 'POST',
              headers: { 'Content-Type': file.type || 'application/octet-stream' },
              body: file,
            }),
            extractAudioWaveformPeaks(file),
          ]);
          const data = (await res.json()) as {
            uploadId?: string;
            originalName?: string;
            size?: number;
            durationSeconds?: number;
            error?: string;
          };
          if (!res.ok || !data.uploadId) {
            failedCount++;
          } else {
            const dur = Math.max(1, Number(data.durationSeconds) || 60);
            const cleanTitle = file.name.replace(/\.[^.]+$/, '') || file.name;
            createdClips.push({
              id: crypto.randomUUID(),
              sourceType: 'upload',
              videoId: 'local-upload',
              url: '',
              title: cleanTitle,
              channel: `Local MP3 · ${formatBytes(data.size ?? file.size)}`,
              durationSeconds: dur,
              thumbnailUrl: '',
              startTime: 0,
              endTime: dur,
              included: true,
              waveformPeaks: peaks,
              uploadId: data.uploadId,
              uploadFilename: data.originalName || file.name,
              fileSizeBytes: data.size ?? file.size,
            });
          }
        } catch {
          failedCount++;
        }
        setUploadProgress({ done: i + 1, total: files.length });
      }

      if (createdClips.length > 0) {
        setClips((prev) => [...prev, ...createdClips]);
        setActiveClipId((prev) => prev || createdClips[0].id);
      }

      if (failedCount > 0) {
        setInputError(
          createdClips.length > 0
            ? `Uploaded ${createdClips.length} file(s). ${failedCount} file(s) failed to process.`
            : 'Could not upload the selected audio files.'
        );
      }
    } finally {
      setUploadProgress(null);
    }
  }, []);

  const handleMarkIn = useCallback((clipId: string, time: number) => {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        const clamped = Math.max(0, Math.min(Math.round(time * 10) / 10, c.endTime - 0.5));
        return { ...c, startTime: clamped };
      })
    );
  }, []);

  const handleMarkOut = useCallback((clipId: string, time: number) => {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        const clamped = Math.min(
          c.durationSeconds,
          Math.max(Math.round(time * 10) / 10, c.startTime + 0.5)
        );
        return { ...c, endTime: clamped };
      })
    );
  }, []);

  const handleAudition = useCallback((clipId: string) => {
    setAuditionMode('single');
    setActiveClipId(clipId);
    setPlayRequestToken((t) => t + 1);
  }, []);

  const handleStartCombine = useCallback(async () => {
    if (includedClips.length === 0 || isRendering) return;
    setActiveSection('export');
    setInputError(null);

    const payload = {
      clips: includedClips.map((c) => ({
        id: c.id,
        videoId: c.videoId,
        url: c.url,
        title: c.title,
        startTime: c.startTime,
        endTime: c.endTime,
        uploadId: c.uploadId,
      })),
      options: exportOptions,
    };

    try {
      const res = await fetch('/api/combine-mp3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { job?: RenderJob; error?: string };
      if (!res.ok || !data.job) {
        setInputError(data.error || 'Failed to start render job.');
        return;
      }
      setActiveJob(data.job);
    } catch (err) {
      setInputError(err instanceof Error ? err.message : 'Failed to start MP3 export.');
    }
  }, [includedClips, exportOptions, isRendering]);

  const handleNavigate = (section: 'workspace' | 'timeline' | 'export') => {
    setActiveSection(section);
    const el = document.getElementById(section);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-[#0B0D11] text-slate-100 flex flex-col">
      <TopBar
        activeSection={activeSection}
        onNavigate={handleNavigate}
        onOpenBatchModal={() => setBatchModalOpen(true)}
        onOpenCookiesModal={() => setCookiesModalOpen(true)}
        onStartCombine={handleStartCombine}
        canExport={includedClips.length > 0}
        isRendering={isRendering}
      />

      <main id="workspace" className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-6">
        {/* Page Header + Single/Multi Link Ingestion Bar */}
        <section className="mb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-white/10 pb-6">
          <div className="max-w-xl">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-100 text-balance">
              Trim YouTube &amp; MP3 Clips into One Combined MP3
            </h1>
            <p className="mt-1.5 text-sm text-slate-400">
              Add YouTube links or upload multiple MP3 files from PC or mobile, set exact In/Out trim points on each clip, and stitch them into a single downloadable MP3 track.
            </p>
          </div>

          {/* Summary Figures (Tabular Numerals, Unboxed) */}
          <div className="flex flex-wrap items-center gap-6 text-xs text-slate-400 shrink-0">
            <div>
              <span className="block text-slate-500">Queued Clips</span>
              <span className="font-mono text-base font-semibold text-slate-100 tabular-nums">
                {clips.length}
              </span>
            </div>
            <div className="h-7 w-px bg-white/10" aria-hidden="true" />
            <div>
              <span className="block text-slate-500">Included in Mix</span>
              <span className="font-mono text-base font-semibold text-slate-100 tabular-nums">
                {includedClips.length}
              </span>
            </div>
            <div className="h-7 w-px bg-white/10" aria-hidden="true" />
            <div>
              <span className="block text-slate-500">Combined Length</span>
              <span className="font-mono text-base font-semibold text-amber-400 tabular-nums">
                {formatTimecode(totalTrimmedDuration, true)}
              </span>
            </div>
          </div>
        </section>

        {/* Link & Multi-MP3 Upload Toolbar */}
        <section className="mb-6">
          <input
            ref={mp3InputRef}
            type="file"
            accept="audio/*,.mp3"
            multiple
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void uploadMultipleMp3Files(e.target.files);
                e.target.value = '';
              }
            }}
            className="hidden"
          />

          <form onSubmit={handleAddSubmit} className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder="Paste a YouTube link (or space-separated links): https://www.youtube.com/watch?v=..."
                aria-label="YouTube video link"
                className="w-full rounded-xl border border-white/15 bg-[#13161D] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="submit"
                disabled={addingUrls || !urlInput.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {addingUrls ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add Link
              </button>

              <button
                type="button"
                onClick={() => setBatchModalOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#13161D] px-4 py-3 text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <ListPlus className="h-4 w-4 text-amber-400" />
                Batch Paste
              </button>

              <button
                type="button"
                onClick={() => mp3InputRef.current?.click()}
                disabled={uploadProgress !== null}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#13161D] px-4 py-3 text-sm font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {uploadProgress ? (
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                ) : (
                  <Upload className="h-4 w-4 text-amber-400" />
                )}
                {uploadProgress
                  ? `Uploading ${uploadProgress.done}/${uploadProgress.total}...`
                  : 'Upload MP3s'}
              </button>
            </div>
          </form>

          {inputError && (
            <p className="mt-2 text-xs text-red-400" role="alert">
              {inputError}
            </p>
          )}
        </section>

        {/* Two-Column Workbench */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Master Stitch Timeline + Clip Trimming Queue */}
          <div className="lg:col-span-7 space-y-6">
            <MasterTimeline
              includedClips={includedClips}
              activeClipId={activeClip?.id ?? null}
              crossfadeSec={exportOptions.crossfadeSec}
              onSelectAndAudition={handleAudition}
            />

            {/* Queue Header + Filter */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-base font-semibold text-slate-100">
                  Trim Queue
                </h2>
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {clips.length} {clips.length === 1 ? 'clip' : 'clips'}
                </span>
              </div>

              {clips.length > 2 && (
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter clips by title..."
                    className="w-full rounded-lg border border-white/10 bg-[#13161D] py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Empty State & Drag-Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFiles(true);
              }}
              onDragLeave={() => setIsDraggingFiles(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingFiles(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  void uploadMultipleMp3Files(e.dataTransfer.files);
                }
              }}
              className="space-y-3"
            >
              {clips.length === 0 ? (
                <div
                  className={`rounded-xl border border-dashed px-6 py-12 text-center transition-colors ${
                    isDraggingFiles
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-white/15 bg-[#13161D]/60'
                  }`}
                >
                  <Scissors className="mx-auto h-8 w-8 text-amber-400/80" />
                  <h3 className="mt-3 font-display text-base font-semibold text-slate-100">
                    Add YouTube links or upload MP3 files
                  </h3>
                  <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-400 leading-relaxed">
                    Paste YouTube URLs above, drag and drop multiple MP3 files here, or tap Upload MP3s from your PC or mobile device. Trim each clip, reorder your mix, and download one combined MP3.
                  </p>
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => mp3InputRef.current?.click()}
                      disabled={uploadProgress !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload MP3s (PC / Mobile)
                    </button>
                    <button
                      type="button"
                      onClick={() => setBatchModalOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <ListPlus className="h-3.5 w-3.5 text-amber-400" />
                      Batch Paste Links
                    </button>
                    <button
                      type="button"
                      onClick={() => void importYoutubeUrls(SAMPLE_YOUTUBE_LINKS)}
                      disabled={addingUrls}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                      Load 2 Sample Clips
                    </button>
                  </div>
                </div>
              ) : filteredClips.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#13161D] p-8 text-center text-xs text-slate-400">
                No clips match "{searchQuery}".
              </div>
            ) : (
              <div className="space-y-3">
                {filteredClips.map((clip) => {
                  const realIndex = clips.findIndex((c) => c.id === clip.id);
                  return (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      index={realIndex}
                      totalCount={clips.length}
                      isActive={activeClip?.id === clip.id}
                      playheadTime={playheadMap[clip.id] ?? null}
                      hasBotError={
                        activeJob?.status === 'error' &&
                        activeJob?.errorCode === 'youtube_bot_check' &&
                        activeJob?.failedClipId === clip.id
                      }
                      onSelect={setActiveClipId}
                      onAudition={handleAudition}
                      onUpdateTrim={handleUpdateTrim}
                      onToggleIncluded={handleToggleIncluded}
                      onMove={handleMove}
                      onDuplicate={handleDuplicate}
                      onRemove={handleRemove}
                      onAttachAudioFile={handleAttachAudioFile}
                    />
                  );
                })}
              </div>
            )}
            </div>
          </div>

          {/* Right Column: Live YouTube Preview Player + MP3 Export Workbench */}
          <aside className="lg:col-span-5 space-y-6 lg:sticky lg:top-20">
            <YouTubePreviewPlayer
              activeClip={activeClip}
              includedClips={includedClips}
              playRequestToken={playRequestToken}
              auditionMode={auditionMode}
              onAuditionModeChange={setAuditionMode}
              onSelectClip={setActiveClipId}
              onPlayheadUpdate={(id, time) =>
                setPlayheadMap((prev) => ({ ...prev, [id]: time }))
              }
              onMarkIn={handleMarkIn}
              onMarkOut={handleMarkOut}
            />

            <ExportPanel
              options={exportOptions}
              onChangeOptions={setExportOptions}
              activeJob={activeJob}
              history={exportHistory}
              canExport={includedClips.length > 0}
              isRendering={isRendering}
              onStartCombine={handleStartCombine}
              onOpenCookiesModal={() => setCookiesModalOpen(true)}
            />
          </aside>
        </div>
      </main>

      <BatchImportModal
        open={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        onImportUrls={importYoutubeUrls}
      />

      <CookiesModal
        open={cookiesModalOpen}
        configured={cookiesConfigured}
        onClose={() => setCookiesModalOpen(false)}
        onStatusChanged={setCookiesConfigured}
      />
    </div>
  );
}
