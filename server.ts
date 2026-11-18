import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Innertube, UniversalCache } from 'youtubei.js';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const TEMP_ROOT = path.join(os.tmpdir(), 'cutline-studio');
const JOBS_DIR = path.join(TEMP_ROOT, 'jobs');
const CACHE_DIR = path.join(TEMP_ROOT, 'cache');
const UPLOADS_DIR = path.join(TEMP_ROOT, 'uploads');
const COOKIES_FILE = path.join(TEMP_ROOT, 'cookies.txt');
const YTDLP_LOCAL_BIN = path.join(TEMP_ROOT, 'yt-dlp');

for (const dir of [TEMP_ROOT, JOBS_DIR, CACHE_DIR, UPLOADS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

if (process.env.YOUTUBE_COOKIES && !fs.existsSync(COOKIES_FILE)) {
  fs.writeFileSync(COOKIES_FILE, process.env.YOUTUBE_COOKIES, 'utf8');
}

interface VideoMeta {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  durationSeconds: number;
  thumbnailUrl: string;
}

interface CombineClipInput {
  id: string;
  videoId: string;
  url: string;
  title: string;
  startTime: number;
  endTime: number;
  uploadId?: string;
}

interface CombineOptions {
  bitrate: 128 | 192 | 320;
  crossfadeSec: number;
  normalize: boolean;
  outputName: string;
}

interface ClipJobProgress {
  clipId: string;
  title: string;
  status: 'pending' | 'downloading' | 'trimming' | 'done' | 'error';
  message?: string;
}

interface RenderJob {
  id: string;
  status: 'queued' | 'processing' | 'combining' | 'ready' | 'error';
  progress: number;
  stageLabel: string;
  error?: string;
  errorCode?: 'youtube_bot_check' | 'ffmpeg_error' | 'invalid_input' | 'unknown';
  failedClipId?: string;
  clips: ClipJobProgress[];
  outputPath?: string;
  outputFilename: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  createdAt: number;
}

const metadataCache = new Map<string, VideoMeta>();
const jobs = new Map<string, RenderJob>();
const uploadedFiles = new Map<string, { path: string; originalName: string; size: number }>();

function persistJob(job: RenderJob): void {
  try {
    const dir = path.join(JOBS_DIR, job.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job), 'utf8');
  } catch {
    // ignore disk metadata write failure
  }
}

function getJob(jobId: string): RenderJob | undefined {
  if (!/^[a-zA-Z0-9-]+$/.test(jobId)) return undefined;
  const mem = jobs.get(jobId);
  if (mem) return mem;
  try {
    const metaPath = path.join(JOBS_DIR, jobId, 'job.json');
    if (fs.existsSync(metaPath)) {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as RenderJob;
      jobs.set(jobId, parsed);
      return parsed;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function findUploadedFile(uploadId: string): string | null {
  if (!/^[a-zA-Z0-9-]+$/.test(uploadId)) return null;
  const cached = uploadedFiles.get(uploadId);
  if (cached && fs.existsSync(cached.path)) return cached.path;
  try {
    const match = fs.readdirSync(UPLOADS_DIR).find((f) => f.startsWith(`${uploadId}.`));
    if (match) {
      const fullPath = path.join(UPLOADS_DIR, match);
      uploadedFiles.set(uploadId, { path: fullPath, originalName: match, size: fs.statSync(fullPath).size });
      return fullPath;
    }
  } catch {
    // ignore
  }
  return null;
}

let innertubePromise: Promise<Innertube> | null = null;
function getInnertube(): Promise<Innertube> {
  if (!innertubePromise) {
    innertubePromise = Innertube.create({
      generate_session_locally: true,
      cache: new UniversalCache(false),
    }).catch((err) => {
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
}

function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(parts[0])) {
        const id = parts[1];
        return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function parseIsoDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!match) return 0;
  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  return Math.round(h * 3600 + m * 60 + s);
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

async function fetchYoutubeInfo(rawUrlOrId: string): Promise<VideoMeta> {
  const videoId = extractVideoId(rawUrlOrId);
  if (!videoId) {
    throw new Error(`Invalid YouTube link: ${rawUrlOrId}`);
  }

  const cached = metadataCache.get(videoId);
  if (cached) return cached;

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let title = '';
  let channel = '';
  let durationSeconds = 0;
  let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const [oembedRes, watchRes] = await Promise.allSettled([
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`, {
      signal: AbortSignal.timeout(7000),
    }).then(async (r) => (r.ok ? ((await r.json()) as { title?: string; author_name?: string; thumbnail_url?: string }) : null)),
    fetch(canonicalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    }).then(async (r) => (r.ok ? await r.text() : '')),
  ]);

  if (oembedRes.status === 'fulfilled' && oembedRes.value) {
    title = oembedRes.value.title || title;
    channel = oembedRes.value.author_name || channel;
    if (oembedRes.value.thumbnail_url) {
      thumbnailUrl = oembedRes.value.thumbnail_url;
    }
  }

  if (watchRes.status === 'fulfilled' && watchRes.value) {
    const html = watchRes.value;
    const lenMatch = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
    if (lenMatch) {
      durationSeconds = Number(lenMatch[1]);
    } else {
      const isoMatch = html.match(/itemprop="duration"\s+content="([^"]+)"/);
      if (isoMatch) {
        durationSeconds = parseIsoDuration(isoMatch[1]);
      }
    }
    if (!title) {
      const titleMatch = html.match(/<meta\s+name="title"\s+content="([^"]+)"/) || html.match(/<title>(.*?)<\/title>/);
      if (titleMatch) {
        title = decodeHtmlEntities(titleMatch[1].replace(/\s*-\s*YouTube\s*$/, '').trim());
      }
    }
    if (!channel) {
      const authorMatch = html.match(/"ownerChannelName"\s*:\s*"([^"]+)"/) || html.match(/itemprop="name"\s+content="([^"]+)"/);
      if (authorMatch) {
        channel = decodeHtmlEntities(authorMatch[1]);
      }
    }
  }

  if (!durationSeconds || !title) {
    try {
      const yt = await getInnertube();
      const search = await yt.search(videoId, { type: 'video' });
      const exact = search.videos.find((v: unknown) => {
        const item = v as { id?: string };
        return item?.id === videoId;
      }) as { title?: { text?: string }; duration?: { seconds?: number }; author?: { name?: string } } | undefined;

      if (exact) {
        if (!title && exact.title?.text) title = exact.title.text;
        if (!channel && exact.author?.name) channel = exact.author.name;
        if (!durationSeconds && exact.duration?.seconds) durationSeconds = exact.duration.seconds;
      }
    } catch {
      // Fallback already populated if possible
    }
  }

  if (!title && !durationSeconds) {
    throw new Error(`Could not resolve metadata for video ${videoId}. Verify the link is public and valid.`);
  }

  const meta: VideoMeta = {
    videoId,
    url: canonicalUrl,
    title: title || `YouTube Video (${videoId})`,
    channel: channel || 'YouTube Channel',
    durationSeconds: durationSeconds > 0 ? durationSeconds : 180,
    thumbnailUrl,
  };

  metadataCache.set(videoId, meta);
  return meta;
}

let ytDlpEnsurePromise: Promise<string> | null = null;
async function ensureYtDlpBinary(): Promise<string> {
  if (ytDlpEnsurePromise) return ytDlpEnsurePromise;

  ytDlpEnsurePromise = (async () => {
    const candidates = [
      '/usr/local/bin/yt-dlp',
      '/usr/bin/yt-dlp',
      '/tmp/yt-dlp',
      YTDLP_LOCAL_BIN,
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try {
          fs.accessSync(c, fs.constants.X_OK);
          return c;
        } catch {
          fs.chmodSync(c, 0o755);
          return c;
        }
      }
    }

    const res = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', {
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      throw new Error(`Failed to download yt-dlp binary (HTTP ${res.status})`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(YTDLP_LOCAL_BIN, buffer);
    fs.chmodSync(YTDLP_LOCAL_BIN, 0o755);
    return YTDLP_LOCAL_BIN;
  })().catch((err) => {
    ytDlpEnsurePromise = null;
    throw err;
  });

  return ytDlpEnsurePromise;
}

function findCachedAudio(videoId: string): string | null {
  const files = fs.readdirSync(CACHE_DIR);
  const match = files.find((f) => f.startsWith(`${videoId}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
  return match ? path.join(CACHE_DIR, match) : null;
}

function runCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(stderr || stdout || `${cmd} exited with code ${code}`);
        reject(err);
      }
    });
  });
}

async function downloadYoutubeAudio(videoId: string, url: string): Promise<string> {
  const cached = findCachedAudio(videoId);
  if (cached) return cached;

  const ytdlp = await ensureYtDlpBinary();
  const outputTemplate = path.join(CACHE_DIR, `${videoId}.%(ext)s`);
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--js-runtimes',
    'node',
    '-f',
    'bestaudio/best',
    '-o',
    outputTemplate,
  ];

  if (fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 0) {
    args.push('--cookies', COOKIES_FILE);
  }

  args.push(url);

  await runCommand(ytdlp, args);

  const downloaded = findCachedAudio(videoId);
  if (!downloaded) {
    throw new Error('Audio stream finished downloading but output file could not be located.');
  }
  return downloaded;
}

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const parsed = parseFloat(stdout.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9_\-\s.]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return cleaned || 'cutline-combined-mix';
}

