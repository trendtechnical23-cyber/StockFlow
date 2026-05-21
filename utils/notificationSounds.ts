/**
 * Notification sound player for the StockFlow dashboard.
 *
 * Uses the Web Audio API (not <audio> elements) so we can amplify the output
 * gain ABOVE 1.0 — a plain HTMLAudioElement caps volume at 1.0, which was too
 * quiet. A GainNode lets us push the signal to ~3x.
 *
 * Sounds live in /sounds/ (public/sounds/). Each notification type maps to a
 * file that mirrors the sound used on the Android APK for the same action.
 *
 * Browser autoplay policy:
 *   AudioContext starts "suspended" until a user gesture. Call unlockAudio()
 *   once from the app root so the context resumes and buffers are pre-decoded.
 */

const PLAYBACK_GAIN = 3.0; // 3x louder than source

const SOUND_MAP: Record<string, string> = {
  // Stock take
  STOCK_TAKE_START   : '/sounds/sound_stock_take_start.wav',
  STOCK_TAKE_END     : '/sounds/sound_stock_take_end.wav',
  stock_take_start   : '/sounds/sound_stock_take_start.wav',
  stock_take_end     : '/sounds/sound_stock_take_end.wav',
  stock_take_session : '/sounds/sound_stock_take_start.wav', // refined by eventType in caller

  // Stock levels
  stock_low          : '/sounds/sound_low_stock.wav',
  low_stock          : '/sounds/sound_low_stock.wav',
  stock_out          : '/sounds/sound_low_stock.wav',

  // Approvals
  approval_pending   : '/sounds/sound_approval_pending.mp3',
  approval           : '/sounds/sound_approval_pending.mp3',
  approved           : '/sounds/sound_approved.mp3',
  rejected           : '/sounds/sound_rejected.wav',

  // Inventory movements
  stock_in           : '/sounds/sound_confirmation.wav',
  stock_update       : '/sounds/sound_confirmation.wav',
  confirmation       : '/sounds/sound_confirmation.wav',

  // General / fallbacks
  stock              : '/sounds/sound_notification.mp3',
  general            : '/sounds/sound_notification.mp3',
  user               : '/sounds/sound_notification.mp3',
  system             : '/sounds/sound_notification.mp3',
  activity           : '/sounds/sound_notification.mp3',
};

// ── Web Audio plumbing ──────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();
const decoding = new Map<string, Promise<AudioBuffer | null>>();

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

/** Fetch + decode a sound file into an AudioBuffer (cached). */
async function loadBuffer(src: string): Promise<AudioBuffer | null> {
  if (bufferCache.has(src)) return bufferCache.get(src)!;
  if (decoding.has(src)) return decoding.get(src)!;

  const ctx = getContext();
  if (!ctx) return null;

  const p = (async () => {
    try {
      const res = await fetch(src);
      const arr = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr);
      bufferCache.set(src, buf);
      return buf;
    } catch (err) {
      console.debug('🔇 Failed to load sound:', src, err);
      return null;
    } finally {
      decoding.delete(src);
    }
  })();

  decoding.set(src, p);
  return p;
}

// ── Audio unlock ──────────────────────────────────────────────────────────────

let audioUnlocked = false;

/**
 * Resume the AudioContext and pre-decode all sounds on the first user gesture.
 * Call once from the app root.
 */
export function unlockAudio(): void {
  if (audioUnlocked || typeof window === 'undefined') return;

  const unlock = () => {
    if (audioUnlocked) return;
    audioUnlocked = true;

    const ctx = getContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});

    // Pre-decode every unique sound so playback is instant later
    [...new Set(Object.values(SOUND_MAP))].forEach(src => { void loadBuffer(src); });

    document.removeEventListener('click',      unlock, true);
    document.removeEventListener('keydown',    unlock, true);
    document.removeEventListener('touchstart', unlock, true);
  };

  document.addEventListener('click',      unlock, { capture: true, once: true });
  document.addEventListener('keydown',    unlock, { capture: true, once: true });
  document.addEventListener('touchstart', unlock, { capture: true, once: true, passive: true });
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Play the notification sound for the given type (amplified to PLAYBACK_GAIN).
 *
 * @param type       Notification type (matches Firestore/FCM "type" field)
 * @param eventType  Optional sub-event (e.g. "STARTED"/"ENDED" for stock_take_session)
 */
export function playNotificationSound(type: string, eventType?: string): void {
  if (typeof window === 'undefined') return;

  // Resolve sub-type overrides
  let resolvedType = type;
  if (type === 'stock_take_session') {
    resolvedType = eventType === 'ENDED' ? 'STOCK_TAKE_END' : 'STOCK_TAKE_START';
  }
  const src = SOUND_MAP[resolvedType] ?? SOUND_MAP['general'];

  const ctx = getContext();
  if (!ctx) return;

  const playFrom = (buffer: AudioBuffer) => {
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = PLAYBACK_GAIN;
      source.connect(gain).connect(ctx.destination);
      source.start(0);
    } catch (err) {
      console.debug('🔇 Notification sound play error:', err);
    }
  };

  const cached = bufferCache.get(src);
  if (cached) {
    playFrom(cached);
  } else {
    loadBuffer(src).then(buf => { if (buf) playFrom(buf); });
  }
}

export default playNotificationSound;
