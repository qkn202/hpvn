'use strict';

// Vua Đầu Bếp rules shared by the turn engine and bots (Authentic Rival Restaurants rules).
const D = require('./vua-dau-bep-data');

class GameError extends Error {}
const fail = message => { throw new GameError(message); };

// mulberry32 on the state's own seed
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
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const newId = (s, prefix) => `${prefix}_${++s.seq}`;

const chefName = id => D.CHEFS[id]?.name || id;
const marketName = key => D.MARKETS[key]?.name || key;
const restaurantOf = chef => D.RESTAURANTS[chef?.restaurantId] || D.RESTAURANTS[D.CHEFS[chef?.id]?.defaultRestaurant] || D.RESTAURANTS.rest_pho_saigon;

function say(s, text) {
  s.logN = (s.logN || 0) + 1;
  s.log.push({ n: s.logN, day: s.day, text });
  if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
}

function ingredient(name) {
  for (const key of D.MARKET_KEYS) {
    const card = D.MARKETS[key].cards.find(c => c.name === name);
    if (card) {
      return {
        name: card.name,
        cost: card.cost,
        emoji: card.emoji,
        type: card.type,
        market: key,
        special: card.special || '',
      };
    }
  }
  return null;
}

const item = (s, name) => ({ id: newId(s, 'ing'), ...ingredient(name) });

const dealRecipe = (s, template) => ({
  ...template,
  requires: [...template.requires],
  id: newId(s, 'rec'),
  cooked: false,
  reqEmojis: template.requires.map(name => ingredient(name)?.emoji || '📦').join(' + '),
});

const actionCard = (s, type) => ({ id: newId(s, 'act'), ...D.ACTION_CARDS.find(c => c.type === type) });

const order = s => (Array.isArray(s.turnOrder) && s.turnOrder.length
  ? s.turnOrder.filter(id => s.chefs[id])
  : D.TURN_ORDER.filter(id => s.chefs[id]));
const round = s => order(s).length;

const hasUpgrade = (chef, id) => (chef.upgrades || []).some(u => u.id === id);

const capacity = chef =>
  (hasUpgrade(chef, 'upg_freezer') ? 8 : 5)
  + (chef.id === 'muoi' ? 1 : 0)
  + (chef.milestonePantryBonus || 0);

// Authentic Rival Restaurants: you may buy as many ingredients as you can afford at your market (within pantry space)
const buyLimit = () => 99;
const cookLimit = chef => (hasUpgrade(chef, 'upg_double_cooktop') ? 2 : 1);
const tierFromLikes = likes => Math.max(0, Math.min(5, Math.floor(likes / 3)));

function dailyIncome(chef) {
  let amt = D.BASE_DAILY_INCOME;
  if (hasUpgrade(chef, 'upg_marketing')) amt += 100;
  if (hasUpgrade(chef, 'upg_celebrity')) amt += 150;
  amt += (chef.milestoneIncomeBonus || 0);
  amt += dailyPerk(chef);
  return amt;
}

function dailyPerk(chef) {
  if (chef.id === 'lola') return 50;
  if (chef.id === 'muoi') return 50;
  return 0;
}

// Authentic Rival Restaurants rule: Chef Powers do NOT work at The Island or Mystery Mart!
function isRegularMarket(key) {
  return D.MARKET_KEYS.includes(key) && key !== 'mystery';
}

function marketSurchargeOwner(s, buyer, shopKey) {
  if (!s || !isRegularMarket(shopKey)) return null;
  const lola = s.chefs?.lola;
  if (lola && lola !== buyer && lola.currentLocation === shopKey) return lola;
  return null;
}

