import * as THREE from 'three';
import type { GraphicsConfig } from './types';
import { dampFactor } from './utils';

/**
 * Orthographic HD-2D camera: low ~32° pitch (exploration spec
 * 2026-11-06), smooth damped follow. It reads target positions; it
 * never writes to game-logic coordinates. Because the projection is
 * orthographic, framing is controlled by the frustum (viewSize), not
 * by the camera distance.
 */
export class CameraController {
  readonly camera: THREE.OrthographicCamera;
  private cfg: GraphicsConfig['camera'];
  private target = new THREE.Vector3(0, 0, 0);
  private current = new THREE.Vector3(0, 0, 0);
  private offset = new THREE.Vector3();
  /** Camera screen-up direction in world space. */
  private screenUp = new THREE.Vector3();
  private lookCenter = new THREE.Vector3();
  private viewSize: number;
  /** viewSize after the portrait boost — the height actually shown. */
  private effectiveViewSize: number;
  private aspect = 16 / 9;
  /** HUD safe-area insets in CSS px (see setViewportInsets). */
  private insetTop = 0;
  private insetBottom = 0;
  private heightPx = 0;

  private yawDegrees: number;
  private pitchDegrees: number;

  constructor(cfg: GraphicsConfig['camera']) {
    this.cfg = cfg;
    this.viewSize = cfg.viewSize;
    this.effectiveViewSize = cfg.viewSize;
    this.yawDegrees = cfg.yawDegrees;
    this.pitchDegrees = cfg.pitchDegrees;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.applyOrientation();
    this.applyFrustum();
    this.snapToTarget();
  }

