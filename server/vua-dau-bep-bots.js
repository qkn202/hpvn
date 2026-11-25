'use strict';

// Smart AI Bots for Real-Time Simultaneous Rival Restaurants Online Engine:
// - Picks optimal markets in Phase 1 (Island for Chocolate/Garbage/Upgrades, high-value Counters)
// - Participates in live Bidding Wars (botAuctionResponse)
// - Plays at most 1 Action Card/day & shops ~8s into Phase 2 (botShopAndCard)
// - Cooks in Phase 3 stopping immediately upon reaching 20⭐ (botCookAll)
const D = require('./vua-dau-bep-data');
const R = require('./vua-dau-bep-rules');

function chooseMarket(s, chef) {
  const banned = (s.bans || []).filter(b => b.chef === chef.id).map(b => b.market);
  const open = key => !R.isClosed(s, key) && !banned.includes(key);

  const hasChoc = chef.inventory.some(i => i.type === 'chocolate');
  if (hasChoc || ((chef.garbage || 0) >= 2 && chef.money >= D.GARBAGE_DISPOSAL_COST * 2)) return 'island';
  if (chef.money >= 550 && chef.upgrades.length < D.MAX_UPGRADES && R.rand(s) < 0.45) return 'island';

  const scores = {};
  for (const name of R.needs(chef)) {
    for (const key of D.MARKET_KEYS) {
      if (!open(key)) continue;
      const mState = s.markets?.[key];
      const counterMatch = mState?.counter?.some(sl => sl?.card?.name === name && !sl.claimedBy);
      const tpl = D.MARKETS[key].cards.find(c => c.name === name);
      if (!tpl) continue;
      if (R.cardCost(chef, tpl, key, { state: s }) > chef.money) continue;
      if (counterMatch) scores[key] = (scores[key] || 0) + 3;
      else if (mState?.shelf?.length) scores[key] = (scores[key] || 0) + 1;
    }
  }
  const keys = Object.keys(scores);
  if (keys.length) {
    const best = Math.max(...keys.map(k => scores[k]));
    return R.pick(s, keys.filter(k => scores[k] === best));
  }
  if ((chef.garbage || 0) >= 1 && chef.money >= D.GARBAGE_DISPOSAL_COST) return 'island';
  if (chef.money >= D.ACTION_CARD_COST + 100 && chef.actionCards.length < 2) return 'island';
  const any = D.MARKET_KEYS.filter(open);
  return any.length ? R.pick(s, any) : 'island';
}

function playOneCard(s, chef) {
  if (!chef.actionCards.length || chef.cardDay === s.day) return;
  const others = Object.values(s.chefs).filter(c => c !== chef);
  const byLeader = [...others].sort((a, b) => b.likes - a.likes);
  const find = (...types) => chef.actionCards.find(c => types.includes(c.type));
  let card = null;
  let text = '';

  if ((card = find('lucky_money'))) {
    chef.money += 200; text = 'nhận Lì Xì Bếp Trưởng +$200';
  } else if ((card = find('five_star_review')) && chef.activeRecipes.some(r => R.canCook(chef, r))) {
    chef.reviewBonusToday = (chef.reviewBonusToday || 0) + 2;
    text = 'dùng Đánh Giá 5 Sao (+2⭐ cho món nấu hôm nay)';
  } else if ((card = find('wild_substitute')) && chef.inventory.length < R.capacity(chef)
    && chef.activeRecipes.some(r => R.missingFor(chef, r).missing.length === 1)) {
    text = `dùng Ảo Thuật Ẩm Thực (${R.addWild(s, chef)})`;
  } else {
    card = null;
    const dumpG = find('dump_garbage'), stealMoney = find('steal_money'), stealItem = find('steal_item'), close = find('close_market');
    const moneyTarget = byLeader.find(c => !R.hasUpgrade(c, 'upg_bouncer') && c.money > 0) || byLeader.find(c => c.money > 0);
    const itemTarget = byLeader.find(c => !R.hasUpgrade(c, 'upg_bouncer') && c.inventory.length > 0) || byLeader.find(c => c.inventory.length > 0);
    const closeTarget = byLeader.find(c => D.MARKET_KEYS.includes(c.currentLocation) && c.currentLocation !== chef.currentLocation && !R.isClosed(s, c.currentLocation));

    if (dumpG && byLeader[0] && (chef.garbage || 0) > 0) {
      const target = byLeader[0];
      if (R.hasUpgrade(target, 'upg_bouncer') && R.rand(s) < 0.5) text = `định đổ rác sang ${R.chefName(target.id)} nhưng bị Bảo Vệ chặn`;
      else { chef.garbage = Math.max(0, chef.garbage - 1); target.garbage = (target.garbage || 0) + 1; text = `đổ 1 Túi Rác 🗑️ sang ${R.chefName(target.id)}`; }
      card = dumpG;
    } else if (stealMoney && moneyTarget) {
      if (R.hasUpgrade(moneyTarget, 'upg_bouncer') && R.rand(s) < 0.5) text = `định cướp tiền của ${R.chefName(moneyTarget.id)} nhưng bị Bảo Vệ chặn`;
      else { const amt = Math.min(100, moneyTarget.money); moneyTarget.money -= amt; chef.money += amt; text = `cướp $${amt} của ${R.chefName(moneyTarget.id)}`; }
      card = stealMoney;
    } else if (stealItem && itemTarget && chef.inventory.length < R.capacity(chef)) {
      if (R.hasUpgrade(itemTarget, 'upg_bouncer') && R.rand(s) < 0.5) text = `định trộm đồ của ${R.chefName(itemTarget.id)} nhưng bị Bảo Vệ chặn`;
      else { const [taken] = itemTarget.inventory.splice(Math.floor(R.rand(s) * itemTarget.inventory.length), 1); chef.inventory.push(taken); text = `trộm ${taken.emoji} ${taken.name} của ${R.chefName(itemTarget.id)}`; }
      card = stealItem;
    } else if (close && closeTarget) {
      s.closed.push({ market: closeTarget.currentLocation, by: chef.id, left: 1 });
      card = close; text = `phong tỏa ${R.marketName(closeTarget.currentLocation)}`;
    }
  }
  if (!card) return;
  chef.actionCards = chef.actionCards.filter(c => c !== card);
  chef.cardDay = s.day;
  R.say(s, `🃏 ${R.chefName(chef.id)} ${text}.`);
}

