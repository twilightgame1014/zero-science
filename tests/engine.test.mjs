// ゲームエンジンとデータの自動テスト（説明の網羅・元素保存・到達可能性・二重実行防止・セーブ互換など）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../src/game/engine.js');
const results = E.runTests();
let fail = 0;
for (const t of results) { console.log(`${t.pass ? '✅' : '❌'} ${t.name}${t.pass ? '' : '：' + t.detail}`); if (!t.pass) fail++; }
console.log(`\n${results.length - fail}/${results.length} 合格`);
process.exit(fail ? 1 : 0);
