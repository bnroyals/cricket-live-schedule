import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  Play,
  Radio,
  Tv,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Channel } from '../types/cricket';
import { PageContent } from '../components/PageContent';
import { hasPageContent } from '../lib/pageContent';
import { getSafeEmbedUrl } from '../lib/security';
import { useNavigate } from '../lib/router';
import { AdSlot } from '../components/AdSlot';

interface WatchPlayerPageProps {
  channelId: string;
  channels: Channel[];
  loading?: boolean;
}

type PlayerCommand = 'play' | 'pause' | 'unmute' | 'mute';

interface FullscreenElementWithVendor extends HTMLDivElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface FullscreenDocumentWithVendor extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

const SIGNED_PARAM_NAMES = new Set([
  'sig',
  'signature',
  'hmac',
  'policy',
  'key-pair-id',
  'x-amz-signature',
]);

/**
 * Builds the playback iframe src for the requested mute state without mutating
 * the stored channel streamUrl. Preserves all existing query parameters and hash;
 * skips adding params if the URL contains a cryptographic signature parameter.
 */
function buildIframePlaybackUrl(
  baseUrl: string,
  muted: boolean,
  explicitAudioMode: boolean
): string {
  if (!explicitAudioMode) {
    return baseUrl;
  }
  try {
    const parsed = new URL(baseUrl);
    for (const key of parsed.searchParams.keys()) {
      if (SIGNED_PARAM_NAMES.has(key.toLowerCase())) {
        return baseUrl;
      }
    }
    parsed.searchParams.set('autoplay', '1');
    parsed.searchParams.set('muted', muted ? '1' : '0');
    parsed.searchParams.set('mute', muted ? '1' : '0');
    return parsed.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Sends standard cross-origin postMessage control payloads supported by common
 * HTML5 / Clappr / JWPlayer / Video.js / Plyr / embed player wrappers.
 */
function dispatchIframeCommand(
  iframe: HTMLIFrameElement | null,
  command: PlayerCommand
): void {
  const win = iframe?.contentWindow;
  if (!win) return;

  const payloads: unknown[] =
    command === 'play'
      ? [
          'play',
          { action: 'play' },
          { command: 'play' },
          { method: 'play' },
          { type: 'play' },
          JSON.stringify({ event: 'command', func: 'playVideo', args: '' }),
          JSON.stringify({ method: 'play' }),
        ]
      : command === 'pause'
        ? [
            'pause',
            { action: 'pause' },
            { command: 'pause' },
            { method: 'pause' },
            { type: 'pause' },
            JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }),
            JSON.stringify({ method: 'pause' }),
          ]
        : command === 'unmute'
          ? [
              'unmute',
              { action: 'unmute' },
              { command: 'unmute' },
              { method: 'setMuted', value: false },
              { method: 'setVolume', value: 1 },
              { type: 'unmute' },
              JSON.stringify({ event: 'command', func: 'unMute', args: '' }),
              JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }),
              JSON.stringify({ method: 'setVolume', value: 1 }),
            ]
          : [
              'mute',
              { action: 'mute' },
              { command: 'mute' },
              { method: 'setMuted', value: true },
              { method: 'setVolume', value: 0 },
              { type: 'mute' },
              JSON.stringify({ event: 'command', func: 'mute', args: '' }),
              JSON.stringify({ method: 'setVolume', value: 0 }),
            ];

  for (const payload of payloads) {
    try {
      win.postMessage(payload, '*');
    } catch {
      // Ignore postMessage restriction if frame is navigating
    }
  }
}

