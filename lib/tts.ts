/**
 * lib/tts.ts — Unified Text-to-Speech Engine
 *
 * Routing:
 *   • English text  → Kokoro TTS (local ONNX model via kokoro-js, voice: af_heart)
 *   • Hindi (hi-IN)  → Web Speech API — Google हिन्दी (hi-IN) voice
 *   • Marathi (mr-IN) → Web Speech API — Google हिन्दी (hi-IN) voice (same model)
 *
 * Kokoro model is loaded lazily on the first English call so page load stays fast.
 * Language is auto-detected from Devanagari Unicode presence when not specified.
 */

import { KokoroTTS } from 'kokoro-js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SpeakOptions {
  /** Force a specific language: 'en', 'hi-IN', 'mr-IN' */
  lang?: string;
  /** Speech rate multiplier (default 1.0) — used by Web Speech API */
  rate?: number;
  /** Callback fired when the full utterance finishes */
  onEnd?: () => void;
  /** Callback fired if something goes wrong */
  onError?: (err: unknown) => void;
}

// ─── Module-level singletons ─────────────────────────────────────────────────

let kokoroInstance: InstanceType<typeof KokoroTTS> | null = null;
let kokoroLoading: Promise<InstanceType<typeof KokoroTTS>> | null = null;

/** Current audio element (Kokoro playback) so we can stop it */
let activeAudio: HTMLAudioElement | null = null;

/** Track whether Web Speech voices are loaded */
let webVoicesReady = false;
let webVoices: SpeechSynthesisVoice[] = [];

// Pre-load Web Speech voices as soon as this module is imported
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  const loadVoices = () => {
    webVoices = window.speechSynthesis.getVoices();
    if (webVoices.length > 0) webVoicesReady = true;
  };
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true when the text contains Devanagari characters (Hindi / Marathi) */
const containsDevanagari = (text: string): boolean =>
  /[\u0900-\u097F]/.test(text);

/** Detect language from text if not supplied */
const detectLang = (text: string, explicit?: string): string => {
  if (explicit) return explicit;
  return containsDevanagari(text) ? 'hi-IN' : 'en';
};

/** Lazily initialise the Kokoro model */
const getKokoro = async (): Promise<InstanceType<typeof KokoroTTS>> => {
  if (kokoroInstance) return kokoroInstance;

  // Avoid double-loading when multiple calls race
  if (!kokoroLoading) {
    const isWebGPU = typeof navigator !== 'undefined' && (navigator as any).gpu !== undefined;
    console.log(`[TTS] Initializing Kokoro TTS using ${isWebGPU ? 'WebGPU' : 'WASM'} mode...`);
    
    kokoroLoading = KokoroTTS.from_pretrained(
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      { 
         dtype: isWebGPU ? 'fp32' : 'q4', 
         device: isWebGPU ? 'webgpu' : 'wasm' 
      } as any
    ).then((tts) => {
      kokoroInstance = tts;
      return tts;
    });
  }

  return kokoroLoading;
};

/** Pick the best Web Speech voice for a given BCP-47 language tag */
const pickVoice = (lang: string): SpeechSynthesisVoice | undefined => {
  if (!webVoicesReady) {
    webVoices = window.speechSynthesis.getVoices();
    if (webVoices.length > 0) webVoicesReady = true;
  }

  // Prefer Google voices for quality
  const googleVoice = webVoices.find(
    (v) => v.lang === lang && v.name.toLowerCase().includes('google'),
  );
  if (googleVoice) return googleVoice;

  // Fallback: any voice matching the language
  const fallback = webVoices.find((v) => v.lang === lang);
  if (fallback) return fallback;

  // Wider match (prefix): e.g. 'hi' matches 'hi-IN'
  const prefix = lang.split('-')[0];
  return webVoices.find((v) => v.lang.startsWith(prefix));
};

// ─── Cancellation token ──────────────────────────────────────────────────────

let cancelGeneration = false;

// ─── Core speak() function ───────────────────────────────────────────────────

/**
 * Speak the given text using the appropriate TTS engine.
 *
 * ```ts
 * speak("Hello world");                         // auto-detects English → Kokoro
 * speak("नमस्ते", { lang: "hi-IN" });            // Hindi → Web Speech
 * speak("नमस्कार", { lang: "mr-IN" });           // Marathi → Web Speech
 * speak("Hello", { rate: 1.2, onEnd: () => {} });
 * speak.stop();                                  // cancel current playback
 * ```
 */
