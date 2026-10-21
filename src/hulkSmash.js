import * as THREE from "three";

export const SMASH_DURATION = 2400;
export const SMASH_VOICE = 0.22;
export const SMASH_IMPACT = 0.64;
const smooth = (value, from, to) => THREE.MathUtils.smoothstep(value, from, to);

export function smashMotion(progress = 1) {
  const active = Number.isFinite(progress) && progress >= 0 && progress < 1;
  if (!active) return { active: false, raise: 0, slam: 0, lift: 0, tuck: 0, impact: 0, shock: 0 };
  const windup = smooth(progress, 0, 0.24);
  const strike = smooth(progress, 0.46, SMASH_IMPACT);
  const recover = smooth(progress, 0.78, 1);
  // A fast takeoff, a moment at the apex, then an accelerating fall into the hit.
  const ascent = 1 - Math.pow(1 - THREE.MathUtils.clamp((progress - 0.12) / 0.24, 0, 1), 2);
  const descent = Math.pow(THREE.MathUtils.clamp((progress - 0.4) / (SMASH_IMPACT - 0.4), 0, 1), 2);
  const lift = 1.3 * ascent * (1 - descent);
  const tuck = smooth(progress, 0.12, 0.3) * (1 - strike);
  const shock = THREE.MathUtils.clamp((progress - SMASH_IMPACT) / (1 - SMASH_IMPACT), 0, 1);
  return { active, raise: windup * (1 - strike), slam: strike * (1 - recover), lift, tuck,
    impact: progress >= SMASH_IMPACT ? Math.exp(-shock * 7) : 0, shock };
}

export function smashCamera(progress = 1) {
  const { lift } = smashMotion(progress);
  // Widen the frame during flight so the fists stay visible; restore it at landing.
  return { y: 0.05 + lift * 0.25, z: 8 + lift * 2.2 };
}

export function createSmashEffect(scene, floorY = -1.45) {
  const group = new THREE.Group();
  group.position.set(0, floorY + 0.025, 0.42);
  group.scale.z = 0.65;
  group.visible = false;
  scene.add(group);

  const rings = [0xb8fa63, 0xffdd96].map((color) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 64), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    return ring;
  });

  const cracks = [];
  for (let i = 0; i < 10; i++) {
    const angle = i * Math.PI * 2 / 10;
    const direction = (radius, turn = 0) => new THREE.Vector3(Math.cos(angle + turn) * radius, 0.006, Math.sin(angle + turn) * radius);
    cracks.push(direction(0.12), direction(0.38, 0.09), direction(0.38, 0.09), direction(0.68, -0.1),
      direction(0.38, 0.09), direction(0.51, 0.35));
  }
  const fissures = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cracks),
    new THREE.LineBasicMaterial({ color: 0x40552e, transparent: true, depthWrite: false }));
  group.add(fissures);

  const rockGeometry = new THREE.DodecahedronGeometry(0.055, 0);
  const rocks = Array.from({ length: 16 }, (_, i) => {
    const mesh = new THREE.Mesh(rockGeometry, new THREE.MeshStandardMaterial({
      color: i % 2 ? 0x7e8769 : 0xb0a68b, roughness: 1, transparent: true,
    }));
    mesh.scale.setScalar(0.65 + (i % 4) * 0.3);
    group.add(mesh);
    return mesh;
  });

  return {
    group,
    update(progress = 1) {
      const { active, impact, shock } = smashMotion(progress);
      group.visible = active && progress >= SMASH_IMPACT;
      if (!group.visible) return { x: 0, y: 0 };
      rings.forEach((ring, index) => {
        const spread = THREE.MathUtils.clamp(shock * 1.6 - index * 0.15, 0, 1);
        ring.scale.setScalar(0.15 + spread * 1.25);
        ring.material.opacity = (1 - spread) * (index ? 0.7 : 0.9);
      });
      fissures.scale.setScalar(0.5 + Math.min(shock * 5, 1) * 0.7);
      fissures.material.opacity = Math.min(shock * 14, 1) * (1 - smooth(shock, 0.45, 1));
      rocks.forEach((rock, index) => {
        const angle = index * Math.PI * 2 / rocks.length;
        const speed = 0.65 + (index % 5) * 0.1;
        const radius = 0.16 + shock * speed;
        rock.position.set(Math.cos(angle) * radius,
          Math.max(0, (1.3 + (index % 3) * 0.3) * shock - 2 * shock * shock), Math.sin(angle) * radius);
        rock.rotation.set(shock * (index + 3), shock * 8, shock * 5);
        rock.material.opacity = 1 - smooth(shock, 0.65, 1);
      });
      return { x: Math.sin(shock * 95) * 0.035 * impact, y: Math.cos(shock * 80) * 0.028 * impact };
    },
  };
}
