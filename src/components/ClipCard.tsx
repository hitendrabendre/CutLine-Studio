import { useEffect, useRef, useState } from 'react';
import {
  Play,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  Upload,
  Music2,
  Check,
} from 'lucide-react';
import type { ClipItem } from '../types';
import { formatTimecode, parseTimecode } from '../utils/time';

interface ClipCardProps {
  clip: ClipItem;
  index: number;
  totalCount: number;
  isActive: boolean;
  playheadTime: number | null;
  hasBotError?: boolean;
  onSelect: (id: string) => void;
  onAudition: (id: string) => void;
  onUpdateTrim: (id: string, startTime: number, endTime: number) => void;
  onToggleIncluded: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onAttachAudioFile: (id: string, file: File) => Promise<void>;
}

export function ClipCard({
  clip,
  index,
  totalCount,
  isActive,
  playheadTime,
  hasBotError,
  onSelect,
  onAudition,
  onUpdateTrim,
  onToggleIncluded,
  onMove,
  onDuplicate,
  onRemove,
  onAttachAudioFile,
}: ClipCardProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [startInput, setStartInput] = useState(formatTimecode(clip.startTime, true));
  const [endInput, setEndInput] = useState(formatTimecode(clip.endTime, true));
  const [imgError, setImgError] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setStartInput(formatTimecode(clip.startTime, true));
  }, [clip.startTime]);

  useEffect(() => {
    setEndInput(formatTimecode(clip.endTime, true));
  }, [clip.endTime]);

  const duration = Math.max(1, clip.durationSeconds);
  const startPct = Math.max(0, Math.min(100, (clip.startTime / duration) * 100));
  const endPct = Math.max(startPct, Math.min(100, (clip.endTime / duration) * 100));
  const segmentDur = Math.max(0, clip.endTime - clip.startTime);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const time = Math.round(ratio * duration * 10) / 10;

      if (dragging === 'start') {
        const clamped = Math.max(0, Math.min(time, clip.endTime - 0.5));
        onUpdateTrim(clip.id, clamped, clip.endTime);
      } else {
        const clamped = Math.min(duration, Math.max(time, clip.startTime + 0.5));
        onUpdateTrim(clip.id, clip.startTime, clamped);
      }
    };

    const onPointerMove = (e: PointerEvent) => handleMove(e.clientX);
    const onPointerUp = () => setDragging(null);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragging, clip.id, clip.startTime, clip.endTime, duration, onUpdateTrim]);

  const commitStartInput = () => {
    const parsed = parseTimecode(startInput);
    if (parsed !== null) {
      const clamped = Math.max(0, Math.min(parsed, clip.endTime - 0.5));
      onUpdateTrim(clip.id, clamped, clip.endTime);
    } else {
      setStartInput(formatTimecode(clip.startTime, true));
    }
  };

  const commitEndInput = () => {
    const parsed = parseTimecode(endInput);
    if (parsed !== null) {
      const clamped = Math.min(duration, Math.max(parsed, clip.startTime + 0.5));
      onUpdateTrim(clip.id, clip.startTime, clamped);
    } else {
      setEndInput(formatTimecode(clip.endTime, true));
    }
  };

  const nudgeStart = (delta: number) => {
    const next = Math.max(0, Math.min(clip.startTime + delta, clip.endTime - 0.5));
    onUpdateTrim(clip.id, Math.round(next * 10) / 10, clip.endTime);
  };

  const nudgeEnd = (delta: number) => {
    const next = Math.min(duration, Math.max(clip.endTime + delta, clip.startTime + 0.5));
    onUpdateTrim(clip.id, clip.startTime, Math.round(next * 10) / 10);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await onAttachAudioFile(clip.id, file);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const playheadPct =
    playheadTime !== null && isActive
      ? Math.max(0, Math.min(100, (playheadTime / duration) * 100))
      : null;

  return (
    <article
      onClick={() => onSelect(clip.id)}
      className={`rounded-xl border transition-colors p-4 ${
        isActive
          ? 'border-amber-500/60 bg-[#171B24]'
          : clip.included
          ? 'border-white/10 bg-[#13161D] hover:border-white/20'
          : 'border-white/5 bg-[#101218] opacity-60'
      }`}
    >
      {/* Row Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3.5 min-w-0">
          <span className="font-mono text-xs font-semibold text-slate-400 tabular-nums pt-1 w-6 shrink-0">
            {String(index + 1).padStart(2, '0')}.
          </span>

          <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#0B0D11]">
            {clip.sourceType !== 'upload' && clip.thumbnailUrl && !imgError ? (
              <img
                src={clip.thumbnailUrl}
                alt={`Thumbnail for ${clip.title}`}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                <Music2 className={`h-5 w-5 ${clip.sourceType === 'upload' ? 'text-amber-400' : 'text-slate-500'}`} />
              </div>
            )}
          </div>

          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-slate-100 truncate">
              {clip.title}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
              <span className="truncate max-w-[200px]">{clip.channel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">Source {formatTimecode(duration)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-amber-400">
                Trimmed {formatTimecode(segmentDur, true)}
              </span>
              {clip.sourceType !== 'upload' && clip.uploadFilename && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <Check className="h-3 w-3" />
                    Audio attached ({clip.uploadFilename})
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-1.5 shrink-0 self-end sm:self-center"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onAudition(clip.id)}
            title="Play trimmed segment"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-amber-500 hover:text-slate-950 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="h-3 w-3 fill-current" />
            Audition
          </button>

          <button
            type="button"
            onClick={() => onDuplicate(clip.id)}
            title="Add another segment from this same video"
            aria-label="Duplicate segment"
            className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-colors cursor-pointer"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onMove(clip.id, 'up')}
            disabled={index === 0}
            title="Move up in mix"
            aria-label="Move clip up"
            className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onMove(clip.id, 'down')}
            disabled={index === totalCount - 1}
            title="Move down in mix"
            aria-label="Move clip down"
            className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onToggleIncluded(clip.id)}
            title={clip.included ? 'Exclude from final mix' : 'Include in final mix'}
            aria-label={clip.included ? 'Exclude clip' : 'Include clip'}
            className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-colors cursor-pointer"
          >
            {clip.included ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => onRemove(clip.id)}
            title="Remove clip"
            aria-label="Remove clip"
            className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Interactive Dual-Handle Waveform Range Trimmer */}
      <div className="mt-4" onClick={(e) => e.stopPropagation()}>
        <div
          ref={trackRef}
          className="relative h-14 w-full select-none rounded-lg border border-white/10 bg-[#0B0D11] px-1 overflow-hidden touch-none"
        >
          {/* Waveform Bars */}
          <div className="flex h-full w-full items-center justify-between gap-[2px] px-0.5 pointer-events-none">
            {clip.waveformPeaks.map((peak, idx) => {
              const barPct = ((idx + 0.5) / clip.waveformPeaks.length) * 100;
              const inside = barPct >= startPct && barPct <= endPct;
              return (
                <div
                  key={idx}
                  style={{ height: `${Math.round(peak * 78)}%` }}
                  className={`flex-1 rounded-xs transition-colors ${
                    inside ? 'bg-amber-400/85' : 'bg-slate-700/60'
                  }`}
                />
              );
            })}
          </div>

          {/* Dimmed Outside Masks */}
          <div
            style={{ width: `${startPct}%` }}
            className="pointer-events-none absolute inset-y-0 left-0 bg-[#0B0D11]/65"
          />
          <div
            style={{ width: `${100 - endPct}%` }}
            className="pointer-events-none absolute inset-y-0 right-0 bg-[#0B0D11]/65"
          />

          {/* Active Selected Window Border */}
          <div
            style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
            className="pointer-events-none absolute inset-y-0 border-y-2 border-amber-500/80 bg-amber-500/10"
          />

          {/* Live Playhead */}
          {playheadPct !== null && (
            <div
              style={{ left: `${playheadPct}%` }}
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
            />
          )}

          {/* Start Handle */}
          <button
            type="button"
            aria-label="Drag trim start handle"
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(clip.id);
              setDragging('start');
            }}
            style={{ left: `calc(${startPct}% - 6px)` }}
            className="absolute inset-y-0 w-3 cursor-ew-resize bg-amber-500 hover:bg-amber-400 flex items-center justify-center shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <span className="h-5 w-0.5 rounded-full bg-slate-950" />
          </button>

          {/* End Handle */}
          <button
            type="button"
            aria-label="Drag trim end handle"
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(clip.id);
              setDragging('end');
            }}
            style={{ left: `calc(${endPct}% - 6px)` }}
            className="absolute inset-y-0 w-3 cursor-ew-resize bg-amber-500 hover:bg-amber-400 flex items-center justify-center shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <span className="h-5 w-0.5 rounded-full bg-slate-950" />
          </button>
        </div>

        {/* Numeric Trim Controls */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`start-${clip.id}`} className="text-xs text-slate-400">
                Start
              </label>
              <button
                type="button"
                onClick={() => nudgeStart(-1)}
                className="rounded border border-white/10 px-1.5 py-1 font-mono text-[11px] text-slate-300 hover:bg-white/10 cursor-pointer"
              >
                -1s
              </button>
              <input
                id={`start-${clip.id}`}
                type="text"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                onBlur={commitStartInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitStartInput();
                }}
                className="w-24 rounded-md border border-white/10 bg-[#0B0D11] px-2 py-1 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => nudgeStart(1)}
                className="rounded border border-white/10 px-1.5 py-1 font-mono text-[11px] text-slate-300 hover:bg-white/10 cursor-pointer"
              >
                +1s
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor={`end-${clip.id}`} className="text-xs text-slate-400">
                End
              </label>
              <button
                type="button"
                onClick={() => nudgeEnd(-1)}
                className="rounded border border-white/10 px-1.5 py-1 font-mono text-[11px] text-slate-300 hover:bg-white/10 cursor-pointer"
              >
                -1s
              </button>
              <input
                id={`end-${clip.id}`}
                type="text"
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
                onBlur={commitEndInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEndInput();
                }}
                className="w-24 rounded-md border border-white/10 bg-[#0B0D11] px-2 py-1 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => nudgeEnd(1)}
                className="rounded border border-white/10 px-1.5 py-1 font-mono text-[11px] text-slate-300 hover:bg-white/10 cursor-pointer"
              >
                +1s
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                hasBotError
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                  : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <Upload className="h-3 w-3" />
              {uploading ? 'Uploading...' : clip.uploadFilename ? 'Replace Audio' : 'Attach Audio File'}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
