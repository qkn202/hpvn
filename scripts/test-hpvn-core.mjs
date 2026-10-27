// HPVN core for Vua Đầu Bếp: checked against every new upstream before it is synced.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const hpvn = readFileSync('hpvn.js', 'utf8');
// the HPVN layer loads after the game script, so it can reach the game's globals; ?v= is its sha256
// (HPVN caches /game/** for an hour, so an unstamped hpvn.js would run the old layer after a release)
const stamp = createHash('sha256').update(hpvn).digest('hex').slice(0, 10);
assert.match(html, new RegExp(`<script src="\\./hpvn\\.js\\?v=${stamp}"></script>\\s*</body>`), `hpvn.js is the last script, stamped ?v=${stamp}`);
// nothing remote: no CDN, no web fonts, no analytics
assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)="https?:/i);
assert.doesNotMatch(hpvn, /https?:\/\//);
// identity only from the parent's checked handoff; messages only to and from the parent's origin
assert.match(hpvn, /params\.get\('hpvn-ticket'\)/);
assert.match(hpvn, /new URL\(document\.referrer\)\.origin !== location\.origin/);
assert.match(hpvn, /event\.source !== window\.parent \|\| event\.origin !== location\.origin/);
assert.doesNotMatch(hpvn, /postMessage\([^)]*'\*'\)/);
// server text is written with textContent, never as HTML
assert.doesNotMatch(hpvn, /innerHTML\s*=\s*(?!\s*'')/);
// every table action goes through the server; the game names it hooks into still exist
for (const name of ['buyIngredientCard', 'cookRecipe', 'trashIngredient', 'setupTargetSelector', 'renderMarketShelf', 'updateRecipeUI', 'getStandeeForChef', 'dialForChef']) {
  assert.match(html, new RegExp(`function ${name}\\(`), name);
}
for (const id of ['btn-reveal-dials', 'btn-done-buying', 'btn-next-day', 'btn-buy-upgrade', 'btn-claim-dumpster', 'btn-execute-action', 'btn-submit-trade', 'btn-confirm-snatch', 'btn-seat-lola']) {
  assert.match(html, new RegExp(`id="${id}"`), id);
}
console.log('vua-dau-bep hpvn core ok');
