/**
 * Helpers for Admin-authored Page Content (raw HTML + embed codes).
 *
 * Page Content is strictly admin-only (writable exclusively by the single
 * authenticated administrator in Firebase Auth + Firestore rules). Raw HTML
 * and embeds (iframes, videos, scripts, styles, widgets) are preserved as-is.
 */

/**
 * Validates that a URL inserted via the Visual editor toolbar uses http: or https:.
 */
export function normalizeHttpUrl(raw: string): string | null {
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleaned || cleaned.length > 1000) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Returns true whenever the admin-authored Page Content contains non-empty HTML.
 */
export function hasPageContent(html?: string): boolean {
  return typeof html === 'string' && html.trim().length > 0;
}
