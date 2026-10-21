export const SCREEN_SMASH_MS = 1500;
const clamp = (value) => Math.max(0, Math.min(1, value));

export function createScreenSmash(width, height, origin, seed = 1) {
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const reach = Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y));
  const cracks = Array.from({ length: 22 }, (_, index) => {
    const angle = index * Math.PI * 2 / 22 + (random() - 0.5) * 0.18;
    const length = reach * (0.7 + random() * 0.3);
    const points = [{ x: origin.x, y: origin.y }];
    for (let i = 1; i <= 12; i++) {
      const radius = i / 12 * length;
      const turn = angle + (random() - 0.5) * 0.12;
      points.push({ x: origin.x + Math.cos(turn) * radius, y: origin.y + Math.sin(turn) * radius });
    }
    return { points, width: 1 + random() * 2.2 };
  });
  const debris = Array.from({ length: 44 }, () => {
    const angle = random() * Math.PI * 2;
    return { angle, speed: 120 + random() * Math.min(reach, 950), lift: 100 + random() * 220,
      size: 4 + random() * 16, spin: (random() - 0.5) * 18 };
  });
  return { width, height, origin, reach, cracks, debris };
}

export function screenSmashFrame(geometry, elapsed) {
  const progress = clamp(elapsed / SCREEN_SMASH_MS);
  const { origin, reach } = geometry;
  return {
    done: progress >= 1,
    progress,
    reveal: clamp(progress * 3.5),
    crackOpacity: (1 - progress) ** 1.4,
    flash: Math.exp(-progress * 24) * 0.75,
    rings: [0, 0.11, 0.22].map((delay) => {
      const phase = clamp((progress - delay) / 0.72);
      return { radius: 24 + reach * (1 - (1 - phase) ** 2),
        opacity: progress >= delay ? (1 - phase) * 0.75 : 0, width: 5 + (1 - phase) * 10 };
    }),
    debris: geometry.debris.map((piece) => ({
      ...piece,
      x: origin.x + Math.cos(piece.angle) * piece.speed * progress,
      y: origin.y + Math.sin(piece.angle) * piece.speed * progress * 0.32
        - Math.sin(progress * Math.PI) * piece.lift + progress * progress * 160,
      rotation: progress * piece.spin,
      opacity: (1 - progress) ** 1.7,
    })),
  };
}
