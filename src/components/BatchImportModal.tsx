import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { extractYoutubeUrls } from '../utils/time';

interface BatchImportModalProps {
  open: boolean;
  onClose: () => void;
  onImportUrls: (urls: string[]) => Promise<void>;
}

export function BatchImportModal({ open, onClose, onImportUrls }: BatchImportModalProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const detected = extractYoutubeUrls(text);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (detected.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onImportUrls(detected);
      setText('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl border border-white/15 bg-[#13161D] p-5 shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="batch-modal-title" className="font-display text-base font-semibold text-slate-100">
              Batch Paste YouTube Links
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Paste as many YouTube URLs as you want — one per line, or separated by spaces or commas.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`https://www.youtube.com/watch?v=...\nhttps://youtu.be/...\nhttps://www.youtube.com/shorts/...`}
            className="w-full rounded-lg border border-white/10 bg-[#0B0D11] p-3 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
          />

          <div className="flex items-center justify-between gap-4">
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {detected.length} valid {detected.length === 1 ? 'link' : 'links'} detected
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={detected.length === 0 || submitting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Add {detected.length > 0 ? detected.length : ''} Links to Queue
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
