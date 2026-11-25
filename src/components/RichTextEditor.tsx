import React from 'react';
import { Code2, Trash2 } from 'lucide-react';

interface RichTextEditorProps {
  id: string;
  label?: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

/**
 * Full Raw HTML Editor for Page Content.
 * Used exclusively inside the login-protected Admin Panel for matches and channels.
 * Saves and renders raw HTML & embed codes directly with zero stripping.
 */
export function RichTextEditor({
  id,
  label = 'Page Content',
  value,
  onChange,
  placeholder = 'Write or paste raw HTML, headings, paragraphs, images, iframes, or embed code directly...',
}: RichTextEditorProps) {
  const lineCount = value ? value.split('\n').length : 1;
  const charCount = value.length;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange(nextValue);
      window.requestAnimationFrame(() => {
        target.selectionStart = start + 2;
        target.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <label
          htmlFor={id}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700"
        >
          <Code2 className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
          <span>{label}</span>
          <span className="text-[11px] font-medium text-emerald-700">
            (Raw HTML)
          </span>
        </label>

        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono-tabular">
          <span>
            {lineCount} {lineCount === 1 ? 'line' : 'lines'} · {charCount} chars
          </span>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 font-sans font-semibold transition-colors"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-300 bg-white overflow-hidden focus-within:border-emerald-600 transition-colors">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 text-[11px] text-slate-600">
          <span className="font-semibold text-slate-800">HTML Code Editor</span>
          <span className="text-slate-500">
            Renders as-is on the public page (supports HTML tags, embeds &amp; scripts)
          </span>
        </div>

        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={14}
          className="block w-full min-h-[320px] p-4 bg-white text-slate-900 font-mono-tabular text-xs sm:text-sm leading-relaxed outline-none resize-y placeholder:text-slate-400"
        />
      </div>
    </div>
  );
}
