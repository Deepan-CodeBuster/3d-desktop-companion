import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCompanionAnimator } from "./companionAnimation.js";
import { REACTIONS, createCharacterPicker } from "./reactions.js";
import { createSpeechPlayback } from "./speechPlayback.js";
import { createKeyboardMovement } from "./keyboardMovement.js";
import { CHARACTERS, getCharacter, savedCharacter } from "./characters.js";
import { createSmashEffect, smashCamera, SMASH_IMPACT, SMASH_VOICE } from "./hulkSmash.js";
import { createSmashSound } from "./smashSound.js";

const PALETTE = {
  head: 0xf2c7aa,
  hands: 0xf2c7aa,
  legs: 0xf2c7aa,
  hair: 0x4b3540,
  eyes: 0x352b34,
  eyebrows: 0x47333b,
  eyelash: 0x302631,
  shorts: 0x50698b,
  shoes: 0xf3f1ec,
  plush: 0x5b92b5,
  zipper: 0xd3dae3,
};

const getColor = (name) => {
  const match = Object.entries(PALETTE).find(([key]) =>
    name.toLowerCase().includes(key)
  );
  return match?.[1] ?? 0x7b9db7;
};

function disposeModel(model) {
  const resources = new Set();
  model.traverse((object) => {
    if (!object.geometry && !object.material) return;
    if (object.geometry) resources.add(object.geometry);
    if (object.skeleton) resources.add(object.skeleton);
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => {
      if (!material) return;
      resources.add(material);
      Object.values(material).forEach((value) => {
        if (value?.isTexture) resources.add(value);
      });
    });
  });
  resources.forEach((resource) => {
    resource?.dispose();
    if (resource?.isTexture) resource.source?.data?.close?.();
  });
}

