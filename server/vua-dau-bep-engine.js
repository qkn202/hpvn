'use strict';

// Vua Đầu Bếp turn engine, run only by the server. Asynchronous play: one in-game day is one turn for
// every chef at the table (2–8 members, bots filling a table to four) in the fixed TURN_ORDER — at a
// two-member table Bếp Sáng (a member), the two market chefs (bots) at noon, Bếp Chiều (a member) — so
// members can play whenever they like. A turn is the upstream day for one chef:
// pick a market (phase 1), shop / trade / play cards (2), cook (3), end. Shelf claims and closures last
// one full round, so whoever plays later can outbid ("bơm tiền") what the earlier player bought, and the
// earlier player gets the same chance the next morning.
const D = require('./vua-dau-bep-data');
const R = require('./vua-dau-bep-rules');
const { autoTurn, acceptsTrade } = require('./vua-dau-bep-bots');

const { fail } = R;
/** humans: the members' chefs; bots take the next free chefs of SEAT_PICK until the table has four. */
function newGame(seed, humans = ['lola', 'angus']) {
  const s = {
    v: 1, rng: seed >>> 0, seq: 0, day: 1, turn: 0, phase: 1, over: false, finalDay: false, winner: null,
    humans: [...humans], chefs: {}, claims: {}, closed: [], bans: [], dumpster: [], offers: [], refused: [], log: [],
  };
  const seated = [...humans];
  for (const id of D.SEAT_PICK) if (seated.length < D.MIN_CHEFS && !seated.includes(id)) seated.push(id);
  const basics = R.shuffle(s, D.BASIC_RECIPES);
  const gourmets = R.shuffle(s, D.GOURMET_RECIPES);
  s.turnOrder = D.TURN_ORDER.filter(id => seated.includes(id));
  s.turnOrder.forEach((id, i) => {
    const basic = R.dealRecipe(s, basics[i]);
    const gourmet = R.dealRecipe(s, gourmets[i]);
    const first = basic.requires[0];
    const starters = [first, gourmet.requires.find(name => name !== first) || gourmet.requires[0]];
    if (id === 'lucrezia') starters.push('Rau Thơm & Dưa Leo'); // Dì Năm's perk: one more starting ingredient
    s.chefs[id] = {
      id, money: 300, likes: 0, tierIdx: 0, level: 1, cookedCount: 0, currentLocation: D.CHEFS[id].start,
      inventory: starters.map(name => R.item(s, name)), activeRecipes: [basic, gourmet],
      actionCards: D.CHEFS[id].cards.map(type => R.actionCard(s, type)), upgrades: [], garbageCan: [],
      boughtCountToday: 0, deliveryUsedToday: false, dumpsterDay: 0, cardDay: 0,
    };
  });
  s.dumpster = D.STARTING_DUMPSTER.map(R.ingredient);
  R.say(s, `🎉 Ván mới! Mỗi ngày đi chợ lần lượt: ${R.order(s).map(id => `${R.chefName(id)}${s.humans.includes(id) ? '' : ' 🤖'}`).join(' → ')}. Ai đạt ${D.WIN_LIKES} ⭐ trước sẽ thắng ngay lập tức! Thứ tự lượt chơi sẽ random sau mỗi ngày.`);
  advance(s);
  return s;
}

const currentChef = s => (s.over ? null : s.chefs[R.order(s)[s.turn]]);
const needPhase = (s, ...phases) => { if (!phases.includes(s.phase)) fail(s.phase === 1 ? 'Hãy chọn quầy chợ trước.' : 'Bước này đã qua trong lượt của bạn.'); };
const needIsland = chef => { if (chef.currentLocation !== 'island') fail('Chỉ làm được khi đứng ở Chợ Bến Thành.'); };
const otherChef = (s, chef, id) => { const c = s.chefs[id]; if (!c || c === chef) fail('Hãy chọn một đối thủ.'); return c; };

