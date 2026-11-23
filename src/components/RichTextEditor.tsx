import React, { useEffect, useRef, useState } from 'react';
import {
  Bold,
  Code2,
  Eraser,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pilcrow,
  Redo2,
  Underline,
  Undo2,
  X,
} from 'lucide-react';
import { hasPageContent, normalizeHttpUrl } from '../lib/pageContent';

interface RichTextEditorProps {
  id: string;
  label?: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

type EditorMode = 'visual' | 'html';
type ActivePopover = 'none' | 'link' | 'image';

function isVisuallyEmptyElement(el: HTMLDivElement): boolean {
  const text = (el.textContent ?? '').replace(/\u00A0/g, ' ').trim();
  if (text.length > 0) return false;
  return !el.querySelector(
    'img, hr, iframe, video, audio, object, embed, script, style, svg, canvas'
  );
}

/**
 * Blogger-style Page Content editor with Visual (WYSIWYG) and HTML (raw code) views.
 * Used exclusively inside the login-protected Admin Panel for matches and channels.
 */
export function RichTextEditor({
  id,
  label = 'Page Content',
  value,
  onChange,
  placeholder = 'Write headings, match notes, lineups, lists, links, images, or switch to HTML view to paste embed codes...',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>(value);
  const savedRangeRef = useRef<Range | null>(null);

  const [mode, setMode] = useState<EditorMode>('visual');
  const [popover, setPopover] = useState<ActivePopover>('none');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageAlt, setImageAlt] = useState('');
  const [popoverError, setPopoverError] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState<boolean>(() => !hasPageContent(value));

  // Populate the Visual contentEditable DOM whenever entering Visual mode
  // or when `value` changes externally (e.g., switching edited item or resetting form).
  useEffect(() => {
    if (mode !== 'visual') return;
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== value && value !== lastEmittedRef.current) {
      el.innerHTML = value;
      lastEmittedRef.current = value;
      setIsEmpty(isVisuallyEmptyElement(el));
    }
  }, [value, mode]);

  // Sync contentEditable DOM immediately when toggling back from HTML view to Visual view
  useEffect(() => {
    if (mode !== 'visual') return;
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = value;
    lastEmittedRef.current = value;
    setIsEmpty(isVisuallyEmptyElement(el));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const emitVisualChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const empty = isVisuallyEmptyElement(el);
    const nextHtml = empty ? '' : el.innerHTML;
    lastEmittedRef.current = nextHtml;
    setIsEmpty(empty);
    onChange(nextHtml);
  };

  const handleModeSwitch = (nextMode: EditorMode) => {
    if (nextMode === mode) return;
    if (mode === 'visual' && editorRef.current) {
      const empty = isVisuallyEmptyElement(editorRef.current);
      const currentHtml = empty ? '' : editorRef.current.innerHTML;
      if (currentHtml !== value) {
        lastEmittedRef.current = currentHtml;
        onChange(currentHtml);
      }
    }
    setPopover('none');
    setPopoverError(null);
    setMode(nextMode);
  };

  const handleRawHtmlChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextHtml = e.target.value;
    lastEmittedRef.current = nextHtml;
    setIsEmpty(!hasPageContent(nextHtml));
    onChange(nextHtml);
  };

  const saveSelection = () => {
    const selection = window.getSelection();
    const el = editorRef.current;
    if (!selection || selection.rangeCount === 0 || !el) return;
    const range = selection.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  };

