# Desktop Companion (Windows)

A transparent, always-on-top Windows desktop companion built with Electron, React, and Three.js. Choose **Deep** or **Hulk**, move between monitors, interact with the character, and have voice conversations using local Ollama and Whisper with ElevenLabs speech output.

## Run

1. Install Node.js LTS (includes npm) and Ollama.
2. Open PowerShell in this folder.
3. Run `npm install`.
4. If `.env.local` does not already exist, create it from `.env.example`, then enter your ElevenLabs API key. See [Voice configuration](#voice-configuration).
5. Run `npm run setup:stt` once to download and initialize the local Whisper model.
6. Install the chat model with `ollama pull qwen2.5:1.5b`. Keep Ollama running at `http://localhost:11434`; start the Ollama desktop app or run `ollama serve` if needed.
7. Run `npm run dev` to open the desktop companion.

Use the Electron desktop window for microphone access and movement between monitors. Fully close and restart the app after changing private configuration or files under `electron/`.

## Controls

The bottom bar contains **Speak**, **Chat**, and **×** to close the app, with a **Character** dropdown below. The selected character is remembered across restarts. Click the character to focus it before using keyboard controls.

| Control | Action |
| --- | --- |
| **Speak** | Start a voice conversation immediately; becomes **Stop** during the conversation. |
| **Chat** | Show or hide typed chat, the latest question and reply, and voice errors. |
| **×** | Close the companion and quit the app. |
| **Character** | Switch between Deep and Hulk. |
| **W / Up**, **S / Down** | Walk up or down. |
| **A / Left**, **D / Right** | Walk left or right. Combine directions to move diagonally. |
| **Space** with Deep | Hop. |
| **Space** with Hulk | Jump high, descend, and smash with both fists while saying **Hulk smash!** |
| **H** | Wave and say **Hello!** using ElevenLabs. |
| Click face, belly, hands, or legs | Trigger a reaction for that body part. |
| Drag the character | Move the companion across the desktop and between monitors. |
| Right-click | Open the tray menu for automatic walking, next screen, wake-word microphone, and Quit. |

Release movement keys to stop. Holding **Space** or **H** does not repeatedly trigger the gesture. Shortcuts preserve normal typing in Chat and operation of the character dropdown. A drag does not trigger a touch reaction. Both characters breathe and look around while idle; spoken touch reactions play when no voice conversation is active.

The companion window stays on top and receives mouse input. The separate smash overlay passes clicks through. Characters do not walk on the edges of other application windows.

## Hulk's jump and smash

Select **Hulk** and press **Space** for a 2.4-second action:

1. Hulk raises both fists, jumps high, and tucks his legs. The camera widens during flight to keep him visible.
2. He says **Hulk smash!** during the jump and accelerates downward into a two-fist ground strike.
3. At landing, a bass impact, concrete crack, camera shake, shockwaves, cracks, and flying debris play together. The screen effect spreads across the **entire current monitor**, anchored at his fists.
4. Hulk returns to standing. The transparent monitor effect clears automatically after about 1.5 seconds from impact and keeps keyboard focus on the companion.

The shout is a bundled ElevenLabs recording at `public/sounds/hulk-smash-voice.mp3`; the impact is a bundled 1.65-second sound at `public/sounds/hulk-smash.wav`. Both play locally without a new API request, so the smash voice and sound work offline. The impact volume is reduced while the shout overlaps it to keep the words clear.

Speech recognition pauses before the shout, stays paused through the landing sound, and then resumes the previous voice mode. Switching characters cancels the effect, shout, and impact sound.

To regenerate the shout with the voice in your private ElevenLabs configuration, run:

```powershell
node scripts/prepare-hulk-voice.cjs
```

This overwrites the bundled MP3 and uses ElevenLabs TTS credits. Restart the app after regeneration; rebuild before packaging. To regenerate the impact sound locally, run `node scripts/generate-smash-sound.mjs`.

## Talk to Deep

Keep Ollama running at `http://localhost:11434` with `qwen2.5:1.5b` installed. If needed, run `ollama pull qwen2.5:1.5b` and `ollama serve` (the Ollama desktop app normally starts the service). Deep uses this exact local model; it does not switch to a cloud model.

Click **Speak** to start a voice conversation immediately, without a wake phrase. Speak your question, pause, and Deep sends the recognized text to Ollama and reads the reply aloud with **ElevenLabs**. Once the reply finishes, **Listening to you...** appears again: ask your next question without pressing Speak again. Speak also works when hands-free wake monitoring is turned off. The conversation ends after one minute without speech, when you click **Stop**, or when you say **stop listening** or **goodbye**.

Recognized questions and replies appear in the speech bubble, which hides two seconds after each update. Open **Chat** to read the latest question and reply for longer. While listening, the blue microphone meter should move when you talk. If no sound reaches the app, a hint points you to your default Windows input device and microphone volume. After you pause for roughly 1.3–1.7 seconds, **Transcribing your words...** appears while Whisper processes the audio.

For hands-free use, the desktop app also listens for **Hey Deep**. Toggle this through **Toggle Hey Deep microphone** in the tray menu. Ordinary background speech does not reach Ollama or launch a browser while waiting for the wake phrase.

- Say **Hey Deep, what is a rainbow?** to ask and hear a reply.
- Or say **Hey Deep**, wait for **Yes? I'm listening**, then ask your question.
- Say **Hey Deep, open Google and search for nearby coffee shops** to open that search in your default browser.
- Say **Hey Deep, open Google**, **wave**, **start walking**, **stop walking**, **jump**, or **move to the other monitor** for those actions.
- Deep listens again after each spoken reply. The Speak control becomes **Stop** throughout the conversation; click it to cancel a reply and end the session. After the session ends, Deep waits for **Hey Deep**, or turns the microphone off if wake monitoring is disabled.
- Click **Chat** to type directly, including when the microphone is off. Typed requests do not require the wake phrase.

Spoken questions use **Whisper base.en**, quantized and running on the laptop's CPU in a background worker. The model downloads from Hugging Face once, then uses `.cache/whisper` in development or the application's user data directory when packaged. Microphone audio stays in memory on this computer and is not uploaded for transcription. Windows `System.Speech` still detects **Hey Deep**, captures microphone speech, and separates utterances; both accepted and rejected dictation audio are passed to Whisper. Questions spoken together with the wake phrase also go through Whisper once Windows detects the wake phrase. Native Windows dictation guesses and confidence scores do not decide the question's final text.

Ollama chat remains local. Replies, Hello greetings, and touch-reaction text are sent to ElevenLabs for speech generation, so these spoken responses require internet access and available account credits. The bundled Hulk shout and impact sound work offline. Microphone input pauses while Deep transcribes, thinks, generates audio, and plays the reply; playback completion is acknowledged before listening resumes.

The assistant keeps the last six conversation exchanges in memory until the app closes. Google commands open searches, but Deep does not read the results page. Model replies cannot launch arbitrary programs or execute terminal commands.

## Voice configuration

The default ElevenLabs voice is **George** (`JBFqnCBsd6RMkjVDRZzb`) with `eleven_flash_v2_5`. Configure the private `.env.local` file using [.env.example](.env.example):

```dotenv
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
```

The API key is read only by the Electron main process from environment variables or `.env.local`. The private file is ignored by Git and excluded from the packaged application. It is not exposed through the renderer, preload bridge, or audio packets. `.env.example` documents `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and `ELEVENLABS_MODEL_ID` without containing a key. Environment variables override the file. Packaged installations can use environment variables or a private `.env.local` inside the application's user data directory.

Run `npm run setup:voice` for a short live API check that writes `artifacts/deep-elevenlabs-sample.mp3`. This generates a short sample using the account's TTS quota. Changing the configured voice affects newly generated speech; regenerate Hulk's bundled shout separately with `node scripts/prepare-hulk-voice.cjs`.

## Troubleshooting

If the microphone is unavailable, check your default Windows input device and microphone access for desktop apps. An English Windows speech recognition language pack must be installed. API failures, account restrictions, and voice-access errors are shown in the companion; typed chat remains available. The key needs text-to-speech permission. Restart the Electron app after changing private configuration or files under `electron/`.

## Multiple monitors

Drag the character across monitor edges, including to displays positioned left of or above the laptop. Dragging uses Electron's desktop coordinates to accommodate different display scaling. On release, the character is kept inside the destination display's work area. Use **Move to next screen** in the tray menu to cycle through screens. Keyboard movement can cross monitor boundaries; automatic walking stays on the current display. If a monitor is disconnected, Deep returns to an available display.

## Checks

Run `npm test` for Speak capture, wake-word gating, explicit search commands, cancellation, ElevenLabs requests and playback, keyboard shortcuts, monitor positioning, touch regions, and character animation. Hulk checks cover the high jump, airborne feet, descent, ground contact, camera framing, shout/impact playback, and full-monitor effect cleanup. Tests use simulated API responses and do not consume ElevenLabs credits. Run `npm run build` to build the renderer and copy the models and bundled sounds into `dist/`. `npm run setup:voice` is the optional live API check.

On Windows, `node scripts/check-speech.cjs` briefly opens the default microphone to verify real wake, pause, and repeated conversation capture transitions. It saves no recordings and prints no recognized microphone input.

`node scripts/check-stt.cjs` creates four synthetic speech fixtures in `.cache/stt-fixtures` and transcribes them through the real local Whisper model, checking question, Google command, follow-up, and combined wake phrase text. It does not record the microphone or use ElevenLabs credits. Accuracy with a user's voice still depends on microphone quality, accent, background noise, and the English-only model.

`node scripts/preview-hulk.mjs` writes an offline geometry preview of takeoff, the high jump, descent, impact, and recovery to `artifacts/hulk-actions.png`. It is a model preview, not a screenshot of the running desktop app.

API references: [ElevenLabs text to speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), [Ollama chat](https://docs.ollama.com/api/chat), [Electron display coordinates](https://www.electronjs.org/docs/latest/api/screen), and [Windows speech recognition](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine).

## Installer

Run `npm run dist` to build the renderer and generate a Windows installer in `release/`. Run packaging on Windows. The models, Hulk shout, and impact sound are bundled; configure ElevenLabs credentials separately on the installed machine and allow the local Whisper model to download on first use.

## Notes

Hulk uses `public/models/hulk.glb`, including its embedded texture and humanoid rig. Walking, waving, touch reactions, and the jumping smash are animated procedurally; the original supplied `Hulk.fbx` is retained. Both characters share the same speech assistant, **Hey Deep** wake phrase, and desktop movement. The GLB's embedded author and license information is preserved; see [Hulk attribution](public/models/ATTRIBUTION.md).

The original Deep model, `companion.fbx`, has no embedded animation clips. Its bones are animated procedurally by `src/companionAnimation.js`, so no extra animation files are needed. External textures not embedded in an FBX may require additional files.

## V2 improvements

Deep's procedural animation targets the outer joint bones, allowing the FBX's duplicate skinning bones to follow consistently across the body, clothes, hair, and shoes. Rotations account for each joint's exported orientation. Walking and direction stay synchronized with keyboard and tray controls. The browser preview is for visual inspection; desktop movement and voice controls require Electron. Deep receives a non-metallic stylized material palette; these colors are approximations of the supplied FBX's appearance. Hulk retains his embedded GLB texture.