  private applyOrientation(): void {
    const pitch = THREE.MathUtils.degToRad(this.pitchDegrees);
    const yaw = THREE.MathUtils.degToRad(this.yawDegrees);
    const dist = 90;
    this.offset.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).multiplyScalar(dist);
    this.screenUp.set(
      -Math.sin(yaw) * Math.sin(pitch),
      Math.cos(pitch),
      -Math.cos(yaw) * Math.sin(pitch),
    );
  }

  /**
   * Orbit the camera at runtime (world-expansion spec, 2026-11-07):
   * the world is authored to be viewed from any side, so yaw/pitch
   * are no longer fixed at construction. Omitted fields keep their
   * current values. Yaw is free (360°); pitch is clamped to a sane
   * exploration range so the ground plane never flips.
   */
  setOrientation(yawDegrees?: number, pitchDegrees?: number): void {
    this.transition = null;
    if (yawDegrees !== undefined && Number.isFinite(yawDegrees)) {
      this.yawDegrees = ((yawDegrees % 360) + 360) % 360;
    }
    if (pitchDegrees !== undefined && Number.isFinite(pitchDegrees)) {
      this.pitchDegrees = THREE.MathUtils.clamp(pitchDegrees, 12, 72);
    }
    this.applyOrientation();
    this.updateCameraTransform();
  }

  /** Current orbit yaw in degrees (0–360). Input mapping on the game
   *  side should follow this so screen-relative movement stays true. */
  getYawDegrees(): number {
    return this.yawDegrees;
  }

  getPitchDegrees(): number {
    return this.pitchDegrees;
  }

  /** Current zoom (base viewSize, before the portrait boost). */
  getViewSize(): number {
    return this.viewSize;
  }

  /** An in-flight view transition (setCameraView with transition). */
  private transition: {
    fromYaw: number; toYaw: number;
    fromPitch: number; toPitch: number;
    fromSize: number; toSize: number;
    t: number; duration: number;
  } | null = null;

  /**
   * Move to a new view, optionally over `transitionSeconds`. Yaw
   * travels the short way around the circle. A direct setOrientation
   * / setViewSize call cancels any in-flight transition.
   */
  transitionTo(view: { yawDegrees?: number; pitchDegrees?: number; viewSize?: number }, transitionSeconds: number): void {
    const toYaw = view.yawDegrees !== undefined
      ? ((view.yawDegrees % 360) + 360) % 360
      : this.yawDegrees;
    const toPitch = view.pitchDegrees !== undefined
      ? THREE.MathUtils.clamp(view.pitchDegrees, 12, 72)
      : this.pitchDegrees;
    const toSize = view.viewSize !== undefined
      ? THREE.MathUtils.clamp(view.viewSize, 4, 60)
      : this.viewSize;
    if (!(transitionSeconds > 0)) {
      this.transition = null;
      this.setOrientation(toYaw, toPitch);
      this.setViewSize(toSize);
      return;
    }
    this.transition = {
      fromYaw: this.yawDegrees, toYaw,
      fromPitch: this.pitchDegrees, toPitch,
      fromSize: this.viewSize, toSize,
      t: 0, duration: transitionSeconds,
    };
  }

  private stepTransition(dt: number): void {
    const tr = this.transition;
    if (!tr) return;
    tr.t += dt / tr.duration;
    const t = Math.min(tr.t, 1);
    const e = t * t * (3 - 2 * t);
    let dy = tr.toYaw - tr.fromYaw;
    if (dy > 180) dy -= 360;
    if (dy < -180) dy += 360;
    this.yawDegrees = ((tr.fromYaw + dy * e) % 360 + 360) % 360;
    this.pitchDegrees = tr.fromPitch + (tr.toPitch - tr.fromPitch) * e;
    this.viewSize = tr.fromSize + (tr.toSize - tr.fromSize) * e;
    this.applyOrientation();
    this.applyFrustum();
    this.updateCameraTransform();
    if (t >= 1) this.transition = null;
  }

  /** Zoom: with an orthographic camera this is the frustum height. */
  setViewSize(viewSize: number): void {
    this.transition = null;
    if (!Number.isFinite(viewSize) || viewSize <= 0) return;
    this.viewSize = THREE.MathUtils.clamp(viewSize, 4, 60);
    this.applyFrustum();
    this.updateCameraTransform();
  }

  /** Set the point the camera should look at (scene coordinates). */
  setTarget(x: number, z: number, groundY = 0): void {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(groundY)) return;
    this.target.set(x, groundY, z);
  }

  snapToTarget(): void {
    this.current.copy(this.target);
    this.updateCameraTransform();
  }

  update(dt: number): void {
    this.stepTransition(dt);
    const k = dampFactor(this.cfg.followDamping, dt);
    this.current.lerp(this.target, k);
    this.updateCameraTransform();
  }

  private updateCameraTransform(): void {
    // Shift the look centre up along screen-up so the followed player
    // sits slightly below screen centre (anchorOffset of the visible
    // height). The shift goes through the real camera transform, so
    // raycasting / tap conversion stays consistent with what is drawn.
    // A bottom HUD inset (tab bar, virtual stick) lifts the usable
    // centre of the frame, so the anchor shift shrinks accordingly;
    // a top inset does the opposite. Fractions are of the canvas height.
    const insetShift = this.heightPx > 0
      ? (this.insetBottom - this.insetTop) / (2 * this.heightPx)
      : 0;
    const shift = ((this.cfg.anchorOffset ?? 0) - insetShift) * this.effectiveViewSize;
    this.lookCenter.copy(this.current).addScaledVector(this.screenUp, shift);
    this.camera.position.copy(this.lookCenter).add(this.offset);
    this.camera.lookAt(this.lookCenter);
    this.camera.updateMatrixWorld();
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(height, 1);
    this.heightPx = height;
    this.applyFrustum();
  }

  /**
   * Tell the camera which parts of the canvas are covered by HUD
   * (CSS px, top/bottom only — left/right are accepted by the public
   * API for symmetry but do not affect the vertical anchor). The
   * followed player is kept inside the remaining safe area. Purely a
   * framing concern; nothing here moves game coordinates.
   */
  setViewportInsets(top: number, bottom: number): void {
    this.insetTop = Math.max(0, top);
    this.insetBottom = Math.max(0, bottom);
  }

  /**
   * On portrait phones a landscape-tuned frustum would show a sliver of
   * world, so the visible height grows to keep some horizontal coverage.
   * The boost is deliberately gentle (max ~1.32x): the stronger boost
   * used before shrank the player to ~6% of the frame height, which is
   * what the exploration spec (2026-11-06) asks to fix — portrait keeps
   * the character at roughly 8%+ of the frame height.
   */
  private applyFrustum(): void {
    const boost = this.aspect >= 1 ? 1 : Math.min(Math.pow(1 / this.aspect, 0.35), 1.32);
    this.effectiveViewSize = this.viewSize * boost;
    const halfH = this.effectiveViewSize / 2;
    const halfW = halfH * this.aspect;
    const c = this.camera;
    c.left = -halfW;
    c.right = halfW;
    c.top = halfH;
    c.bottom = -halfH;
    c.updateProjectionMatrix();
  }

  getFocus(): THREE.Vector3 {
    return this.current.clone();
  }
}
