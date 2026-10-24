import * as THREE from 'three';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import { deviceQuaternion, dragQuaternion, headingOffset, headsetQuaternion, walkDirection } from './headsetOrientation';

export type HeadsetMode = 'webxr' | 'cardboard';

export interface HeadsetStart {
  /** Eye position in scene units (cm). */
  position: { x: number; y: number; z: number };
  /** Initial heading, radians (0 = looking down -Z). */
  yaw: number;
}

export interface HeadsetCallbacks {
  /** Called once when the session ends for any reason (exit button, back gesture, headset removed). */
  onEnd: () => void;
  /** Hint text drawn over the stereo view for a few seconds. */
  hint: string;
  exitLabel: string;
}

/** Walking speed while the screen (or the headset's button) is held: 1.2 m/s. */
const WALK_SPEED = 120;
/** Typical interpupillary distance, 64 mm, in scene centimetres. */
const EYE_SEPARATION = 6.4;

type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

export async function detectHeadsetMode(): Promise<HeadsetMode> {
  try {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
    if (xr && await xr.isSessionSupported('immersive-vr')) return 'webxr';
  } catch { /* Fall back to the phone headset mode. */ }
  return 'cardboard';
}

/** Presents the scene in a VR headset: WebXR where supported (Quest, Android XR), otherwise a
 * split-screen stereo view driven by the phone's gyroscope for phone headsets (Cardboard type). */
