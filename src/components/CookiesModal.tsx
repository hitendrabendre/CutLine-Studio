import { useEffect, useState } from 'react';
import { X, CheckCircle2, Trash2 } from 'lucide-react';

interface CookiesModalProps {
  open: boolean;
  configured: boolean;
  onClose: () => void;
  onStatusChanged: (configured: boolean) => void;
}

export function CookiesModal({
  open,
  configured,
  onClose,
  onStatusChanged,
}: CookiesModalProps) {
  const [cookiesText, setCookiesText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookiesText }),
      });
      const data = (await res.json()) as { configured?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error || 'Failed to save cookies');
        return;
      }
      onStatusChanged(Boolean(data.configured));
      setCookiesText('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await fetch('/api/cookies', { method: 'DELETE' });
      onStatusChanged(false);
      onClose();
    } finally {
      setSaving(false);
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
        aria-labelledby="cookies-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl border border-white/15 bg-[#13161D] p-5 shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="cookies-modal-title" className="font-display text-base font-semibold text-slate-100">
              YouTube Authentication (Optional)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              If YouTube prompts cloud servers for anti-bot verification, paste Netscape-format cookies.txt below.
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

        {configured && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-950/25 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>YouTube cookies are configured on this server session.</span>
            </div>
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/15 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-3">
          <textarea
            rows={6}
            value={cookiesText}
            onChange={(e) => setCookiesText(e.target.value)}
            placeholder={`# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...\tLOGIN_INFO\t...`}
            className="w-full rounded-lg border border-white/10 bg-[#0B0D11] p-3 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
          />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 cursor-pointer"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={!cookiesText.trim() || saving}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Cookies'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