async function speak(text: string, options?: SpeakOptions): Promise<void> {
  // Always stop any ongoing speech first
  speak.stop();
  cancelGeneration = false;

  const lang = detectLang(text, options?.lang);

  // ── Hindi / Marathi → Web Speech API (Google हिन्दी hi-IN for both) ─────
  if (lang === 'hi-IN' || lang === 'mr-IN' || lang === 'hi' || lang === 'mr') {
    // Use Google हिन्दी (hi-IN) voice for BOTH Hindi and Marathi
    const voiceLang = 'hi-IN';

    return new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window)) {
        console.warn('[TTS] Web Speech API not supported in this browser');
        options?.onEnd?.();
        resolve();
        return;
      }

      // Cancel any leftovers
      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = voiceLang;
      utter.rate = options?.rate ?? 1.0;

      const voice = pickVoice(voiceLang);
      if (voice) utter.voice = voice;

      utter.onend = () => {
        options?.onEnd?.();
        resolve();
      };
      utter.onerror = (e) => {
        console.warn('[TTS] Web Speech error:', e);
        options?.onError?.(e);
        options?.onEnd?.();
        resolve();
      };

      window.speechSynthesis.speak(utter);
    });
  }

  // ── English → Kokoro TTS (local ONNX) ──────────────────────────────────
  try {
    const tts = await getKokoro();

    if (cancelGeneration) return; // user called stop() while model was loading

    // Chunk text by punctuation (sentences) to provide fast Time-To-First-Audio.
    const rawChunks = text.match(/[^.!?;]+[.!?;]?/g) || [text];
    const sentences = rawChunks.map(s => s.trim()).filter(s => s.length > 0);

    return new Promise<void>((resolve) => {
      let currentIndex = 0;
      let nextAudioBlobUrl: string | null = null;

      const generateChunk = async (idx: number): Promise<string | null> => {
        if (idx >= sentences.length || cancelGeneration) return null;
        try {
          const audio = await tts.generate(sentences[idx], { voice: 'af_heart' } as any);
          if (cancelGeneration) return null;
          return URL.createObjectURL((audio as any).toBlob());
        } catch (e) {
          console.warn('[TTS] Chunk generation failed', e);
          return null;
        }
      };

      const playCurrentAndPreloadNext = async () => {
        if (cancelGeneration) {
          if (nextAudioBlobUrl) URL.revokeObjectURL(nextAudioBlobUrl);
          return;
        }

        // Get URL for current chunk (either preloaded from previous iteration, or generate now)
        const urlToPlay = nextAudioBlobUrl || await generateChunk(currentIndex);
        if (cancelGeneration) return;

        if (!urlToPlay) {
          options?.onEnd?.();
          resolve();
          return;
        }

        // Start preloading the NEXT chunk immediately in the background
        let nextUrlPromise: Promise<string | null> | null = null;
        if (currentIndex + 1 < sentences.length) {
          nextUrlPromise = generateChunk(currentIndex + 1);
        }

        const el = new Audio(urlToPlay);
        activeAudio = el;
        if (options?.rate && options.rate !== 1) {
          el.playbackRate = options.rate;
        }

        el.onended = async () => {
          URL.revokeObjectURL(urlToPlay);
          activeAudio = null;
          currentIndex++;
          
          if (currentIndex >= sentences.length) {
            options?.onEnd?.();
            resolve();
          } else {
            // Await the prefetched chunk
            nextAudioBlobUrl = nextUrlPromise ? await nextUrlPromise : null;
            playCurrentAndPreloadNext();
          }
        };

        el.onerror = (e) => {
          URL.revokeObjectURL(urlToPlay);
          activeAudio = null;
          console.warn('[TTS] Kokoro playback error:', e);
          options?.onError?.(e);
          options?.onEnd?.();
          resolve();
        };

        el.play().catch((e) => {
          URL.revokeObjectURL(urlToPlay);
          activeAudio = null;
          console.warn('[TTS] Autoplay blocked:', e);
          options?.onError?.(e);
          options?.onEnd?.();
          resolve();
        });
      };

      // Start playback chain
      playCurrentAndPreloadNext();
    });
  } catch (err) {
    console.warn('[TTS] Kokoro generation failed, falling back to Web Speech:', err);

    // ── Fallback: Web Speech API for English too ────────────────────────
    return new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window)) {
        options?.onEnd?.();
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-US';
      utter.rate = options?.rate ?? 1.0;

      const voice = pickVoice('en-US') || pickVoice('en-GB');
      if (voice) utter.voice = voice;

      utter.onend = () => {
        options?.onEnd?.();
        resolve();
      };
      utter.onerror = () => {
        options?.onEnd?.();
        resolve();
      };

      window.speechSynthesis.speak(utter);
    });
  }
}

// ─── speak.stop() ────────────────────────────────────────────────────────────

speak.stop = (): void => {
  cancelGeneration = true;

  // Stop Kokoro playback
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = '';
    activeAudio = null;
  }

  // Stop Web Speech
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
};

export { speak };

// ─── Eager Preloading ────────────────────────────────────────────────────────
// Kick off the model download immediately so it's ready when the interview starts.
// WebAssembly init + 82MB fetch takes time, we don't want to block the first question.
if (typeof window !== 'undefined') {
  // Fire and forget
  getKokoro().catch((err) => {
    console.warn('[TTS] Background preload of Kokoro failed:', err);
  });
}