  const restoreSelection = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    if (savedRangeRef.current && el.contains(savedRangeRef.current.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    } else {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const runCommand = (command: string, commandValue?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false, commandValue);
    saveSelection();
    emitVisualChange();
  };

  const openLinkPopover = () => {
    saveSelection();
    const selectedText = savedRangeRef.current?.toString().trim() ?? '';
    setLinkUrl('');
    setLinkText(selectedText);
    setPopoverError(null);
    setPopover((prev) => (prev === 'link' ? 'none' : 'link'));
  };

  const openImagePopover = () => {
    saveSelection();
    setImageUrl('');
    setImageAlt('');
    setPopoverError(null);
    setPopover((prev) => (prev === 'image' ? 'none' : 'image'));
  };

  const closePopover = () => {
    setPopover('none');
    setPopoverError(null);
  };

  const handleInsertLink = () => {
    const safeUrl = normalizeHttpUrl(linkUrl);
    if (!safeUrl) {
      setPopoverError('Enter a valid URL starting with http:// or https://.');
      return;
    }

    restoreSelection();
    const selection = window.getSelection();
    const el = editorRef.current;
    if (!el || !selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const displayText = linkText.trim() || range.toString().trim() || safeUrl;

    const anchor = document.createElement('a');
    anchor.setAttribute('href', safeUrl);
    anchor.textContent = displayText;

    range.deleteContents();
    range.insertNode(anchor);

    const afterRange = document.createRange();
    afterRange.setStartAfter(anchor);
    afterRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(afterRange);

    saveSelection();
    emitVisualChange();
    closePopover();
  };

  const handleInsertImage = () => {
    const safeSrc = normalizeHttpUrl(imageUrl);
    if (!safeSrc) {
      setPopoverError('Enter a valid image URL starting with http:// or https://.');
      return;
    }

    restoreSelection();
    const selection = window.getSelection();
    const el = editorRef.current;
    if (!el || !selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const img = document.createElement('img');
    img.setAttribute('src', safeSrc);
    img.setAttribute('alt', imageAlt.trim().slice(0, 200));

    range.deleteContents();
    range.insertNode(img);

    const afterRange = document.createRange();
    afterRange.setStartAfter(img);
    afterRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(afterRange);

    saveSelection();
    emitVisualChange();
    closePopover();
  };

  const toolbarBtnClass =
    'inline-flex items-center justify-center min-w-[34px] h-[34px] px-2 rounded-lg text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 transition-colors';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="block text-xs font-semibold text-slate-700">
          {label}
        </label>

        {/* Blogger-style Visual / HTML View Switcher */}
        <div
          role="tablist"
          aria-label="Editor view mode"
          className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'visual'}
            onClick={() => handleModeSwitch('visual')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
              mode === 'visual'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Visual</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'html'}
            onClick={() => handleModeSwitch('html')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
              mode === 'html'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>HTML</span>
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-300 bg-white overflow-hidden focus-within:border-emerald-600 transition-colors">
        {mode === 'visual' ? (
          <>
            {/* Visual Toolbar */}
            <div
              role="toolbar"
              aria-label="Page content formatting toolbar"
              className="flex flex-wrap items-center gap-1 p-2 bg-slate-50 border-b border-slate-200"
            >
              <button
                type="button"
                title="Heading 1"
                aria-label="Heading 1"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('formatBlock', 'H1')}
                className={toolbarBtnClass}
              >
                <Heading1 className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="Heading 2"
                aria-label="Heading 2"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('formatBlock', 'H2')}
                className={toolbarBtnClass}
              >
                <Heading2 className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="Heading 3"
                aria-label="Heading 3"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('formatBlock', 'H3')}
                className={toolbarBtnClass}
              >
                <Heading3 className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="Paragraph"
                aria-label="Paragraph"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('formatBlock', 'P')}
                className={toolbarBtnClass}
              >
                <Pilcrow className="w-4 h-4" aria-hidden="true" />
              </button>

              <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden="true" />

              <button
                type="button"
                title="Bold"
                aria-label="Bold"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('bold')}
                className={toolbarBtnClass}
              >
                <Bold className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="Italic"
                aria-label="Italic"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('italic')}
                className={toolbarBtnClass}
              >
                <Italic className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="Underline"
                aria-label="Underline"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('underline')}
                className={toolbarBtnClass}
              >
                <Underline className="w-4 h-4" aria-hidden="true" />
              </button>

              <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden="true" />

              <button
                type="button"
                title="Bullet List"
                aria-label="Bullet list"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('insertUnorderedList')}
                className={toolbarBtnClass}
              >
                <List className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="Numbered List"
                aria-label="Numbered list"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('insertOrderedList')}
                className={toolbarBtnClass}
              >
                <ListOrdered className="w-4 h-4" aria-hidden="true" />
              </button>

              <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden="true" />

              <button
                type="button"
                title="Insert Link"
                aria-label="Insert link"
                onMouseDown={(e) => e.preventDefault()}
                onClick={openLinkPopover}
                className={`${toolbarBtnClass} ${
                  popover === 'link' ? 'bg-emerald-100 text-emerald-800' : ''
                }`}
              >
                <LinkIcon className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="Insert Image by URL"
                aria-label="Insert image"
                onMouseDown={(e) => e.preventDefault()}
                onClick={openImagePopover}
                className={`${toolbarBtnClass} ${
                  popover === 'image' ? 'bg-emerald-100 text-emerald-800' : ''
                }`}
              >
                <ImageIcon className="w-4 h-4" aria-hidden="true" />
              </button>

              <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden="true" />

              <button
                type="button"
                title="Clear Formatting"
                aria-label="Clear formatting"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('removeFormat')}
                className={toolbarBtnClass}
              >
                <Eraser className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="Undo"
                aria-label="Undo"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('undo')}
                className={toolbarBtnClass}
              >
                <Undo2 className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                title="Redo"
                aria-label="Redo"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand('redo')}
                className={toolbarBtnClass}
              >
                <Redo2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Inline Insert Link Panel */}
            {popover === 'link' && (
              <div className="p-3 bg-emerald-50/70 border-b border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    Insert Link (opens in same tab)
                  </span>
                  <button
                    type="button"
                    onClick={closePopover}
                    aria-label="Close insert link panel"
                    className="text-slate-500 hover:text-slate-900 p-1"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => {
                      setLinkUrl(e.target.value);
                      setPopoverError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleInsertLink();
                      }
                    }}
                    placeholder="https://example.com"
                    className="w-full min-h-[38px] px-3 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleInsertLink();
                      }
                    }}
                    placeholder="Link text (optional)"
                    className="w-full min-h-[38px] px-3 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                </div>
                {popoverError && (
                  <p role="alert" className="text-xs font-semibold text-red-600">
                    {popoverError}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleInsertLink}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-colors"
                  >
                    Insert Link
                  </button>
                  <button
                    type="button"
                    onClick={closePopover}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Inline Insert Image Panel */}
            {popover === 'image' && (
              <div className="p-3 bg-emerald-50/70 border-b border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800">Insert Image by URL</span>
                  <button
                    type="button"
                    onClick={closePopover}
                    aria-label="Close insert image panel"
                    className="text-slate-500 hover:text-slate-900 p-1"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => {
                      setImageUrl(e.target.value);
                      setPopoverError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleInsertImage();
                      }
                    }}
                    placeholder="https://example.com/photo.jpg"
                    className="w-full min-h-[38px] px-3 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={imageAlt}
                    onChange={(e) => setImageAlt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleInsertImage();
                      }
                    }}
                    placeholder="Image description / alt text (optional)"
                    className="w-full min-h-[38px] px-3 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                </div>
                {popoverError && (
                  <p role="alert" className="text-xs font-semibold text-red-600">
                    {popoverError}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleInsertImage}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-colors"
                  >
                    Insert Image
                  </button>
                  <button
                    type="button"
                    onClick={closePopover}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Editable Rich Content Canvas */}
            <div className="relative">
              {isEmpty && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute top-3.5 left-3.5 right-3.5 text-sm text-slate-400 select-none"
                >
                  {placeholder}
                </div>
              )}
              <div
                id={id}
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label={label}
                onInput={() => {
                  saveSelection();
                  emitVisualChange();
                }}
                onBlur={() => {
                  saveSelection();
                  emitVisualChange();
                }}
                onKeyUp={saveSelection}
                onMouseUp={saveSelection}
                className="page-content min-h-[220px] max-h-[480px] overflow-y-auto p-3.5 focus:outline-none"
              />
            </div>
          </>
        ) : (
          /* Raw HTML View */
          <div>
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 text-[11px] text-slate-600">
              <span className="font-semibold text-slate-700">Raw HTML &amp; Embed Code</span>
              <span>Paste iframe, video, script, or custom HTML directly</span>
            </div>
            <textarea
              id={id}
              value={value}
              onChange={handleRawHtmlChange}
              spellCheck={false}
              aria-label={`${label} (HTML view)`}
              placeholder={'<h2>Match Notes</h2>\n<p>Paste raw HTML or embed code (iframe, video, script) here...</p>'}
              className="w-full min-h-[240px] max-h-[500px] p-3.5 bg-white text-slate-900 font-mono-tabular text-xs sm:text-sm leading-relaxed resize-y focus:outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