export default function App() {
  const mount = useRef(null);
  const drag = useRef(null);
  const pickCharacter = useRef(null);
  const lastReplyId = useRef(0);
  const lastNoticeId = useRef(0);
  const lastTranscript = useRef("");
  const lastPhase = useRef("");
  const smashSound = useRef(null);
  const controller = useRef({
    walking: false,
    direction: 1,
    heading: null,
    waveUntil: 0,
    jumpStartedAt: -Infinity,
    smashStartedAt: -Infinity,
    speaking: false,
    listening: false,
    reaction: null,
  });
  const [speech, updateSpeech] = useState({ text: "Loading your buddy...", id: 0 });
  const [bubbleVisible, setBubbleVisible] = useState(true);
  const setSpeech = useCallback((text) => {
    updateSpeech((previous) => ({ text, id: previous.id + 1 }));
  }, []);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [characterId, setCharacterId] = useState(() => {
    try { return savedCharacter(window.localStorage); } catch { return "deep"; }
  });
  const characterProfile = getCharacter(characterId);
  const [assistantState, setAssistantState] = useState({
    enabled: !!window.desktop, phase: window.desktop ? "starting" : "off",
    transcript: "", reply: "", error: "", recognitionError: "",
  });
  const [chatOpen, setChatOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [requestError, setRequestError] = useState("");
  const busy = ["transcribing", "thinking", "synthesizing", "speaking"].includes(assistantState.phase);
  const voiceActive = busy || assistantState.conversationActive;

  const performSpecial = useCallback(() => {
    const profile = getCharacter(characterId);
    const field = profile.special === "smash" ? "smashStartedAt" : "jumpStartedAt";
    const now = performance.now();
    if (now - controller.current[field] < profile.duration) return;
    controller.current[field] = now;
    if (profile.special === "smash") {
      window.desktop?.beginSmash?.();
      setSpeech("Hulk smash!");
    }
  }, [characterId, setSpeech]);

  useEffect(() => {
    setBubbleVisible(true);
    const timer = setTimeout(() => setBubbleVisible(false), 2000);
    return () => clearTimeout(timer);
  }, [speech.id, error]);

  useEffect(() => {
    const sound = createSmashSound();
    smashSound.current = sound;
    return () => { sound.dispose(); smashSound.current = null; };
  }, []);

  useEffect(() => {
    if (!window.desktop) return;
    const playback = createSpeechPlayback({ finish: (id, failure) => window.desktop.finishSpeech(id, failure) });
    const unsubscribeAudio = window.desktop.onSpeechAudio((packet) => playback.play(packet));
    const unsubscribeCancel = window.desktop.onSpeechCancel(() => playback.cancel());
    return () => { unsubscribeAudio(); unsubscribeCancel(); playback.dispose(); };
  }, []);

  useEffect(() => {
    if (!ready || !window.desktop) return;
    const keyboard = createKeyboardMovement((value) => window.desktop.setMovement(value), (action) => {
      const now = performance.now();
      if (action === "wave") {
        controller.current.waveUntil = now + 2400;
        setSpeech("Hello! \u{1f44b}");
        void window.desktop.react("Hello!").catch((failure) => setRequestError(failure.message));
      }
      if (action === "hop") performSpecial();
    });
    window.addEventListener("keydown", keyboard.keyDown);
    window.addEventListener("keyup", keyboard.keyUp);
    window.addEventListener("blur", keyboard.reset);
    return () => {
      window.removeEventListener("keydown", keyboard.keyDown);
      window.removeEventListener("keyup", keyboard.keyUp);
      window.removeEventListener("blur", keyboard.reset);
      keyboard.reset();
    };
  }, [ready, setSpeech, performSpecial]);

  useEffect(() => {
    if (!window.desktop) return;
    let mounted = true;
    const applyState = (state) => {
      if (!mounted) return;
      const previousPhase = lastPhase.current;
      lastPhase.current = state.phase;
      setAssistantState(state);
      if (state.phase === "thinking") setRequestError("");
      controller.current.speaking = state.phase === "speaking";
      const wasListening = controller.current.listening;
      controller.current.listening = state.phase === "listening";
      if (state.phase === "thinking" && state.transcript && state.transcript !== lastTranscript.current) {
        lastTranscript.current = state.transcript;
        setSpeech(`I heard: ${state.transcript}`);
      }
      if (state.phase === "listening") {
        if (state.transcript) setSpeech(`I heard: ${state.transcript}`);
        else if (!wasListening && previousPhase !== "transcribing") setSpeech("I'm listening. Go ahead!");
      }
      if (state.reply && state.replyId !== lastReplyId.current) {
        setRequestError("");
        lastReplyId.current = state.replyId;
        setSpeech(state.reply);
      }
      if (state.notice && state.noticeId !== lastNoticeId.current) {
        lastNoticeId.current = state.noticeId;
        setSpeech(state.notice);
      }
    };
    const unsubscribe = window.desktop.onAssistantState(applyState);
    const unsubscribeAction = window.desktop.onAction((action) => {
      if (action === "wave") controller.current.waveUntil = performance.now() + 2400;
      if (action === "hop") performSpecial();
    });
    window.desktop.getAssistantState().then(applyState).catch((failure) => {
      if (mounted) setRequestError(failure.message);
    });
    return () => { mounted = false; unsubscribe(); unsubscribeAction(); };
  }, [performSpecial]);

  useEffect(() => {
    return window.desktop?.onWalkingChanged?.((state) => {
      controller.current.walking = state.walking;
      controller.current.direction = state.direction;
      controller.current.heading = state.heading ?? null;
    });
  }, []);

  useEffect(() => {
    const host = mount.current;
    const profile = getCharacter(characterId);
    setReady(false);
    setError("");
    setSpeech(`Loading ${profile.name}...`);
    pickCharacter.current = null;
    controller.current.jumpStartedAt = -Infinity;
    controller.current.smashStartedAt = -Infinity;
    controller.current.reaction = null;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 340 / 450, 0.01, 1000);
    camera.position.set(0, 0.05, 8);
    camera.lookAt(0, 0.05, 0);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setError("Unable to start the 3D character. Please enable hardware acceleration.");
      return;
    }
    renderer.setClearColor(0, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(340, 450);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x7b8ca0, 2.1));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(3, 5, 6);
    scene.add(light);

    // Keep a foot-level pivot so turns and hops move the entire character.
    const character = new THREE.Group();
    const floorY = profile.id === "hulk" ? -1.18 : -1.45;
    character.position.y = floorY;
    scene.add(character);
    const smashEffect = profile.special === "smash" ? createSmashEffect(scene, character.position.y) : null;
    if (smashEffect) window.desktop?.prepareSmash?.();

    let raf;
    let animator;
    let disposed = false;
    let lastImpact = -Infinity;
    let lastVoice = -Infinity;
    const clock = new THREE.Clock();

    const loaded = (fbx) => {
        if (disposed) {
          disposeModel(fbx);
          return;
        }
        character.add(fbx);
        fbx.traverse((object) => {
          if (!object.isMesh) return;
          object.frustumCulled = false;
          // Hulk's GLB embeds its authored skin/clothing texture and materials.
          if (profile.id === "hulk") return;
          const original = Array.isArray(object.material)
            ? object.material
            : [object.material];
          const makeMaterial = (material) => new THREE.MeshStandardMaterial({
            color: material?.map ? 0xffffff : getColor(object.name),
            map: material?.map || null,
            transparent: !!material?.transparent,
            opacity: material?.opacity ?? 1,
            side: THREE.DoubleSide,
            metalness: 0,
            roughness: 0.9,
          });
          object.material = Array.isArray(object.material)
            ? original.map(makeMaterial)
            : makeMaterial(original[0]);
          original.forEach((material) => material?.dispose());
        });

        character.position.y = 0;
        fbx.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(fbx);
        if (box.isEmpty()) {
          setError("The character model contains no visible geometry.");
          return;
        }
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const factor = 2.9 / Math.max(size.x, size.y, size.z, 0.001);
        fbx.position.set(-center.x, -box.min.y, -center.z).multiplyScalar(factor);
        fbx.scale.multiplyScalar(factor);
        character.position.y = floorY;
        animator = createCompanionAnimator(fbx, character, { profile: profile.id });
        const pick = createCharacterPicker(fbx, character, camera, { wholeBody: profile.id === "hulk" });
        pickCharacter.current = (clientX, clientY) => {
          return pick(clientX, clientY, renderer.domElement.getBoundingClientRect());
        };
        controller.current.waveUntil = performance.now() + 2400;
        setSpeech(profile.id === "hulk" ? "Hulk ready. Space to smash!" : "Hi there! \u{1f44b}");
        setReady(true);
    };
    const loadFailed = () => {
      if (!disposed) setError(`Couldn't load ${profile.name}. Choose another character or try again.`);
    };
    if (profile.format === "gltf") {
      new GLTFLoader().load(profile.path, (gltf) => loaded(gltf.scene), undefined, loadFailed);
    } else {
      new FBXLoader().load(profile.path, loaded, undefined, loadFailed);
    }

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const now = performance.now();
      const state = controller.current;
      const smashProgress = THREE.MathUtils.clamp((now - state.smashStartedAt) / profile.duration, 0, 1);
      if (smashEffect && smashProgress >= SMASH_VOICE && smashProgress < 1 && state.smashStartedAt !== lastVoice) {
        lastVoice = state.smashStartedAt;
        void smashSound.current?.speak().catch((failure) => setRequestError(`Hulk voice: ${failure.message}`));
      }
      if (smashEffect && smashProgress >= SMASH_IMPACT && smashProgress < 1 && state.smashStartedAt !== lastImpact) {
        lastImpact = state.smashStartedAt;
        window.desktop?.smash?.();
        void smashSound.current?.play().catch((failure) => setRequestError(`Smash sound: ${failure.message}`));
      }
      animator?.update(dt, {
        walking: state.walking,
        waving: now < state.waveUntil,
        jumpProgress: THREE.MathUtils.clamp((now - state.jumpStartedAt) / 900, 0, 1),
        smashProgress,
        direction: state.direction,
        heading: state.heading,
        roaming: !window.desktop,
        speaking: state.speaking || (profile.id === "hulk" && !!smashSound.current?.speaking),
        listening: state.listening,
        reaction: state.reaction ? {
          region: state.reaction.region,
          progress: THREE.MathUtils.clamp((now - state.reaction.startedAt) / 1100, 0, 1),
        } : null,
      });
      const shake = smashEffect?.update(smashProgress);
      const framing = smashCamera(smashEffect ? smashProgress : 1);
      camera.position.x = shake?.x || 0;
      camera.position.y = framing.y + (shake?.y || 0);
      camera.position.z = framing.z;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      if (smashEffect) {
        smashSound.current?.stop();
        window.desktop?.cancelSmash?.();
      }
      pickCharacter.current = null;
      cancelAnimationFrame(raf);
      disposeModel(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [characterId, setSpeech]);

  const reactToTouch = (clientX, clientY) => {
    const region = pickCharacter.current?.(clientX, clientY);
    if (!region) return;
    const now = performance.now();
    if (controller.current.reaction && now - controller.current.reaction.startedAt < 350) return;
    controller.current.reaction = { region, startedAt: now };
    if (region.startsWith("hand")) controller.current.waveUntil = now + 1200;
    const responses = REACTIONS[region];
    const response = responses[Math.floor(Math.random() * responses.length)];
    if (!voiceActive) {
      setSpeech(response);
      window.desktop?.react(response).catch((failure) => setRequestError(failure.message));
    }
  };

  const submitMessage = async (event) => {
    event.preventDefault();
    if (!message.trim() || busy) return;
    if (!window.desktop) {
      setRequestError("Open the desktop app with npm run dev to talk to Deep.");
      return;
    }
    const text = message.trim();
    setMessage("");
    setRequestError("");
    try {
      const state = await window.desktop.ask(text);
      if (state.error) setRequestError(state.error);
    } catch (failure) { setRequestError(failure.message); }
  };

  const beginSpeak = async () => {
    setRequestError("");
    try {
      const state = await window.desktop?.beginListening();
      if (state?.error) setRequestError(state.error);
    } catch (failure) { setRequestError(failure.message); }
  };

  const stopReply = async () => {
    setRequestError("");
    try { await window.desktop?.stopReply(); }
    catch (failure) { setRequestError(failure.message); }
  };

  const stopDragging = (event, cancelled = false) => {
    const previous = drag.current;
    drag.current = null;
    window.desktop?.endDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && previous && !previous.moved) reactToTouch(event.clientX, event.clientY);
  };

  const status = {
    starting: "Starting voice...", wake: 'Say "Hey Deep"', listening: "Listening to you...",
    transcribing: "Transcribing your words...", thinking: "Thinking...", synthesizing: "Preparing voice...", speaking: "Speaking...", off: "Microphone off", error: "Voice unavailable",
    effect: "Hulk smash!",
  }[assistantState.phase] || "Deep";
  const assistantError = requestError || assistantState.error || assistantState.recognitionError;

  return (
    <div
      className="app"
      tabIndex={0}
      aria-label={`${characterProfile.name} desktop companion. WASD or arrow keys move, Space ${characterProfile.special === "smash" ? "smashes" : "hops"}, and H waves.`}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target.closest("button, input, select, label, .bubble, .chat-panel")) return;
        event.currentTarget.focus({ preventScroll: true });
        drag.current = { x: event.screenX, y: event.screenY, moved: false };
        window.desktop?.startDrag();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        if (Math.hypot(event.screenX - drag.current.x, event.screenY - drag.current.y) > 5) {
          drag.current.moved = true;
        }
        if (drag.current.moved) window.desktop?.updateDrag();
      }}
      onPointerUp={stopDragging}
      onPointerCancel={(event) => stopDragging(event, true)}
      onLostPointerCapture={() => { drag.current = null; window.desktop?.endDrag(); }}
      onContextMenu={(event) => {
        event.preventDefault();
        window.desktop?.menu();
      }}
    >
      {bubbleVisible && <div className="bubble" role="status">{error || speech.text}</div>}
      <div ref={mount} className="model" />
      {!assistantError && !["wake", "off"].includes(assistantState.phase) &&
        <div className="speech-status" data-phase={assistantState.phase} role="status">
          <span className="voice-dot" /> {status}
          {assistantState.phase === "listening" && <span className="mic-meter" role="meter"
            aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={assistantState.audioLevel || 0}>
            <span style={{ width: `${assistantState.audioLevel || 0}%` }} />
          </span>}
        </div>}
      {assistantState.phase === "listening" && assistantState.microphoneWarning && !chatOpen &&
        <div className="mic-hint" role="status">{assistantState.microphoneWarning}</div>}
      {assistantError && !chatOpen && <button className="assistant-error" onClick={() => setChatOpen(true)}>
        {assistantError}
      </button>}
      {chatOpen && <section className="chat-panel" aria-label="Talk with Deep">
        <p className="chat-hint">Click <strong>Speak</strong> or say <strong>Hey Deep</strong>. Wait for each reply, then speak again. Say <strong>stop listening</strong> to finish.</p>
        {(assistantState.transcript || assistantState.lastUserText) &&
          <p className="heard">You: {assistantState.transcript || assistantState.lastUserText}</p>}
        {assistantState.reply && <p className="chat-reply">Deep: {assistantState.reply}</p>}
        {assistantError && <p className="chat-error" role="alert">{assistantError}</p>}
        {assistantState.microphoneWarning && <p className="chat-hint">{assistantState.microphoneWarning}</p>}
        <form onSubmit={submitMessage}>
          <input aria-label="Message Deep" placeholder="Ask Deep or search Google..." value={message}
            onChange={(event) => setMessage(event.target.value)} maxLength={4000} />
          <button type="submit" disabled={busy || !message.trim()}>Send</button>
        </form>
      </section>}
      <div className="controls" data-character={characterId}>
       <div className="actions">
        <button className="speak-button" onClick={voiceActive ? stopReply : beginSpeak}
          disabled={!window.desktop} aria-pressed={!!assistantState.conversationActive}
          title={voiceActive ? "Stop the voice conversation" : "Start a voice conversation"}>
          {voiceActive ? "\u25a0 Stop" : "\u{1f399} Speak"}
        </button>
        <button onClick={() => setChatOpen(!chatOpen)} aria-expanded={chatOpen}>Chat</button>
        <button className="close-button" onClick={() => window.desktop?.quit()}
          disabled={!window.desktop} aria-label="Close Deep" title="Close Deep">×</button>
       </div>
       <label className="character-picker">
         <span>Character</span>
         <select aria-label="Choose character" value={characterId} onChange={(event) => {
           const id = getCharacter(event.target.value).id;
           setCharacterId(id);
           try { window.localStorage.setItem("deep.character", id); } catch { /* Preference storage is optional. */ }
           event.currentTarget.closest(".app")?.focus({ preventScroll: true });
         }}>
           {CHARACTERS.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
         </select>
       </label>
      </div>
    </div>
  );
}
