'use strict';

// Vua Đầu Bếp rules shared by the turn engine and the market bots: seeded randomness, prices, pantry,
// cooking and the shelf. Every function works on the plain state object stored on the table.
const D = require('./vua-dau-bep-data');

class GameError extends Error {}
const fail = message => { throw new GameError(message); };

// mulberry32 on the state's own seed, so a table replays the same way and the client cannot predict it
function rand(s) {
  s.rng = (s.rng + 0x6D2B79F5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (s, list) => list[Math.floor(rand(s) * list.length)];
function shuffle(s, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const newId = (s, prefix) => `${prefix}_${++s.seq}`;

const chefName = id => D.CHEFS[id]?.name || id;
const marketName = key => D.MARKETS[key]?.name || key;
// n numbers every line, so a member's page can show what happened since it last looked
function say(s, text) {
  s.logN = (s.logN || 0) + 1;
  s.log.push({ n: s.logN, day: s.day, text });
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
}

function ingredient(name) {
  for (const key of D.MARKET_KEYS) {
    const card = D.MARKETS[key].cards.find(c => c.name === name);
    if (card) return { name: card.name, cost: card.cost, emoji: card.emoji, type: card.type };
  }
  return null;
}
const item = (s, name) => ({ id: newId(s, 'ing'), ...ingredient(name) });
const dealRecipe = (s, template) => ({
  ...template, requires: [...template.requires], id: newId(s, 'rec'), cooked: false,
  reqEmojis: template.requires.map(name => ingredient(name).emoji).join(' + '),
});
const actionCard = (s, type) => ({ id: newId(s, 'act'), ...D.ACTION_CARDS.find(c => c.type === type) });

// the chefs at this table in turn order (tables from before 2–8 seats have the first four)
const order = s => D.TURN_ORDER.filter(id => s.chefs[id]);
const round = s => order(s).length;

const hasUpgrade = (chef, id) => chef.upgrades.some(u => u.id === id);
const capacity = chef => (hasUpgrade(chef, 'upg_freezer') ? 8 : 5) + (chef.id === 'muoi' ? 1 : 0);
const buyLimit = chef => (chef.id === 'lola' && chef.level === 2 ? 3 : 2);
const tierFromLikes = likes => Math.max(0, Math.min(5, Math.floor(likes / 3)));
function dailyPerk(chef) {
  if (chef.id === 'lola') return chef.level === 2 ? 100 : 50;
  if (chef.id === 'muoi') return chef.level === 2 ? 100 : 50;
  return 0;
}

function cardCost(chef, card, shopKey) {
  let cost = card.cost;
  if (hasUpgrade(chef, 'upg_vip')) cost = Math.max(50, cost - 50);
  if (chef.id === 'angus') {
    if (shopKey === 'mystery') cost = Math.max(50, cost - 100);
    else if (chef.level === 2) cost = Math.max(50, cost - 50);
  }
  if (chef.id === 'chen' && shopKey === 'chop') cost = Math.max(50, cost - 100);
  if (chef.id === 'tam' && shopKey === 'dairy') cost = Math.max(50, cost - 100);
  if (chef.id === 'hai' && (shopKey === 'fruit' || shopKey === 'vegetable')) cost = Math.max(50, cost - 50);
  return cost;
}

// Closures and shelf claims last one full round (every chef plays once), then the shelf restocks.
const isClosed = (s, key) => s.closed.some(c => c.market === key);
const claimKey = (market, name) => `${market}|${name}`;
const claimHolder = (s, claim) => Object.values(s.chefs).find(c => c.inventory.some(i => i.id === claim?.itemInstanceId)) || null;

function missingFor(chef, recipe) {
  const pool = chef.inventory.map(i => ({ name: i.name.toLowerCase(), wild: i.type === 'wild' }));
  const missing = [];
  for (const req of recipe.requires) {
    const idx = pool.findIndex(p => !p.wild && p.name.includes(req.toLowerCase()));
    if (idx !== -1) pool.splice(idx, 1); else missing.push(req);
  }
  return { missing, wildCount: pool.filter(p => p.wild).length };
}
function canCook(chef, recipe) {
  const { missing, wildCount } = missingFor(chef, recipe);
  return missing.length <= wildCount;
}
const needs = chef => chef.activeRecipes.flatMap(r => missingFor(chef, r).missing);

function addWild(s, chef) {
  if (chef.inventory.length < capacity(chef)) {
    chef.inventory.push({ id: newId(s, 'wild'), name: 'Nguyên Liệu Ảo Thuật (Tự Do)', cost: 100, emoji: '✨', type: 'wild' });
    return 'thêm 1 Nguyên Liệu Ảo Thuật';
  }
  chef.money += 200;
  return 'kho đầy, đổi thành +$200';
}

function trashItem(s, chef, itemId) {
  const idx = chef.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) fail('Món này không còn trong kho.');
  const [thrown] = chef.inventory.splice(idx, 1);
  chef.garbageCan.push(thrown);
  if (thrown.type !== 'wild') s.dumpster.push(ingredient(thrown.name));
  return thrown;
}

function cook(s, chef, recipe) {
  if (!canCook(chef, recipe)) fail('Chưa đủ nguyên liệu để nấu món này.');
  for (const req of recipe.requires) {
    let idx = chef.inventory.findIndex(i => i.type !== 'wild' && i.name.toLowerCase().includes(req.toLowerCase()));
    if (idx === -1) idx = chef.inventory.findIndex(i => i.type === 'wild');
    const [used] = chef.inventory.splice(idx, 1);
    if (used.type !== 'wild') s.dumpster.push(ingredient(used.name));
  }
  let gained = recipe.likes;
  if (hasUpgrade(chef, 'upg_neon')) gained += 1;
  if (chef.id === 'lucrezia' && chef.level === 2) gained += 1;
  if (chef.id === 'chen' && chef.level === 2 && recipe.requires.some(r => /Bò|Sườn|Thịt/.test(r))) { gained += 1; chef.money += 100; }
  if (chef.id === 'hai' && chef.level === 2 && !recipe.isGourmet) gained += 1;
  if (chef.id === 'tam' && chef.level === 2 && recipe.requires.some(r => /Tôm|Cua/.test(r))) gained += 1;
  if (chef.id === 'sau') {
    chef.money += 50;
    if (chef.level === 2 && recipe.requires.includes('Bánh Phở Tươi')) gained += 1;
  }
  chef.likes += gained;
  chef.cookedCount += 1;
  chef.tierIdx = Math.max(chef.tierIdx, tierFromLikes(chef.likes));
  if (chef.cookedCount >= 3 && chef.level === 1) {
    chef.level = 2;
    say(s, `👑 ${chefName(chef.id)} lên Cấp 2 – Bếp Trưởng Bậc Thầy!`);
  }
  const deck = recipe.isGourmet ? D.GOURMET_RECIPES : D.BASIC_RECIPES;
  const active = chef.activeRecipes.map(r => r.name);
  const pool = deck.filter(r => !active.includes(r.name));
  chef.activeRecipes[chef.activeRecipes.indexOf(recipe)] = dealRecipe(s, pick(s, pool.length ? pool : deck));
  say(s, `🍳 ${chefName(chef.id)} nấu xong ${recipe.name} (+${gained} ⭐, tổng ${chef.likes}).`);
  if (chef.likes >= D.WIN_LIKES && !s.finalDay) {
    s.finalDay = true;
    say(s, `🏁 ${chefName(chef.id)} đạt ${chef.likes} ⭐! Ván kết thúc vào cuối ngày ${s.day}.`);
  }
  return gained;
}

module.exports = {
  GameError, fail, rand, pick, shuffle, newId, chefName, marketName, say, ingredient, item, dealRecipe, actionCard,
  order, round, hasUpgrade, capacity, buyLimit, tierFromLikes, dailyPerk, cardCost, isClosed, claimKey, claimHolder,
  missingFor, canCook, needs, addWild, trashItem, cook,
};