export function WatchPlayerPage({
  channelId,
  channels,
  loading = false,
}: WatchPlayerPageProps) {
  const navigate = useNavigate();

  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const retryTimersRef = useRef<number[]>([]);

  const [shieldActive, setShieldActive] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [audioModeExplicit, setAudioModeExplicit] = useState<boolean>(false);
  const [nativeFullscreen, setNativeFullscreen] = useState<boolean>(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState<boolean>(false);
  const [streamStarted, setStreamStarted] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0);

  const isFullscreen = nativeFullscreen || fallbackFullscreen;

  const normalizedId = channelId.trim().toLowerCase();
  const channel =
    channels.find((c) => c.id.toLowerCase() === normalizedId) ??
    channels.find((c) => c.name.trim().toLowerCase() === normalizedId) ??
    null;

  const embedUrl = channel ? getSafeEmbedUrl(channel.streamUrl) : null;
  const isPlayable = Boolean(embedUrl);

  const iframeSrc = useMemo(() => {
    if (!embedUrl) return null;
    return buildIframePlaybackUrl(embedUrl, isMuted, audioModeExplicit);
  }, [embedUrl, isMuted, audioModeExplicit]);

  // Toggle Permissions Policy autoplay delegation:
  // - When unmuted: `autoplay *` delegates user-gesture autoplay with sound to the iframe & nested players.
  // - When muted: `autoplay 'none'` blocks unmuted autoplay so reloading muted reliably returns to muted state.
  const iframeAllow = isMuted
    ? "autoplay 'none'; fullscreen *; encrypted-media *; picture-in-picture *"
    : 'autoplay *; fullscreen *; encrypted-media *; picture-in-picture *';

  const clearRetryTimers = useCallback(() => {
    for (const timerId of retryTimersRef.current) {
      window.clearTimeout(timerId);
    }
    retryTimersRef.current = [];
  }, []);

  // Reset player shield & control state when channel or stream URL changes
  useEffect(() => {
    clearRetryTimers();
    setShieldActive(true);
    setIsPlaying(false);
    setIsMuted(true);
    setAudioModeExplicit(false);
    setFallbackFullscreen(false);
    setStreamStarted(false);
    setReloadKey(0);
  }, [channelId, embedUrl, clearRetryTimers]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearRetryTimers();
    };
  }, [clearRetryTimers]);

  const exitFullscreenNow = useCallback(() => {
    setFallbackFullscreen(false);
    const doc = document as FullscreenDocumentWithVendor;
    const activeEl = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    if (activeEl) {
      if (typeof doc.exitFullscreen === 'function') {
        void doc.exitFullscreen().catch(() => {
          // Ignore exitFullscreen errors
        });
      } else if (typeof doc.webkitExitFullscreen === 'function') {
        void doc.webkitExitFullscreen();
      }
    }
  }, []);

  // Sync fullscreen button state with native Fullscreen API events
  useEffect(() => {
    const syncFullscreen = () => {
      const doc = document as FullscreenDocumentWithVendor;
      const activeEl = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      const active = Boolean(activeEl);
      setNativeFullscreen(active);
      if (active) {
        // Keep focus on the parent container so Escape is never trapped inside the cross-origin iframe
        playerContainerRef.current?.focus({ preventScroll: true });
      }
    };

    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen);
    };
  }, []);

  // Ensure Escape always exits fullscreen (both native and fallback)
  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        exitFullscreenNow();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isFullscreen, exitFullscreenNow]);

  const triggerStreamCommands = useCallback(
    (muted: boolean) => {
      clearRetryTimers();
      const sendBatch = () => {
        dispatchIframeCommand(iframeRef.current, 'play');
        dispatchIframeCommand(iframeRef.current, muted ? 'mute' : 'unmute');
      };
      sendBatch();
      const t1 = window.setTimeout(sendBatch, 250);
      const t2 = window.setTimeout(sendBatch, 800);
      retryTimersRef.current = [t1, t2];
    },
    [clearRetryTimers]
  );

  // Starts/resumes stream on user click gesture and dismisses the click-shield overlay
  const handleStartStream = useCallback(() => {
    if (!embedUrl) return;
    setStreamStarted(true);
    setIsPlaying(true);
    setShieldActive(false);
    triggerStreamCommands(isMuted);
  }, [embedUrl, isMuted, triggerStreamCommands]);

  const handleTogglePlay = useCallback(() => {
    if (!embedUrl) return;

    if (!isPlaying || shieldActive) {
      // If previously paused, reload stream cleanly on user gesture to guarantee start
      if (streamStarted && !isPlaying) {
        setReloadKey((k) => k + 1);
      }
      handleStartStream();
    } else {
      clearRetryTimers();
      dispatchIframeCommand(iframeRef.current, 'pause');
      setIsPlaying(false);
      // Re-arm click-shield while paused so stray clicks cannot trigger host popups
      setShieldActive(true);
    }
  }, [embedUrl, isPlaying, shieldActive, streamStarted, handleStartStream, clearRetryTimers]);

  // Remounts the unsandboxed iframe directly on the Unmute/Mute click gesture so the
  // host player starts genuinely unmuted (with sound) or muted again.
  const handleToggleMute = useCallback(() => {
    if (!embedUrl) return;
    const nextMuted = !isMuted;
    clearRetryTimers();
    setIsMuted(nextMuted);
    setAudioModeExplicit(true);
    setStreamStarted(true);
    setIsPlaying(true);
    setShieldActive(false);
    setReloadKey((k) => k + 1);
  }, [embedUrl, isMuted, clearRetryTimers]);

  const handleToggleFullscreen = useCallback(() => {
    const container = playerContainerRef.current as FullscreenElementWithVendor | null;
    if (!container) return;

    if (isFullscreen) {
      exitFullscreenNow();
      return;
    }

    const enterFallback = () => {
      setFallbackFullscreen(true);
      window.requestAnimationFrame(() => {
        container.focus({ preventScroll: true });
      });
    };

    if (typeof container.requestFullscreen === 'function') {
      try {
        const result = container.requestFullscreen();
        if (result && typeof result.then === 'function') {
          result
            .then(() => {
              container.focus({ preventScroll: true });
            })
            .catch(() => {
              enterFallback();
            });
        } else {
          container.focus({ preventScroll: true });
        }
      } catch {
        enterFallback();
      }
    } else if (typeof container.webkitRequestFullscreen === 'function') {
      try {
        void container.webkitRequestFullscreen();
        container.focus({ preventScroll: true });
      } catch {
        enterFallback();
      }
    } else {
      enterFallback();
    }
  }, [isFullscreen, exitFullscreenNow]);

  if (loading && !channel) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-10 text-center">
          <Tv className="w-8 h-8 text-emerald-700 mx-auto" aria-hidden="true" />
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 mt-3">
            Loading Live Player
          </h1>
          <p className="text-sm text-slate-600 mt-1.5">
            Fetching live channel stream configuration...
          </p>
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-8 sm:p-12 text-center">
          <Tv className="w-9 h-9 text-slate-400 mx-auto" aria-hidden="true" />
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-900 mt-3">
            Channel Not Found
          </h1>
          <p className="text-sm text-slate-600 mt-3 max-w-md mx-auto leading-relaxed">
            The requested broadcast channel does not exist or has been removed.
          </p>
          <div className="mt-7 flex items-center justify-center">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold whitespace-nowrap transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Back to Schedule</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
      {/* Top In-App Navigation Row — Back to Schedule only */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to Schedule</span>
        </button>
      </div>

      <AdSlot positionId="watch-player-top" />

      {/* Main Embedded Live Player Card */}
      <section className="mt-3 rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden">
        {/* Player Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-emerald-700">Live Broadcast Player</span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="font-semibold text-slate-800">{channel.language}</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mt-0.5 leading-tight">
              {channel.name}
            </h1>
          </div>

          <div
            className={`inline-flex items-center gap-1.5 text-xs font-bold whitespace-nowrap ${
              isPlayable ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            <Radio className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isPlayable ? 'Embedded Stream Ready' : 'Stream Unavailable'}</span>
          </div>
        </div>

        {/* Player + Controls Wrapper (Fullscreen container keeps controls & Exit Fullscreen reachable) */}
        <div
          ref={playerContainerRef}
          tabIndex={-1}
          className={
            fallbackFullscreen
              ? 'fixed inset-0 z-50 flex flex-col bg-slate-950 p-3 sm:p-4 outline-none'
              : isFullscreen
                ? 'w-full h-full flex flex-col bg-slate-950 p-3 sm:p-4 outline-none'
                : 'p-4 sm:p-6 bg-[#F8FAFC] outline-none'
          }
        >
          {/* Responsive 16:9 In-App Player Area */}
          <div
            className={`relative w-full overflow-hidden border bg-slate-950 ${
              isFullscreen
                ? 'flex-1 min-h-0 rounded-lg border-slate-800'
                : 'aspect-video rounded-xl border-slate-200'
            }`}
          >
            {isPlayable && iframeSrc ? (
              <>
                {/* Unsandboxed stream iframe (NO sandbox attribute, NO allow-popups) */}
                <iframe
                  ref={iframeRef}
                  key={`${embedUrl}-${reloadKey}-${isMuted ? 'muted' : 'unmuted'}`}
                  src={iframeSrc}
                  title={`${channel.name} Live Stream`}
                  className="w-full h-full border-0"
                  allow={iframeAllow}
                  allowFullScreen
                  referrerPolicy="no-referrer"
                  onLoad={() => {
                    if (streamStarted && isPlaying) {
                      triggerStreamCommands(isMuted);
                    }
                  }}
                />

                {/* Transparent Click-Shield Overlay with Centered Play Button */}
                {shieldActive && (
                  <div
                    role="region"
                    aria-label={`Click shield for ${channel.name}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/35 backdrop-blur-[1px] select-none"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleStartStream();
                      }}
                      aria-label={`Play ${channel.name} live stream`}
                      className="group inline-flex flex-col items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400"
                    >
                      <span className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-emerald-600 group-hover:bg-emerald-500 group-active:scale-95 text-white shadow-xl ring-4 ring-white/25 flex items-center justify-center transition-all duration-150">
                        <Play className="w-9 h-9 sm:w-10 sm:h-10 fill-current translate-x-0.5" aria-hidden="true" />
                      </span>
                      <span className="px-4 py-1.5 rounded-lg bg-slate-950/80 text-white text-xs sm:text-sm font-bold tracking-wide shadow-sm">
                        Click to Play Stream
                      </span>
                    </button>
                  </div>
                )}

                {/* Always-reachable Exit Fullscreen button while in fullscreen */}
                {isFullscreen && (
                  <button
                    type="button"
                    onClick={exitFullscreenNow}
                    aria-label="Exit Fullscreen"
                    className="absolute top-3 right-3 z-30 inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-lg bg-slate-950/85 hover:bg-slate-900 text-white border border-white/20 text-xs sm:text-sm font-bold shadow-lg transition-colors"
                  >
                    <Minimize className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Exit Fullscreen</span>
                  </button>
                )}
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 sm:p-10 bg-slate-50">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
                  <Tv className="w-7 h-7" aria-hidden="true" />
                </div>
                <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 mt-4">
                  Stream Currently Unavailable
                </h2>
                <p className="text-sm text-slate-600 mt-2 max-w-md leading-relaxed">
                  No playable embedded stream is currently available for{' '}
                  <span className="font-semibold text-slate-900">{channel.name}</span>. Please
                  check back later.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="mt-5 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  <span>Back to Schedule</span>
                </button>
              </div>
            )}
          </div>

          {/* Three Player Control Buttons Below Video: Play, Unmute, Fullscreen */}
          {isPlayable && iframeSrc && (
            <div className="mt-3 sm:mt-4 grid grid-cols-3 gap-2.5 sm:gap-3 shrink-0">
              <button
                type="button"
                onClick={handleTogglePlay}
                className="inline-flex items-center justify-center gap-2 min-h-[46px] px-3 sm:px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white text-sm font-bold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              >
                {isPlaying && !shieldActive ? (
                  <>
                    <Pause className="w-4 h-4 fill-current shrink-0" aria-hidden="true" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current shrink-0" aria-hidden="true" />
                    <span>Play</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleToggleMute}
                aria-pressed={!isMuted}
                className={`inline-flex items-center justify-center gap-2 min-h-[46px] px-3 sm:px-5 py-2.5 rounded-xl border text-sm font-bold transition-all duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                  isFullscreen
                    ? isMuted
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                      : 'bg-emerald-700 hover:bg-emerald-600 border-emerald-500 text-white'
                    : isMuted
                      ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-900'
                      : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-400 text-emerald-900'
                }`}
              >
                {isMuted ? (
                  <>
                    <Volume2
                      className={`w-4 h-4 shrink-0 ${isFullscreen ? 'text-emerald-400' : 'text-emerald-700'}`}
                      aria-hidden="true"
                    />
                    <span>Unmute</span>
                  </>
                ) : (
                  <>
                    <VolumeX
                      className={`w-4 h-4 shrink-0 ${isFullscreen ? 'text-white' : 'text-slate-600'}`}
                      aria-hidden="true"
                    />
                    <span>Mute</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleToggleFullscreen}
                className={`inline-flex items-center justify-center gap-2 min-h-[46px] px-3 sm:px-5 py-2.5 rounded-xl active:scale-[0.98] border text-sm font-bold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                  isFullscreen
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-900'
                }`}
              >
                {isFullscreen ? (
                  <>
                    <Minimize className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden="true" />
                    <span>Exit Fullscreen</span>
                  </>
                ) : (
                  <>
                    <Maximize className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
                    <span>Fullscreen</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Admin-Authored Rich Channel Page Content */}
      {hasPageContent(channel.pageContent) && (
        <section className="mt-6 rounded-2xl bg-white border border-slate-200 shadow-xs p-6 sm:p-8">
          <PageContent html={channel.pageContent} />
        </section>
      )}
    </div>
  );
}