function tradePart(chef, part) {
  if (part && typeof part.item === 'string') {
    const found = chef.inventory.find(i => i.id === part.item);
    if (!found) fail(`${R.chefName(chef.id)} không còn món đó.`);
    return { item: found };
  }
  if (part && Number.isSafeInteger(part.money) && part.money > 0 && part.money <= 2000) {
    if (chef.money < part.money) fail(`${R.chefName(chef.id)} không đủ $${part.money}.`);
    return { money: part.money };
  }
  return fail('Đề nghị đổi đồ không hợp lệ.');
}
const partLabel = part => (part.item ? `${part.item.emoji} ${part.item.name}` : `$${part.money}`);
function swap(a, b, give, want) {
  const net = (want.item ? 1 : 0) - (give.item ? 1 : 0);
  if (net > 0 && a.inventory.length + net > R.capacity(a)) fail(`Kho của ${R.chefName(a.id)} đã đầy.`);
  if (net < 0 && b.inventory.length - net > R.capacity(b)) fail(`Kho của ${R.chefName(b.id)} đã đầy.`);
  const move = (from, to, part) => {
    if (part.money) { from.money -= part.money; to.money += part.money; return; }
    from.inventory.splice(from.inventory.indexOf(part.item), 1);
    to.inventory.push(part.item);
  };
  move(a, b, give);
  move(b, a, want);
}