async function processCombineJob(jobId: string, clips: CombineClipInput[], options: CombineOptions) {
  const job = jobs.get(jobId);
  if (!job) return;

  const jobDir = path.join(JOBS_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const trimmedSegments: { path: string; duration: number }[] = [];

  try {
    job.status = 'processing';
    const totalSteps = clips.length + 1;

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const clipState = job.clips[i];

      let sourcePath: string | null = null;
      if (clip.uploadId) {
        sourcePath = findUploadedFile(clip.uploadId);
        if (!sourcePath && (!clip.videoId || clip.videoId === 'local-upload')) {
          throw new Error(`Uploaded file for "${clip.title}" is no longer on the server. Please re-upload it.`);
        }
      }

      if (!sourcePath) {
        clipState.status = 'downloading';
        clipState.message = 'Fetching YouTube audio stream';
        job.stageLabel = `Fetching audio for clip ${i + 1} of ${clips.length}: ${clip.title}`;
        job.progress = Math.round(((i + 0.25) / totalSteps) * 100);

        try {
          sourcePath = await downloadYoutubeAudio(clip.videoId, clip.url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          clipState.status = 'error';
          clipState.message = msg;
          if (/sign in to confirm you.?re not a bot|cookies/i.test(msg)) {
            job.status = 'error';
            job.errorCode = 'youtube_bot_check';
            job.failedClipId = clip.id;
            job.error =
              'YouTube flagged this cloud server IP with an anti-bot verification check. Paste your YouTube cookies.txt in Studio Auth or attach a local audio file for this clip to continue.';
            job.stageLabel = 'Verification required by YouTube';
            return;
          }
          throw err;
        }
      }

      clipState.status = 'trimming';
      clipState.message = `Trimming ${clip.startTime.toFixed(1)}s → ${clip.endTime.toFixed(1)}s`;
      job.stageLabel = `Trimming clip ${i + 1} of ${clips.length}: ${clip.title}`;
      job.progress = Math.round(((i + 0.65) / totalSteps) * 100);

      const segDuration = Math.max(0.2, clip.endTime - clip.startTime);
      const segPath = path.join(jobDir, `seg_${String(i).padStart(3, '0')}.wav`);

      await runCommand('ffmpeg', [
        '-y',
        '-ss',
        clip.startTime.toFixed(3),
        '-t',
        segDuration.toFixed(3),
        '-i',
        sourcePath,
        '-vn',
        '-ar',
        '44100',
        '-ac',
        '2',
        '-c:a',
        'pcm_s16le',
        segPath,
      ]);

      const actualDur = (await getAudioDuration(segPath)) || segDuration;
      trimmedSegments.push({ path: segPath, duration: actualDur });

      clipState.status = 'done';
      clipState.message = `Trimmed (${actualDur.toFixed(1)}s)`;
      job.progress = Math.round(((i + 1) / totalSteps) * 100);
    }

    job.status = 'combining';
    job.stageLabel = 'Stitching segments & encoding MP3';
    job.progress = 92;

    const baseName = sanitizeFilename(options.outputName).replace(/\.mp3$/i, '');
    const finalFilename = `${baseName}.mp3`;
    const outputPath = path.join(jobDir, finalFilename);
    const bitrate = [128, 192, 320].includes(options.bitrate) ? options.bitrate : 192;

    const mp3EncodeFlags = [
      '-ar',
      '44100',
      '-ac',
      '2',
      '-c:a',
      'libmp3lame',
      '-b:a',
      `${bitrate}k`,
      '-minrate',
      `${bitrate}k`,
      '-maxrate',
      `${bitrate}k`,
      '-bufsize',
      `${bitrate * 2}k`,
      '-write_xing',
      '0',
      '-id3v2_version',
      '3',
      '-write_id3v1',
      '1',
      '-metadata',
      `title=${baseName}`,
      '-metadata',
      'artist=CutLine Studio',
      '-f',
      'mp3',
      outputPath,
    ];

    if (trimmedSegments.length === 1) {
      const ffArgs = ['-y', '-i', trimmedSegments[0].path];
      if (options.normalize) {
        ffArgs.push('-af', 'loudnorm=I=-14:TP=-1.5:LRA=11');
      }
      ffArgs.push(...mp3EncodeFlags);
      await runCommand('ffmpeg', ffArgs);
    } else if (options.crossfadeSec > 0) {
      const ffArgs = ['-y'];
      for (const seg of trimmedSegments) {
        ffArgs.push('-i', seg.path);
      }

      const filters: string[] = [];
      let prevLabel = '0:a';
      for (let i = 1; i < trimmedSegments.length; i++) {
        const minDur = Math.min(trimmedSegments[i - 1].duration, trimmedSegments[i].duration);
        const cf = Math.max(0.05, Math.min(options.crossfadeSec, minDur * 0.4));
        const outLabel = i === trimmedSegments.length - 1 ? (options.normalize ? 'pre_norm' : 'aout') : `cf_${i}`;
        filters.push(`[${prevLabel}][${i}:a]acrossfade=d=${cf.toFixed(3)}:c1=tri:c2=tri[${outLabel}]`);
        prevLabel = outLabel;
      }
      if (options.normalize) {
        filters.push(`[pre_norm]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
      }

      ffArgs.push('-filter_complex', filters.join(';'), '-map', '[aout]', ...mp3EncodeFlags);
      await runCommand('ffmpeg', ffArgs);
    } else {
      const concatListPath = path.join(jobDir, 'concat.txt');
      const concatContent = trimmedSegments.map((s) => `file '${s.path.replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(concatListPath, concatContent, 'utf8');

      const ffArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath];
      if (options.normalize) {
        ffArgs.push('-af', 'loudnorm=I=-14:TP=-1.5:LRA=11');
      }
      ffArgs.push(...mp3EncodeFlags);
      await runCommand('ffmpeg', ffArgs);
    }

    const stat = fs.statSync(outputPath);
    const finalDur = await getAudioDuration(outputPath);

    job.outputPath = outputPath;
    job.outputFilename = finalFilename;
    job.fileSizeBytes = stat.size;
    job.durationSeconds = finalDur;
    job.progress = 100;
    job.status = 'ready';
    job.stageLabel = 'MP3 ready for download';
    persistJob(job);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = 'error';
    job.errorCode = job.errorCode || 'ffmpeg_error';
    job.error = msg.slice(0, 600);
    job.stageLabel = 'Render failed';
    persistJob(job);
  }
}

async function startServer() {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, cookiesConfigured: fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 0 });
  });

  // Raw upload endpoint before express.json() for multi-MP3 & local audio uploads
  app.post(
    '/api/upload-audio',
    express.raw({ type: () => true, limit: '250mb' }),
    async (req, res) => {
      try {
        const rawName = typeof req.query.filename === 'string' ? req.query.filename : 'audio.mp3';
        const ext = path.extname(rawName).toLowerCase() || '.mp3';
        const allowed = ['.mp3', '.m4a', '.wav', '.mp4', '.webm', '.ogg', '.aac', '.flac'];
        const safeExt = allowed.includes(ext) ? ext : '.mp3';

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: 'Empty file payload.' });
          return;
        }

        const uploadId = crypto.randomUUID();
        const filePath = path.join(UPLOADS_DIR, `${uploadId}${safeExt}`);
        fs.writeFileSync(filePath, req.body);

        uploadedFiles.set(uploadId, {
          path: filePath,
          originalName: rawName,
          size: req.body.length,
        });

        const durationSeconds = await getAudioDuration(filePath);

        res.json({
          uploadId,
          originalName: rawName,
          size: req.body.length,
          durationSeconds: durationSeconds > 0 ? durationSeconds : 60,
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
      }
    }
  );

  app.use(express.json({ limit: '5mb' }));

  app.get('/api/cookies', (_req, res) => {
    const configured = fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 0;
    res.json({ configured });
  });

  app.post('/api/cookies', (req, res) => {
    const { cookiesText } = req.body as { cookiesText?: string };
    if (!cookiesText || typeof cookiesText !== 'string' || cookiesText.trim().length < 20) {
      res.status(400).json({ error: 'Please paste valid Netscape-format YouTube cookies.txt content.' });
      return;
    }
    fs.writeFileSync(COOKIES_FILE, cookiesText.trim() + '\n', 'utf8');
    res.json({ configured: true });
  });

  app.delete('/api/cookies', (_req, res) => {
    if (fs.existsSync(COOKIES_FILE)) {
      fs.unlinkSync(COOKIES_FILE);
    }
    res.json({ configured: false });
  });

  app.post('/api/youtube/info', async (req, res) => {
    const { urls } = req.body as { urls?: string[] };
    if (!Array.isArray(urls) || urls.length === 0) {
      res.status(400).json({ error: 'Provide at least one YouTube URL.' });
      return;
    }

    const limited = urls.slice(0, 50);
    const results = await Promise.all(
      limited.map(async (rawUrl) => {
        try {
          const meta = await fetchYoutubeInfo(rawUrl);
          return { ok: true as const, input: rawUrl, meta };
        } catch (err) {
          return {
            ok: false as const,
            input: rawUrl,
            error: err instanceof Error ? err.message : 'Failed to inspect URL',
          };
        }
      })
    );

    res.json({ results });
  });

  app.post('/api/combine-mp3', (req, res) => {
    const { clips, options } = req.body as {
      clips?: CombineClipInput[];
      options?: Partial<CombineOptions>;
    };

    if (!Array.isArray(clips) || clips.length === 0) {
      res.status(400).json({ error: 'Add at least one trimmed clip before combining.' });
      return;
    }

    for (const clip of clips) {
      if ((!clip.videoId && !clip.uploadId) || typeof clip.startTime !== 'number' || typeof clip.endTime !== 'number' || clip.endTime <= clip.startTime) {
        res.status(400).json({ error: `Invalid trim range for "${clip.title || clip.videoId}". End time must be greater than start time.` });
        return;
      }
    }

    const jobId = crypto.randomUUID();
    const safeOptions: CombineOptions = {
      bitrate: options?.bitrate === 128 || options?.bitrate === 320 ? options.bitrate : 192,
      crossfadeSec: typeof options?.crossfadeSec === 'number' ? Math.max(0, Math.min(3, options.crossfadeSec)) : 0,
      normalize: Boolean(options?.normalize),
      outputName: typeof options?.outputName === 'string' && options.outputName.trim() ? options.outputName.trim() : 'cutline-combined-mix',
    };

    const job: RenderJob = {
      id: jobId,
      status: 'queued',
      progress: 0,
      stageLabel: 'Initializing FFmpeg render pipeline',
      outputFilename: `${sanitizeFilename(safeOptions.outputName).replace(/\.mp3$/i, '')}.mp3`,
      clips: clips.map((c) => ({
        clipId: c.id,
        title: c.title,
        status: 'pending',
      })),
      createdAt: Date.now(),
    };

    jobs.set(jobId, job);
    persistJob(job);
    void processCombineJob(jobId, clips, safeOptions);

    res.json({ jobId, job });
  });

  app.get('/api/jobs/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Render job not found.' });
      return;
    }
    res.json({ job });
  });

  app.get('/api/jobs/:jobId/download', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job || job.status !== 'ready' || !job.outputPath || !fs.existsSync(job.outputPath)) {
      res.status(404).json({ error: 'MP3 file is not ready yet.' });
      return;
    }
    const stat = fs.statSync(job.outputPath);
    const safeName = job.outputFilename.replace(/["\\/\r\n]/g, '');
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(job.outputPath).pipe(res);
  });

  app.get('/api/jobs/:jobId/stream', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job || job.status !== 'ready' || !job.outputPath || !fs.existsSync(job.outputPath)) {
      res.status(404).json({ error: 'MP3 file is not ready yet.' });
      return;
    }
    const stat = fs.statSync(job.outputPath);
    const total = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/mpeg',
      });
      fs.createReadStream(job.outputPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(job.outputPath).pipe(res);
    }
  });

  app.get('/api/uploads/:uploadId/stream', (req, res) => {
    const filePath = findUploadedFile(req.params.uploadId);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Uploaded audio file not found.' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.mp4': 'audio/mp4',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.webm': 'audio/webm',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
    };
    const contentType = mimeMap[ext] || 'audio/mpeg';
    const stat = fs.statSync(filePath);
    const total = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CutLine Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
