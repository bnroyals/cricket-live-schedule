import type { Channel } from '../types/cricket';
import { getSafeEmbedUrl } from './security';

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Extracts the channel display name from raw channel HTML.
 * Priority:
 *   1. First element with a non-empty `data-channel-name` attribute
 *      (e.g. `<div data-channel-name="Willow Cricket">...</div>`).
 *   2. Text content of the first `<h1>` element.
 *   3. Optional fallback string.
 */
export function parseChannelNameFromHtml(html?: string, fallback = ''): string {
  const raw = typeof html === 'string' ? html.trim() : '';
  if (!raw) return fallback.trim();

  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      const attrEl = doc.querySelector('[data-channel-name]');
      const attrName = attrEl?.getAttribute('data-channel-name')?.trim();
      if (attrName) return attrName;

      const h1Text = doc.querySelector('h1')?.textContent?.trim();
      if (h1Text) return h1Text;
    } catch {
      // Fall through to regex parsing
    }
  }

  const attrMatch = raw.match(/data-channel-name\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  const attrVal = (attrMatch?.[1] ?? attrMatch?.[2] ?? '').trim();
  if (attrVal) return attrVal;

  const h1Match = raw.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) {
    const h1Text = h1Match[1].replace(/<[^>]+>/g, '').trim();
    if (h1Text) return h1Text;
  }

  return fallback.trim();
}

/**
 * Generates clean, self-contained channel HTML from legacy channel fields
 * (name, streamUrl, saved pageContent) so existing channels migrate cleanly
 * with zero data loss and play immediately.
 */
export function buildChannelHtmlFromLegacy(legacy: {
  name?: string;
  language?: string;
  streamUrl?: string;
  pageContent?: string;
}): string {
  const name = (legacy.name ?? '').trim() || 'Live Channel';
  const safeUrl = legacy.streamUrl ? getSafeEmbedUrl(legacy.streamUrl) : null;
  const extraContent = typeof legacy.pageContent === 'string' ? legacy.pageContent.trim() : '';

  const lines: string[] = [
    `<div data-channel-name="${escapeHtmlAttr(name)}">`,
    `  <h1>${escapeHtmlText(name)}</h1>`,
  ];

  if (safeUrl) {
    lines.push(
      `  <div style="position:relative;width:100%;aspect-ratio:16/9;background:#020617;border-radius:12px;overflow:hidden;">`,
      `    <iframe src="${escapeHtmlAttr(safeUrl)}" title="${escapeHtmlAttr(name)} Live Stream" style="width:100%;height:100%;border:0;margin:0;border-radius:0;" allow="autoplay *; fullscreen *; encrypted-media *; picture-in-picture *" allowfullscreen referrerpolicy="no-referrer"></iframe>`,
      `  </div>`
    );
  } else {
    lines.push(
      `  <p>Stream currently unavailable for ${escapeHtmlText(name)}. Please check back later.</p>`
    );
  }

  if (extraContent) {
    lines.push(`  <div style="margin-top:20px;">`, extraContent, `  </div>`);
  }

  lines.push(`</div>`);
  return lines.join('\n');
}

/**
 * Returns a channel's saved HTML, falling back to generating HTML from legacy
 * fields at read time if the stored channel document has no `html` yet.
 */
export function getChannelHtml(
  channel: Pick<Channel, 'html' | 'name' | 'language' | 'streamUrl' | 'pageContent'>
): string {
  if (typeof channel.html === 'string' && channel.html.trim().length > 0) {
    return channel.html;
  }
  return buildChannelHtmlFromLegacy(channel);
}

/**
 * Resolves the public display name for a channel from its HTML code
 * (`data-channel-name` attribute or first `<h1>`), falling back to stored name/id.
 */
export function getChannelDisplayName(
  channel: Pick<Channel, 'html' | 'name' | 'id' | 'language' | 'streamUrl' | 'pageContent'>
): string {
  const html = getChannelHtml(channel);
  return parseChannelNameFromHtml(html, channel.name || channel.id);
}

/**
 * Returns true if the channel HTML contains an embedded player or media/script element.
 */
export function hasPlayableHtmlEmbed(html?: string): boolean {
  const raw = typeof html === 'string' ? html.trim() : '';
  if (!raw) return false;

  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      const iframes = Array.from(doc.querySelectorAll('iframe'));
      if (iframes.some((el) => Boolean(getSafeEmbedUrl(el.getAttribute('src') ?? '')))) {
        return true;
      }
      if (doc.querySelector('video, audio, embed, object, script')) {
        return true;
      }
      return false;
    } catch {
      // Fall through to regex check
    }
  }

  return /<(iframe|video|audio|embed|object|script)\b/i.test(raw);
}

/**
 * Returns true if the channel has a playable stream embed in its HTML
 * (or legacy streamUrl when unmigrated).
 */
export function channelHasPlayableEmbed(
  channel: Pick<Channel, 'html' | 'name' | 'language' | 'streamUrl' | 'pageContent'>
): boolean {
  return hasPlayableHtmlEmbed(getChannelHtml(channel));
}
