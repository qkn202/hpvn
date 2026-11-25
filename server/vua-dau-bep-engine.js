'use strict';

// Vua Đầu Bếp REAL-TIME SIMULTANEOUS Engine (Authentic Rival Restaurants Online Multiplayer).
// Matches playing with bots / the physical board game 1-to-1:
//   Phase 1 (Money & Move, untimed): All humans secretly lock their Movement Wheel; once all lock,
//            bots pick, dials reveal simultaneously, Wok Away resolves, and Phase 2 begins!
//   Phase 2 (Buy & Barter, 60-second real-time shared clock): All humans & bots act simultaneously!
//            Contested Counter buys trigger a LIVE Bidding War (pauses 60s timer, 10s gavel per bid)!
//            Barter offers between humans happen live during the 60s timer!
//            Strictly 1 Action Card per day (pauses timer briefly). Ring bell early -> readyDone.
//   Phase 3 (Cook & Counter, untimed): All humans cook simultaneously (1 dish, or 2 w/ Double Cooktop).
//            First to 20⭐ wins IMMEDIATELY! Once all readyNextDay -> refill Counters, pay $300+ income, Day+1!
const D = require('./vua-dau-bep-data');
const R = require('./vua-dau-bep-rules');
const { chooseMarket, botShopAndCard, botCookAll, acceptsTrade, botAuctionResponse } = require('./vua-dau-bep-bots');

const { fail } = R;

const PHASE2_DURATION_MS = 60_000;
const AUCTION_GAVEL_MS = 10_000;
const BOT_SHOP_DELAY_MS = 8_000; // Bots shop ~8s into Phase 2 (matches Solo!)
const ACTION_PAUSE_MS = 3_000;   // Brief tactical pause when an Action Card is played

function newGame(seed, humans = ['lola', 'angus'], options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const s = {
    v: 3,
    mode: 'realtime',
    rng: seed >>> 0,
    seq: 0,
    day: 1,
    phase: 1,
    over: false,
    winner: null,
    humans: [...humans],
    chefs: {},
    markets: {},
    claims: {},
    closed: [],
    bans: [],
    dumpster: [],
    offers: [],
    refused: [],
    log: [],
    // Real-time simultaneous phase state:
    dials: {},              // Phase 1 secret locked destinations: { [chefId]: marketKey }
    readyDone: [],          // Phase 2 humans who rang the bell early
    readyNextDay: [],       // Phase 3 humans ready for next day
    phase2RemainingMs: PHASE2_DURATION_MS,
    phase2LastTickAt: nowMs,
    timerPaused: false,
    pauseReason: null,
    pauseUntilMs: 0,
    botShoppedDay: 0,
    auction: null,          // Live Bidding War state when contested!
  };
  s.markets = R.buildMarketDecks(s);

  const seated = [...humans];
  for (const id of D.SEAT_PICK) if (seated.length < D.MIN_CHEFS && !seated.includes(id)) seated.push(id);
  const basics = R.shuffle(s, D.BASIC_RECIPES);
  const gourmets = R.shuffle(s, D.GOURMET_RECIPES);
  s.turnOrder = D.TURN_ORDER.filter(id => seated.includes(id));

  const customRests = (options && options.restaurants && typeof options.restaurants === 'object') ? options.restaurants : {};

  s.turnOrder.forEach((id, i) => {
    const basic = R.dealRecipe(s, basics[i % basics.length]);
    const gourmet = R.dealRecipe(s, gourmets[i % gourmets.length]);
    const first = basic.requires[0];
    const starters = [first, gourmet.requires.find(name => name !== first) || gourmet.requires[0]];
    if (id === 'lucrezia') starters.push('Rau Thơm & Dưa Leo');
    const restId = D.RESTAURANTS[customRests[id]] ? customRests[id] : D.CHEFS[id].defaultRestaurant;
    s.chefs[id] = {
      id,
      restaurantId: restId,
      money: D.BASE_DAILY_INCOME,
      likes: 0,
      tierIdx: 0,
      level: 1,
      cookedCount: 0,
      cookedToday: 0,
      garbage: 0,
      pendingGarbage: 0,
      garbageBeforeCook: null,
      reviewBonusToday: 0,
      unlockedMilestones: [],
      milestoneIncomeBonus: 0,
      milestonePantryBonus: 0,
      milestoneDiscount: 0,
      milestoneSeafoodDiscount: 0,
      milestoneCookBonus: 0,
      currentLocation: D.CHEFS[id].start,
      inventory: starters.map(name => R.item(s, name)),
      activeRecipes: [basic, gourmet],
      // Authentic Rival Restaurants setup: EVERY chef starts with at least 1 secret Action Card!
      actionCards: (D.CHEFS[id].cards.length ? D.CHEFS[id].cards : [R.pick(s, D.ACTION_CARDS).type]).map(type => R.actionCard(s, type)),
      upgrades: [],
      garbageCan: [],
      boughtCountToday: 0,
      deliveryUsedToday: false,
      dumpsterDay: 0,
      cardDay: 0,
      chefPowerDay: 0,
    };
  });

  s.dumpster = D.STARTING_DUMPSTER.map(R.ingredient).filter(Boolean);
  R.say(s, `🎉 VÁN ONLINE THỜI GIAN THỰC (Luật Rival Restaurants chuẩn)! Tất cả người chơi cùng xoay Đĩa bí mật, cùng tranh mua 60 giây & đấu giá trực tiếp! Ai đạt ${D.WIN_LIKES}⭐ trước thắng ngay!`);
  return s;
}

// Returns a pending human chef (for legacy callers inspecting currentChef(s)); null when game over.
function currentChef(s) {
  if (s.over) return null;
  if (s.phase === 1) {
    const waiting = s.humans.find(id => s.chefs[id] && !s.dials[id]);
    return s.chefs[waiting || s.humans[0]] || null;
  }
  if (s.phase === 2) {
    if (s.auction) {
      const pendingBidder = s.auction.bidders.find(id => s.humans.includes(id) && id !== s.auction.leader && !s.auction.folded.includes(id));
      if (pendingBidder) return s.chefs[pendingBidder];
    }
    const active = s.humans.find(id => s.chefs[id] && !s.readyDone.includes(id));
    return s.chefs[active || s.humans[0]] || null;
  }
  const notReady = s.humans.find(id => s.chefs[id] && !s.readyNextDay.includes(id));
  return s.chefs[notReady || s.humans[0]] || null;
}

