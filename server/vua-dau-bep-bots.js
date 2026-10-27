'use strict';

// The market chefs (and the autopilot of a member who missed the turn deadline): upstream's AI, on the
// seeded state. One call plays a whole turn: pick a market, maybe one action card, shop, cook.
const D = require('./vua-dau-bep-data');
const R = require('./vua-dau-bep-rules');

function chooseMarket(s, chef) {
  const banned = s.bans.filter(b => b.chef === chef.id).map(b => b.market);
  const open = key => !R.isClosed(s, key) && !banned.includes(key);
  if (chef.money >= 650 && chef.upgrades.length < 4 && R.rand(s) < 0.4) return 'island';
  const scores = {};
  for (const name of R.needs(chef)) {
    for (const key of D.MARKET_KEYS) {
      const card = D.MARKETS[key].cards.find(c => c.name === name);
      if (card && open(key) && R.cardCost(chef, card, key) <= chef.money) scores[key] = (scores[key] || 0) + 1;
    }
  }
  const keys = Object.keys(scores);
  if (keys.length) {
    const best = Math.max(...keys.map(k => scores[k]));
    return R.pick(s, keys.filter(k => scores[k] === best));
  }
  if (chef.money >= 200 && chef.actionCards.length < 3) return 'island';
  const any = D.MARKET_KEYS.filter(open);
  return any.length ? R.pick(s, any) : 'island';
}

