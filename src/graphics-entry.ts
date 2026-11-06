// ゲーム側から描画モジュールを使うための入口（src/graphics 本体は改変しない）
import * as THREE from 'three';
import { initializeGraphics, terrainHeight, DEFAULT_CONFIG, resolveConfig, RESOURCE_VISUAL_SPECS } from './graphics';
// 検証モードのアセット一覧用（登録済みのテクスチャ。すでに同梱されているものを参照するだけ）
import { GPT_TEXTURES } from './graphics/gptTextures';
import { BRANCH_TEXTURES } from './graphics/branchTextures';
(window as any).HD2D = { initializeGraphics, terrainHeight, DEFAULT_CONFIG, resolveConfig, THREE, RESOURCE_VISUAL_SPECS, GPT_TEXTURES, BRANCH_TEXTURES };
window.dispatchEvent(new Event('hd2d-ready'));
