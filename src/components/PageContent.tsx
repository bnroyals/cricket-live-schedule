import { memo, useEffect, useMemo, useRef } from 'react';
import { hasPageContent } from '../lib/pageContent';

interface PageContentProps {
  html?: string;
  className?: string;
}

/**
 * Renders admin-authored Page Content HTML as-is (including iframe, video,
 * audio, object, embed, style, and executable script widget embeds).
 */
export const PageContent = memo(function PageContent({
  html,
  className = '',
}: PageContentProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rawHtml = typeof html === 'string' ? html : '';
  const hasContent = hasPageContent(rawHtml);

  const markup = useMemo(() => ({ __html: rawHtml }), [rawHtml]);

  // HTML injected via dangerouslySetInnerHTML does not execute <script> tags.
  // Recreate each <script> element after mount/update so script-based embeds run.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasContent) return;

    const scripts = Array.from(container.querySelectorAll('script'));
    scripts.forEach((oldScript) => {
      if (oldScript.dataset.clswExecuted === '1') return;
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach((attr) => {
        newScript.setAttribute(attr.name, attr.value);
      });
      newScript.dataset.clswExecuted = '1';
      if (oldScript.textContent) {
        newScript.textContent = oldScript.textContent;
      }
      oldScript.parentNode?.replaceChild(newScript, oldScript);
    });
  }, [rawHtml, hasContent]);

  if (!hasContent) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`page-content ${className}`.trim()}
      dangerouslySetInnerHTML={markup}
    />
  );
});