// At most one card a turn, only when it helps (upstream aiPlayOneCard).
function playOneCard(s, chef) {
  if (!chef.actionCards.length || chef.cardDay === s.day) return;
  const others = Object.values(s.chefs).filter(c => c !== chef);
  const byLeader = [...others].sort((a, b) => b.likes - a.likes);
  const find = (...types) => chef.actionCards.find(c => types.includes(c.type));
  const canHit = c => !R.hasUpgrade(c, 'upg_bouncer');
  let card = null;
  let text = '';
  if ((card = find('lucky_money'))) {
    chef.money += 150; text = 'nhận Lì Xì Bếp Trưởng +$150';
  } else if ((card = find('wild_substitute')) && chef.inventory.length < R.capacity(chef)
    && chef.activeRecipes.some(r => R.missingFor(chef, r).missing.length === 1)) {
    text = `dùng Ảo Thuật Ẩm Thực (${R.addWild(s, chef)})`;
  } else {
    card = null;
    const stealMoney = find('steal_money'), stealItem = find('steal_item'), close = find('close_market'), kick = find('kick_opponent');
    const moneyTarget = byLeader.find(c => !R.hasUpgrade(c, 'upg_bouncer') && c.money > 0) || byLeader.find(c => c.money > 0);
    const itemTarget = byLeader.find(c => !R.hasUpgrade(c, 'upg_bouncer') && c.inventory.length > 0) || byLeader.find(c => c.inventory.length > 0);
    const closeTarget = byLeader.find(c => D.MARKET_KEYS.includes(c.currentLocation) && c.currentLocation !== chef.currentLocation && !R.isClosed(s, c.currentLocation));
    if (stealMoney && moneyTarget) {
      const defended = R.hasUpgrade(moneyTarget, 'upg_bouncer') && R.rand(s) < 0.5;
      if (defended) {
        card = stealMoney; text = `định cướp tiền của ${R.chefName(moneyTarget.id)} nhưng bị Bảo Vệ Quán 24/7 chặn đứng (50%)`;
      } else {
        const amount = Math.min(100, moneyTarget.money);
        moneyTarget.money -= amount; chef.money += amount;
        card = stealMoney; text = `cướp $${amount} của ${R.chefName(moneyTarget.id)}${R.hasUpgrade(moneyTarget, 'upg_bouncer') ? ' (vượt qua Bảo Vệ 50%)' : ''}`;
      }
    } else if (stealItem && itemTarget && chef.inventory.length < R.capacity(chef)) {
      const defended = R.hasUpgrade(itemTarget, 'upg_bouncer') && R.rand(s) < 0.5;
      if (defended) {
        card = stealItem; text = `định trộm nguyên liệu của ${R.chefName(itemTarget.id)} nhưng bị Bảo Vệ Quán 24/7 chặn đứng (50%)`;
      } else {
        const [taken] = itemTarget.inventory.splice(Math.floor(R.rand(s) * itemTarget.inventory.length), 1);
        chef.inventory.push(taken);
        card = stealItem; text = `bốc trộm ${taken.emoji} ${taken.name} của ${R.chefName(itemTarget.id)}${R.hasUpgrade(itemTarget, 'upg_bouncer') ? ' (vượt qua Bảo Vệ 50%)' : ''}`;
      }
    } else if (close && closeTarget) {
      s.closed.push({ market: closeTarget.currentLocation, by: chef.id, left: R.round(s) });
      card = close; text = `phong tỏa ${R.marketName(closeTarget.currentLocation)}`;
    } else if (kick && D.MARKET_KEYS.includes(chef.currentLocation)) {
      s.bans.push({ chef: byLeader[0].id, market: chef.currentLocation, by: chef.id });
      card = kick; text = `cấm ${R.chefName(byLeader[0].id)} vào ${R.marketName(chef.currentLocation)} ở lượt tới`;
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
  const spare = chef.inventory.find(i => i.type !== 'wild' && !wanted.includes(i.name));
  if (spare) R.trashItem(s, chef, spare.id);
}

function shop(s, chef) {
  const key = chef.currentLocation;
  if (R.isClosed(s, key)) return;
  if (key === 'island') {
    if (chef.upgrades.length < 4) {
      const options = D.UPGRADES.filter(u => !R.hasUpgrade(chef, u.id) && chef.money >= u.cost + 200);
      if (options.length) {
        const upgrade = R.pick(s, options);
        chef.money -= upgrade.cost; chef.upgrades.push({ ...upgrade });
        R.say(s, `🛠️ ${R.chefName(chef.id)} mua nâng cấp ${upgrade.icon} ${upgrade.name}.`);
      }
    }
    if (chef.money >= D.ACTION_CARD_COST + 100 && chef.actionCards.length < 3) {
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
  for (const card of D.MARKETS[key].cards) {
    if (chef.boughtCountToday >= R.buyLimit(chef) || chef.inventory.length >= R.capacity(chef)) break;
    if (s.claims[R.claimKey(key, card.name)] || !R.needs(chef).includes(card.name)) continue;
    const cost = R.cardCost(chef, card, key);
    if (chef.money < cost) continue;
    chef.money -= cost;
    const bought = { id: R.newId(s, 'ing'), ...card, cost };
    chef.inventory.push(bought);
    s.claims[R.claimKey(key, card.name)] = { id: chef.id, itemInstanceId: bought.id, baseCost: cost, bribeCost: 50, left: R.round(s) };
    chef.boughtCountToday += 1;
    R.say(s, `🛒 ${R.chefName(chef.id)} mua ${card.emoji} ${card.name} ($${cost}).`);
  }
}

function cookAll(s, chef) {
  for (const recipe of [...chef.activeRecipes]) if (R.canCook(chef, recipe)) R.cook(s, chef, recipe);
}

/** Plays what is left of this chef's turn; the caller ends the turn. */
function autoTurn(s, chef) {
  if (s.phase === 1) {
    chef.currentLocation = chooseMarket(s, chef);
    R.say(s, `📍 ${R.chefName(chef.id)} đi ${R.marketName(chef.currentLocation)}.`);
    playOneCard(s, chef);
    trashIfFull(s, chef);
    shop(s, chef);
  }
  cookAll(s, chef);
}

/** Would this market chef take the deal? (upstream barter: a needed item always, $200+ for a spare, else a coin flip) */
function acceptsTrade(s, chef, giveItem, giveMoney, wantItem) {
  const wanted = R.needs(chef);
  if (giveItem && wanted.includes(giveItem.name)) return true;
  const wantNeeded = !!wantItem && wanted.includes(wantItem.name);
  if (giveMoney >= 200 && !wantNeeded) return true;
  if (wantNeeded) return false;
  return R.rand(s) > 0.35;
}

module.exports = { autoTurn, acceptsTrade, chooseMarket };
