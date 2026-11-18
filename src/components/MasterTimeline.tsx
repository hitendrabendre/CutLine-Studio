import type { ClipItem } from '../types';
import { formatTimecode } from '../utils/time';

interface MasterTimelineProps {
  includedClips: ClipItem[];
  activeClipId: string | null;
  crossfadeSec: number;
  onSelectAndAudition: (clipId: string) => void;
}

const SEGMENT_TONES = [
  'bg-amber-500/25 border-amber-500/60 text-amber-200',
  'bg-sky-500/20 border-sky-500/50 text-sky-200',
  'bg-emerald-500/20 border-emerald-500/50 text-emerald-200',
  'bg-orange-500/25 border-orange-500/55 text-orange-200',
  'bg-indigo-500/20 border-indigo-500/50 text-indigo-200',
];

export function MasterTimeline({
  includedClips,
  activeClipId,
  crossfadeSec,
  onSelectAndAudition,
}: MasterTimelineProps) {
  const rawTotal = includedClips.reduce(
    (sum, c) => sum + Math.max(0.2, c.endTime - c.startTime),
    0
  );
  const overlapSaved =
    includedClips.length > 1 && crossfadeSec > 0
      ? (includedClips.length - 1) * crossfadeSec
      : 0;
  const combinedTotal = Math.max(0, rawTotal - overlapSaved);

  return (
    <section
      id="timeline"
      className="rounded-xl border border-white/10 bg-[#13161D] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Combined Stitch Sequence
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {includedClips.length === 0
              ? 'Include at least one trimmed clip to assemble your combined MP3.'
              : `${includedClips.length} ${
                  includedClips.length === 1 ? 'segment' : 'segments'
                } stitched in order${
                  crossfadeSec > 0 && includedClips.length > 1
                    ? ` · ${crossfadeSec}s crossfade between cuts`
                    : ' · gapless splice'
                }`}
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span>
            Final Length:{' '}
            <strong className="font-mono text-slate-100 tabular-nums">
              {formatTimecode(combinedTotal, true)}
            </strong>
          </span>
        </div>
      </div>

      {includedClips.length > 0 ? (
        <div className="mt-4">
          <div className="flex h-12 w-full items-stretch gap-1 overflow-x-auto rounded-lg border border-white/10 bg-[#0B0D11] p-1">
            {includedClips.map((clip, idx) => {
              const segDur = Math.max(0.2, clip.endTime - clip.startTime);
              const pct = rawTotal > 0 ? Math.max(6, (segDur / rawTotal) * 100) : 100;
              const tone = SEGMENT_TONES[idx % SEGMENT_TONES.length];
              const isSelected = clip.id === activeClipId;

              return (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => onSelectAndAudition(clip.id)}
                  style={{ width: `${pct}%` }}
                  title={`${clip.title} (${formatTimecode(segDur, true)})`}
                  className={`group relative flex min-w-[72px] flex-col justify-center rounded-md border px-2.5 py-1 text-left transition-colors cursor-pointer overflow-hidden ${tone} ${
                    isSelected ? 'ring-1 ring-white/70' : 'hover:brightness-110'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="font-mono text-[11px] font-semibold tabular-nums shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums opacity-85 shrink-0">
                      {formatTimecode(segDur)}
                    </span>
                  </div>
                  <span className="truncate text-[11px] font-medium opacity-90">
                    {clip.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex h-12 items-center justify-center rounded-lg border border-dashed border-white/10 bg-[#0B0D11] text-xs text-slate-500">
          Your combined timeline preview will appear here once clips are queued.
        </div>
      )}
    </section>
  );
}