export class HeadsetSession {
  private ended = false;
  private cleanups: (() => void)[] = [];
  private saved: {
    position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number; focus: number; aspect: number;
    parent: THREE.Object3D | null; width: number; height: number; pixelRatio: number;
  };

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private host: HTMLElement,
    private callbacks: HeadsetCallbacks,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    this.saved = {
      position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov,
      focus: camera.focus, aspect: camera.aspect, parent: camera.parent,
      width: size.x, height: size.y, pixelRatio: renderer.getPixelRatio(),
    };
  }

  async start(mode: HeadsetMode, start: HeadsetStart) {
    if (mode === 'webxr') {
      try { await this.startWebXR(start); return; }
      catch (error) { console.warn('WebXR unavailable, using the phone headset view', error); }
    }
    await this.startCardboard(start);
  }

  /** Ends the session and restores the normal viewer. Safe to call more than once. */
  stop() {
    if (this.ended) return;
    this.ended = true;
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try { cleanup(); } catch { /* Keep restoring the rest. */ }
    }
    const { camera, renderer, saved } = this;
    camera.removeFromParent();
    if (saved.parent) saved.parent.add(camera);
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    camera.fov = saved.fov;
    camera.focus = saved.focus;
    camera.aspect = saved.aspect;
    camera.updateProjectionMatrix();
    renderer.setScissorTest(false);
    renderer.setPixelRatio(saved.pixelRatio);
    renderer.setSize(saved.width, saved.height);
    this.callbacks.onEnd();
  }

  /* ---------------- Phone headset (stereo + gyroscope) ---------------- */

  private async startCardboard(start: HeadsetStart) {
    const { camera, renderer, scene, host } = this;

    // iOS asks for motion access, and only during the tap that started the session.
    const permission = (globalThis.DeviceOrientationEvent as unknown as OrientationPermission | undefined)?.requestPermission;
    if (typeof permission === 'function') {
      try { await permission.call(globalThis.DeviceOrientationEvent); } catch { /* Drag to look instead. */ }
    }

    const overlay = this.createOverlay();
    try {
      if (!document.fullscreenElement) await host.requestFullscreen?.({ navigationUI: 'hide' });
    } catch { /* Some phones (iPhone) cannot go fullscreen; the view still fills the panel. */ }
    try {
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
      this.cleanups.push(() => { try { screen.orientation.unlock(); } catch { /* ignore */ } });
    } catch { /* The user can rotate the phone by hand. */ }
    try {
      const lock = await (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen');
      if (lock) this.cleanups.push(() => { void lock.release().catch(() => {}); });
    } catch { /* Screen may dim after a while. */ }
    this.cleanups.push(() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); });

    camera.removeFromParent();
    camera.position.set(start.position.x, start.position.y, start.position.z);
    camera.fov = 80;
    camera.focus = 300;
    const effect = new StereoEffect(renderer);
    effect.setEyeSeparation(EYE_SEPARATION);

    const resize = () => {
      const width = host.clientWidth || window.innerWidth, height = host.clientHeight || window.innerHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // Two eyes per frame: keep phones smooth.
      effect.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);
    this.cleanups.push(() => window.removeEventListener('resize', resize));

    // Orientation: gyroscope when present, otherwise drag to look.
    let reading: { alpha: number; beta: number; gamma: number } | null = null;
    let offset: number | null = null;
    const deviceQ = new THREE.Quaternion();
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null) return;
      reading = { alpha: event.alpha, beta: event.beta, gamma: event.gamma };
    };
    window.addEventListener('deviceorientation', onOrientation);
    this.cleanups.push(() => window.removeEventListener('deviceorientation', onOrientation));
    const screenAngle = () => {
      const angle = screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
      return Number(angle) || 0;
    };
    let dragYaw = start.yaw, dragPitch = 0;

    // Hold to walk; double tap re-centres the view on the starting direction.
    let walking = false, lastTap = 0, drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    const canvas = renderer.domElement;
    const onDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-headset-ui]')) return;
      const now = performance.now();
      if (now - lastTap < 320) {
        // Wherever the user faces now becomes the starting direction of the walk.
        offset = null; dragYaw = start.yaw; dragPitch = 0;
        walking = false; lastTap = 0; return;
      }
      lastTap = now;
      walking = true;
      drag = { x: event.clientX, y: event.clientY, yaw: dragYaw, pitch: dragPitch };
    };
    const onMove = (event: PointerEvent) => {
      if (!drag || reading) return;
      // Without a gyroscope, dragging looks around instead of walking.
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) walking = false;
      dragYaw = drag.yaw + dx * 0.005;
      dragPitch = drag.pitch + dy * 0.005;
    };
    const onUp = () => { walking = false; drag = null; };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    });

    // Leaving fullscreen (back gesture, Esc) ends the session.
    const onFullscreen = () => { if (!document.fullscreenElement) this.stop(); };
    document.addEventListener('fullscreenchange', onFullscreen);
    this.cleanups.push(() => document.removeEventListener('fullscreenchange', onFullscreen));
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') this.stop(); };
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));

    let frame = 0, previous = performance.now();
    const loop = (now: number) => {
      if (this.ended) return;
      frame = requestAnimationFrame(loop);
      const dt = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (reading) {
        deviceQuaternion(reading.alpha, reading.beta, reading.gamma, screenAngle(), deviceQ);
        if (offset === null) offset = headingOffset(deviceQ, start.yaw);
        headsetQuaternion(deviceQ, offset, camera.quaternion);
      } else {
        dragQuaternion(dragYaw, dragPitch, camera.quaternion);
      }
      if (walking) {
        const dir = walkDirection(camera.quaternion);
        camera.position.x += dir.x * WALK_SPEED * dt;
        camera.position.z += dir.z * WALK_SPEED * dt;
      }
      camera.updateMatrixWorld();
      effect.render(scene, camera);
      renderer.domElement.dataset.rendered = 'true';
    };
    frame = requestAnimationFrame(loop);
    this.cleanups.push(() => { cancelAnimationFrame(frame); overlay.remove(); });
  }

  private createOverlay() {
    const overlay = document.createElement('div');
    overlay.dataset.headsetUi = 'true';
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:80;';
    const exit = document.createElement('button');
    exit.type = 'button';
    exit.dataset.headsetUi = 'true';
    exit.textContent = '✕';
    exit.setAttribute('aria-label', this.callbacks.exitLabel);
    exit.title = this.callbacks.exitLabel;
    exit.style.cssText = 'position:absolute;top:12px;left:12px;width:44px;height:44px;border-radius:22px;border:0;background:rgba(0,0,0,.55);color:#fff;font:600 20px/44px sans-serif;pointer-events:auto;';
    exit.addEventListener('click', () => this.stop());
    const hint = document.createElement('div');
    hint.textContent = this.callbacks.hint;
    hint.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:min(560px,80vw);padding:12px 16px;border-radius:12px;background:rgba(0,0,0,.7);color:#fff;font:500 15px/1.4 sans-serif;text-align:center;transition:opacity .6s;';
    overlay.append(exit, hint);
    if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
    this.host.append(overlay);
    const timer = setTimeout(() => { hint.style.opacity = '0'; }, 5000);
    this.cleanups.push(() => clearTimeout(timer));
    return overlay;
  }

  /* ---------------- WebXR (standalone and PC headsets) ---------------- */

  private async startWebXR(start: HeadsetStart) {
    const { camera, renderer, scene } = this;
    const xr = (navigator as Navigator & { xr?: { requestSession(mode: string, init?: object): Promise<XRSession> } }).xr;
    if (!xr) throw new Error('WebXR unavailable');
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });

    // The model is in centimetres and WebXR poses in metres: a rig scaled ×100 carries the camera.
    const rig = new THREE.Group();
    rig.scale.setScalar(100);
    rig.position.set(start.position.x, start.position.y, start.position.z);
    rig.rotation.y = start.yaw;
    camera.removeFromParent();
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    rig.add(camera);
    scene.add(rig);
    const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
    let walking = 0;
    const press = () => { walking++; }, release = () => { walking = Math.max(0, walking - 1); };
    for (const controller of controllers) {
      rig.add(controller);
      controller.addEventListener('selectstart', press);
      controller.addEventListener('selectend', release);
    }

    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session as never);

    const head = new THREE.Quaternion();
    let previous = performance.now();
    renderer.setAnimationLoop((now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      // Thumbstick forward/back on any controller, or the trigger to walk where you look.
      let push = walking ? 1 : 0;
      for (const source of session.inputSources) {
        const axes = source.gamepad?.axes;
        if (axes && axes.length >= 4 && Math.abs(axes[3]) > 0.2) push = -axes[3];
      }
      if (push) {
        renderer.xr.getCamera().getWorldQuaternion(head);
        const dir = walkDirection(head);
        rig.position.x += dir.x * WALK_SPEED * push * dt;
        rig.position.z += dir.z * WALK_SPEED * push * dt;
      }
      renderer.render(scene, camera);
    });

    const onEnd = () => this.stop();
    session.addEventListener('end', onEnd);
    this.cleanups.push(() => {
      session.removeEventListener('end', onEnd);
      renderer.setAnimationLoop(null);
      void session.end().catch(() => {});
      renderer.xr.enabled = false;
      for (const controller of controllers) {
        controller.removeEventListener('selectstart', press);
        controller.removeEventListener('selectend', release);
        controller.removeFromParent();
      }
      rig.removeFromParent();
    });
  }
}