const needPhase = (s, ...phases) => {
  if (!phases.includes(s.phase)) {
    fail(s.phase === 1 ? 'Đang ở Giai đoạn 1: hãy chọn và khóa Đĩa Di Chuyển trước!' : 'Bước này không khả dụng ở giai đoạn hiện tại.');
  }
};
const needIsland = chef => { if (chef.currentLocation !== 'island') fail('Chỉ làm được khi đứng ở Chợ Bến Thành (Đảo Trung Tâm).'); };
const otherChef = (s, chef, id) => { const c = s.chefs[id]; if (!c || c === chef) fail('Hãy chọn một đối thủ.'); return c; };

// ---------- Phase Transitions & Server-Authoritative 60s Real-Time Clock ----------
function enterPhase2(s, nowMs) {
  // Bots choose destinations now
  for (const id of R.order(s)) {
    if (!s.humans.includes(id)) {
      s.dials[id] = chooseMarket(s, s.chefs[id]);
    }
  }
  // Simultaneous reveal & movement!
  for (const id of R.order(s)) {
    const chef = s.chefs[id];
    const dest = s.dials[id] || chooseMarket(s, chef);
    chef.currentLocation = dest;
    chef.boughtCountToday = 0;
    chef.cookedToday = 0;
    chef.pendingGarbage = 0;
    chef.garbageBeforeCook = null;
    chef.deliveryUsedToday = false;
  }

  // Bot Mệ Thảo (Angus Khan) automatic Wok Away if contesting a regular market!
  if (!s.humans.includes('angus') && s.chefs.angus) {
    const angus = s.chefs.angus;
    if (R.isRegularMarket(angus.currentLocation) && angus.chefPowerDay !== s.day) {
      const sameSpot = Object.values(s.chefs).filter(c => c !== angus && c.currentLocation === angus.currentLocation);
      if (sameSpot.length > 0 && R.rand(s) < 0.6) {
        const victim = sameSpot[0];
        const opts = D.MARKET_KEYS.filter(k => k !== angus.currentLocation && !R.isClosed(s, k));
        const newM = opts.length ? R.pick(s, opts) : 'island';
        victim.currentLocation = newM;
        angus.chefPowerDay = s.day;
        R.say(s, `🔥 Mệ Thảo dùng Đuổi Chợ (Wok Away): đá ${R.chefName(victim.id)} văng sang ${R.marketName(newM)}!`);
      }
    }
  }

  const summary = R.order(s).map(id => `${R.chefName(id)} → ${D.MARKETS[s.chefs[id].currentLocation].shortName}`).join(' · ');
  R.say(s, `🛎️ MỞ ĐĨA ĐỒNG LOẠT! ${summary}. Bắt đầu 60 giây Mua Sắm & Thương Lượng!`);

  s.phase = 2;
  s.dials = {};
  s.readyDone = [];
  s.phase2RemainingMs = PHASE2_DURATION_MS;
  s.phase2LastTickAt = nowMs;
  s.timerPaused = false;
  s.pauseReason = null;
  s.pauseUntilMs = 0;
  s.auction = null;
}

function finalizeAuction(s, nowMs) {
  const auc = s.auction;
  if (!auc) return;
  s.auction = null;
  s.timerPaused = false;
  s.pauseReason = null;
  s.phase2LastTickAt = nowMs;

  const winner = s.chefs[auc.leader];
  const slot = s.markets?.[auc.market]?.counter?.[auc.slotIndex];
  if (!winner || !slot || !slot.card || slot.claimedBy) return;

  const cost = Math.min(winner.money, auc.currentBid);
  if (winner.inventory.length >= R.capacity(winner)) {
    R.say(s, `🔨 Phiên đấu giá ${slot.card.emoji} ${slot.card.name} hủy do kho ${R.chefName(winner.id)} đã đầy.`);
    return;
  }
  winner.money -= cost;
  const surchargeOwner = R.marketSurchargeOwner(s, winner, auc.market);
  if (surchargeOwner && cost >= 50) {
    surchargeOwner.money += 50;
  }
  const bought = { id: R.newId(s, 'ing'), ...slot.card, cost };
  winner.inventory.push(bought);
  const claim = { id: winner.id, itemInstanceId: bought.id, baseCost: cost, bribeCost: 50, left: 1 };
  slot.claimedBy = claim;
  s.claims[R.claimKey(auc.market, auc.slotIndex)] = claim;
  winner.boughtCountToday += 1;
  R.say(s, `🔨 CHỐT ĐẤU GIÁ! ${R.chefName(winner.id)} giành được ${slot.card.emoji} ${slot.card.name} với giá $${cost}! Đồng hồ 60s tiếp tục chạy!`);
}

function runBotsPhase2(s) {
  if (s.botShoppedDay === s.day) return;
  s.botShoppedDay = s.day;
  const botIds = R.shuffle(s, R.order(s).filter(id => !s.humans.includes(id)));
  for (const id of botIds) {
    botShopAndCard(s, s.chefs[id]);
  }
}

function enterPhase3(s, nowMs) {
  if (s.auction) finalizeAuction(s, nowMs);
  runBotsPhase2(s);
  s.phase = 3;
  s.readyNextDay = [];
  s.offers = [];
  s.timerPaused = false;
  s.pauseReason = null;
  s.phase2RemainingMs = 0;
  R.say(s, `🍳 HẾT GIỜ MUA SẮM — Bắt đầu Giai đoạn 3: Nấu Món & Tính Điểm (Cook & Counter)!`);

  // Bots cook immediately at start of Phase 3 in shuffled fair order (stopping immediately on 20⭐!)
  for (const id of R.shuffle(s, R.order(s))) {
    if (s.over) break;
    if (!s.humans.includes(id)) botCookAll(s, s.chefs[id]);
  }
  if (!s.over && s.humans.length === 0) {
    endDay(s, nowMs);
  }
}

