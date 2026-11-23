const HASH_ITERATIONS = 120000;

export interface PasswordStrengthResult {
  valid: boolean;
  minLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
  errors: string[];
}

/**
 * Generates a cryptographically strong random hex string using Web Crypto API.
 */
export function generateRandomHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derives a strong SHA-256 salted password hash using PBKDF2-HMAC-SHA256
 * (falls back to iterated SHA-256 digest if PBKDF2 is unavailable).
 */
export async function hashPasswordSha256(
  password: string,
  salt: string,
  iterations = HASH_ITERATIONS
): Promise<string> {
  const encoder = new TextEncoder();
  const subtle = crypto.subtle;

  try {
    const keyMaterial = await subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const derivedBits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: encoder.encode(`cricket-live-v1:${salt}`),
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    return Array.from(new Uint8Array(derivedBits), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
  } catch {
    // Fallback to direct salted SHA-256 digest
    let data: Uint8Array = encoder.encode(`${salt}:${password}`);
    const rounds = Math.min(iterations, 5000);
    for (let i = 0; i < rounds; i++) {
      const digest = await subtle.digest('SHA-256', data.buffer as ArrayBuffer);
      data = new Uint8Array(digest);
    }
    return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

export function getDefaultHashIterations(): number {
  return HASH_ITERATIONS;
}

/**
 * Constant-time string comparison to reduce timing side channels.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Validates strong admin password requirements:
 * Minimum 12 chars, at least one letter, one number, and one symbol.
 */
export function validateStrongPassword(password: string): PasswordStrengthResult {
  const minLength = password.length >= 12;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9\s]/.test(password);

  const errors: string[] = [];
  if (!minLength) errors.push('Minimum 12 characters required.');
  if (!hasLetter) errors.push('Must include at least one letter (A-Z, a-z).');
  if (!hasNumber) errors.push('Must include at least one number (0-9).');
  if (!hasSymbol) errors.push('Must include at least one symbol (e.g. !@#$%^&*).');

  return {
    valid: minLength && hasLetter && hasNumber && hasSymbol,
    minLength,
    hasLetter,
    hasNumber,
    hasSymbol,
    errors,
  };
}

export function validateEmail(email: string): { valid: boolean; value: string; error?: string } {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return { valid: false, value: '', error: 'Email is required.' };
  }
  if (trimmed.length > 160) {
    return { valid: false, value: '', error: 'Email is too long.' };
  }
  if (containsDangerousMarkup(trimmed)) {
    return { valid: false, value: '', error: 'Invalid characters in email.' };
  }
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, value: '', error: 'Enter a valid email address.' };
  }
  return { valid: true, value: trimmed };
}

/**
 * Detects HTML tags, script tags, event handlers, or dangerous URI schemes.
 */
export function containsDangerousMarkup(raw: string): boolean {
  const patterns: RegExp[] = [
    /[<>]/,
    /<\s*\/?\s*script/i,
    /<\s*\/?\s*(iframe|object|embed|svg|img|style|link|meta|form|input)/i,
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /data\s*:\s*text\/html/i,
    /\bon[a-z]+\s*=/i,
    /expression\s*\(/i,
  ];
  return patterns.some((re) => re.test(raw));
}

/**
 * Sanitizes and validates plain text input from admin forms.
 * Explicitly blocks HTML/script injection rather than silently rendering unsafe markup.
 */
export function validateSafeText(
  raw: string,
  fieldLabel: string,
  options: { required?: boolean; maxLength?: number } = {}
): { valid: boolean; value: string; error?: string } {
  const { required = true, maxLength = 140 } = options;
  // Strip invisible control characters except normal spaces
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();

  if (required && cleaned.length === 0) {
    return { valid: false, value: '', error: `${fieldLabel} is required.` };
  }
  if (cleaned.length > maxLength) {
    return {
      valid: false,
      value: '',
      error: `${fieldLabel} must be ${maxLength} characters or fewer.`,
    };
  }
  if (containsDangerousMarkup(cleaned)) {
    return {
      valid: false,
      value: '',
      error: `${fieldLabel} contains blocked HTML or script characters (<, >, script, or event handlers).`,
    };
  }

  return { valid: true, value: cleaned };
}

/**
 * Returns true if the URL belongs to a source known to block iframe embedding
 * via X-Frame-Options: SAMEORIGIN / 403.
 */
export function isFramingBlockedStreamUrl(raw: string): boolean {
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    return (
      host === 'playsza.st' ||
      host.endsWith('.playsza.st') ||
      host.includes('playsza') ||
      host.includes('crichd')
    );
  } catch {
    return false;
  }
}

/**
 * Validates an optional embeddable stream URL. Allows empty string or strict http/https URLs
 * from embeddable sources (blocks framing-blocked playsza/CricHD hosts).
 */
export function validateStreamUrl(raw: string): { valid: boolean; value: string; error?: string } {
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleaned) {
    return { valid: true, value: '' };
  }
  if (cleaned.length > 500) {
    return { valid: false, value: '', error: 'Stream URL must be 500 characters or fewer.' };
  }
  if (containsDangerousMarkup(cleaned)) {
    return {
      valid: false,
      value: '',
      error: 'Stream URL contains blocked characters or unsafe script syntax.',
    };
  }
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        valid: false,
        value: '',
        error: 'Stream URL must start with https:// or http://.',
      };
    }
    if (isFramingBlockedStreamUrl(parsed.toString())) {
      return {
        valid: false,
        value: '',
        error: 'This source blocks embedded playback. Enter an embeddable stream URL or leave blank.',
      };
    }
    return { valid: true, value: parsed.toString() };
  } catch {
    return {
      valid: false,
      value: '',
      error: 'Enter a valid stream URL starting with https:// or http://.',
    };
  }
}

/**
 * Safe runtime check before embedding any stored stream URL in an in-app iframe.
 */
export function getSafeEmbedUrl(url: string): string | null {
  if (!url) return null;
  const check = validateStreamUrl(url);
  if (!check.valid || !check.value) return null;
  return check.value;
}

/**
 * Safe runtime check for external URL validation.
 */
export function getSafeExternalUrl(url: string): string | null {
  return getSafeEmbedUrl(url);
}

/**
 * Generates a clean, lowercase, letter-and-hyphen-only URL slug (zero numbers).
 */
export function generateCleanSlug(
  teamA: string,
  teamB: string,
  existingSlugs: string[] = []
): string {
  const sanitizePart = (input: string) =>
    input
      .toLowerCase()
      .replace(/[0-9]+/g, '')
      .replace(/[^a-z]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');

  const partA = sanitizePart(teamA) || 'team-a';
  const partB = sanitizePart(teamB) || 'team-b';
  const base = `${partA}-vs-${partB}`;

  const taken = new Set(existingSlugs.map((s) => s.toLowerCase()));
  if (!taken.has(base)) return base;

  const suffixes = [
    'clash',
    'fixture',
    'live',
    'cup',
    'series',
    'b',
    'c',
    'd',
    'e',
    'f',
    'g',
    'h',
  ];
  for (const suffix of suffixes) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Fallback alphabetic suffix (still zero numbers)
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let extra = '';
  for (let i = 0; i < 4; i++) {
    extra += letters[Math.floor(Math.random() * letters.length)];
  }
  return `${base}-${extra}`;
}
