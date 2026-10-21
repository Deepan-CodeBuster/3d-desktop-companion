export function createSmashSound({ makeAudio = (src) => new Audio(src) } = {}) {
  const impact = makeAudio("./sounds/hulk-smash.wav");
  const voice = makeAudio("./sounds/hulk-smash-voice.mp3");
  const clips = [impact, voice];
  clips.forEach((audio) => { audio.preload = "auto"; });
  impact.volume = 0.75;
  voice.volume = 1;
  const restart = (audio) => {
    audio.pause();
    audio.currentTime = 0;
    return audio.play();
  };
  return {
    play() {
      // Keep the words clear when the final syllable overlaps the landing.
      impact.volume = !voice.paused && !voice.ended ? 0.55 : 0.75;
      return restart(impact);
    },
    speak() { return restart(voice); },
    get speaking() { return !voice.paused && !voice.ended; },
    stop() { clips.forEach((audio) => { audio.pause(); audio.currentTime = 0; }); },
    dispose() { clips.forEach((audio) => { audio.pause(); audio.removeAttribute("src"); audio.load(); }); },
  };
}
