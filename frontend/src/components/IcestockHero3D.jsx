import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * A self-contained, dependency-light 3D hero scene: an icestock ("Eisstock" —
 * the weighted, handled puck used in the sport) gliding across an ice lane
 * toward the concentric target rings, per the Team/Individual Target
 * discipline. Built with plain three.js (no react-three-fiber) to keep the
 * bundle small and the failure surface minimal on a free-tier deploy.
 *
 * Fully self-cleaning: cancels its animation loop and disposes every
 * geometry/material/texture on unmount so navigating away doesn't leak
 * WebGL contexts (a real risk with client-side routing).
 */
export default function IcestockHero3D({ height = 420 }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const heightPx = height;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1b2b, 14, 34);

    const camera = new THREE.PerspectiveCamera(42, width / heightPx, 0.1, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, heightPx);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // ---- Lighting: cool arena floodlight + warm accent, matching the
    // "Arctic Arena" brand palette (ice cyan / signal orange). ----
    scene.add(new THREE.AmbientLight(0x203449, 1.1));
    const flood = new THREE.DirectionalLight(0xbfe9fb, 1.4);
    flood.position.set(6, 10, 4);
    scene.add(flood);
    const accent = new THREE.PointLight(0xff7a45, 6, 18);
    accent.position.set(-3, 2.5, 3);
    scene.add(accent);

    // ---- Ice lane ----
    const iceGeo = new THREE.PlaneGeometry(11, 24, 40, 80);
    const iceMat = new THREE.MeshPhysicalMaterial({
      color: 0x123449,
      metalness: 0.25,
      roughness: 0.12,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
      reflectivity: 0.6,
    });
    const ice = new THREE.Mesh(iceGeo, iceMat);
    ice.rotation.x = -Math.PI / 2;
    ice.position.y = 0;
    scene.add(ice);

    // Lane boundary lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0x5fd3f3, transparent: true, opacity: 0.35 });
    [-5, 5].forEach((x) => {
      const points = [new THREE.Vector3(x, 0.02, -12), new THREE.Vector3(x, 0.02, 12)];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      scene.add(new THREE.Line(geo, lineMat));
    });

    // ---- Target rings (2 / 4 / 6 / 8 / 10 scoring zones) ----
    const targetGroup = new THREE.Group();
    const ringColors = [0x1e3a52, 0x2e5a6e, 0x5fd3f3, 0xeaf6fb, 0xff7a45];
    const radii = [4.2, 3.3, 2.4, 1.5, 0.65];
    radii.forEach((r, i) => {
      const ringGeo = new THREE.RingGeometry(i === radii.length - 1 ? 0 : radii[i + 1] || 0, r, 64);
      const ringMat = new THREE.MeshStandardMaterial({
        color: ringColors[i],
        side: THREE.DoubleSide,
        roughness: 0.5,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(ringGeo, ringMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.01 + i * 0.001;
      targetGroup.add(mesh);
    });
    targetGroup.position.set(0, 0, -8);
    scene.add(targetGroup);

    // ---- The icestock (weighted disc + handle) ----
    function buildStock(color) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.85, 0.95, 0.5, 32),
        new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 })
      );
      group.add(body);
      const spindle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.14, 0.55, 16),
        new THREE.MeshStandardMaterial({ color: 0x0b1b2b, roughness: 0.5 })
      );
      spindle.position.y = 0.45;
      group.add(spindle);
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.08, 12, 32),
        new THREE.MeshStandardMaterial({ color: 0xeaf6fb, roughness: 0.3, metalness: 0.5 })
      );
      handle.rotation.x = Math.PI / 2;
      handle.position.y = 0.72;
      group.add(handle);
      return group;
    }

    const slidingStock = buildStock(0xff7a45);
    slidingStock.position.set(1.1, 0.25, 10);
    scene.add(slidingStock);

    const restingStock = buildStock(0x5fd3f3);
    restingStock.position.set(-0.6, 0.25, -7.4);
    restingStock.rotation.y = 0.6;
    scene.add(restingStock);

    // ---- Ambient sparkle particles ----
    const sparkleCount = 160;
    const positions = new Float32Array(sparkleCount * 3);
    for (let i = 0; i < sparkleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 1] = Math.random() * 5 + 0.2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 26;
    }
    const sparkleGeo = new THREE.BufferGeometry();
    sparkleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const sparkleMat = new THREE.PointsMaterial({
      color: 0xbfe9fb,
      size: 0.045,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparkles = new THREE.Points(sparkleGeo, sparkleMat);
    scene.add(sparkles);

    camera.position.set(0, 6.5, 15);
    camera.lookAt(0, 0, -3);

    // ---- Animation loop ----
    let frameId;
    const clock = new THREE.Clock();
    const SLIDE_DURATION = 3.2;
    const HOLD_DURATION = 1.4;
    const CYCLE = SLIDE_DURATION + HOLD_DURATION;

    function animate() {
      const elapsed = clock.getElapsedTime();

      // Slow cinematic orbit around the scene.
      const angle = elapsed * 0.08;
      camera.position.x = Math.sin(angle) * 15;
      camera.position.z = Math.cos(angle) * 15 + 2;
      camera.position.y = 6.5 + Math.sin(elapsed * 0.15) * 0.6;
      camera.lookAt(0, 0.3, -4);

      // Sliding stock: eased travel from the throw line to the target, holds, then resets.
      const t = elapsed % CYCLE;
      if (t < SLIDE_DURATION) {
        const progress = t / SLIDE_DURATION;
        const eased = 1 - Math.pow(1 - progress, 3);
        slidingStock.position.z = 10 - eased * 17.3;
        slidingStock.rotation.y = elapsed * 4;
        slidingStock.visible = true;
      } else {
        slidingStock.visible = false;
      }

      restingStock.rotation.y += 0.002;
      sparkles.rotation.y += 0.0006;

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    }
    animate();

    function handleResize() {
      const w = mount.clientWidth;
      camera.aspect = w / heightPx;
      camera.updateProjectionMatrix();
      renderer.setSize(w, heightPx);
    }
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [height]);

  return <div ref={mountRef} style={{ width: '100%', height, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }} />;
}
