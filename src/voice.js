// Atlas — voice input via the Web Speech API.
// Dictation straight into the composer. The constructor is injected
// so tests can pass a fake; in the app it is window.SpeechRecognition
// or window.webkitSpeechRecognition. When the browser has neither,
// supported is false and the UI says so plainly — nothing is faked.

export function isSpeechSupported() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createVoiceInput(deps = {}) {
  const Recognition = deps.Recognition
    ?? (typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : undefined);
  if (!Recognition) return { supported: false };

  let rec = null;
  let listening = false;

  return {
    supported: true,

    get listening() { return listening; },

    // callbacks: onResult(text, isFinal), onError(code), onEnd()
    start({ onResult, onError, onEnd } = {}) {
      if (listening) return false;
      try {
        rec = new Recognition();
      } catch (err) {
        onError?.('not-allowed');
        return false;
      }
      rec.lang = 'en-IN';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (event) => {
        const results = Array.from(event.results || []);
        const text = results.map((r) => r[0]?.transcript || '').join('');
        const isFinal = results.length ? Boolean(results[results.length - 1].isFinal) : false;
        onResult?.(text, isFinal);
      };
      rec.onerror = (event) => {
        listening = false;
        onError?.(event?.error || 'unknown');
      };
      rec.onend = () => {
        listening = false;
        onEnd?.();
      };
      try {
        rec.start();
      } catch (err) {
        onError?.('not-allowed');
        return false;
      }
      listening = true;
      return true;
    },

    stop() {
      if (!listening || !rec) return;
      try { rec.stop(); } catch (err) { /* already stopped */ }
    },
  };
}