function endDay(s, nowMs) {
  const chefs = Object.values(s.chefs);
  for (const chef of chefs) R.flushPendingGarbage(chef);

  const contenders = chefs.filter(c => c.likes >= D.WIN_LIKES);
  if (contenders.length || s.day >= D.MAX_DAYS) {
    const best = (contenders.length ? contenders : chefs).sort((a, b) => (b.likes - a.likes) || (b.money - a.money))[0];
    s.over = true;
    s.winner = best.id;
    R.say(s, `🏆 ${R.chefName(best.id)} thắng với ${best.likes} ⭐ và $${best.money}!`);
    return;
  }

  R.refillMarketCounters(s);
  s.claims = {};
  s.closed = [];
  s.bans = [];
  s.offers = [];
  s.refused = [];

  for (const chef of chefs) {
    chef.money += R.dailyIncome(chef);
    chef.reviewBonusToday = 0;
    chef.boughtCountToday = 0;
    chef.cookedToday = 0;
    chef.deliveryUsedToday = false;
    chef.garbageCan = [];
  }
  s.day += 1;
  s.phase = 1;
  s.dials = {};
  s.readyDone = [];
  s.readyNextDay = [];
  s.phase2RemainingMs = PHASE2_DURATION_MS;
  s.phase2LastTickAt = nowMs;
  s.timerPaused = false;
  s.pauseReason = null;
  R.say(s, `☀️ NGÀY ${s.day}: Mọi bếp nhận thu nhập ngày ($${D.BASE_DAILY_INCOME} nền + Quảng Cáo) & nhập lại Quầy Chợ! Hãy xoay Đĩa Di Chuyển bí mật!`);
}

// Advance real-time 60s sand timer, brief action pause, live auction gavel, and delayed bot shopping!
function syncClock(s, nowMs = Date.now()) {
  if (s.over || s.phase !== 2) return;

  // 1. Check live auction gavel timeout
  if (s.auction) {
    if (nowMs >= s.auction.expiresAt) {
      finalizeAuction(s, nowMs);
    } else {
      return; // 60s timer remains paused during live auction!
    }
  }

  // 2. Check brief Action Card tactical pause
  if (s.timerPaused && s.pauseReason === 'action') {
    if (nowMs >= (s.pauseUntilMs || 0)) {
      s.timerPaused = false;
      s.pauseReason = null;
      s.phase2LastTickAt = nowMs;
    } else {
      return;
    }
  }

  // 3. Drain 60-second real-time Sand Timer
  if (!s.timerPaused) {
    const dt = Math.max(0, nowMs - (s.phase2LastTickAt || nowMs));
    s.phase2RemainingMs = Math.max(0, s.phase2RemainingMs - dt);
    s.phase2LastTickAt = nowMs;
  }

  // 4. Trigger bots' Phase 2 shopping ~8s into Phase 2
  const elapsedPhase2 = PHASE2_DURATION_MS - s.phase2RemainingMs;
  if (elapsedPhase2 >= BOT_SHOP_DELAY_MS && s.botShoppedDay !== s.day) {
    runBotsPhase2(s);
  }

  // 5. Auto-transition to Phase 3 when 60s runs out!
  if (s.phase2RemainingMs <= 0) {
    enterPhase3(s, nowMs);
  }
}

// ---------- Barter Helpers (Items, Cash, & Garbage) ----------
function tradePart(chef, part, allowNothing = false) {
  if (!part || typeof part !== 'object') fail('Đề nghị đổi đồ không hợp lệ.');
  if (allowNothing && part.nothing === true) return { nothing: true };
  const res = {};
  if (typeof part.item === 'string') {
    const found = chef.inventory.find(i => i.id === part.item);
    if (!found) fail(`${R.chefName(chef.id)} không còn món đó.`);
    res.item = found;
  }
  if (part.money !== undefined) {
    if (!Number.isSafeInteger(part.money) || part.money <= 0 || part.money > 2000) fail('Số tiền đổi không hợp lệ.');
    if (chef.money < part.money) fail(`${R.chefName(chef.id)} không đủ $${part.money}.`);
    res.money = part.money;
  }
  if (part.garbage !== undefined) {
    if (!Number.isSafeInteger(part.garbage) || part.garbage <= 0 || part.garbage > 5) fail('Số túi rác không hợp lệ.');
    if ((chef.garbage || 0) < part.garbage) fail(`${R.chefName(chef.id)} không có đủ ${part.garbage} túi rác.`);
    res.garbage = part.garbage;
  }
  if (!res.item && !res.money && !res.garbage) fail('Đề nghị đổi đồ không hợp lệ.');
  return res;
}

function partLabel(part) {
  if (part.nothing) return 'Nhận hộ (Không đổi lại)';
  const pieces = [];
  if (part.item) pieces.push(`${part.item.emoji} ${part.item.name}`);
  if (part.money) pieces.push(`$${part.money}`);
  if (part.garbage) pieces.push(`${part.garbage}🗑️ Rác`);
  return pieces.join(' + ');
}

function serializePart(part) {
  if (part.nothing) return { nothing: true };
  const out = {};
  if (part.item) out.item = part.item.id;
  if (part.money) out.money = part.money;
  if (part.garbage) out.garbage = part.garbage;
  return out;
}

function swap(a, b, give, want) {
  const net = (want.item ? 1 : 0) - (give.item ? 1 : 0);
  if (net > 0 && a.inventory.length + net > R.capacity(a)) fail(`Kho của ${R.chefName(a.id)} đã đầy.`);
  if (net < 0 && b.inventory.length - net > R.capacity(b)) fail(`Kho của ${R.chefName(b.id)} đã đầy.`);
  const move = (from, to, part) => {
    if (part.money) { from.money -= part.money; to.money += part.money; }
    if (part.item) { from.inventory.splice(from.inventory.indexOf(part.item), 1); to.inventory.push(part.item); }
    if (part.garbage) { from.garbage = Math.max(0, (from.garbage || 0) - part.garbage); to.garbage = (to.garbage || 0) + part.garbage; }
  };
  move(a, b, give);
  move(b, a, want);
}

function findCounterSlot(s, market, slotIndex, name) {
  const m = s.markets?.[market];
  if (!m) return null;
  if (Number.isSafeInteger(slotIndex) && m.counter[slotIndex]) return m.counter[slotIndex];
  if (typeof name === 'string') {
    return m.counter.find(sl => sl?.card?.name === name && !sl.claimedBy)
      || m.counter.find(sl => sl?.card?.name === name)
      || null;
  }
  return null;
}

