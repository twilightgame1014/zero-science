// GitHub Pages の公開ワークフローの決まり（2026-11-15 オーナー承認：main への push だけで自動公開）を、ファイルの中身で確かめる。
// 実際の公開は GitHub の上でしか確かめられない（このテストは条件の書き忘れ・消し忘れを止めるため）。
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
let fail = 0, n = 0; const ok = (name, c, d = '') => { n++; if (!c) fail++; console.log(`${c ? '✅' : '❌'} ${name}${c ? '' : '：' + d}`); };
const onBlock = src.slice(src.indexOf('\non:'), src.indexOf('\npermissions:'));
ok('きっかけは main への push と手動実行だけ（pull_request・ほかのブランチ・タグはない）', /push:\s*\n\s*branches:\s*\[main\]/.test(onBlock) && /workflow_dispatch/.test(onBlock) && !/pull_request|branches-ignore|tags|'\*\*'|\[\s*'\*'/.test(onBlock), onBlock);
const jobs = src.slice(src.indexOf('\njobs:')).split(/\n  (?=[a-z][\w-]*:\s*\n)/).slice(1).map(b => ({ name: b.split(':')[0], body: b }));
ok('ジョブは build・verify・deploy', jobs.map(j => j.name).join() === 'build,verify,deploy', jobs.map(j => j.name).join());
ok("すべてのジョブに github.ref == 'refs/heads/main' の条件（手動実行でも main 以外は公開しない）", jobs.every(j => /\n    if: .*github\.ref == 'refs\/heads\/main'/.test(j.body)));
const dep = jobs.find(j => j.name === 'deploy')?.body || '';
ok('公開は build と verify の両方の成功が条件', /needs:\s*\[build,\s*verify\]/.test(dep));
ok('公開の権限（pages: write・id-token: write）は deploy ジョブだけ', /pages: write/.test(dep) && /id-token: write/.test(dep) && jobs.filter(j => j.name !== 'deploy').every(j => !/pages: write|id-token: write/.test(j.body)) && !/^permissions:[\s\S]*?pages: write[\s\S]*?\njobs:/m.test(src));
ok('公開の直前に「この SHA がまだ main の先端か」を確かめ、違えば公開しない', /commits\/main/.test(dep) && /if: steps\.head\.outputs\.latest == 'true'/.test(dep) && /deploy-pages@v4/.test(dep));
ok('同時実行は 1 つずつ（実行中の公開を止めない）', /concurrency:\s*\n\s*group: pages-main\s*\n\s*cancel-in-progress: false/.test(src));
const b = jobs.find(j => j.name === 'build')?.body || '', v = jobs.find(j => j.name === 'verify')?.body || '';
ok('build：typecheck・build・npm test・version.json の SHA の確認・同じ dist を e2e 用と公開用に保存', ['npm run typecheck', 'npm run build', 'npm test', 'version.json', 'upload-artifact', 'upload-pages-artifact', 'configure-pages'].every(k => b.includes(k)) && b.indexOf('npm run build') < b.indexOf('npm test'));
ok('verify：build の dist を取り出して e2e（作り直さない）', /download-artifact/.test(v) && !/npm run (build|e2e)/.test(v) && ['play.mjs', 'construction.mjs', 'construction-visual.mjs', 'looks.mjs', 'playthrough.mjs', 'recovery.mjs', 'space.mjs', 'hero-8dir.mjs --suit', 'camera-focus-fade.mjs', 'book.mjs'].every(k => v.includes(k)));
const t = fs.readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
ok('test.yml は main への push では動かさない（同じ検証を重ねない）。PR とほかのブランチは今までどおり', /branches-ignore:\s*\[main\]/.test(t) && /pull_request/.test(t) && !/pages: write|deploy-pages/.test(t));
const others = fs.readdirSync(new URL('../.github/workflows/', import.meta.url)).filter(f => f !== 'pages.yml').map(f => fs.readFileSync(new URL('../.github/workflows/' + f, import.meta.url), 'utf8'));
ok('ほかのワークフローは公開しない（deploy-pages・pages: write がない）', others.every(x => !/deploy-pages|pages: write/.test(x)));
console.log(`\n${n - fail}/${n} 件合格`); if (fail) process.exit(1);
