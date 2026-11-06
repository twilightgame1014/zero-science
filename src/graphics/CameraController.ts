import * as THREE from 'three';
import type { GraphicsConfig } from './types';
import { dampFactor } from './utils';

/**
 * Orthographic HD-2D camera: fixed ~50° pitch, smooth damped follow.
 * It reads target positions; it never writes to game-logic coordinates.
 */
export class CameraController {
  readonly camera: THREE.OrthographicCamera;
  private cfg: GraphicsConfig['camera'];
  private target = new THREE.Vector3(0, 0, 0);
  private current = new THREE.Vector3(0, 0, 0);
  private offset = new THREE.Vector3();
  private viewSize: number;
  private aspect = 16 / 9;

  constructor(cfg: GraphicsConfig['camera']) {
    this.cfg = cfg;
    this.viewSize = cfg.viewSize;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    const pitch = THREE.MathUtils.degToRad(cfg.pitchDegrees);
    const yaw = THREE.MathUtils.degToRad(cfg.yawDegrees);
    const dist = 90;
    this.offset.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).multiplyScalar(dist);
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
    this.camera.position.copy(this.current).add(this.offset);
    this.camera.lookAt(this.current);
    this.camera.updateMatrixWorld();
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(height, 1);
    this.applyFrustum();
  }

  /**
   * On portrait phones a landscape-tuned frustum would show a sliver of
   * world, so the visible height grows to keep horizontal coverage sane.
   */
  private applyFrustum(): void {
    const boost = this.aspect >= 1 ? 1 : Math.min(Math.pow(1 / this.aspect, 0.62), 1.9);
    const halfH = (this.viewSize * boost) / 2;
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