function maybeRunBotAuctionBids(s, nowMs) {
  if (!s.auction) return;
  let guard = 0;
  while (s.auction && guard++ < 10) {
    const auc = s.auction;
    const activeBots = auc.bidders.filter(id => !s.humans.includes(id) && id !== auc.leader && !auc.folded.includes(id));
    if (!activeBots.length) break;
    let anyoneRaised = false;
    for (const botId of activeBots) {
      const bot = s.chefs[botId];
      const raise = botAuctionResponse(s, bot, auc);
      if (raise > 0 && bot.money >= auc.currentBid + raise) {
        auc.currentBid += raise;
        auc.leader = botId;
        auc.expiresAt = nowMs + AUCTION_GAVEL_MS;
        R.say(s, `🔨 ${R.chefName(botId)} nâng giá đấu ${auc.card.emoji} ${auc.card.name} lên $${auc.currentBid}!`);
        anyoneRaised = true;
      } else {
        auc.folded.push(botId);
      }
    }
    if (!anyoneRaised) break;
  }
  // If only the leader remains un-folded, close auction immediately!
  if (s.auction) {
    const remaining = s.auction.bidders.filter(id => !s.auction.folded.includes(id));
    if (remaining.length <= 1) finalizeAuction(s, nowMs);
  }
}