function trashIfFull(s, chef) {
  if (chef.inventory.length < R.capacity(chef)) return;
  const wanted = R.needs(chef);
  const keepTypes = new Set(['wild', 'tofu', 'wine', 'secret_sauce', 'chocolate']);
  const spare = chef.inventory.find(i => !keepTypes.has(i.type) && !wanted.includes(i.name))
    || chef.inventory.find(i => i.type !== 'wild' && !wanted.includes(i.name));
  if (spare) R.trashItem(s, chef, spare.id);
}

function shop(s, chef) {
  const key = chef.currentLocation;
  if (R.isClosed(s, key)) return;
  if (key === 'island') {
    let chocIdx;
    while ((chocIdx = chef.inventory.findIndex(i => i.type === 'chocolate')) !== -1) {
      const [sold] = chef.inventory.splice(chocIdx, 1);
      const tpl = R.ingredient(sold.name); if (tpl) s.dumpster.push(tpl);
      chef.money += D.CHOCOLATE_SELL_VALUE;
      R.say(s, `🍫 ${R.chefName(chef.id)} bán Sô-cô-la Đặc Sản thu +$${D.CHOCOLATE_SELL_VALUE}!`);
    }
    if ((chef.garbage || 0) > 0 && chef.money >= D.GARBAGE_DISPOSAL_COST) {
      const qty = Math.min(chef.garbage, Math.floor(chef.money / D.GARBAGE_DISPOSAL_COST));
      if (qty > 0) { chef.money -= qty * D.GARBAGE_DISPOSAL_COST; chef.garbage -= qty; R.say(s, `🧹 ${R.chefName(chef.id)} trả $${qty * D.GARBAGE_DISPOSAL_COST} dọn ${qty} Túi Rác.`); }
    }
    if (chef.upgrades.length < D.MAX_UPGRADES) {
      const preferred = ['upg_double_cooktop', 'upg_marketing', 'upg_vip', 'upg_freezer', 'upg_celebrity', 'upg_bouncer', 'upg_delivery'];
      const upgrade = preferred.map(id => D.UPGRADES.find(u => u.id === id)).find(u => u && !R.hasUpgrade(chef, u.id) && chef.money >= u.cost + 150);
      if (upgrade) { chef.money -= upgrade.cost; chef.upgrades.push({ ...upgrade }); R.say(s, `🛠️ ${R.chefName(chef.id)} mua nâng cấp ${upgrade.icon} ${upgrade.name}.`); }
    }
    if (chef.money >= D.ACTION_CARD_COST + 150 && chef.actionCards.length < 2) {
      chef.money -= D.ACTION_CARD_COST;
      chef.actionCards.push(R.actionCard(s, R.pick(s, D.ACTION_CARDS).type));
    }
    const wanted = R.needs(chef);
    const found = s.dumpster.findIndex(d => wanted.includes(d.name));
    if (found !== -1 && chef.inventory.length < R.capacity(chef) && chef.dumpsterDay !== s.day) {
      const [dug] = s.dumpster.splice(found, 1);
      chef.inventory.push({ id: R.newId(s, 'ing'), ...dug });
      chef.dumpsterDay = s.day;
    }
    return;
  }

  const mState = s.markets?.[key];
  if (!mState) return;
  let boughtHere = 0;
  for (const slot of mState.counter) {
    if (chef.inventory.length >= R.capacity(chef)) break;
    if (!slot || !slot.card || slot.claimedBy) continue;
    const card = slot.card;
    const isSpecialGood = ['wild', 'tofu', 'chocolate'].includes(card.type)
      || (card.type === 'wine' && chef.activeRecipes.some(r => r.isGourmet))
      || (card.type === 'secret_sauce' && chef.activeRecipes.some(r => !r.isGourmet));
    if (!R.needs(chef).includes(card.name) && !isSpecialGood) continue;
    const cost = R.cardCost(chef, card, key, { fromShelf: false, state: s });
    if (chef.money < cost) continue;
    chef.money -= cost;
    const surchargeOwner = R.marketSurchargeOwner(s, chef, key);
    if (surchargeOwner) surchargeOwner.money += 50;
    const bought = { id: R.newId(s, 'ing'), ...card, cost };
    chef.inventory.push(bought);
    const claim = { id: chef.id, itemInstanceId: bought.id, baseCost: cost, bribeCost: 50, left: 1 };
    slot.claimedBy = claim;
    s.claims[R.claimKey(key, slot.slotIdx)] = claim;
    chef.boughtCountToday += 1;
    boughtHere += 1;
    R.say(s, `🛒 ${R.chefName(chef.id)} mua ${card.emoji} ${card.name} ($${cost}).`);
  }

  if (boughtHere === 0 && mState.shelf.length > 0 && chef.inventory.length < R.capacity(chef)) {
    const shelfCost = R.cardCost(chef, { cost: D.MARKETS[key].cost }, key, { fromShelf: true, state: s });
    const hasNeededInMarket = R.needs(chef).some(n => D.MARKETS[key].cards.some(c => c.name === n));
    if (hasNeededInMarket && chef.money >= shelfCost) {
      const drawn = mState.shelf.shift();
      chef.money -= shelfCost;
      const surchargeOwner = R.marketSurchargeOwner(s, chef, key);
      if (surchargeOwner) surchargeOwner.money += 50;
      chef.inventory.push({ id: R.newId(s, 'ing'), ...drawn, cost: shelfCost });
      chef.boughtCountToday += 1;
      R.say(s, `📦 ${R.chefName(chef.id)} bốc Kệ Úp ${R.marketName(key)} được ${drawn.emoji} ${drawn.name} ($${shelfCost}).`);
    }
  }
}

