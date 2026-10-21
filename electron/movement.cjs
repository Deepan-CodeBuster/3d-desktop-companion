const { clampToArea } = require("./displays.cjs");

function normalizeMovement(value) {
  const x = Number.isFinite(value?.x) ? Math.max(-1, Math.min(1, value.x)) : 0;
  const y = Number.isFinite(value?.y) ? Math.max(-1, Math.min(1, value.y)) : 0;
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

function keyboardStep(bounds, movement, dt, displays) {
  if (!displays.length) return { x: bounds.x, y: bounds.y };
  const speed = 220 * Math.max(0, Math.min(dt, 0.05));
  const areas = displays.map((display) => display.workArea);
  const minX = Math.min(...areas.map((area) => area.x));
  const minY = Math.min(...areas.map((area) => area.y));
  const maxX = Math.max(...areas.map((area) => area.x + area.width));
  const maxY = Math.max(...areas.map((area) => area.y + area.height));
  const position = clampToArea({ ...bounds, x: bounds.x + movement.x * speed,
    y: bounds.y + movement.y * speed }, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  const center = { x: position.x + bounds.width / 2, y: position.y + bounds.height / 2 };
  if (displays.some(({ bounds: area }) => center.x >= area.x && center.x < area.x + area.width
    && center.y >= area.y && center.y < area.y + area.height)) return position;
  // Avoid losing the companion in empty gaps in staggered monitor layouts.
  const nearest = areas.reduce((best, area) => {
    const distance = Math.max(area.x - center.x, 0, center.x - area.x - area.width) ** 2
      + Math.max(area.y - center.y, 0, center.y - area.y - area.height) ** 2;
    return !best || distance < best.distance ? { area, distance } : best;
  }, null);
  return clampToArea({ ...bounds, ...position }, nearest.area);
}

module.exports = { normalizeMovement, keyboardStep };