// ---------- Real-Time Simultaneous Operations ----------
const OPS = {
  // No-op clock sync called by clients when 60s timer or 10s gavel reaches 0
  tick() { return {}; },

  // Phase 1: Secretly lock Movement Wheel (simultaneous!)
  move(s, chef, { to }, nowMs) {
    needPhase(s, 1);
    if (to !== 'island' && !D.MARKET_KEYS.includes(to)) fail('Quầy chợ không hợp lệ.');
    if (s.bans.some(b => b.chef === chef.id && b.market === to)) fail('Bạn đang bị cấm vào quầy chợ này.');
    s.dials[chef.id] = to;
    const allLocked = s.humans.every(id => !!s.dials[id]);
    if (allLocked) {
      enterPhase2(s, nowMs);
    } else {
      const lockedCount = s.humans.filter(id => !!s.dials[id]).length;
      R.say(s, `🧭 ${R.chefName(chef.id)} đã khóa Đĩa Di Chuyển bí mật (${lockedCount}/${s.humans.length} người sẵn sàng).`);
    }
  },

  // Phase 2: Buy face-up Counter card — triggers LIVE BIDDING WAR if contested!
  buy(s, chef, { market, slotIndex, name, bribe }, nowMs) {
    needPhase(s, 2);
    if (s.auction) fail('Đang có phiên Đấu Giá Tranh Mua trực tiếp — hãy giải quyết xong trước!');
    if (!D.MARKET_KEYS.includes(market)) fail('Quầy chợ không hợp lệ.');
    const remote = market !== chef.currentLocation;
    if (remote && (!R.hasUpgrade(chef, 'upg_delivery') || chef.deliveryUsedToday)) fail('Bạn không đứng ở quầy này.');
    if (R.isClosed(s, market)) fail('Quầy này đang bị Cục VSATTP phong tỏa.');
    if (chef.inventory.length >= R.capacity(chef)) fail(`Kho đã đầy (${R.capacity(chef)} món). Vứt bớt hoặc mua Tủ Đông.`);

    const slot = findCounterSlot(s, market, slotIndex, name);
    if (!slot || !slot.card) fail('Ô quầy này đã trống, hãy bốc Kệ Úp hoặc chờ cuối ngày.');

    const template = slot.card;
    const claim = slot.claimedBy || s.claims[R.claimKey(market, slot.slotIdx)];

    // Already bought by someone else earlier in this Phase 2 -> allow direct outbid if passed bribe
    if (claim) {
      const holder = R.claimHolder(s, claim);
      if (!holder) fail(`${template.name} đã bán hết hôm nay.`);
      if (holder === chef) fail(`Bạn đã mua ${template.name} rồi.`);
      if (bribe !== 50 && bribe !== 100) fail('Chọn mức đấu giá tranh mua +$50 hoặc +$100.');
      const total = (claim.baseCost || template.cost) + bribe;
      if (chef.money < total) fail(`Cần $${total} để tranh mua.`);
      const taken = holder.inventory.splice(holder.inventory.findIndex(i => i.id === claim.itemInstanceId), 1)[0];
      chef.money -= total;
      holder.money += total;
      chef.inventory.push(taken);
      const updatedClaim = { ...claim, id: chef.id, baseCost: total, left: 1 };
      slot.claimedBy = updatedClaim;
      s.claims[R.claimKey(market, slot.slotIdx)] = updatedClaim;
      if (remote) chef.deliveryUsedToday = true; else chef.boughtCountToday += 1;
      R.say(s, `💥 ${R.chefName(chef.id)} trả $${total} (+$${bribe}) giành ${template.emoji} ${template.name} từ ${R.chefName(holder.id)}!`);
      return;
    }

    const cost = R.cardCost(chef, template, market, { fromShelf: false, state: s });
    if (chef.money < cost) fail(`Thẻ giá $${cost}, bạn chỉ có $${chef.money}.`);

    // CHECK FOR LIVE REAL-TIME BIDDING WAR!
    // Contested if another chef is standing on the SAME market (human who can afford cost+50, OR bot who wants it & can afford cost+50)!
    if (!remote) {
      const rivalsAtMarket = Object.values(s.chefs).filter(other => {
        if (other === chef || other.currentLocation !== market) return false;
        if (other.inventory.length >= R.capacity(other)) return false;
        if (other.money < cost + 50) return false;
        if (s.humans.includes(other.id)) return true; // Any human rival at the same market gets to bid or fold!
        return R.needs(other).includes(template.name) || ['wild', 'tofu', 'chocolate'].includes(template.type);
      });
      if (rivalsAtMarket.length > 0) {
        s.timerPaused = true;
        s.pauseReason = 'auction';
        s.auction = {
          id: R.newId(s, 'auc'),
          market,
          slotIndex: slot.slotIdx,
          card: { ...template },
          baseCost: cost,
          currentBid: cost,
          leader: chef.id,
          bidders: [chef.id, ...rivalsAtMarket.map(r => r.id)],
          folded: [],
          expiresAt: nowMs + AUCTION_GAVEL_MS,
        };
        R.say(s, `🔨 ĐẤU GIÁ TRANH MUA! ${R.chefName(chef.id)} đặt $${cost} cho ${template.emoji} ${template.name} tại ${R.marketName(market)} — đồng hồ 60s TẠM DỪNG!`);
        maybeRunBotAuctionBids(s, nowMs);
        return { auction: s.auction };
      }
    }

    // Uncontested -> instant buy!
    chef.money -= cost;
    const surchargeOwner = R.marketSurchargeOwner(s, chef, market);
    if (surchargeOwner) {
      surchargeOwner.money += 50;
      R.say(s, `💸 ${R.chefName(surchargeOwner.id)} thu phụ phí bến bãi +$50 từ ${R.chefName(chef.id)}!`);
    }
    const bought = { id: R.newId(s, 'ing'), ...template, cost };
    chef.inventory.push(bought);
    const newClaim = { id: chef.id, itemInstanceId: bought.id, baseCost: cost, bribeCost: 50, left: 1 };
    slot.claimedBy = newClaim;
    s.claims[R.claimKey(market, slot.slotIdx)] = newClaim;
    if (remote) chef.deliveryUsedToday = true; else chef.boughtCountToday += 1;
    R.say(s, `🛒 ${R.chefName(chef.id)} mua ${template.emoji} ${template.name}${remote ? ' (🛵 giao từ xa)' : ''} ($${cost}).`);
  },

  // Live Bidding War: Raise bid (+$50 or +$100)
  bid(s, chef, { raise }, nowMs) {
    needPhase(s, 2);
    const auc = s.auction;
    if (!auc) fail('Hiện không có phiên đấu giá nào.');
    if (!auc.bidders.includes(chef.id)) fail('Bạn không đứng ở quầy đang đấu giá.');
    if (auc.folded.includes(chef.id)) fail('Bạn đã rút khỏi phiên đấu giá này.');
    if (auc.leader === chef.id) fail('Bạn đang là người dẫn đầu giá cao nhất rồi!');
    if (raise !== 50 && raise !== 100) fail('Chọn mức nâng giá +$50 hoặc +$100.');
    const nextPrice = auc.currentBid + raise;
    if (chef.money < nextPrice) fail(`Bạn cần $${nextPrice} để nâng giá.`);
    auc.currentBid = nextPrice;
    auc.leader = chef.id;
    auc.expiresAt = nowMs + AUCTION_GAVEL_MS;
    R.say(s, `🔥 ${R.chefName(chef.id)} nâng giá đấu ${auc.card.emoji} ${auc.card.name} lên $${nextPrice}!`);
    maybeRunBotAuctionBids(s, nowMs);
  },

  // Live Bidding War: Fold / Withdraw
  fold(s, chef, _, nowMs) {
    needPhase(s, 2);
    const auc = s.auction;
    if (!auc) fail('Hiện không có phiên đấu giá nào.');
    if (!auc.bidders.includes(chef.id) || auc.folded.includes(chef.id)) return;
    auc.folded.push(chef.id);
    R.say(s, `🏳️ ${R.chefName(chef.id)} bỏ cuộc trong phiên đấu giá ${auc.card.name}.`);
    // If leader folded somehow, hand leadership to next remaining bidder
    const remaining = auc.bidders.filter(id => !auc.folded.includes(id));
    if (auc.leader === chef.id && remaining.length > 0) auc.leader = remaining[0];
    if (remaining.length <= 1) {
      finalizeAuction(s, nowMs);
    }
  },

  // Blind Shelf Draw (never contested!)
  buyShelf(s, chef, { market }) {
    needPhase(s, 2);
    if (s.auction) fail('Đang tạm dừng vì Đấu Giá Tranh Mua!');
    const targetMarket = market || chef.currentLocation;
    if (!D.MARKET_KEYS.includes(targetMarket)) fail('Chợ này không có Kệ Úp.');
    const remote = targetMarket !== chef.currentLocation;
    if (remote && (!R.hasUpgrade(chef, 'upg_delivery') || chef.deliveryUsedToday)) fail('Bạn không đứng ở quầy này.');
    if (R.isClosed(s, targetMarket)) fail('Quầy này đang bị Cục VSATTP phong tỏa.');
    if (chef.inventory.length >= R.capacity(chef)) fail(`Kho đã đầy (${R.capacity(chef)} món).`);
    const m = s.markets[targetMarket];
    if (!m || !m.shelf.length) fail('Kệ úp của chợ này đã hết thẻ, chờ cuối ngày nhập hàng!');

    const cost = R.cardCost(chef, { cost: D.MARKETS[targetMarket].cost }, targetMarket, { fromShelf: true, state: s });
    if (chef.money < cost) fail(`Mua úp từ Kệ giá $${cost}, bạn chỉ có $${chef.money}.`);
    const drawn = m.shelf.shift();
    chef.money -= cost;
    const surchargeOwner = R.marketSurchargeOwner(s, chef, targetMarket);
    if (surchargeOwner) surchargeOwner.money += 50;
    const bought = { id: R.newId(s, 'ing'), ...drawn, cost };
    chef.inventory.push(bought);
    if (remote) chef.deliveryUsedToday = true; else chef.boughtCountToday += 1;
    R.say(s, `📦 ${R.chefName(chef.id)} bốc Kệ Úp ${R.marketName(targetMarket)} được ${drawn.emoji} ${drawn.name} ($${cost}).`);
    return { item: bought };
  },

  // Island actions
  draw(s, chef) {
    needPhase(s, 2); needIsland(chef);
    if (s.auction) fail('Đang tạm dừng vì Đấu Giá!');
    if (chef.money < D.ACTION_CARD_COST) fail(`Thẻ Hành Động giá $${D.ACTION_CARD_COST}.`);
    chef.money -= D.ACTION_CARD_COST;
    const card = R.actionCard(s, R.pick(s, D.ACTION_CARDS).type);
    chef.actionCards.push(card);
    R.say(s, `⚡ ${R.chefName(chef.id)} bốc 1 Thẻ Hành Động bí mật ($${D.ACTION_CARD_COST}).`);
    return { card };
  },

  upgrade(s, chef, { id }) {
    needPhase(s, 2); needIsland(chef);
    if (s.auction) fail('Đang tạm dừng vì Đấu Giá!');
    const upgrade = D.UPGRADES.find(u => u.id === id);
    if (!upgrade) fail('Nâng cấp không hợp lệ.');
    if (R.hasUpgrade(chef, id)) fail('Bạn đã có nâng cấp này rồi.');
    if (chef.upgrades.length >= D.MAX_UPGRADES) fail(`Bếp đã đủ ${D.MAX_UPGRADES} nâng cấp.`);
    if (chef.money < upgrade.cost) fail(`Nâng cấp giá $${upgrade.cost}.`);
    chef.money -= upgrade.cost;
    chef.upgrades.push({ ...upgrade });
    R.say(s, `🛠️ ${R.chefName(chef.id)} lắp nâng cấp ${upgrade.icon} ${upgrade.name} ($${upgrade.cost}).`);
  },

  disposeGarbage(s, chef, { count = 1 }) {
    needPhase(s, 2); needIsland(chef);
    if (s.auction) fail('Đang tạm dừng vì Đấu Giá!');
    if ((chef.garbage || 0) <= 0) fail('Bếp của bạn đang sạch, không có rác!');
    const qty = count === 'all' ? chef.garbage : (Number.isSafeInteger(count) ? count : 1);
    if (qty <= 0 || qty > chef.garbage) fail('Số túi rác không hợp lệ.');
    const total = qty * D.GARBAGE_DISPOSAL_COST;
    if (chef.money < total) fail(`Cần $${total} để đổ ${qty} túi rác.`);
    chef.money -= total;
    chef.garbage -= qty;
    R.say(s, `🧹 ${R.chefName(chef.id)} trả $${total} đổ ${qty} Túi Rác (còn ${chef.garbage}🗑️).`);
    return { disposed: qty, cost: total };
  },

  sellSpecialty(s, chef, { itemId }) {
    needPhase(s, 2); needIsland(chef);
    if (s.auction) fail('Đang tạm dừng vì Đấu Giá!');
    const idx = itemId
      ? chef.inventory.findIndex(i => i.id === itemId && i.type === 'chocolate')
      : chef.inventory.findIndex(i => i.type === 'chocolate');
    if (idx === -1) fail('Bạn không có Sô-cô-la Đặc Sản 🍫 trong kho.');
    const [sold] = chef.inventory.splice(idx, 1);
    const tpl = R.ingredient(sold.name);
    if (tpl) s.dumpster.push(tpl);
    chef.money += D.CHOCOLATE_SELL_VALUE;
    R.say(s, `🍫 ${R.chefName(chef.id)} bán Sô-cô-la Đặc Sản thu về +$${D.CHOCOLATE_SELL_VALUE}!`);
    return { earned: D.CHOCOLATE_SELL_VALUE };
  },

  dumpster(s, chef, { index }) {
    needPhase(s, 2); needIsland(chef);
    if (s.auction) fail('Đang tạm dừng vì Đấu Giá!');
    if (chef.dumpsterDay === s.day) fail('Hôm nay bạn đã nhặt Khay Bỏ rồi (1 món/ngày).');
    if (!Number.isSafeInteger(index) || !s.dumpster[index]) fail('Món này không còn ở Khay Bỏ.');
    if (chef.inventory.length >= R.capacity(chef)) fail('Kho đã đầy.');
    const [dug] = s.dumpster.splice(index, 1);
    chef.inventory.push({ id: R.newId(s, 'ing'), ...dug });
    chef.dumpsterDay = s.day;
    R.say(s, `♻️ ${R.chefName(chef.id)} nhặt được ${dug.emoji} ${dug.name} ($0) từ Khay Bỏ.`);
  },

  // Real-time Wok Away (Angus Khan): kicks a rival on the SAME regular market to another open market IMMEDIATELY!
  chefPower(s, chef, { target }) {
    needPhase(s, 2);
    if (chef.id !== 'angus') fail('Kỹ năng đầu bếp của bạn là tự động.');
    if (chef.chefPowerDay === s.day) fail('Hôm nay bạn đã dùng Đuổi Chợ (Wok Away) rồi.');
    if (!R.isRegularMarket(chef.currentLocation)) fail('Luật gốc: Kỹ năng Đầu Bếp không tác dụng tại Chợ Bến Thành hoặc Phố Gia Vị!');
    const victim = otherChef(s, chef, target);
    if (victim.currentLocation !== chef.currentLocation) fail('Chỉ đuổi được đối thủ đang đứng CÙNG quầy chợ với bạn!');
    const opts = D.MARKET_KEYS.filter(k => k !== chef.currentLocation && !R.isClosed(s, k));
    const newM = opts.length ? R.pick(s, opts) : 'island';
    victim.currentLocation = newM;
    chef.chefPowerDay = s.day;
    R.say(s, `🔥 ${R.chefName(chef.id)} dùng Đuổi Chợ (Wok Away): đá ${R.chefName(victim.id)} văng sang ${R.marketName(newM)} ngay lập tức!`);
  },

  trash(s, chef, { itemId }) {
    const thrown = R.trashItem(s, chef, itemId);
    R.say(s, `♻️ ${R.chefName(chef.id)} bỏ ${thrown.emoji} ${thrown.name} ra Khay Bỏ.`);
  },

  // Real-Time Action Card (Strictly 1/day + brief tactical timer pause!)
  play(s, chef, { cardId, target }, nowMs) {
    const card = chef.actionCards.find(c => c.id === cardId);
    if (!card) fail('Bạn không có thẻ này.');
    if (chef.cardDay === s.day) fail('Luật Rival Restaurants: Mỗi ngày chỉ dùng tối đa 1 Thẻ Hành Động!');
    needPhase(s, ...(['lucky_money', 'wild_substitute', 'five_star_review'].includes(card.type) ? [2, 3] : [2]));
    const name = R.chefName(chef.id);
    let text;

    if (card.type === 'steal_money' || card.type === 'steal_item' || card.type === 'dump_garbage') {
      const victim = otherChef(s, chef, target);
      const defended = R.hasUpgrade(victim, 'upg_bouncer') && R.rand(s) < 0.5;
      if (defended) {
        text = `định phá hoại ${R.chefName(victim.id)} nhưng bị Bảo Vệ Quán 24/7 chặn đứng (50%)!`;
      } else if (card.type === 'steal_money') {
        const amount = Math.min(100, victim.money); victim.money -= amount; chef.money += amount;
        text = `cướp $${amount} của ${R.chefName(victim.id)}`;
      } else if (card.type === 'steal_item') {
        if (!victim.inventory.length) fail('Kho của đối thủ đang trống.');
        if (chef.inventory.length >= R.capacity(chef)) fail('Kho của bạn đã đầy.');
        const [taken] = victim.inventory.splice(Math.floor(R.rand(s) * victim.inventory.length), 1);
        chef.inventory.push(taken);
        text = `bốc trộm ${taken.emoji} ${taken.name} của ${R.chefName(victim.id)}`;
      } else {
        if ((chef.garbage || 0) > 0) chef.garbage -= 1;
        victim.garbage = (victim.garbage || 0) + 1;
        text = `đổ 1 Túi Rác 🗑️ sang bếp của ${R.chefName(victim.id)} (${victim.garbage}🗑️)`;
      }
    } else if (card.type === 'close_market') {
      if (!D.MARKET_KEYS.includes(target) || R.isClosed(s, target)) fail('Chọn một quầy chợ đang mở.');
      s.closed.push({ market: target, by: chef.id, left: 1 });
      text = `phong tỏa ${R.marketName(target)} trong hôm nay`;
    } else if (card.type === 'kick_opponent') {
      const victim = otherChef(s, chef, target);
      if (victim.currentLocation !== chef.currentLocation || !D.MARKET_KEYS.includes(chef.currentLocation)) {
        fail('Chỉ đuổi được đối thủ đang đứng cùng quầy chợ với bạn!');
      }
      const opts = D.MARKET_KEYS.filter(k => k !== chef.currentLocation && !R.isClosed(s, k));
      const newM = opts.length ? R.pick(s, opts) : 'island';
      victim.currentLocation = newM;
      text = `đá ${R.chefName(victim.id)} văng sang ${R.marketName(newM)} ngay lập tức`;
    } else if (card.type === 'five_star_review') {
      chef.reviewBonusToday = (chef.reviewBonusToday || 0) + 2;
      text = 'dùng Đánh Giá 5 Sao (+2⭐ cho món nấu tiếp theo hôm nay)';
    } else if (card.type === 'lucky_money') {
      chef.money += 200;
      text = 'nhận Lì Xì Bếp Trưởng +$200';
    } else {
      text = `dùng Ảo Thuật Ẩm Thực (${R.addWild(s, chef)})`;
    }

    chef.actionCards = chef.actionCards.filter(c => c !== card);
    chef.cardDay = s.day;
    if (s.phase === 2 && !s.auction) {
      s.timerPaused = true;
      s.pauseReason = 'action';
      s.pauseUntilMs = nowMs + ACTION_PAUSE_MS;
    }
    R.say(s, `🃏 ${name} ${text} (tạm dừng đồng hồ 3s).`);
  },

  // Live Barter with Bot (instant!)
  trade(s, chef, { with: id, give, want }) {
    needPhase(s, 2);
    const bot = otherChef(s, chef, id);
    if (s.humans.includes(bot.id)) fail('Với người chơi, hãy gửi lời đề nghị đổi đồ trực tiếp.');
    const mine = tradePart(chef, give, false);
    const theirs = tradePart(bot, want, !!mine.garbage);
    const key = [s.day, chef.id, bot.id, JSON.stringify(serializePart(mine)), JSON.stringify(serializePart(theirs))].join('|');
    if (s.refused.includes(key)) fail(`${R.chefName(bot.id)} đã từ chối kèo này hôm nay.`);
    if (!acceptsTrade(s, bot, mine, theirs)) {
      s.refused.push(key);
      R.say(s, `❌ ${R.chefName(bot.id)} từ chối đổi ${partLabel(theirs)} lấy ${partLabel(mine)}.`);
      return { accepted: false };
    }
    swap(chef, bot, mine, theirs);
    R.say(s, `🤝 ${R.chefName(chef.id)} đổi ${partLabel(mine)} lấy ${partLabel(theirs)} với ${R.chefName(bot.id)}.`);
    return { accepted: true };
  },

  // Live Barter Offer to Another Human (pops up immediately on their screen during Phase 2!)
  offer(s, chef, { to, give, want }) {
    needPhase(s, 2);
    const rival = otherChef(s, chef, to);
    if (!s.humans.includes(rival.id)) fail('Bếp máy trả lời ngay: hãy dùng đổi đồ thường.');
    const mine = tradePart(chef, give, false);
    const theirs = tradePart(rival, want, !!mine.garbage);
    s.offers = s.offers.filter(o => !(o.from === chef.id && o.to === rival.id));
    s.offers.push({
      id: R.newId(s, 'offer'),
      from: chef.id,
      to: rival.id,
      day: s.day,
      give: serializePart(mine),
      want: serializePart(theirs),
      label: `${partLabel(mine)} ⇄ ${partLabel(theirs)}`,
    });
    R.say(s, `📨 ${R.chefName(chef.id)} gửi kèo trực tiếp cho ${R.chefName(rival.id)}: ${partLabel(mine)} ⇄ ${partLabel(theirs)}!`);
  },

  // Live Answer to Human Barter Offer (executes immediately during Phase 2!)
  answer(s, chef, { offerId, accept }) {
    needPhase(s, 2);
    const offer = s.offers.find(o => o.id === offerId && o.to === chef.id);
    if (!offer) fail('Lời đề nghị này đã hết hạn hoặc bị hủy.');
    const from = s.chefs[offer.from];
    if (accept === true) {
      const give = tradePart(from, offer.give, false);
      const want = tradePart(chef, offer.want, !!give.garbage);
      swap(from, chef, give, want);
      R.say(s, `🤝 CHỐT KÈO! ${R.chefName(chef.id)} đồng ý đổi với ${R.chefName(from.id)}: ${offer.label}!`);
    } else {
      R.say(s, `🙅 ${R.chefName(chef.id)} từ chối kèo của ${R.chefName(from.id)}.`);
    }
    s.offers = s.offers.filter(o => o !== offer);
  },

  // Phase 2: Ring Bell Early (ready for Phase 3; once ALL humans ring bell -> Phase 3 immediately!)
  done(s, chef, _, nowMs) {
    needPhase(s, 2);
    if (s.auction) fail('Hãy hoàn tất phiên Đấu Giá trước khi rung chuông!');
    if (!s.readyDone.includes(chef.id)) s.readyDone.push(chef.id);
    const allReady = s.humans.every(id => s.readyDone.includes(id));
    if (allReady) {
      enterPhase3(s, nowMs);
    } else {
      R.say(s, `🔔 ${R.chefName(chef.id)} rung chuông xong sớm (${s.readyDone.length}/${s.humans.length} người).`);
    }
  },

  // Phase 3: Cook Simultaneously!
  cook(s, chef, { recipeId, useAddon = false }) {
    needPhase(s, 3);
    const recipe = chef.activeRecipes.find(r => r.id === recipeId);
    if (!recipe) fail('Không có món này.');
    return { likes: R.cook(s, chef, recipe, { useAddon }) };
  },

  // Phase 3: Ready for Next Day (once ALL humans click -> refill Counter, pay income, Day + 1!)
  end(s, chef, _, nowMs) {
    needPhase(s, 3);
    R.flushPendingGarbage(chef);
    if (!s.readyNextDay.includes(chef.id)) s.readyNextDay.push(chef.id);
    const allReady = s.humans.every(id => s.readyNextDay.includes(id));
    if (allReady) {
      endDay(s, nowMs);
    } else {
      R.say(s, `✅ ${R.chefName(chef.id)} đã nấu xong (${s.readyNextDay.length}/${s.humans.length} người sẵn sàng sang ngày mới).`);
    }
  },
};