function cardCost(chef, card, shopKey, { fromShelf = false, state = null } = {}) {
  let cost = card.cost;
  // Upgrades & Restaurant milestone discounts apply across markets
  if (hasUpgrade(chef, 'upg_vip')) cost = Math.max(50, cost - 50);
  if (chef.milestoneDiscount) cost = Math.max(50, cost - chef.milestoneDiscount);
  if (shopKey === 'dairy' && chef.milestoneSeafoodDiscount) cost = Math.max(50, cost - chef.milestoneSeafoodDiscount);

  // Chef Market Powers (DISABLED at Mystery Mart & The Island per official rules!)
  if (isRegularMarket(shopKey)) {
    if (chef.id === 'chen' && shopKey === 'chop') cost = Math.max(50, cost - 100);
    if (chef.id === 'tam' && shopKey === 'dairy') cost = Math.max(50, cost - 100);
    if (chef.id === 'hai' && (shopKey === 'fruit' || shopKey === 'vegetable')) cost = Math.max(50, cost - 50);
    if (chef.id === 'lucrezia' && fromShelf) cost = Math.max(50, cost - 50);
  }

  // Daily Event market price modifiers
  const ev = state?.dailyEvent;
  if (ev) {
    if (ev.effect === 'discount_green' && (shopKey === 'fruit' || shopKey === 'vegetable')) {
      cost = Math.max(50, cost - 50);
    } else if (ev.effect === 'discount_protein' && (shopKey === 'chop' || shopKey === 'dairy')) {
      cost = Math.max(50, cost - 50);
    } else if (ev.effect === 'storm_surcharge' && ev.targetMarket === shopKey) {
      cost += 50;
    }
  }

  // Cô Ba's Surcharge chef power (only at regular markets, never at Island or Mystery Mart)
  if (marketSurchargeOwner(state, chef, shopKey)) {
    cost += 50;
  }
  return cost;
}

// Daily Event dynamic pricing helpers
function garbageDisposalCost(s) {
  return s?.dailyEvent?.effect === 'free_disposal' ? 0 : D.GARBAGE_DISPOSAL_COST;
}

function chocolateSellValue(s) {
  return s?.dailyEvent?.effect === 'vip_chocolate' ? D.VIP_CHOCOLATE_SELL_VALUE : D.CHOCOLATE_SELL_VALUE;
}

function actionCardCost(s) {
  return s?.dailyEvent?.effect === 'action_sale' ? D.ACTION_SALE_COST : D.ACTION_CARD_COST;
}

// Per-chef analytics stats & end-of-day history helpers
function ensureStats(chef) {
  if (!chef) return null;
  if (!chef.stats) {
    chef.stats = {
      auctionsWon: 0,
      tradesDone: 0,
      garbageDumped: 0,
      peakMoney: chef.money || 0,
      dishesCooked: chef.cookedCount || 0,
    };
  }
  return chef.stats;
}

function trackPeakMoney(chef) {
  const st = ensureStats(chef);
  if (!st) return;
  if (chef.money > st.peakMoney) st.peakMoney = chef.money;
  st.dishesCooked = chef.cookedCount || 0;
}

function syncAllPeakMoney(s) {
  if (!s || !s.chefs) return;
  for (const chef of Object.values(s.chefs)) trackPeakMoney(chef);
}

function recordDaySnapshot(s) {
  s.dayHistory = s.dayHistory || [];
  const likes = {};
  const money = {};
  for (const id of order(s)) {
    const c = s.chefs[id];
    likes[id] = c.likes || 0;
    money[id] = c.money || 0;
  }
  const snap = {
    day: s.day,
    likes,
    money,
    event: s.dailyEvent ? s.dailyEvent.id : null,
  };
  const existingIdx = s.dayHistory.findIndex(h => h.day === s.day);
  if (existingIdx !== -1) s.dayHistory[existingIdx] = snap;
  else s.dayHistory.push(snap);
  return snap;
}

// Roll 1 deterministic Daily Event at start of each day (Day 1..MAX_DAYS)
function rollDailyEvent(s) {
  if (s.eventsEnabled === false) {
    s.dailyEvent = null;
    return null;
  }
  const prevId = s.dailyEvent?.id || null;
  const pool = prevId ? D.DAILY_EVENTS.filter(e => e.id !== prevId) : D.DAILY_EVENTS;
  const tpl = pick(s, pool);
  const ev = { ...tpl };
  if (ev.effect === 'storm_surcharge') {
    const regularMarkets = D.MARKET_KEYS.filter(isRegularMarket);
    const targetMarket = pick(s, regularMarkets);
    ev.targetMarket = targetMarket;
    const mInfo = D.MARKETS[targetMarket];
    ev.desc = `${mInfo.emoji} ${mInfo.shortName} bị mưa bão: tăng phụ phí +$50 mọi món hàng hôm nay!`;
  }
  s.dailyEvent = ev;
  say(s, `📰 SỰ KIỆN NGÀY ${s.day}: ${ev.emoji} ${ev.name} — ${ev.desc}`);

  // Start-of-day immediate effect: hygiene_inspect (chefs with >= 2 garbage pay $100 fine)
  if (ev.effect === 'hygiene_inspect') {
    for (const id of order(s)) {
      const chef = s.chefs[id];
      if ((chef.garbage || 0) >= 2) {
        const fine = Math.min(D.HYGIENE_FINE, chef.money);
        chef.money -= fine;
        say(s, `🕵️ Đoàn VSATTP phạt ${chefName(id)} -$${fine} vì tích ${chef.garbage}🗑️ Rác!`);
      }
    }
  }
  syncAllPeakMoney(s);
  return ev;
}

