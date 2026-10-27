// HPVN static export: the game page, the HPVN table layer and the dish photos, nothing else.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const path of ['index.html', 'hpvn.js', 'images']) cpSync(path, `dist/${path}`, { recursive: true });