/** Real-Time Simultaneous Action: ANY seated human may act during the current phase! */
function act(s, chefId, op, data, nowMs = Date.now()) {
  if (s.over) fail('Ván đã kết thúc.');
  if (!s.chefs[chefId]) fail('Bếp không tồn tại trong bàn này.');
  if (!Object.hasOwn(OPS, op)) fail('Thao tác không hợp lệ.');
  syncClock(s, nowMs);
  if (s.over) return {};
  return OPS[op](s, s.chefs[chefId], data && typeof data === 'object' ? data : {}, nowMs) || {};
}

/** Autopilot / Timeout helper: advances all pending humans through the current phase cleanly! */
function autoplay(s, nowMs = Date.now()) {
  if (s.over) return;
  syncClock(s, nowMs);
  if (s.over) return;
  if (s.phase === 1) {
    for (const id of s.humans) {
      if (!s.dials[id]) s.dials[id] = chooseMarket(s, s.chefs[id]);
    }
    enterPhase2(s, nowMs);
    return;
  }
  if (s.phase === 2) {
    if (s.auction) finalizeAuction(s, nowMs);
    for (const id of s.humans) {
      if (!s.readyDone.includes(id)) botShopAndCard(s, s.chefs[id]);
    }
    enterPhase3(s, nowMs);
    return;
  }
  if (s.phase === 3) {
    for (const id of s.humans) {
      if (s.over) return;
      if (!s.readyNextDay.includes(id)) botCookAll(s, s.chefs[id]);
    }
    if (!s.over) endDay(s, nowMs);
  }
}

