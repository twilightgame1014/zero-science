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

  constructor(cfg: GraphicsConfig['camera']) {
    this.cfg = cfg;
    this.viewSize = cfg.viewSize;
    this.effectiveViewSize = cfg.viewSize;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    const pitch = THREE.MathUtils.degToRad(cfg.pitchDegrees);
    const yaw = THREE.MathUtils.degToRad(cfg.yawDegrees);
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
    this.applyFrustum();
    this.snapToTarget();
  }

  /** Set the point the camera should look at (scene coordinates). */
  setTarget(x: number, z: number, groundY = 0): void {
    this.target.set(x, groundY, z);
  }

  snapToTarget(): void {
    this.current.copy(this.target);
    this.updateCameraTransform();
  }

  update(dt: number): void {
    const k = dampFactor(this.cfg.followDamping, dt);
    this.current.lerp(this.target, k);
    this.updateCameraTransform();
  }

  private updateCameraTransform(): void {
    // Shift the look centre up along screen-up so the followed player
    // sits slightly below screen centre (anchorOffset of the visible
    // height). The shift goes through the real camera transform, so
    // raycasting / tap conversion stays consistent with what is drawn.
    const shift = (this.cfg.anchorOffset ?? 0) * this.effectiveViewSize;
    this.lookCenter.copy(this.current).addScaledVector(this.screenUp, shift);
    this.camera.position.copy(this.lookCenter).add(this.offset);
    this.camera.lookAt(this.lookCenter);
    this.camera.updateMatrixWorld();
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(height, 1);
    this.applyFrustum();
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
