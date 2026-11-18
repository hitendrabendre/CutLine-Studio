export function formatTimecode(seconds: number, withDecimals = false): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe - Math.floor(safe)) * 10);

  const pad = (n: number) => String(n).padStart(2, '0');
  const base = hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  return withDecimals ? `${base}.${tenths}` : base;
}

export function parseTimecode(input: string): number | null {
  const cleaned = input.trim();
  if (!cleaned) return null;

  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    const val = parseFloat(cleaned);
    return Number.isFinite(val) && val >= 0 ? val : null;
  }

  const parts = cleaned.split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;

  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

  if (parts.length === 2) {
    const [m, s] = nums;
    if (s >= 60) return null;
    return m * 60 + s;
  }

  const [h, m, s] = nums;
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

export function extractYoutubeUrls(rawText: string): string[] {
  const tokens = rawText
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const valid: string[] = [];
  for (const token of tokens) {
    if (parseYoutubeId(token)) {
      valid.push(token);
    }
  }
  return valid;
}

export function parseYoutubeId(input: string): { videoId: string; startHint?: number } | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return { videoId: trimmed };
  }
  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();

    let startHint: number | undefined;
    const tParam = u.searchParams.get('t') || u.searchParams.get('start');
    if (tParam) {
      const m = tParam.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
      if (m && (m[1] || m[2] || m[3])) {
        startHint = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
      } else if (/^\d+$/.test(tParam)) {
        startHint = Number(tParam);
      }
    }

    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return { videoId: id, startHint };
    }

    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return { videoId: v, startHint };
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(parts[0])) {
        const id = parts[1];
        if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return { videoId: id, startHint };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function generateWaveformPeaks(seedStr: string, barCount = 72): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const peaks: number[] = [];
  for (let i = 0; i < barCount; i++) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    const norm = ((hash >>> 0) % 1000) / 1000;
    const envelope = Math.sin((i / barCount) * Math.PI) * 0.25 + 0.75;
    peaks.push(Math.max(0.18, Math.min(1, (0.25 + norm * 0.75) * envelope)));
  }
  return peaks;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function extractAudioWaveformPeaks(file: File, barCount = 72): Promise<number[]> {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx || file.size > 40 * 1024 * 1024) {
      return generateWaveformPeaks(`${file.name}-${file.size}`, barCount);
    }
    const ctx = new AudioCtx();
    try {
      const buf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buf);
      const data = decoded.getChannelData(0);
      const step = Math.max(1, Math.floor(data.length / barCount));
      const rawPeaks: number[] = [];
      let maxVal = 0.01;
      for (let i = 0; i < barCount; i++) {
        const start = i * step;
        let peak = 0;
        const sampleStride = Math.max(1, Math.floor(step / 64));
        for (let j = 0; j < step && start + j < data.length; j += sampleStride) {
          const v = Math.abs(data[start + j]);
          if (v > peak) peak = v;
        }
        rawPeaks.push(peak);
        if (peak > maxVal) maxVal = peak;
      }
      return rawPeaks.map((p) => Math.max(0.16, Math.min(1, p / maxVal)));
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch {
    return generateWaveformPeaks(`${file.name}-${file.size}`, barCount);
  }
}
