export function createSpeechPlayback({ finish, makeAudio = (url) => new Audio(url),
  makeUrl = (audio, mimeType) => URL.createObjectURL(new Blob([audio], { type: mimeType })),
  revokeUrl = (url) => URL.revokeObjectURL(url) }) {
  let current = null;
  const clear = () => {
    if (!current) return;
    const previous = current;
    current = null;
    previous.audio.onended = null;
    previous.audio.onerror = null;
    previous.audio.pause();
    previous.audio.removeAttribute("src");
    revokeUrl(previous.url);
  };
  return {
    play({ id, audio: bytes, wav, mimeType = "audio/wav" }) {
      clear();
      const url = makeUrl(bytes ?? wav, mimeType);
      const audio = makeAudio(url);
      const item = { id, url, audio };
      current = item;
      const complete = (error = "") => {
        if (current !== item) return;
        clear();
        finish(id, error);
      };
      audio.onended = () => complete();
      audio.onerror = () => complete("Unable to play speech audio. Check your audio output device.");
      audio.play().catch((error) => complete(error.message));
    },
    cancel: clear,
    dispose() {
      if (current) finish(current.id, "Speech playback closed.");
      clear();
    },
  };
}
