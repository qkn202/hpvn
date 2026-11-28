// HPVN static export: the game page, the HPVN table layer, AAA 3D/VFX module, and the dish/chef art, nothing else.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const path of ['index.html', 'hpvn.js', 'images', 'modules']) {
  if (existsSync(path)) cpSync(path, `dist/${path}`, { recursive: true });
}