// Build initial shuffled Shelf Deck + 3 face-up Counter slots for each of the 6 markets
function buildMarketDecks(s) {
  const markets = {};
  for (const key of D.MARKET_KEYS) {
    const deck = [];
    for (const c of D.MARKETS[key].cards) {
      const copies = c.copies || 4;
      for (let i = 0; i < copies; i++) {
        deck.push({ name: c.name, cost: c.cost, emoji: c.emoji, type: c.type, market: key, special: c.special || '' });
      }
    }
    const shuffled = shuffle(s, deck);
    // Deal 3 distinct-if-possible initial face-up Counter cards so starting board looks lively
    const counter = [];
    const seen = new Set();
    for (let slot = 0; slot < D.COUNTER_SLOTS; slot++) {
      let pickIdx = shuffled.findIndex(c => !seen.has(c.name));
      if (pickIdx === -1) pickIdx = 0;
      const [card] = shuffled.splice(pickIdx, 1);
      seen.add(card.name);
      counter.push({ slotIdx: slot, card, claimedBy: null });
    }
    markets[key] = { shelf: shuffled, counter };
  }
  return markets;
}

// Authentic Cook & Counter Resupply: refill empty Counter slots from Shelf.
// If Shelf is empty, reshuffle matching cards from Discard Tray (s.dumpster) back into Shelf.
function refillMarketCounters(s) {
  if (!s.markets) return;
  for (const key of D.MARKET_KEYS) {
    const m = s.markets[key];
    if (!m) continue;
    for (let i = 0; i < D.COUNTER_SLOTS; i++) {
      const slot = m.counter[i];
      const needsRefill = !slot || !slot.card || !!slot.claimedBy;
      if (!needsRefill) continue;
      if (m.shelf.length === 0) {
        // Reshuffle matching market cards from Discard Tray
        const recycled = [];
        const remain = [];
        for (const d of (s.dumpster || [])) {
          const tpl = ingredient(d.name);
          if (tpl && tpl.market === key) recycled.push(tpl);
          else remain.push(d);
        }
        s.dumpster = remain;
        if (recycled.length > 0) {
          m.shelf = shuffle(s, recycled);
        } else {
          // Safety restock if all copies are held in player hands
          const fresh = [];
          for (const c of D.MARKETS[key].cards) {
            for (let k = 0; k < 2; k++) {
              fresh.push({ name: c.name, cost: c.cost, emoji: c.emoji, type: c.type, market: key, special: c.special || '' });
            }
          }
          m.shelf = shuffle(s, fresh);
        }
      }
      const nextCard = m.shelf.shift() || null;
      m.counter[i] = { slotIdx: i, card: nextCard, claimedBy: null };
    }
  }
}

const isClosed = (s, key) => s.closed.some(c => c.market === key);
const claimKey = (market, slotOrName) => `${market}|${slotOrName}`;
const claimHolder = (s, claim) => Object.values(s.chefs).find(c => c.inventory.some(i => i.id === claim?.itemInstanceId)) || null;

// Ingredient matching with authentic Tofu (substitutes Meat) & Alien Goo/Wild (substitutes any required)
function missingFor(chef, recipe) {
  const pool = (chef.inventory || []).map(i => ({
    id: i.id,
    name: (i.name || '').toLowerCase(),
    type: i.type,
    wild: i.type === 'wild',
    tofu: i.type === 'tofu',
  }));
  const missing = [];
  let tofuUsed = 0;
  for (const req of recipe.requires) {
    const reqLower = req.toLowerCase();
    // 1. Exact non-wild match first
    let idx = pool.findIndex(p => !p.wild && p.name.includes(reqLower));
    if (idx !== -1) {
      pool.splice(idx, 1);
      continue;
    }
    // 2. Tofu substitutes any Chop Shop (meat) ingredient!
    const reqTpl = ingredient(req);
    if (reqTpl && reqTpl.type === 'meat') {
      idx = pool.findIndex(p => p.tofu);
      if (idx !== -1) {
        pool.splice(idx, 1);
        tofuUsed++;
        continue;
      }
    }
    missing.push(req);
  }
  const wildCount = pool.filter(p => p.wild).length;
  return { missing, wildCount, tofuUsed };
}

