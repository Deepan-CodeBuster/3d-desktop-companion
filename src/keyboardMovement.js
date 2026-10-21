const MOVEMENT = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};
const GESTURES = { Space: "hop", KeyH: "wave" };

function keyCode(event) {
  if (MOVEMENT[event.code] || GESTURES[event.code]) return event.code;
  if (event.key === " " || event.key === "Spacebar") return "Space";
  if (event.key?.length === 1) return `Key${event.key.toUpperCase()}`;
  return event.key;
}

export function createKeyboardMovement(send, onGesture = () => {}) {
  const held = new Map();
  const gestures = new Set();
  const publish = () => {
    const directions = new Set(held.values());
    send({ x: Number(directions.has("right")) - Number(directions.has("left")),
      y: Number(directions.has("down")) - Number(directions.has("up")) });
  };
  return {
    keyDown(event) {
      const code = keyCode(event);
      if ((!MOVEMENT[code] && !GESTURES[code]) || event.altKey || event.ctrlKey || event.metaKey || event.isComposing
        || event.target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']")) return;
      event.preventDefault();
      if (GESTURES[code]) {
        if (event.repeat || gestures.has(code)) return;
        gestures.add(code);
        onGesture(GESTURES[code]);
        return;
      }
      if (held.has(code)) return;
      held.set(code, MOVEMENT[code]);
      publish();
    },
    keyUp(event) {
      const code = keyCode(event);
      if (gestures.delete(code)) { event.preventDefault(); return; }
      if (!held.delete(code)) return;
      event.preventDefault();
      publish();
    },
    reset() { held.clear(); gestures.clear(); publish(); },
  };
}