const OPS = {
  move(s, chef, { to }) {
    needPhase(s, 1);
    if (to !== 'island' && !D.MARKET_KEYS.includes(to)) fail('Quầy chợ không hợp lệ.');
    if (s.bans.some(b => b.chef === chef.id && b.market === to)) fail('Bạn bị Cưỡng Chế Đổi Chợ: lượt này không được vào quầy này.');
    chef.currentLocation = to;
    s.phase = 2;
    R.say(s, `📍 ${R.chefName(chef.id)} đi ${R.marketName(to)}${R.isClosed(s, to) ? ' (đang bị phong tỏa!)' : ''}.`);
  },
  buy(s, chef, { market, name, bribe }) {
    needPhase(s, 2);
    const template = D.MARKETS[market]?.cards.find(c => c.name === name);
    if (!template) fail('Không có thẻ này ở quầy.');
    const remote = market !== chef.currentLocation;
    if (remote && (!R.hasUpgrade(chef, 'upg_delivery') || chef.deliveryUsedToday)) fail('Bạn không đứng ở quầy này.');
    if (R.isClosed(s, market)) fail('Quầy này đang bị Cục VSATTP phong tỏa.');
    if (!remote && chef.boughtCountToday >= R.buyLimit(chef)) fail(`Lượt này bạn đã mua đủ ${R.buyLimit(chef)} thẻ.`);
    if (chef.inventory.length >= R.capacity(chef)) fail(`Kho đã đầy (${R.capacity(chef)} món). Vứt bớt hoặc mua Tủ Đông.`);
    const key = R.claimKey(market, name);
    const claim = s.claims[key];
    if (claim) {
      const holder = R.claimHolder(s, claim);
      if (!holder) fail(`${name} đã bán hết, chờ quầy về hàng.`);
      if (holder === chef) fail(`Bạn đã mua ${name} rồi.`);
      if (bribe !== 50 && bribe !== 100) fail('Chọn mức bơm tiền $50 hoặc $100.');
      const total = template.cost + bribe;
      if (chef.money < total) fail(`Cần $${total} để bơm tiền tranh mua.`);
      const taken = holder.inventory.splice(holder.inventory.findIndex(i => i.id === claim.itemInstanceId), 1)[0];
      chef.money -= total;
      holder.money += total;
      chef.inventory.push(taken);
      s.claims[key] = { ...claim, id: chef.id, baseCost: total, left: R.round(s) };
      R.say(s, `💥 ${R.chefName(chef.id)} bơm $${bribe} giành ${template.emoji} ${name} từ ${R.chefName(holder.id)} (${R.chefName(holder.id)} nhận $${total}).`);
    } else {
      const cost = R.cardCost(chef, template, market);
      if (chef.money < cost) fail(`Thẻ giá $${cost}, bạn chỉ có $${chef.money}.`);
      chef.money -= cost;
      const bought = { id: R.newId(s, 'ing'), ...template, cost };
      chef.inventory.push(bought);
      s.claims[key] = { id: chef.id, itemInstanceId: bought.id, baseCost: cost, bribeCost: 50, left: R.round(s) };
      R.say(s, `🛒 ${R.chefName(chef.id)} mua ${template.emoji} ${name}${remote ? ' (🛵 giao từ xa)' : ''} ($${cost}).`);
    }
    if (remote) chef.deliveryUsedToday = true; else chef.boughtCountToday += 1;
  },
  draw(s, chef) {
    needPhase(s, 2); needIsland(chef);
    if (chef.money < D.ACTION_CARD_COST) fail(`Thẻ Hành Động giá $${D.ACTION_CARD_COST}.`);
    chef.money -= D.ACTION_CARD_COST;
    const card = R.actionCard(s, R.pick(s, D.ACTION_CARDS).type);
    chef.actionCards.push(card);
    R.say(s, `⚡ ${R.chefName(chef.id)} bốc 1 Thẻ Hành Động.`);
    return { card };
  },
  upgrade(s, chef, { id }) {
    needPhase(s, 2); needIsland(chef);
    const upgrade = D.UPGRADES.find(u => u.id === id);
    if (!upgrade) fail('Nâng cấp không hợp lệ.');
    if (R.hasUpgrade(chef, id)) fail('Bạn đã có nâng cấp này.');
    if (chef.upgrades.length >= 4) fail('Bếp đã đủ 4 nâng cấp.');
    if (chef.money < upgrade.cost) fail(`Nâng cấp giá $${upgrade.cost}.`);
    chef.money -= upgrade.cost;
    chef.upgrades.push({ ...upgrade });
    R.say(s, `🛠️ ${R.chefName(chef.id)} mua nâng cấp ${upgrade.icon} ${upgrade.name}.`);
  },
  dumpster(s, chef, { index }) {
    needPhase(s, 2); needIsland(chef);
    if (chef.dumpsterDay === s.day) fail('Hôm nay bạn đã bới rác rồi (mỗi ngày 1 món).');
    if (!Number.isSafeInteger(index) || !s.dumpster[index]) fail('Món này không còn ở bãi rác.');
    if (chef.inventory.length >= R.capacity(chef)) fail('Kho đã đầy.');
    const [dug] = s.dumpster.splice(index, 1);
    chef.inventory.push({ id: R.newId(s, 'ing'), ...dug });
    chef.dumpsterDay = s.day;
    R.say(s, `🗑️ ${R.chefName(chef.id)} bới được ${dug.emoji} ${dug.name}.`);
  },
  trash(s, chef, { itemId }) {
    const thrown = R.trashItem(s, chef, itemId);
    R.say(s, `🗑️ ${R.chefName(chef.id)} vứt ${thrown.emoji} ${thrown.name} (thùng rác ${chef.garbageCan.length}/3).`);
  },
  play(s, chef, { cardId, target }) {
    const card = chef.actionCards.find(c => c.id === cardId);
    if (!card) fail('Bạn không có thẻ này.');
    needPhase(s, ...(['lucky_money', 'wild_substitute'].includes(card.type) ? [2, 3] : [2]));
    const name = R.chefName(chef.id);
    let text;
    if (card.type === 'steal_money' || card.type === 'steal_item') {
      const victim = otherChef(s, chef, target);
      const defended = R.hasUpgrade(victim, 'upg_bouncer') && R.rand(s) < 0.5;
      if (defended) {
        text = `định ${card.type === 'steal_money' ? 'cướp tiền' : 'trộm nguyên liệu'} của ${R.chefName(victim.id)} nhưng bị Bảo Vệ Quán 24/7 chặn đứng (tỉ lệ 50%)!`;
      } else if (card.type === 'steal_money') {
        const amount = Math.min(100, victim.money);
        victim.money -= amount; chef.money += amount;
        text = `cướp $${amount} của ${R.chefName(victim.id)}${R.hasUpgrade(victim, 'upg_bouncer') ? ' (vượt qua Bảo Vệ 50%)' : ''}`;
      } else {
        if (!victim.inventory.length) fail('Kho của đối thủ đang trống.');
        if (chef.inventory.length >= R.capacity(chef)) fail('Kho của bạn đã đầy.');
        const [taken] = victim.inventory.splice(Math.floor(R.rand(s) * victim.inventory.length), 1);
        chef.inventory.push(taken);
        text = `bốc trộm ${taken.emoji} ${taken.name} của ${R.chefName(victim.id)}${R.hasUpgrade(victim, 'upg_bouncer') ? ' (vượt qua Bảo Vệ 50%)' : ''}`;
      }
    } else if (card.type === 'close_market') {
      if (!D.MARKET_KEYS.includes(target) || R.isClosed(s, target)) fail('Chọn một quầy chợ đang mở.');
      s.closed.push({ market: target, by: chef.id, left: R.round(s) });
      text = `phong tỏa ${R.marketName(target)} trọn một vòng`;
    } else if (card.type === 'kick_opponent') {
      // Async version: the rival may not enter the market you stand in on their next turn.
      if (!D.MARKET_KEYS.includes(chef.currentLocation)) fail('Hãy đứng ở một quầy chợ để cấm đối thủ vào.');
      const victim = otherChef(s, chef, target);
      s.bans.push({ chef: victim.id, market: chef.currentLocation, by: chef.id });
      text = `cấm ${R.chefName(victim.id)} vào ${R.marketName(chef.currentLocation)} ở lượt tới`;
    } else if (card.type === 'lucky_money') {
      chef.money += 150; text = 'nhận Lì Xì Bếp Trưởng +$150';
    } else {
      text = `dùng Ảo Thuật Ẩm Thực (${R.addWild(s, chef)})`;
    }
    chef.actionCards = chef.actionCards.filter(c => c !== card);
    R.say(s, `🃏 ${name} ${text}.`);
  },
  trade(s, chef, { with: id, give, want }) {
    needPhase(s, 2);
    const bot = otherChef(s, chef, id);
    if (s.humans.includes(bot.id)) fail('Với người chơi, hãy gửi lời đề nghị đổi đồ.');
    const mine = tradePart(chef, give);
    const theirs = tradePart(bot, want);
    const key = [s.day, chef.id, bot.id, mine.item?.id || `$${mine.money}`, theirs.item?.id || `$${theirs.money}`].join('|');
    if (s.refused.includes(key)) fail(`${R.chefName(bot.id)} đã từ chối kèo này hôm nay.`);
    if (!acceptsTrade(s, bot, mine.item, mine.money || 0, theirs.item)) {
      s.refused.push(key);
      R.say(s, `❌ ${R.chefName(bot.id)} từ chối đổi ${partLabel(theirs)} lấy ${partLabel(mine)}.`);
      return { accepted: false };
    }
    swap(chef, bot, mine, theirs);
    R.say(s, `🤝 ${R.chefName(chef.id)} đổi ${partLabel(mine)} lấy ${partLabel(theirs)} của ${R.chefName(bot.id)}.`);
    return { accepted: true };
  },
  offer(s, chef, { to, give, want }) {
    const rival = otherChef(s, chef, to);
    if (!s.humans.includes(rival.id)) fail('Bếp chợ trả lời ngay: hãy dùng đổi đồ thường.');
    const mine = tradePart(chef, give);
    const theirs = tradePart(rival, want);
    s.offers = s.offers.filter(o => !(o.from === chef.id && o.to === rival.id));
    s.offers.push({ id: R.newId(s, 'offer'), from: chef.id, to: rival.id, day: s.day,
      give: mine.item ? { item: mine.item.id } : { money: mine.money }, want: theirs.item ? { item: theirs.item.id } : { money: theirs.money },
      label: `${partLabel(mine)} ⇄ ${partLabel(theirs)}` });
    R.say(s, `📨 ${R.chefName(chef.id)} gửi ${R.chefName(rival.id)} lời đề nghị đổi ${partLabel(mine)} lấy ${partLabel(theirs)}.`);
  },
  answer(s, chef, { offerId, accept }) {
    const offer = s.offers.find(o => o.id === offerId && o.to === chef.id);
    if (!offer) fail('Lời đề nghị này không còn.');
    const from = s.chefs[offer.from];
    if (accept === true) {
      swap(from, chef, tradePart(from, offer.give), tradePart(chef, offer.want));
      R.say(s, `🤝 ${R.chefName(chef.id)} nhận lời đổi của ${R.chefName(from.id)}: ${offer.label}.`);
    } else {
      R.say(s, `🙅 ${R.chefName(chef.id)} từ chối lời đề nghị của ${R.chefName(from.id)}.`);
    }
    s.offers = s.offers.filter(o => o !== offer);
  },
  done(s) { needPhase(s, 2); s.phase = 3; },
  cook(s, chef, { recipeId }) {
    needPhase(s, 2, 3);
    const recipe = chef.activeRecipes.find(r => r.id === recipeId);
    if (!recipe) fail('Không có món này.');
    s.phase = 3;
    return { likes: R.cook(s, chef, recipe) };
  },
  end(s) { finishTurn(s); advance(s); },
};