function canCook(chef, recipe) {
  if (!chef || !recipe || recipe.cooked) return false;
  if ((chef.cookedToday || 0) >= cookLimit(chef)) return false;
  const { missing, wildCount } = missingFor(chef, recipe);
  return missing.length <= wildCount;
}

const needs = chef => (chef.activeRecipes || []).flatMap(r => missingFor(chef, r).missing);

// Check if chef holds an eligible optional Mystery add-on (Wine for Gourmet, Secret Sauce for Basic)
function eligibleAddonFor(chef, recipe) {
  const targetType = recipe.isGourmet ? 'wine' : 'secret_sauce';
  // Official rule: does NOT grant bonus if explicitly required by the recipe
  const found = (chef.inventory || []).find(i => i.type === targetType && !recipe.requires.includes(i.name));
  return found || null;
}

// Preview exact Likes & Garbage outcome before cooking
function previewCook(chef, recipe, { useAddon = false, state = null } = {}) {
  const rest = restaurantOf(chef);
  const { tofuUsed } = missingFor(chef, recipe);
  const baseLikes = recipe.likes;
  const cuisineBonus = recipe.cuisine === rest.cuisine ? 1 : 0;
  const addonItem = useAddon ? eligibleAddonFor(chef, recipe) : null;
  const addonBonus = addonItem ? 1 : 0;
  const reviewBonus = chef.reviewBonusToday || 0;
  const cleanCelebrityBonus = (hasUpgrade(chef, 'upg_celebrity') && (chef.garbage || 0) === 0) ? 1 : 0;
  const milestoneBonus = chef.milestoneCookBonus || 0;
  const eventBonus = (state?.dailyEvent?.effect === 'gourmet_festival' && recipe.isGourmet) ? 1 : 0;
  const cashBonus = (chef.id === 'sau' ? 50 : 0)
    + (state?.dailyEvent?.effect === 'cook_cash_bonus' ? D.COOK_CASH_BONUS : 0);

  // Double Cooktop simultaneous rule: both dishes use the garbage count BEFORE this turn's cooking
  const effectiveGarbage = (chef.cookedToday || 0) > 0 && typeof chef.garbageBeforeCook === 'number'
    ? chef.garbageBeforeCook
    : (chef.garbage || 0);

  const grossLikes = baseLikes + cuisineBonus + addonBonus + reviewBonus + cleanCelebrityBonus + milestoneBonus + eventBonus;
  // Official Rulebook: a cooked recipe's popularity value cannot drop below 0!
  const netLikes = Math.max(0, grossLikes - effectiveGarbage);
  const addedGarbage = Math.max(0, (recipe.garbage ?? (recipe.isGourmet ? 2 : 1)) - tofuUsed);

  return {
    baseLikes, cuisineBonus, addonBonus, addonItem, reviewBonus,
    cleanCelebrityBonus, milestoneBonus, eventBonus, cashBonus, garbagePenalty: effectiveGarbage,
    grossLikes, netLikes, addedGarbage, tofuUsed,
  };
}

function addWild(s, chef) {
  if (chef.inventory.length < capacity(chef)) {
    chef.inventory.push({
      id: newId(s, 'wild'),
      name: 'Gia Vị Ảo Thuật',
      cost: 300,
      emoji: '✨',
      type: 'wild',
      market: 'mystery',
      special: 'Thay thế bất kỳ 1 nguyên liệu bắt buộc nào khi nấu món!',
    });
    return 'thêm 1 Gia Vị Ảo Thuật ✨';
  }
  chef.money += 200;
  return 'kho đầy, đổi thành +$200';
}

function trashItem(s, chef, itemId) {
  const idx = chef.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) fail('Món này không còn trong kho.');
  const [thrown] = chef.inventory.splice(idx, 1);
  const tpl = ingredient(thrown.name);
  if (tpl) s.dumpster.push(tpl);
  return thrown;
}

