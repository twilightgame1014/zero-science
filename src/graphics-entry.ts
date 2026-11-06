// ゲーム側から描画モジュールを使うための入口（src/graphics 本体は改変しない）
import * as THREE from 'three';
import { initializeGraphics, terrainHeight, DEFAULT_CONFIG, resolveConfig } from './graphics';
(window as any).HD2D = { initializeGraphics, terrainHeight, DEFAULT_CONFIG, resolveConfig, THREE };
window.dispatchEvent(new Event('hd2d-ready'));
