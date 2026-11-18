import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, SkipForward, Scissors, Volume2, Music2 } from 'lucide-react';
import type { ClipItem } from '../types';
import { formatTimecode } from '../utils/time';

interface YTPlayer {
  loadVideoById: (opts: { videoId: string; startSeconds?: number }) => void;
  cueVideoById: (opts: { videoId: string; startSeconds?: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId?: string;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: () => void;
            onStateChange?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YouTubePreviewPlayerProps {
  activeClip: ClipItem | null;
  includedClips: ClipItem[];
  playRequestToken: number;
  auditionMode: 'single' | 'sequence';
  onAuditionModeChange: (mode: 'single' | 'sequence') => void;
  onSelectClip: (clipId: string) => void;
  onPlayheadUpdate: (clipId: string, time: number) => void;
  onMarkIn: (clipId: string, time: number) => void;
  onMarkOut: (clipId: string, time: number) => void;
}

function isLocalAudioClip(clip: ClipItem | null): boolean {
  return Boolean(clip && (clip.sourceType === 'upload' || (clip.uploadId && clip.videoId === 'local-upload')));
}

export function YouTubePreviewPlayer({
  activeClip,
  includedClips,
  playRequestToken,
  auditionMode,
  onAuditionModeChange,
  onSelectClip,
  onPlayheadUpdate,
  onMarkIn,
  onMarkOut,
}: YouTubePreviewPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [playerReady, setPlayerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const loadedVideoRef = useRef<string | null>(null);
  const pendingAudioPlayRef = useRef<number | null>(null);

  const activeClipRef = useRef(activeClip);
  activeClipRef.current = activeClip;

  const includedClipsRef = useRef(includedClips);
  includedClipsRef.current = includedClips;

  const auditionModeRef = useRef(auditionMode);
  auditionModeRef.current = auditionMode;

  const isLocal = isLocalAudioClip(activeClip);

  useEffect(() => {
    let cancelled = false;

    const initPlayer = () => {
      if (cancelled || !containerRef.current || !window.YT?.Player || playerRef.current) return;
      const mountNode = document.createElement('div');
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(mountNode);

      const initialYt =
        activeClipRef.current && !isLocalAudioClip(activeClipRef.current)
          ? activeClipRef.current.videoId
          : '';

      playerRef.current = new window.YT.Player(mountNode, {
        videoId: initialYt,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            setPlayerReady(true);
            if (activeClipRef.current && !isLocalAudioClip(activeClipRef.current)) {
              loadedVideoRef.current = activeClipRef.current.videoId;
              playerRef.current?.cueVideoById({
                videoId: activeClipRef.current.videoId,
                startSeconds: activeClipRef.current.startTime,
              });
            }
          },
          onStateChange: (ev) => {
            if (cancelled || isLocalAudioClip(activeClipRef.current)) return;
            setIsPlaying(ev.data === 1);
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
    } else {
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existingScript) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prevCallback?.();
        initPlayer();
      };
    }

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  // Switch cleanly between YouTube & Local MP3 clips
  useEffect(() => {
    if (!activeClip) {
      audioRef.current?.pause();
      if (playerReady && playerRef.current) playerRef.current.pauseVideo();
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }

    if (isLocalAudioClip(activeClip)) {
      if (playerReady && playerRef.current) {
        playerRef.current.pauseVideo();
      }
      setCurrentTime(activeClip.startTime);
      setIsPlaying(false);
      if (audioRef.current) {
        const src = `/api/uploads/${activeClip.uploadId}/stream`;
        if (!audioRef.current.src.endsWith(src)) {
          pendingAudioPlayRef.current = playRequestToken > 0 ? activeClip.startTime : null;
          audioRef.current.src = src;
          audioRef.current.load();
        }
      }
    } else {
      audioRef.current?.pause();
      if (playerReady && playerRef.current && loadedVideoRef.current !== activeClip.videoId) {
        loadedVideoRef.current = activeClip.videoId;
        if (playRequestToken > 0) {
          playerRef.current.loadVideoById({
            videoId: activeClip.videoId,
            startSeconds: activeClip.startTime,
          });
        } else {
          playerRef.current.cueVideoById({
            videoId: activeClip.videoId,
            startSeconds: activeClip.startTime,
          });
        }
        setCurrentTime(activeClip.startTime);
      }
    }
  }, [activeClip?.id, activeClip?.videoId, activeClip?.uploadId, playerReady]);

  // Handle explicit audition request
  useEffect(() => {
    if (playRequestToken === 0 || !activeClip) return;
    if (isLocalAudioClip(activeClip)) {
      playerRef.current?.pauseVideo();
      const el = audioRef.current;
      if (!el) return;
      const src = `/api/uploads/${activeClip.uploadId}/stream`;
      if (!el.src.endsWith(src)) {
        pendingAudioPlayRef.current = activeClip.startTime;
        el.src = src;
        el.load();
      } else {
        el.currentTime = activeClip.startTime;
        void el.play().catch(() => {});
      }
      setCurrentTime(activeClip.startTime);
      return;
    }

    audioRef.current?.pause();
    if (!playerReady || !playerRef.current) return;
    if (loadedVideoRef.current !== activeClip.videoId) {
      loadedVideoRef.current = activeClip.videoId;
      playerRef.current.loadVideoById({
        videoId: activeClip.videoId,
        startSeconds: activeClip.startTime,
      });
    } else {
      playerRef.current.seekTo(activeClip.startTime, true);
      playerRef.current.playVideo();
    }
    setCurrentTime(activeClip.startTime);
  }, [playRequestToken]);

  // Unified playhead polling + segment end & sequential mix advance
  useEffect(() => {
    const advanceOrStop = (clip: ClipItem) => {
      if (auditionModeRef.current === 'sequence') {
        const list = includedClipsRef.current;
        const idx = list.findIndex((c) => c.id === clip.id);
        if (idx >= 0 && idx + 1 < list.length) {
          const next = list[idx + 1];
          onSelectClip(next.id);
          if (isLocalAudioClip(next)) {
            playerRef.current?.pauseVideo();
            if (audioRef.current) {
              pendingAudioPlayRef.current = next.startTime;
              audioRef.current.src = `/api/uploads/${next.uploadId}/stream`;
              audioRef.current.load();
            }
          } else {
            audioRef.current?.pause();
            if (playerRef.current) {
              loadedVideoRef.current = next.videoId;
              playerRef.current.loadVideoById({
                videoId: next.videoId,
                startSeconds: next.startTime,
              });
            }
          }
          return true;
        }
      }
      return false;
    };

    const interval = window.setInterval(() => {
      const clip = activeClipRef.current;
      if (!clip) return;

      if (isLocalAudioClip(clip)) {
        const el = audioRef.current;
        if (!el) return;
        const t = el.currentTime;
        if (Number.isFinite(t)) {
          setCurrentTime(t);
          onPlayheadUpdate(clip.id, t);
        }
        if (!el.paused && Number.isFinite(t) && t >= clip.endTime - 0.08) {
          if (!advanceOrStop(clip)) {
            el.pause();
            el.currentTime = clip.startTime;
            setIsPlaying(false);
          }
        }
        return;
      }

      const player = playerRef.current;
      if (!playerReady || !player || typeof player.getCurrentTime !== 'function') return;
      const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
      const t = player.getCurrentTime();
      if (Number.isFinite(t)) {
        setCurrentTime(t);
        onPlayheadUpdate(clip.id, t);
      }
      if (state === 1 && Number.isFinite(t) && t >= clip.endTime - 0.08) {
        if (!advanceOrStop(clip)) {
          player.pauseVideo();
          player.seekTo(clip.startTime, true);
          setIsPlaying(false);
        }
      }
    }, 150);

    return () => window.clearInterval(interval);
  }, [playerReady]);

  const handlePlaySegment = () => {
    if (!activeClip) return;
    onAuditionModeChange('single');
    if (isLocal) {
      const el = audioRef.current;
      if (!el) return;
      if (el.currentTime < activeClip.startTime || el.currentTime >= activeClip.endTime - 0.2) {
        el.currentTime = activeClip.startTime;
      }
      void el.play().catch(() => {});
      return;
    }
    if (!playerRef.current || !playerReady) return;
    if (loadedVideoRef.current !== activeClip.videoId) {
      loadedVideoRef.current = activeClip.videoId;
      playerRef.current.loadVideoById({
        videoId: activeClip.videoId,
        startSeconds: activeClip.startTime,
      });
    } else {
      const t = playerRef.current.getCurrentTime();
      if (t < activeClip.startTime || t >= activeClip.endTime - 0.2) {
        playerRef.current.seekTo(activeClip.startTime, true);
      }
      playerRef.current.playVideo();
    }
  };

  const handlePlaySequence = () => {
    if (includedClips.length === 0) return;
    onAuditionModeChange('sequence');
    const first = includedClips[0];
    onSelectClip(first.id);
    if (isLocalAudioClip(first)) {
      playerRef.current?.pauseVideo();
      const el = audioRef.current;
      if (!el) return;
      const src = `/api/uploads/${first.uploadId}/stream`;
      if (!el.src.endsWith(src)) {
        pendingAudioPlayRef.current = first.startTime;
        el.src = src;
        el.load();
      } else {
        el.currentTime = first.startTime;
        void el.play().catch(() => {});
      }
    } else if (playerRef.current && playerReady) {
      audioRef.current?.pause();
      loadedVideoRef.current = first.videoId;
      playerRef.current.loadVideoById({
        videoId: first.videoId,
        startSeconds: first.startTime,
      });
    }
  };

  const handlePause = () => {
    if (isLocal) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      playerRef.current?.pauseVideo();
    }
  };

  const handleStop = () => {
    if (!activeClip) return;
    if (isLocal && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = activeClip.startTime;
      setIsPlaying(false);
      setCurrentTime(activeClip.startTime);
      return;
    }
    if (!playerRef.current) return;
    playerRef.current.pauseVideo();
    playerRef.current.seekTo(activeClip.startTime, true);
    setCurrentTime(activeClip.startTime);
  };

  const controlsReady = Boolean(activeClip && (isLocal || playerReady));

  return (
    <section className="rounded-xl border border-white/10 bg-[#13161D] overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-slate-100 truncate">
            {activeClip ? activeClip.title : 'Preview Monitor'}
          </h2>
          {activeClip ? (
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400 truncate">
              <span className="truncate">{activeClip.channel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums shrink-0">
                Slice {formatTimecode(activeClip.startTime, true)} → {formatTimecode(activeClip.endTime, true)}
              </span>
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-slate-400">
              Add a YouTube link or upload MP3 files to preview and trim
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-xs text-amber-400 tabular-nums">
            {formatTimecode(currentTime, true)}
          </span>
        </div>
      </div>

      <div className="relative aspect-video w-full bg-[#07090C]">
        {/* Keep YouTube container mounted cleanly */}
        <div
          ref={containerRef}
          className={`h-full w-full ${isLocal || !activeClip ? 'hidden' : 'block'}`}
        />

        {/* Local MP3 Audio Deck Overlay */}
        {activeClip && isLocal && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 bg-[#090B10]">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10">
              <Music2 className="h-6 w-6 text-amber-400" />
            </div>
            <div className="text-center max-w-sm">
              <p className="font-display text-sm font-semibold text-slate-100 truncate">
                {activeClip.title}
              </p>
              <p className="mt-0.5 font-mono text-xs text-slate-400 tabular-nums">
                {formatTimecode(currentTime, true)} / {formatTimecode(activeClip.durationSeconds)}
              </p>
            </div>
            <audio
              ref={audioRef}
              controls
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                if (pendingAudioPlayRef.current !== null) {
                  el.currentTime = pendingAudioPlayRef.current;
                  pendingAudioPlayRef.current = null;
                  void el.play().catch(() => {});
                } else if (activeClipRef.current) {
                  el.currentTime = activeClipRef.current.startTime;
                }
              }}
              className="w-full max-w-sm h-9"
            />
          </div>
        )}

        {/* Hidden audio tag kept ready if switching from YouTube -> Local in sequence */}
        {(!activeClip || !isLocal) && (
          <audio
            ref={audioRef}
            className="hidden"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (pendingAudioPlayRef.current !== null) {
                el.currentTime = pendingAudioPlayRef.current;
                pendingAudioPlayRef.current = null;
                void el.play().catch(() => {});
              }
            }}
          />
        )}

        {!activeClip && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <Volume2 className="h-8 w-8 text-slate-600" />
            <p className="text-sm font-medium text-slate-400">No active clip selected</p>
            <p className="text-xs text-slate-500 max-w-xs">
              Paste YouTube links or upload MP3 files from your PC or mobile device to audition and trim exact In/Out points.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 bg-[#101319]">
        <div className="flex items-center gap-2">
          {isPlaying ? (
            <button
              type="button"
              onClick={handlePause}
              disabled={!controlsReady}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-white/15 transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Pause className="h-3.5 w-3.5" />
              Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePlaySegment}
              disabled={!controlsReady}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Play Segment
            </button>
          )}

          <button
            type="button"
            onClick={handleStop}
            disabled={!controlsReady}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Square className="h-3 w-3" />
            Reset
          </button>

          <button
            type="button"
            onClick={handlePlaySequence}
            disabled={includedClips.length === 0}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0 ${
              auditionMode === 'sequence' && isPlaying
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-white/10 text-slate-300 hover:bg-white/5'
            }`}
          >
            <SkipForward className="h-3.5 w-3.5" />
            Audition Full Mix
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => activeClip && onMarkIn(activeClip.id, currentTime)}
            disabled={!controlsReady}
            title="Set segment start to current playhead"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Scissors className="h-3.5 w-3.5 text-amber-400" />
            Set In
          </button>
          <button
            type="button"
            onClick={() => activeClip && onMarkOut(activeClip.id, currentTime)}
            disabled={!controlsReady}
            title="Set segment end to current playhead"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Scissors className="h-3.5 w-3.5 text-amber-400" />
            Set Out
          </button>
        </div>
      </div>
    </section>
  );
}