// Grant Restaurant Popularity Level-Up Bonuses at 3⭐, 7⭐, 12⭐
function checkRestaurantMilestones(s, chef) {
  const rest = restaurantOf(chef);
  chef.unlockedMilestones = chef.unlockedMilestones || [];
  const newlyUnlocked = [];
  for (const pt of D.MILESTONE_POINTS) {
    if (chef.likes >= pt && !chef.unlockedMilestones.includes(pt)) {
      chef.unlockedMilestones.push(pt);
      const m = rest.milestones[pt];
      if (!m) continue;
      if (m.effect === 'cash') {
        chef.money += m.amount;
      } else if (m.effect === 'income') {
        chef.milestoneIncomeBonus = (chef.milestoneIncomeBonus || 0) + m.amount;
      } else if (m.effect === 'card') {
        chef.actionCards.push(actionCard(s, pick(s, D.ACTION_CARDS).type));
      } else if (m.effect === 'card_and_clean') {
        chef.actionCards.push(actionCard(s, pick(s, D.ACTION_CARDS).type));
        chef.garbage = Math.max(0, (chef.garbage || 0) - m.amount);
      } else if (m.effect === 'clean_all_cash') {
        chef.garbage = 0;
        chef.money += m.amount;
      } else if (m.effect === 'cook_bonus') {
        chef.milestoneCookBonus = (chef.milestoneCookBonus || 0) + m.amount;
      } else if (m.effect === 'pantry') {
        chef.milestonePantryBonus = (chef.milestonePantryBonus || 0) + m.amount;
      } else if (m.effect === 'income_and_clean') {
        chef.milestoneIncomeBonus = (chef.milestoneIncomeBonus || 0) + m.amount;
        chef.garbage = Math.max(0, (chef.garbage || 0) - 1);
      } else if (m.effect === 'wild') {
        addWild(s, chef);
      } else if (m.effect === 'discount') {
        chef.milestoneDiscount = (chef.milestoneDiscount || 0) + m.amount;
      } else if (m.effect === 'cash_and_clean2') {
        chef.money += m.amount;
        chef.garbage = Math.max(0, (chef.garbage || 0) - 2);
      } else if (m.effect === 'card_and_cash') {
        chef.actionCards.push(actionCard(s, pick(s, D.ACTION_CARDS).type));
        chef.money += m.amount;
      } else if (m.effect === 'seafood_discount') {
        chef.milestoneSeafoodDiscount = (chef.milestoneSeafoodDiscount || 0) + m.amount;
      } else if (m.effect === 'cash_and_clean') {
        chef.money += m.amount;
        chef.garbage = Math.max(0, (chef.garbage || 0) - 1);
      } else if (m.effect === 'pantry_and_card') {
        chef.milestonePantryBonus = (chef.milestonePantryBonus || 0) + m.amount;
        chef.actionCards.push(actionCard(s, pick(s, D.ACTION_CARDS).type));
      } else if (m.effect === 'pantry_and_cash') {
        chef.milestonePantryBonus = (chef.milestonePantryBonus || 0) + 1;
        chef.money += m.amount;
      } else if (m.effect === 'clean_and_wild') {
        chef.garbage = 0;
        addWild(s, chef);
      }
      if (pt >= 7 && chef.level < 2) chef.level = 2;
      newlyUnlocked.push({ point: pt, label: m.label });
      say(s, `🌟 ${chefName(chef.id)} (${rest.shortName}) đạt mốc ${pt}⭐: ${m.label}!`);
    }
  }
  return newlyUnlocked;
}

function flushPendingGarbage(chef) {
  if (chef.pendingGarbage > 0) {
    chef.garbage = (chef.garbage || 0) + chef.pendingGarbage;
    chef.pendingGarbage = 0;
  }
  chef.garbageBeforeCook = null;
}

