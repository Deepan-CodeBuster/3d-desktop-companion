function clampToArea(bounds, area) {
  return {
    x: Math.round(Math.max(area.x, Math.min(area.x + Math.max(0, area.width - bounds.width), bounds.x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + Math.max(0, area.height - bounds.height), bounds.y))),
  };
}

function dragPosition(cursor, offset) {
  // Both values come from Electron's DIP coordinates, including mixed-DPI displays.
  return { x: Math.round(cursor.x - offset.x), y: Math.round(cursor.y - offset.y) };
}

function nextDisplayPosition(bounds, displays, currentId) {
  const ordered = [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  if (!ordered.length) return { x: bounds.x, y: bounds.y };
  const index = ordered.findIndex((display) => display.id === currentId);
  const target = ordered[(index + 1) % ordered.length].workArea;
  return clampToArea({ ...bounds, x: target.x + target.width - bounds.width - 30,
    y: target.y + target.height - bounds.height - 20 }, target);
}

module.exports = { clampToArea, dragPosition, nextDisplayPosition };
