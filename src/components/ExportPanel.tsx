import { useState } from 'react';
import { Download, Loader2, AlertTriangle, CheckCircle2, KeyRound, Music } from 'lucide-react';
import type { ExportOptions, RenderJob } from '../types';
import { formatBytes, formatTimecode } from '../utils/time';

interface ExportPanelProps {
  options: ExportOptions;
  onChangeOptions: (next: ExportOptions) => void;
  activeJob: RenderJob | null;
  history: RenderJob[];
  canExport: boolean;
  isRendering: boolean;
  onStartCombine: () => void;
  onOpenCookiesModal: () => void;
}

export function ExportPanel({
  options,
  onChangeOptions,
  activeJob,
  history,
  canExport,
  isRendering,
  onStartCombine,
  onOpenCookiesModal,
}: ExportPanelProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownloadMp3 = async (jobId: string, filename: string) => {
    setDownloadError(null);
    setDownloadingId(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/download`, { cache: 'no-store' });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || `Download failed (HTTP ${res.status}). Re-render the track and try again.`);
      }

      const buf = await res.arrayBuffer();
      if (buf.byteLength < 128) {
        throw new Error('Downloaded MP3 payload was empty. Please re-render the mix.');
      }

      // Verify ID3 header ("ID3") or MPEG audio frame sync (0xFF 0xE0..0xFF)
      const bytes = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
      const isId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
      const isMpegSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
      if (!isId3 && !isMpegSync) {
        throw new Error('Server returned an unexpected non-MP3 response. Please re-render the track.');
      }

      const blob = new Blob([buf], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.endsWith('.mp3') ? filename : `${filename}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  };
  return (
    <section
      id="export"
      className="rounded-xl border border-white/10 bg-[#13161D] p-4 space-y-5"
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-100">
            MP3 Mixdown & Export
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Configure encoding quality, transitions, and download your combined track.
          </p>
        </div>
      </div>

      {/* Output Settings */}
      <div className="space-y-4">
        <div>
          <label htmlFor="output-name" className="block text-xs font-medium text-slate-300 mb-1.5">
            Output Filename
          </label>
          <div className="flex items-center rounded-lg border border-white/10 bg-[#0B0D11] focus-within:border-amber-500">
            <input
              id="output-name"
              type="text"
              value={options.outputName}
              onChange={(e) => onChangeOptions({ ...options, outputName: e.target.value })}
              placeholder="cutline-combined-mix"
              className="w-full bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
            />
            <span className="pr-3 font-mono text-xs text-slate-400 shrink-0">.mp3</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <span className="block text-xs font-medium text-slate-300 mb-1.5">MP3 Bitrate</span>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#0B0D11] p-1 border border-white/10">
              {([128, 192, 320] as const).map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => onChangeOptions({ ...options, bitrate: rate })}
                  className={`rounded-md py-1.5 font-mono text-xs font-medium transition-colors cursor-pointer ${
                    options.bitrate === rate
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {rate}k
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-300 mb-1.5">Crossfade</span>
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-[#0B0D11] p-1 border border-white/10">
              {[0, 0.5, 1, 2].map((cf) => (
                <button
                  key={cf}
                  type="button"
                  onClick={() => onChangeOptions({ ...options, crossfadeSec: cf })}
                  className={`rounded-md py-1.5 font-mono text-xs font-medium transition-colors cursor-pointer ${
                    options.crossfadeSec === cf
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cf === 0 ? 'Off' : `${cf}s`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0B0D11] px-3 py-2.5 cursor-pointer">
          <div>
            <span className="block text-xs font-medium text-slate-200">
              Loudness Normalization (-14 LUFS)
            </span>
            <span className="block text-[11px] text-slate-400">
              Evens out volume differences between separate YouTube videos
            </span>
          </div>
          <input
            type="checkbox"
            checked={options.normalize}
            onChange={(e) => onChangeOptions({ ...options, normalize: e.target.checked })}
            className="h-4 w-4 accent-amber-500 rounded cursor-pointer"
          />
        </label>

        <button
          type="button"
          onClick={onStartCombine}
          disabled={!canExport || isRendering}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {isRendering ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Combining & Encoding MP3...
            </>
          ) : (
            <>
              <Music className="h-4 w-4" />
              Combine Trimmed Clips to MP3
            </>
          )}
        </button>
      </div>

      {/* Active Job Status */}
      {activeJob && (
        <div className="border-t border-white/10 pt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-200 truncate">
              {activeJob.stageLabel}
            </span>
            <span className="font-mono text-xs text-amber-400 tabular-nums shrink-0">
              {activeJob.progress}%
            </span>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#0B0D11]">
            <div
              style={{ width: `${activeJob.progress}%` }}
              className={`h-full transition-all duration-300 ${
                activeJob.status === 'error'
                  ? 'bg-red-500'
                  : activeJob.status === 'ready'
                  ? 'bg-emerald-500'
                  : 'bg-amber-500'
              }`}
            />
          </div>

          {/* Per-clip breakdown */}
          <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {activeJob.clips.map((c, idx) => (
              <li
                key={`${c.clipId}-${idx}`}
                className="flex items-center justify-between gap-2 text-xs text-slate-400"
              >
                <span className="truncate">
                  {String(idx + 1).padStart(2, '0')}. {c.title}
                </span>
                <span
                  className={`font-mono text-[11px] shrink-0 ${
                    c.status === 'done'
                      ? 'text-emerald-400'
                      : c.status === 'error'
                      ? 'text-red-400'
                      : c.status === 'downloading' || c.status === 'trimming'
                      ? 'text-amber-400'
                      : 'text-slate-500'
                  }`}
                >
                  {c.status === 'pending' && 'Queued'}
                  {c.status === 'downloading' && 'Fetching'}
                  {c.status === 'trimming' && 'Trimming'}
                  {c.status === 'done' && 'Done'}
                  {c.status === 'error' && 'Failed'}
                </span>
              </li>
            ))}
          </ul>

          {/* Error Recovery */}
          {activeJob.status === 'error' && (
            <div className="rounded-lg border border-red-500/30 bg-red-950/30 p-3 space-y-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs text-red-200 space-y-1">
                  <p className="font-semibold">
                    {activeJob.errorCode === 'youtube_bot_check'
                      ? 'YouTube Anti-Bot Verification Triggered'
                      : 'Render Pipeline Error'}
                  </p>
                  <p className="text-red-300/90 leading-relaxed">{activeJob.error}</p>
                </div>
              </div>

              {activeJob.errorCode === 'youtube_bot_check' && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onOpenCookiesModal}
                    className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Paste YouTube Cookies & Retry
                  </button>
                  <span className="text-[11px] text-slate-400">
                    or attach a local audio file directly on the highlighted clip.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Ready Audio Player & Download */}
          {activeJob.status === 'ready' && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-emerald-200 truncate">
                    {activeJob.outputFilename}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-emerald-300/80 tabular-nums shrink-0">
                  {activeJob.durationSeconds ? formatTimecode(activeJob.durationSeconds, true) : ''}
                  {activeJob.fileSizeBytes ? ` · ${formatBytes(activeJob.fileSizeBytes)}` : ''}
                </span>
              </div>

              <audio
                controls
                src={`/api/jobs/${activeJob.id}/stream`}
                className="w-full h-9"
              />

              <button
                type="button"
                onClick={() => void handleDownloadMp3(activeJob.id, activeJob.outputFilename)}
                disabled={downloadingId === activeJob.id}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {downloadingId === activeJob.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {downloadingId === activeJob.id
                  ? 'Preparing MP3...'
                  : `Download MP3 (${activeJob.fileSizeBytes ? formatBytes(activeJob.fileSizeBytes) : 'MP3'})`}
              </button>

              {downloadError && (
                <p className="text-xs text-red-400" role="alert">
                  {downloadError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recent Export History */}
      {history.length > 0 && (
        <div className="border-t border-white/10 pt-4 space-y-2">
          <h3 className="text-xs font-semibold text-slate-300">Session Exports</h3>
          <ul className="space-y-2">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0B0D11] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-200 truncate">
                    {item.outputFilename}
                  </p>
                  <p className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {item.durationSeconds ? formatTimecode(item.durationSeconds) : '00:00'}
                    {' · '}
                    {item.fileSizeBytes ? formatBytes(item.fileSizeBytes) : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDownloadMp3(item.id, item.outputFilename)}
                  disabled={downloadingId === item.id}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50 transition-colors shrink-0 cursor-pointer"
                >
                  {downloadingId === item.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  MP3
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