function endDay(s) {
  const chefs = Object.values(s.chefs);
  const contenders = chefs.filter(c => c.likes >= D.WIN_LIKES);
  if (contenders.length || s.day >= D.MAX_DAYS) {
    const best = (contenders.length ? contenders : chefs).sort((a, b) => (b.likes - a.likes) || (b.money - a.money))[0];
    s.over = true;
    s.winner = best.id;
    R.say(s, `🏆 ${R.chefName(best.id)} thắng với ${best.likes} ⭐ và $${best.money}!`);
    return;
  }
  for (const chef of chefs) {
    chef.money += D.INCOME_PER_TIER[chef.tierIdx] + R.dailyPerk(chef);
    if (chef.garbageCan.length >= 3) {
      chef.money = Math.max(0, chef.money - 100);
      R.say(s, `⚠️ ${R.chefName(chef.id)} bị phạt $100 vì thùng rác có ${chef.garbageCan.length} món.`);
    }
    chef.garbageCan = [];
  }
  s.refused = [];
  s.day += 1;
  s.turn = 0;
  s.turnOrder = R.shuffle(s, R.order(s));
  R.say(s, `☀️ Ngày ${s.day}: mọi bếp nhận trợ cấp theo hạng danh tiếng. Thứ tự đi chợ hôm nay: ${R.order(s).map(id => `${R.chefName(id)}${s.humans.includes(id) ? '' : ' 🤖'}`).join(' → ')}.`);
}