function botShopAndCard(s, chef) {
  playOneCard(s, chef);
  trashIfFull(s, chef);
  shop(s, chef);
}

function botCookAll(s, chef) {
  const candidates = [...chef.activeRecipes].sort((a, b) => b.likes - a.likes);
  for (const recipe of candidates) {
    if (s.over) break;
    if (!R.canCook(chef, recipe)) continue;
    const previewNoAddon = R.previewCook(chef, recipe, { useAddon: false });
    if (previewNoAddon.netLikes === 0 && (chef.garbage || 0) >= 2 && chef.money >= D.GARBAGE_DISPOSAL_COST) continue;
    R.cook(s, chef, recipe, { useAddon: !!R.eligibleAddonFor(chef, recipe) });
  }
}

function botAuctionResponse(s, bot, auc) {
  if (!bot || bot.inventory.length >= R.capacity(bot)) return 0;
  const maxWilling = Math.min(bot.money, auc.baseCost + (R.needs(bot).includes(auc.card.name) ? 100 : 50));
  if (auc.currentBid + 50 <= maxWilling) return 50;
  return 0;
}

function acceptsTrade(s, chef, give, want) {
  const wanted = R.needs(chef);
  if (give.garbage) {
    const reqMoney = (chef.garbage || 0) === 0 ? 100 * give.garbage : 150 * give.garbage;
    if ((give.money || 0) >= reqMoney && !want.item && !want.money) return true;
    if (give.item && wanted.includes(give.item.name) && (!want.item || !wanted.includes(want.item.name))) return true;
    return false;
  }
  if (want.garbage && !want.item && (!want.money || want.money <= 100)) return true;
  if (give.item && wanted.includes(give.item.name)) return true;
  const wantNeeded = !!want.item && wanted.includes(want.item.name);
  if ((give.money || 0) >= 200 && !wantNeeded) return true;
  if (wantNeeded) return false;
  return R.rand(s) > 0.35;
}

module.exports = { chooseMarket, botShopAndCard, botCookAll, botAuctionResponse, acceptsTrade };
