import { createScreenSmash, screenSmashFrame } from "./smash-geometry.js";

const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");
let frame;

window.effects.onSmash(({ bounds, origin, seed }) => {
  cancelAnimationFrame(frame);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(bounds.width * dpr);
  canvas.height = Math.round(bounds.height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const geometry = createScreenSmash(bounds.width, bounds.height, origin, seed);
  const started = performance.now();
  const draw = () => {
    context.clearRect(0, 0, bounds.width, bounds.height);
    const state = screenSmashFrame(geometry, performance.now() - started);
    if (state.done) return;
    context.save();
    const glowRadius = 100 + state.progress * 420;
    const glow = context.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, glowRadius);
    glow.addColorStop(0, `rgba(255,240,165,${state.flash})`);
    glow.addColorStop(0.3, `rgba(158,242,79,${state.flash * 0.5})`);
    glow.addColorStop(1, "rgba(158,242,79,0)");
    context.fillStyle = glow;
    context.fillRect(origin.x - glowRadius, origin.y - glowRadius, glowRadius * 2, glowRadius * 2);

    for (const crack of geometry.cracks) {
      const count = Math.max(2, Math.ceil(crack.points.length * state.reveal));
      context.beginPath();
      crack.points.slice(0, count).forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.strokeStyle = `rgba(15,28,13,${state.crackOpacity * 0.8})`;
      context.lineWidth = crack.width + 3;
      context.stroke();
      context.strokeStyle = `rgba(187,239,112,${state.crackOpacity * 0.85})`;
      context.lineWidth = crack.width;
      context.stroke();
    }
    for (const ring of state.rings) {
      context.beginPath();
      context.arc(origin.x, origin.y, ring.radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(185,255,105,${ring.opacity})`;
      context.shadowColor = "#b7ff69";
      context.shadowBlur = 22;
      context.lineWidth = ring.width;
      context.stroke();
    }
    context.shadowBlur = 0;
    for (const piece of state.debris) {
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotation);
      context.globalAlpha = piece.opacity;
      context.fillStyle = "#7b8162";
      context.strokeStyle = "#d4d6aa";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(-piece.size, -piece.size * 0.4);
      context.lineTo(piece.size * 0.4, -piece.size);
      context.lineTo(piece.size, piece.size * 0.5);
      context.lineTo(-piece.size * 0.5, piece.size);
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
    }
    context.restore();
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
});