// The chef whose turn ends: offers to them lapse, their ban is served, a round passes for claims/closures.
function finishTurn(s) {
  const ender = currentChef(s).id;
  s.offers = s.offers.filter(o => o.to !== ender);
  s.bans = s.bans.filter(b => b.chef !== ender);
  for (const [key, claim] of Object.entries(s.claims)) if (--claim.left <= 0) delete s.claims[key];
  s.closed = s.closed.filter(c => --c.left > 0);
  s.turn += 1;
}

/** Starts the next turn; bots (and seats with no member) play straight through until a member's turn. */
function advance(s) {
  while (!s.over) {
    if (s.turn >= R.round(s)) { endDay(s); if (s.over) return; }
    const chef = currentChef(s);
    s.phase = 1;
    chef.boughtCountToday = 0;
    chef.deliveryUsedToday = false;
    if (s.humans.includes(chef.id)) return;
    autoTurn(s, chef);
    if (s.over) return;
    finishTurn(s);
  }
}

/** One member action. Throws GameError for anything the rules refuse; the caller keeps the old state. */
function act(s, chefId, op, data) {
  if (s.over) fail('Ván đã kết thúc.');
  if (!s.chefs[chefId] || currentChef(s)?.id !== chefId) fail('Chưa tới lượt bạn.');
  if (!Object.hasOwn(OPS, op)) fail('Thao tác không hợp lệ.');
  return OPS[op](s, s.chefs[chefId], data && typeof data === 'object' ? data : {}) || {};
}

/** The member missed the deadline (or left): the autopilot finishes this turn. */
function autoplay(s) {
  if (s.over) return;
  const chef = currentChef(s);
  R.say(s, `⏰ ${R.chefName(chef.id)} quá hạn lượt, quản lý quán đi chợ thay.`);
  autoTurn(s, chef);
  if (s.over) return;
  finishTurn(s);
  advance(s);
}

function leave(s, chefId) {
  s.humans = s.humans.filter(id => id !== chefId);
  R.say(s, `🚪 ${R.chefName(chefId)} rời bàn, bếp chợ tiếp quản.`);
  if (currentChef(s)?.id === chefId) { autoTurn(s, currentChef(s)); if (s.over) return; finishTurn(s); advance(s); }
}

/** What a member sees: no seed, rivals' action cards only as a count. */
function view(s, chefId) {
  const out = JSON.parse(JSON.stringify(s));
  delete out.rng;
  delete out.refused;
  for (const chef of Object.values(out.chefs)) {
    chef.actionCardCount = chef.actionCards.length;
    if (chef.id !== chefId) chef.actionCards = [];
  }
  out.turnChef = currentChef(s)?.id || null;
  return out;
}

module.exports = { newGame, act, autoplay, leave, view, currentChef, GameError: R.GameError };