function cook(s, chef, recipe, opts = {}) {
  if ((chef.cookedToday || 0) >= cookLimit(chef)) {
    fail(hasUpgrade(chef, 'upg_double_cooktop')
      ? 'Hôm nay bạn đã nấu đủ 2 món trên Bếp Đôi.'
      : 'Mỗi ngày chỉ nấu được 1 món! Mua 🔥 Bếp Đôi ở Chợ Bến Thành để nấu 2 món/ngày.');
  }
  if (!canCook(chef, recipe)) fail('Chưa đủ nguyên liệu để nấu món này.');

  if ((chef.cookedToday || 0) === 0) {
    chef.garbageBeforeCook = chef.garbage || 0;
  }

  const useAddon = opts.useAddon === true;
  const breakdown = previewCook(chef, recipe, { useAddon, state: s });

  // Consume required ingredients (exact → Tofu for meat → Wild)
  for (const req of recipe.requires) {
    const reqLower = req.toLowerCase();
    let idx = chef.inventory.findIndex(i => i.type !== 'wild' && i.name.toLowerCase().includes(reqLower));
    if (idx === -1) {
      const reqTpl = ingredient(req);
      if (reqTpl && reqTpl.type === 'meat') {
        idx = chef.inventory.findIndex(i => i.type === 'tofu');
      }
    }
    if (idx === -1) idx = chef.inventory.findIndex(i => i.type === 'wild');
    const [used] = chef.inventory.splice(idx, 1);
    const tpl = ingredient(used.name);
    if (tpl) s.dumpster.push(tpl);
  }

  // Consume optional Wine / Secret Sauce add-on if selected
  if (breakdown.addonItem) {
    const aIdx = chef.inventory.findIndex(i => i.id === breakdown.addonItem.id);
    if (aIdx !== -1) {
      const [usedAddon] = chef.inventory.splice(aIdx, 1);
      const tpl = ingredient(usedAddon.name);
      if (tpl) s.dumpster.push(tpl);
    }
  }

  if (chef.reviewBonusToday > 0) chef.reviewBonusToday = 0;
  if (chef.id === 'sau') chef.money += 50;
  const eventCashBonus = s?.dailyEvent?.effect === 'cook_cash_bonus' ? D.COOK_CASH_BONUS : 0;
  if (eventCashBonus > 0) chef.money += eventCashBonus;

  chef.likes += breakdown.netLikes;
  chef.cookedCount += 1;
  chef.cookedToday = (chef.cookedToday || 0) + 1;
  chef.tierIdx = Math.max(chef.tierIdx, tierFromLikes(chef.likes));

  // Double Cooktop: defer new garbage until both dishes finish or turn ends!
  if (hasUpgrade(chef, 'upg_double_cooktop') && chef.cookedToday < 2) {
    chef.pendingGarbage = (chef.pendingGarbage || 0) + breakdown.addedGarbage;
  } else {
    chef.garbage = (chef.garbage || 0) + (chef.pendingGarbage || 0) + breakdown.addedGarbage;
    chef.pendingGarbage = 0;
    chef.garbageBeforeCook = null;
  }

  const deck = recipe.isGourmet ? D.GOURMET_RECIPES : D.BASIC_RECIPES;
  const active = chef.activeRecipes.map(r => r.name);
  const pool = deck.filter(r => !active.includes(r.name));
  chef.activeRecipes[chef.activeRecipes.indexOf(recipe)] = dealRecipe(s, pick(s, pool.length ? pool : deck));

  const tags = [];
  if (breakdown.cuisineBonus) tags.push('+1⭐ Đặc sản');
  if (breakdown.eventBonus) tags.push('+1⭐ Lễ Hội');
  if (breakdown.addonBonus) tags.push(`+1⭐ ${breakdown.addonItem.name}`);
  if (breakdown.reviewBonus) tags.push(`+${breakdown.reviewBonus}⭐ 5 Sao`);
  if (eventCashBonus) tags.push(`+$${eventCashBonus} Bo Hậu`);
  if (breakdown.garbagePenalty) tags.push(`-${breakdown.garbagePenalty}⭐ Rác`);
  if (breakdown.addedGarbage) tags.push(`+${breakdown.addedGarbage}🗑️`);
  const detail = tags.length ? ` [${tags.join(', ')}]` : '';

  say(s, `🍳 ${chefName(chef.id)} nấu xong ${recipe.name} (+${breakdown.netLikes} ⭐${detail}, tổng ${chef.likes}⭐).`);

  checkRestaurantMilestones(s, chef);
  trackPeakMoney(chef);

  if (chef.likes >= D.WIN_LIKES && !s.over) {
    s.over = true;
    s.winner = chef.id;
    recordDaySnapshot(s);
    say(s, `🏆 ${chefName(chef.id)} (${restaurantOf(chef).name}) đạt ${chef.likes} ⭐ và CHIẾN THẮNG NGAY LẬP TỨC! 🎉`);
  }
  return breakdown.netLikes;
}

module.exports = {
  GameError, fail, rand, pick, shuffle, newId, chefName, marketName, restaurantOf, say,
  ingredient, item, dealRecipe, actionCard, order, round, hasUpgrade, capacity, buyLimit, cookLimit,
  tierFromLikes, dailyIncome, dailyPerk, isRegularMarket, marketSurchargeOwner, cardCost,
  garbageDisposalCost, chocolateSellValue, actionCardCost,
  ensureStats, trackPeakMoney, syncAllPeakMoney, recordDaySnapshot, rollDailyEvent,
  buildMarketDecks, refillMarketCounters, isClosed, claimKey, claimHolder,
  missingFor, canCook, needs, eligibleAddonFor, previewCook, addWild, trashItem,
  checkRestaurantMilestones, flushPendingGarbage, cook,
};