function leave(s, chefId, nowMs = Date.now()) {
  s.humans = s.humans.filter(id => id !== chefId);
  R.say(s, `🚪 ${R.chefName(chefId)} rời bàn, bếp máy tiếp quản.`);
  if (s.over) return;
  if (s.auction && s.auction.bidders.includes(chefId) && !s.auction.folded.includes(chefId)) {
    s.auction.folded.push(chefId);
    const rem = s.auction.bidders.filter(id => !s.auction.folded.includes(id));
    if (s.auction.leader === chefId && rem.length) s.auction.leader = rem[0];
    if (rem.length <= 1) finalizeAuction(s, nowMs);
  }
  if (s.phase === 1 && s.humans.length > 0 && s.humans.every(id => !!s.dials[id])) enterPhase2(s, nowMs);
  else if (s.phase === 2 && s.humans.length > 0 && s.humans.every(id => s.readyDone.includes(id))) enterPhase3(s, nowMs);
  else if (s.phase === 3 && s.humans.length > 0 && s.humans.every(id => s.readyNextDay.includes(id))) endDay(s, nowMs);
}

/** Pure view for a seated member: hides RNG seed, rival action cards, face-down shelf cards, AND other players' secret Phase 1 dials! */
function view(s, chefId, nowMs = Date.now()) {
  const out = JSON.parse(JSON.stringify(s));
  delete out.rng;
  delete out.refused;

  // Hide secret Phase 1 dials of other players; only expose myDial + dialReady list!
  out.myDial = s.dials[chefId] || null;
  out.dialReady = Object.keys(s.dials || {});
  delete out.dials;

  // Compute live accurate remaining ms for Phase 2 & live auction gavel without mutating state
  out.serverNow = nowMs;
  if (out.phase === 2) {
    if (out.auction) {
      out.auction.remainingMs = Math.max(0, out.auction.expiresAt - nowMs);
    } else if (out.timerPaused && out.pauseReason === 'action' && nowMs >= (out.pauseUntilMs || 0)) {
      out.timerPaused = false;
      out.pauseReason = null;
      out.phase2RemainingMs = Math.max(0, out.phase2RemainingMs - Math.max(0, nowMs - out.pauseUntilMs));
    } else if (!out.timerPaused) {
      out.phase2RemainingMs = Math.max(0, out.phase2RemainingMs - Math.max(0, nowMs - (out.phase2LastTickAt || nowMs)));
    }
  }

  if (out.markets) {
    for (const key of D.MARKET_KEYS) {
      if (out.markets[key]) {
        out.markets[key].shelfCount = (out.markets[key].shelf || []).length;
        delete out.markets[key].shelf;
      }
    }
  }
  for (const chef of Object.values(out.chefs)) {
    chef.actionCardCount = chef.actionCards.length;
    if (chef.id !== chefId) chef.actionCards = [];
  }
  out.turnChef = currentChef(s)?.id || null;
  return out;
}

module.exports = {
  newGame, act, autoplay, leave, view, currentChef, syncClock,
  PHASE2_DURATION_MS, AUCTION_GAVEL_MS, BOT_SHOP_DELAY_MS,
  GameError: R.GameError,
};
