interface TopBarProps {
  activeSection: 'workspace' | 'timeline' | 'export';
  onNavigate: (section: 'workspace' | 'timeline' | 'export') => void;
  onOpenBatchModal: () => void;
  onOpenCookiesModal: () => void;
  onStartCombine: () => void;
  canExport: boolean;
  isRendering: boolean;
}

export function TopBar({
  activeSection,
  onNavigate,
  onOpenBatchModal,
  onOpenCookiesModal,
  onStartCombine,
  canExport,
  isRendering,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0D11]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('workspace');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
        >
          CutLine Studio
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => onNavigate('workspace')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer py-1 border-b-2 ${
              activeSection === 'workspace'
                ? 'border-amber-500 text-slate-100'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Clip Queue
          </button>
          <button
            type="button"
            onClick={onOpenBatchModal}
            className="whitespace-nowrap shrink-0 transition-colors cursor-pointer py-1 border-b-2 border-transparent hover:text-slate-200"
          >
            Batch Paste
          </button>
          <button
            type="button"
            onClick={() => onNavigate('timeline')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer py-1 border-b-2 ${
              activeSection === 'timeline'
                ? 'border-amber-500 text-slate-100'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Stitch Sequence
          </button>
          <button
            type="button"
            onClick={() => onNavigate('export')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer py-1 border-b-2 ${
              activeSection === 'export'
                ? 'border-amber-500 text-slate-100'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            MP3 Export
          </button>
          <button
            type="button"
            onClick={onOpenCookiesModal}
            className="whitespace-nowrap shrink-0 transition-colors cursor-pointer py-1 border-b-2 border-transparent hover:text-slate-200"
          >
            YouTube Auth
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onStartCombine}
            disabled={!canExport || isRendering}
            className="whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            {isRendering ? 'Rendering MP3...' : 'Combine & Download MP3'}
          </button>
        </div>
      </div>
    </header>
  );
}
