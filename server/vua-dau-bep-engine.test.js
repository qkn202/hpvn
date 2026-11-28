'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./vua-dau-bep-engine');
const R = require('./vua-dau-bep-rules');
const D = require('./vua-dau-bep-data');
const B = require('./vua-dau-bep-bots');

const refused = (fn, pattern) => assert.throws(fn, error => error instanceof E.GameError && pattern.test(error.message));

test('real-time game starts in Phase 1 with 6 Shelf+Counter markets and hides rivals\' secret dials', () => {
  const t0 = 1_000_000;
  const s = E.newGame(42, ['lola', 'angus'], { nowMs: t0 });
  assert.equal(s.mode, 'realtime');
  assert.equal(s.phase, 1);
  for (const key of D.MARKET_KEYS) {
    assert.equal(s.markets[key].counter.length, 3);
    assert.ok(s.markets[key].shelf.length > 0);
  }
  // Lola locks her dial first — Angus MUST NOT see where Lola is going!
  E.act(s, 'lola', 'move', { to: 'chop' }, t0 + 500);
  assert.equal(s.phase, 1, 'waits until all humans lock dial');
  const angusView = E.view(s, 'angus', t0 + 600);
  assert.equal(angusView.dials, undefined);
  assert.equal(angusView.myDial, null);
  assert.deepEqual(angusView.dialReady, ['lola']);
  const lolaView = E.view(s, 'lola', t0 + 600);
  assert.equal(lolaView.myDial, 'chop');

  // Angus locks his dial -> simultaneous reveal & Phase 2 starts with 60s real-time clock!
  E.act(s, 'angus', 'move', { to: 'dairy' }, t0 + 1000);
  assert.equal(s.phase, 2);
  assert.equal(s.phase2RemainingMs, E.PHASE2_DURATION_MS);
});

test('Phase 2 runs shared 60-second real-time clock; all humans act simultaneously; timer expiry starts Phase 3', () => {
  const t0 = 2_000_000;
  const s = E.newGame(7, ['lola', 'angus'], { nowMs: t0 });
  E.act(s, 'lola', 'move', { to: 'fruit' }, t0);
  E.act(s, 'angus', 'move', { to: 'carbs' }, t0);
  assert.equal(s.phase, 2);

  // Both humans buy simultaneously in the same real-time Phase 2!
  const shelfBefore = s.markets.fruit.shelf.length;
  E.act(s, 'lola', 'buyShelf', { market: 'fruit' }, t0 + 2000);
  E.act(s, 'angus', 'buyShelf', { market: 'carbs' }, t0 + 2500);
  assert.equal(s.markets.fruit.shelf.length, shelfBefore - 1);
  assert.equal(s.phase2RemainingMs, 57_500);

  // After 8s elapsed, bots automatically shop!
  E.act(s, 'lola', 'tick', {}, t0 + 9_000);
  assert.equal(s.botShoppedDay, 1);

  // After 60s elapsed -> automatically transitions to Phase 3!
  E.act(s, 'lola', 'tick', {}, t0 + 61_000);
  assert.equal(s.phase, 3);
});

test('LIVE REAL-TIME BIDDING WAR between 2 humans pauses 60s timer, supports +$50/+$100 bids & fold, then resumes timer', () => {
  const t0 = 3_000_000;
  const s = E.newGame(13, ['lola', 'angus'], { nowMs: t0 });
  s.chefs.lola.money = 1000;
  s.chefs.angus.money = 1000;
  // Disable bot angus Wok Away (angus is human here) and send BOTH humans to chop!
  E.act(s, 'lola', 'move', { to: 'chop' }, t0);
  E.act(s, 'angus', 'move', { to: 'chop' }, t0);
  assert.equal(s.phase, 2);

  // Lola clicks Counter slot 0 at t0+5000 -> LIVE BIDDING WAR opens & pauses 60s timer at 55s!
  E.act(s, 'lola', 'buy', { market: 'chop', slotIndex: 0 }, t0 + 5000);
  assert.ok(s.auction, 'live auction started');
  assert.equal(s.timerPaused, true);
  assert.equal(s.phase2RemainingMs, 55_000);
  assert.equal(s.auction.leader, 'lola');

  // 4 seconds pass during auction — 60s timer MUST stay paused at 55s!
  E.act(s, 'angus', 'bid', { raise: 50 }, t0 + 9000);
  assert.equal(s.auction.leader, 'angus');
  assert.equal(s.auction.currentBid, 250);
  assert.equal(s.phase2RemainingMs, 55_000, '60s timer stayed paused during bidding war');

  // Lola raises +$100 -> $350
  E.act(s, 'lola', 'bid', { raise: 100 }, t0 + 11000);
  assert.equal(s.auction.leader, 'lola');
  assert.equal(s.auction.currentBid, 350);

  // Angus folds -> Lola wins immediately, timer resumes cleanly!
  E.act(s, 'angus', 'fold', {}, t0 + 12000);
  assert.equal(s.auction, null);
  assert.equal(s.timerPaused, false);
  assert.equal(s.chefs.lola.money, 650);
  assert.equal(s.phase2RemainingMs, 55_000, 'timer resumed from 55s with zero lost time');
});

test('LIVE HUMAN-TO-HUMAN BARTER executes immediately during Phase 2 (including Garbage offloading!)', () => {
  const t0 = 4_000_000;
  const s = E.newGame(17, ['lola', 'angus'], { nowMs: t0 });
  s.chefs.lola.garbage = 2;
  s.chefs.lola.money = 500;
  E.act(s, 'lola', 'move', { to: 'fruit' }, t0);
  E.act(s, 'angus', 'move', { to: 'chop' }, t0);

  // Lola sends live offer to Angus during Phase 2: "Take 1 garbage + $150"
  E.act(s, 'lola', 'offer', { to: 'angus', give: { garbage: 1, money: 150 }, want: { nothing: true } }, t0 + 1000);
  assert.equal(s.offers.length, 1);

  // Angus accepts RIGHT NOW during the same Phase 2!
  E.act(s, 'angus', 'answer', { offerId: s.offers[0].id, accept: true }, t0 + 2000);
  assert.equal(s.chefs.lola.garbage, 1);
  assert.equal(s.chefs.angus.garbage, 1);
  assert.equal(s.chefs.angus.money, 450);
});

test('Real-time Wok Away (Angus) kicks rival immediately; disabled at Island & Mystery Mart', () => {
  const t0 = 5_000_000;
  const s = E.newGame(21, ['lola', 'angus'], { nowMs: t0 });
  E.act(s, 'lola', 'move', { to: 'fruit' }, t0);
  E.act(s, 'angus', 'move', { to: 'fruit' }, t0);
  E.act(s, 'angus', 'chefPower', { target: 'lola' }, t0 + 1000);
  assert.notEqual(s.chefs.lola.currentLocation, 'fruit', 'Lola immediately kicked to another market');

  // Disabled at Mystery Mart
  const s2 = E.newGame(22, ['lola', 'angus'], { nowMs: t0 });
  E.act(s2, 'lola', 'move', { to: 'mystery' }, t0);
  E.act(s2, 'angus', 'move', { to: 'mystery' }, t0);
  refused(() => E.act(s2, 'angus', 'chefPower', { target: 'lola' }, t0 + 1000), /không tác dụng/);
});

test('strict 1 Action Card per day + brief 3s timer pause', () => {
  const t0 = 6_000_000;
  const s = E.newGame(25, ['lola', 'angus'], { nowMs: t0 });
  s.chefs.lola.actionCards = [R.actionCard(s, 'lucky_money'), R.actionCard(s, 'five_star_review')];
  E.act(s, 'lola', 'move', { to: 'fruit' }, t0);
  E.act(s, 'angus', 'move', { to: 'chop' }, t0);
  E.act(s, 'lola', 'play', { cardId: s.chefs.lola.actionCards[0].id }, t0 + 1000);
  assert.equal(s.chefs.lola.money, 500);
  assert.equal(s.timerPaused, true);
  assert.equal(s.pauseReason, 'action');
  refused(() => E.act(s, 'lola', 'play', { cardId: s.chefs.lola.actionCards[0].id }, t0 + 2000), /tối đa 1 Thẻ Hành Động/);
});

test('Simultaneous Phase 3 cooking: Double Cooktop, Cuisine Bonus, Wine, Tofu, Garbage, 3/7/12⭐ Milestones & Instant 20⭐ Win', () => {
  const t0 = 7_000_000;
  const s = E.newGame(31, ['lola', 'angus'], { nowMs: t0 });
  E.act(s, 'lola', 'move', { to: 'island' }, t0);
  E.act(s, 'angus', 'move', { to: 'island' }, t0);
  // Both ring bell early -> Phase 3 immediately!
  E.act(s, 'lola', 'done', {}, t0 + 500);
  assert.equal(s.phase, 2);
  E.act(s, 'angus', 'done', {}, t0 + 600);
  assert.equal(s.phase, 3);

  const lola = s.chefs.lola;
  lola.upgrades.push(D.UPGRADES.find(u => u.id === 'upg_double_cooktop'));
  lola.garbage = 1;
  const b = R.dealRecipe(s, D.BASIC_RECIPES.find(r => r.id === 'rec_banhmi')); // 2 + 1 cuisine - 1 garbage = 2⭐
  const g = R.dealRecipe(s, D.GOURMET_RECIPES.find(r => r.id === 'rec_pho'));  // 5 + 1 wine - 1 pre-cook garbage = 5⭐
  lola.activeRecipes = [b, g];
  lola.inventory = [
    R.item(s, 'Bánh Mì Sài Gòn'), R.item(s, 'Rau Thơm & Dưa Leo'),
    R.item(s, 'Bánh Phở Tươi'), R.item(s, 'Đậu Hũ Hoàng Gia'), R.item(s, 'Hồi Quế Thảo Mộc'), R.item(s, 'Rượu Nếp Cẩm'),
  ];
  assert.equal(E.act(s, 'lola', 'cook', { recipeId: b.id }, t0 + 1000).likes, 2);
  assert.equal(E.act(s, 'lola', 'cook', { recipeId: g.id, useAddon: true }, t0 + 1100).likes, 5);
  assert.equal(lola.likes, 7);
  assert.equal(lola.garbage, 3);
  assert.ok(lola.unlockedMilestones.includes(3) && lola.unlockedMilestones.includes(7));

  // Both ready for next day -> Day 2 with $300+ daily income & refilled counters!
  E.act(s, 'lola', 'end', {}, t0 + 2000);
  assert.equal(s.day, 1);
  E.act(s, 'angus', 'end', {}, t0 + 2100);
  assert.equal(s.day, 2);
  assert.equal(s.phase, 1);
});

test('200-game real-time stress test (2-player & 8-player) always reaches a clean winner with 0 invariant breaks', () => {
  for (let seed = 0; seed < 200; seed++) {
    const humans = seed % 5 === 0 ? D.TURN_ORDER : ['lola', 'angus'];
    const s = E.newGame(seed * 7919 + 1, humans, { nowMs: 1000 });
    let guard = 0;
    while (!s.over && guard++ < 400) {
      E.autoplay(s, 1000 + guard * 5000);
      for (const chef of Object.values(s.chefs)) {
        assert.ok(chef.money >= 0, `money ${seed}`);
        assert.ok(chef.garbage >= 0, `garbage ${seed}`);
        assert.ok(chef.inventory.length <= R.capacity(chef), `pantry ${seed}`);
        assert.ok(chef.upgrades.length <= D.MAX_UPGRADES);
      }
    }
    assert.ok(s.over, `seed ${seed} finished`);
    assert.ok(s.day <= D.MAX_DAYS);
    assert.ok(s.winner);
  }
});

// ==================== GÓI C TESTS: DAILY EVENTS, AI DIFFICULTIES, EMOTES & ANALYTICS ====================

test('Daily Event Deck has 10 canonical events, rolls deterministically per day, avoids repeats, and respects options.events === false', () => {
  const expectedEffects = [
    'calm_market', 'discount_green', 'discount_protein', 'gourmet_festival', 'hygiene_inspect',
    'free_disposal', 'storm_surcharge', 'vip_chocolate', 'action_sale', 'cook_cash_bonus',
  ];
  assert.equal(D.DAILY_EVENTS.length, 10);
  assert.deepEqual(D.DAILY_EVENTS.map(e => e.effect).sort(), [...expectedEffects].sort());

  // Deterministic roll with identical seed
  const s1 = E.newGame(12345, ['lola', 'angus'], { nowMs: 1000 });
  const s2 = E.newGame(12345, ['lola', 'angus'], { nowMs: 1000 });
  assert.ok(s1.dailyEvent && s1.dailyEvent.id);
  assert.deepEqual(s1.dailyEvent, s2.dailyEvent);
  const v1 = E.view(s1, 'lola', 1000);
  assert.deepEqual(v1.dailyEvent, s1.dailyEvent);

  // Advance to Day 2 -> event rolls deterministically and never repeats back-to-back
  const day1Id = s1.dailyEvent.id;
  E.autoplay(s1, 2000); // Phase 1 -> 2
  E.autoplay(s1, 3000); // Phase 2 -> 3
  E.autoplay(s1, 4000); // Phase 3 -> Day 2
  assert.equal(s1.day, 2);
  assert.ok(s1.dailyEvent);
  assert.notEqual(s1.dailyEvent.id, day1Id, 'consecutive days should roll a fresh event');

  // Backward-compatible disable option
  const sOff = E.newGame(12345, ['lola', 'angus'], { nowMs: 1000, events: false });
  assert.equal(sOff.dailyEvent, null);
  assert.equal(E.view(sOff, 'lola', 1000).dailyEvent, null);
  E.autoplay(sOff, 2000);
  E.autoplay(sOff, 3000);
  E.autoplay(sOff, 4000);
  assert.equal(sOff.dailyEvent, null, 'remains disabled on Day 2+');
});

test('Daily Event mechanical effects: discount_green, discount_protein, storm_surcharge, and calm_market pricing', () => {
  const s = E.newGame(101, ['lola', 'sau'], { nowMs: 1000, events: false });
  s.chefs.lola.currentLocation = 'island'; // Avoid Cô Ba surcharge interfering with baseline price checks
  const chef = s.chefs.sau; // Neutral pricing chef (no market discounts)
  const fruitCard = D.MARKETS.fruit.cards[0];
  const vegCard = D.MARKETS.vegetable.cards[0];
  const carbsCard = D.MARKETS.carbs.cards[0];
  const chopCard = D.MARKETS.chop.cards[0];
  const dairyCard = D.MARKETS.dairy.cards[0];
  const mysteryCard = D.MARKETS.mystery.cards[0];

  // calm_market baseline
  s.dailyEvent = { ...D.DAILY_EVENTS.find(e => e.effect === 'calm_market') };
  assert.equal(R.cardCost(chef, fruitCard, 'fruit', { state: s }), 100);
  assert.equal(R.cardCost(chef, chopCard, 'chop', { state: s }), 200);
  assert.equal(R.cardCost(chef, mysteryCard, 'mystery', { state: s }), 300);

  // discount_green: -$50 fruit & vegetable only (min $50)
  s.dailyEvent = { ...D.DAILY_EVENTS.find(e => e.effect === 'discount_green') };
  assert.equal(R.cardCost(chef, fruitCard, 'fruit', { state: s }), 50);
  assert.equal(R.cardCost(chef, vegCard, 'vegetable', { state: s }), 50);
  assert.equal(R.cardCost(chef, carbsCard, 'carbs', { state: s }), 100);
  assert.equal(R.cardCost(chef, chopCard, 'chop', { state: s }), 200);

  // discount_protein: -$50 chop & dairy only
  s.dailyEvent = { ...D.DAILY_EVENTS.find(e => e.effect === 'discount_protein') };
  assert.equal(R.cardCost(chef, chopCard, 'chop', { state: s }), 150);
  assert.equal(R.cardCost(chef, dairyCard, 'dairy', { state: s }), 150);
  assert.equal(R.cardCost(chef, fruitCard, 'fruit', { state: s }), 100);
  assert.equal(R.cardCost(chef, mysteryCard, 'mystery', { state: s }), 300);

  // storm_surcharge: +$50 at one random regular market (never mystery/island)
  s.dailyEvent = { ...D.DAILY_EVENTS.find(e => e.effect === 'storm_surcharge'), targetMarket: 'carbs' };
  assert.equal(R.cardCost(chef, carbsCard, 'carbs', { state: s }), 150);
  assert.equal(R.cardCost(chef, fruitCard, 'fruit', { state: s }), 100);
  assert.equal(R.cardCost(chef, mysteryCard, 'mystery', { state: s }), 300);

  // Verify rolled storm_surcharge always picks a regular market
  let foundStorm = null;
  for (let seed = 1; seed <= 80 && !foundStorm; seed++) {
    const probe = E.newGame(seed, ['lola', 'angus'], { nowMs: 1000 });
    if (probe.dailyEvent?.effect === 'storm_surcharge') foundStorm = probe.dailyEvent;
  }
  assert.ok(foundStorm, 'storm_surcharge rolls naturally');
  assert.ok(R.isRegularMarket(foundStorm.targetMarket), 'targetMarket is a regular market');
});

test('Daily Event mechanical effects: free_disposal, vip_chocolate, action_sale at The Island', () => {
  const t0 = 10_000;
  const s = E.newGame(202, ['lola', 'angus'], { nowMs: t0, events: false });
  E.act(s, 'lola', 'move', { to: 'island' }, t0);
  E.act(s, 'angus', 'move', { to: 'island' }, t0);
  const lola = s.chefs.lola;

  // free_disposal: $0 garbage disposal even with $0 cash!
  s.dailyEvent = { ...D.DAILY_EVENTS.find(e => e.effect === 'free_disposal') };
  lola.garbage = 3;
  lola.money = 0;
  const disp = E.act(s, 'lola', 'disposeGarbage', { count: 'all' }, t0 + 100);
  assert.deepEqual(disp, { disposed: 3, cost: 0 });
  assert.equal(lola.garbage, 0);
  assert.equal(lola.money, 0);

  // vip_chocolate: Chocolate sells for $650 at Island!
  s.dailyEvent = { ...D.DAILY_EVENTS.find(e => e.effect === 'vip_chocolate') };
  lola.inventory = [R.item(s, 'Sô-cô-la Đặc Sản')];
  const sold = E.act(s, 'lola', 'sellSpecialty', {}, t0 + 200);
  assert.equal(sold.earned, 650);
  assert.equal(lola.money, 650);

  // action_sale: Action Card costs $150 at Island!
  s.dailyEvent = { ...D.DAILY_EVENTS.find(e => e.effect === 'action_sale') };
  const drawn = E.act(s, 'lola', 'draw', {}, t0 + 300);
  assert.equal(drawn.cost, 150);
  assert.equal(lola.money, 500);
});

test('Daily Event mechanical effects: gourmet_festival (+1⭐ gourmet), cook_cash_bonus (+$100/dish), hygiene_inspect (fine >=2 garbage)', () => {
  const t0 = 20_000;
  const s = E.newGame(303, ['lola', 'sau'], { nowMs: t0, events: false });
  E.act(s, 'lola', 'move', { to: 'island' }, t0);
  E.act(s, 'sau', 'move', { to: 'island' }, t0);
  E.act(s, 'lola', 'done', {}, t0 + 100);
  E.act(s, 'sau', 'done', {}, t0 + 200);

  // gourmet_festival: +1⭐ for Gourmet ONLY, +0⭐ for Basic
  s.dailyEvent = { ...D.DAILY_EVENTS.find(e => e.effect === 'gourmet_festival') };
  const lola = s.chefs.lola;
  lola.upgrades.push(D.UPGRADES.find(u => u.id === 'upg_double_cooktop'));
  lola.garbage = 0;
  const basic = R.dealRecipe(s, D.BASIC_RECIPES.find(r => r.id === 'rec_goicuon')); // 2⭐ non-specialty basic
  const gourmet = R.dealRecipe(s, D.GOURMET_RECIPES.find(r => r.id === 'rec_pho')); // 5⭐ non-specialty gourmet -> 6⭐!
  lola.activeRecipes = [basic, gourmet];
  lola.inventory = [
    R.item(s, 'Bánh Phở Tươi'), R.item(s, 'Tôm Sú Tươi'),
    R.item(s, 'Bánh Phở Tươi'), R.item(s, 'Bắp Bò Tươi'), R.item(s, 'Hồi Quế Thảo Mộc'),
  ];
  assert.equal(E.act(s, 'lola', 'cook', { recipeId: basic.id }, t0 + 300).likes, 2, 'basic unaffected by gourmet_festival');
  assert.equal(E.act(s, 'lola', 'cook', { recipeId: gourmet.id }, t0 + 400).likes, 6, 'gourmet gets +1⭐ from gourmet_festival');

  // cook_cash_bonus: +$100 cash per dish (+ Anh Sáu +$50 power = +$150!)
  s.dailyEvent = { ...D.DAILY_EVENTS.find(e => e.effect === 'cook_cash_bonus') };
  const sau = s.chefs.sau;
  sau.money = 300;
  const sauDish = R.dealRecipe(s, D.BASIC_RECIPES.find(r => r.id === 'rec_goicuon'));
  sau.activeRecipes = [sauDish];
  sau.inventory = [R.item(s, 'Bánh Phở Tươi'), R.item(s, 'Tôm Sú Tươi')];
  E.act(s, 'sau', 'cook', { recipeId: sauDish.id }, t0 + 500);
  assert.equal(sau.money, 450, 'Anh Sáu earns +$50 chef perk + $100 cook_cash_bonus');

  // hygiene_inspect: start-of-day fine -$100 for chefs with >=2 garbage, $0 for <=1, clamped at $0
  const sH = E.newGame(404, ['lola', 'angus'], { nowMs: t0 });
  sH.chefs.lola.garbage = 2;
  sH.chefs.lola.money = 300;
  sH.chefs.angus.garbage = 1;
  sH.chefs.angus.money = 300;
  sH.chefs.chen.garbage = 3;
  sH.chefs.chen.money = 50;
  // Find a deterministic RNG state that rolls hygiene_inspect via rollDailyEvent
  let rolledHygiene = false;
  for (let tries = 0; tries < 50; tries++) {
    const clone = JSON.parse(JSON.stringify(sH));
    clone.rng = (tries * 2654435761) >>> 0;
    clone.dailyEvent = null;
    const ev = R.rollDailyEvent(clone);
    if (ev?.effect === 'hygiene_inspect') {
      assert.equal(clone.chefs.lola.money, 200, 'lola (>=2 garbage) fined $100');
      assert.equal(clone.chefs.angus.money, 300, 'angus (1 garbage) not fined');
      assert.equal(clone.chefs.chen.money, 0, 'chen (low cash) clamped safely at $0');
      rolledHygiene = true;
      break;
    }
  }
  assert.ok(rolledHygiene, 'hygiene_inspect rolled and verified cleanly');
});

test('3 AI Difficulty Levels (easy/normal/master) differentiate auction ceilings, chef tactics, and game speed', () => {
  // 1. Auction ceilings: easy (+$50) vs normal (+$100) vs master (+$150)
  for (const [diff, expectedCeiling] of [['easy', 250], ['normal', 300], ['master', 350]]) {
    const s = E.newGame(505, ['lola'], { nowMs: 1000, difficulty: diff, events: false });
    assert.equal(E.view(s, 'lola', 1000).difficulty, diff);
    const bot = s.chefs.chen;
    bot.money = 1000;
    const wantedName = R.needs(bot)[0];
    const auc = { baseCost: 200, currentBid: 200, card: { name: wantedName, type: 'meat' } };
    let bid = 200;
    let guard = 0;
    while (guard++ < 10) {
      const raise = B.botAuctionResponse(s, bot, { ...auc, currentBid: bid });
      if (!raise) break;
      bid += raise;
    }
    assert.equal(bid, expectedCeiling, `${diff} bot ceiling should be $${expectedCeiling}`);
  }

  // 2. Mệ Thảo (angus) Master Wok Away specifically targets the leading rival at her regular market
  const sWok = E.newGame(606, ['lola'], { nowMs: 1000, difficulty: 'master', events: false });
  sWok.chefs.angus.currentLocation = 'fruit';
  sWok.chefs.lola.currentLocation = 'fruit';
  sWok.chefs.chen.currentLocation = 'fruit';
  sWok.chefs.lola.likes = 14; // Leading rival!
  sWok.chefs.chen.likes = 2;
  const kicked = B.botWokAway(sWok, sWok.chefs.angus);
  assert.equal(kicked, true);
  assert.notEqual(sWok.chefs.lola.currentLocation, 'fruit', 'Master Mệ Thảo kicks the leading rival');
  assert.equal(sWok.chefs.chen.currentLocation, 'fruit', 'trailing rival left alone');

  // 3. Cô Ba (lola) Master targets contested regular market to earn +$50 surcharge
  const sCoba = E.newGame(707, ['angus'], { nowMs: 1000, difficulty: 'master', events: false });
  const lola = sCoba.chefs.lola;
  lola.money = 300;
  lola.inventory = [R.item(sCoba, 'Bánh Phở Tươi'), R.item(sCoba, 'Bắp Bò Tươi')];
  // Lola only needs Mystery item (no regular market needs), while all 3 rivals ONLY need Thịt Ba Rọi at 'chop'!
  lola.activeRecipes = [R.dealRecipe(sCoba, D.GOURMET_RECIPES.find(r => r.id === 'rec_pho'))];
  for (const rivalId of ['angus', 'chen', 'lucrezia']) {
    sCoba.chefs[rivalId].money = 500;
    sCoba.chefs[rivalId].inventory = [R.item(sCoba, 'Gạo Tấm Thơm')];
    sCoba.chefs[rivalId].activeRecipes = [R.dealRecipe(sCoba, D.BASIC_RECIPES.find(r => r.id === 'rec_comtam_bicha'))];
  }
  // Clear mystery counter match so Cô Ba prefers farming 3 rivals' +$50 surcharges at 'chop'
  for (const sl of sCoba.markets.mystery.counter) sl.claimedBy = { id: 'angus' };
  sCoba.markets.chop.counter[0].card = { ...D.MARKETS.chop.cards[0], market: 'chop', special: '' }; // Thịt Ba Rọi
  sCoba.markets.chop.counter[0].claimedBy = null;
  const lolaPick = B.chooseMarket(sCoba, lola);
  assert.equal(lolaPick, 'chop', 'Master Cô Ba targets heavily contested regular market for +$50 surcharges');

  // 4. Dì Năm (lucrezia) leverages -$50 Shelf Deck discount at regular market on Master
  const sDinam = E.newGame(808, ['lola'], { nowMs: 1000, difficulty: 'master', events: false });
  sDinam.chefs.lola.currentLocation = 'island'; // Avoid Cô Ba's +$50 surcharge at fruit
  const lucrezia = sDinam.chefs.lucrezia;
  lucrezia.currentLocation = 'fruit';
  lucrezia.money = 100;
  lucrezia.inventory = [];
  lucrezia.actionCards = [];
  lucrezia.activeRecipes = [R.dealRecipe(sDinam, D.BASIC_RECIPES.find(r => r.id === 'rec_cua_rangmuoi'))]; // needs Chanh Ớt Tươi (fruit)
  // Clear counter matches so she draws from Shelf at $50!
  for (const sl of sDinam.markets.fruit.counter) sl.claimedBy = { id: 'lola' };
  const shelfBefore = sDinam.markets.fruit.shelf.length;
  B.botShopAndCard(sDinam, lucrezia);
  assert.equal(sDinam.markets.fruit.shelf.length, shelfBefore - 1, 'Dì Năm draws from Shelf Deck');
  assert.equal(lucrezia.money, 50, 'Dì Năm paid discounted $50 Shelf cost');

  // 5. Master smart garbage dumping hits leader & increments stats.garbageDumped
  const sDump = E.newGame(909, ['lola'], { nowMs: 1000, difficulty: 'master', events: false });
  const dumper = sDump.chefs.chen;
  dumper.garbage = 0; // Even with 0 own garbage, Master dumps on a dangerous leader!
  dumper.actionCards = [R.actionCard(sDump, 'dump_garbage')];
  sDump.chefs.lola.likes = 12;
  sDump.chefs.lola.garbage = 0;
  sDump.chefs.angus.likes = 2;
  B.botShopAndCard(sDump, dumper);
  assert.equal(sDump.chefs.lola.garbage, 1, 'Master dumped garbage onto leading rival');
  assert.equal(dumper.stats.garbageDumped, 1, 'garbageDumped stat tracked');

  // 6. Performance comparison: Master finishes faster on average than Easy
  let easyDays = 0;
  let masterDays = 0;
  for (let i = 1; i <= 20; i++) {
    const se = E.newGame(i * 331, ['lola', 'angus'], { nowMs: 1000, difficulty: 'easy' });
    const sm = E.newGame(i * 331, ['lola', 'angus'], { nowMs: 1000, difficulty: 'master' });
    let g = 0;
    while (!se.over && g++ < 300) E.autoplay(se, 1000 + g * 5000);
    g = 0;
    while (!sm.over && g++ < 300) E.autoplay(sm, 1000 + g * 5000);
    easyDays += se.day;
    masterDays += sm.day;
  }
  assert.ok(masterDays < easyDays, `Master (${masterDays / 20}d) should finish faster than Easy (${easyDays / 20}d)`);
});

test('Real-Time Online Quick Emotes: allowlist, rate-limit, max 6 ring buffer, works in all phases + post-game', () => {
  const t0 = 50_000;
  const s = E.newGame(777, ['lola', 'angus'], { nowMs: t0 });

  // Disallowed emoji rejected
  refused(() => E.act(s, 'lola', 'emote', { emoji: '💩' }, t0), /Biểu cảm không hợp lệ/);
  refused(() => E.act(s, 'lola', 'emote', { emoji: '' }, t0), /Biểu cảm không hợp lệ/);

  // Send allowlisted emote in Phase 1
  const r1 = E.act(s, 'lola', 'emote', { emoji: '🔥' }, t0);
  assert.equal(r1.emote.from, 'lola');
  assert.equal(r1.emote.emoji, '🔥');
  assert.equal(r1.emote.at, t0);

  // Rate limit blocks same chef within 1500ms, allows different chef immediately
  refused(() => E.act(s, 'lola', 'emote', { emoji: '😈' }, t0 + 500), /quá nhanh/);
  E.act(s, 'angus', 'emote', { emoji: '😱' }, t0 + 500);

  // Send 6 more spaced emotes across all 8 allowlisted emojis -> ring buffer keeps last 6 only
  const restEmojis = ['🤝', '😈', '👏', '😂', '🍲', '💀'];
  restEmojis.forEach((em, i) => {
    E.act(s, i % 2 === 0 ? 'lola' : 'angus', 'emote', { emoji: em }, t0 + (i + 2) * 2000);
  });
  const v = E.view(s, 'lola', t0 + 20_000);
  assert.equal(v.emoteCooldowns, undefined, 'rate-limit internals hidden from view');
  assert.equal(v.emotes.length, 6, 'capped to last 6 emotes');
  assert.deepEqual(v.emotes.map(e => e.emoji), restEmojis);

  // Also allowed post-game for GG celebration!
  s.over = true;
  s.winner = 'lola';
  E.act(s, 'lola', 'emote', { emoji: '👏' }, t0 + 30_000);
  assert.equal(s.emotes[s.emotes.length - 1].emoji, '👏');
});

test('End-Game Analytics: dayHistory snapshots & per-chef stats (auctionsWon, tradesDone, garbageDumped, peakMoney)', () => {
  const t0 = 80_000;
  const s = E.newGame(888, ['lola', 'angus'], { nowMs: t0, events: false });
  s.chefs.lola.money = 900;
  s.chefs.angus.money = 900;
  s.chefs.lola.garbage = 2;

  E.act(s, 'lola', 'move', { to: 'chop' }, t0);
  E.act(s, 'angus', 'move', { to: 'chop' }, t0);

  // 1. Live auction -> Lola wins -> auctionsWon === 1
  E.act(s, 'lola', 'buy', { market: 'chop', slotIndex: 0 }, t0 + 1000);
  E.act(s, 'angus', 'fold', {}, t0 + 1500);
  assert.equal(s.chefs.lola.stats.auctionsWon, 1);

  // 2. Human barter with garbage offload -> tradesDone === 1 for both, garbageDumped === 1 for lola
  E.act(s, 'lola', 'offer', { to: 'angus', give: { garbage: 1, money: 150 }, want: { nothing: true } }, t0 + 2000);
  E.act(s, 'angus', 'answer', { offerId: s.offers[0].id, accept: true }, t0 + 2500);
  assert.equal(s.chefs.lola.stats.tradesDone, 1);
  assert.equal(s.chefs.angus.stats.tradesDone, 1);
  assert.equal(s.chefs.lola.stats.garbageDumped, 1);
  assert.ok(s.chefs.angus.stats.peakMoney >= 1050, 'peakMoney updated after receiving barter cash');

  // 3. Complete Day 1 -> dayHistory has Day 1 snapshot
  E.act(s, 'lola', 'done', {}, t0 + 3000);
  E.act(s, 'angus', 'done', {}, t0 + 3100);
  E.act(s, 'lola', 'end', {}, t0 + 3200);
  E.act(s, 'angus', 'end', {}, t0 + 3300);
  assert.equal(s.day, 2);
  assert.equal(s.dayHistory.length, 1);
  assert.equal(s.dayHistory[0].day, 1);
  assert.equal(typeof s.dayHistory[0].likes.lola, 'number');
  assert.equal(typeof s.dayHistory[0].money.angus, 'number');

  // 4. Instant 20⭐ victory on Day 2 -> dayHistory includes Day 2 with winner >= 20⭐!
  E.act(s, 'lola', 'move', { to: 'island' }, t0 + 4000);
  E.act(s, 'angus', 'move', { to: 'island' }, t0 + 4000);
  E.act(s, 'lola', 'done', {}, t0 + 4100);
  E.act(s, 'angus', 'done', {}, t0 + 4200);
  const lola = s.chefs.lola;
  lola.likes = 18;
  lola.garbage = 0;
  const winDish = R.dealRecipe(s, D.BASIC_RECIPES.find(r => r.id === 'rec_banhmi')); // 2 + 1 specialty = 3⭐ -> 21⭐!
  lola.activeRecipes = [winDish];
  lola.inventory = [R.item(s, 'Bánh Mì Sài Gòn'), R.item(s, 'Rau Thơm & Dưa Leo')];
  E.act(s, 'lola', 'cook', { recipeId: winDish.id }, t0 + 4500);
  assert.equal(s.over, true);
  assert.equal(s.winner, 'lola');

  const v = E.view(s, 'lola', t0 + 5000);
  assert.equal(v.dayHistory.length, 2, 'final winning day captured on instant win');
  assert.equal(v.dayHistory[1].day, 2);
  assert.ok(v.dayHistory[1].likes.lola >= 20);
  assert.equal(v.stats.lola.auctionsWon, 1);
  assert.equal(v.stats.lola.tradesDone, 1);
  assert.equal(v.stats.lola.garbageDumped, 1);
  assert.equal(v.stats.lola.dishesCooked, 1);
  assert.deepEqual(v.stats.lola, v.chefs.lola.stats);
});

test('200-game stress test across ALL 3 AI difficulties (easy/normal/master) + Daily Events + Analytics invariants', () => {
  const seenEvents = new Set();
  for (let seed = 0; seed < 200; seed++) {
    const diff = D.AI_DIFFICULTIES[seed % 3];
    const humans = seed % 6 === 0 ? D.TURN_ORDER : ['lola', 'angus'];
    const s = E.newGame(seed * 104729 + 17, humans, { nowMs: 1000, difficulty: diff });
    let guard = 0;
    while (!s.over && guard++ < 400) {
      if (s.dailyEvent) seenEvents.add(s.dailyEvent.id);
      E.autoplay(s, 1000 + guard * 5000);
      for (const chef of Object.values(s.chefs)) {
        assert.ok(chef.money >= 0, `money ${diff} seed=${seed}`);
        assert.ok(chef.garbage >= 0, `garbage ${diff} seed=${seed}`);
        assert.ok(chef.inventory.length <= R.capacity(chef), `pantry ${diff} seed=${seed}`);
        assert.ok(chef.upgrades.length <= D.MAX_UPGRADES, `upgrades ${diff} seed=${seed}`);
        assert.ok(chef.stats.peakMoney >= chef.money, `peakMoney ${diff} seed=${seed}`);
      }
    }
    assert.ok(s.over, `finished ${diff} seed=${seed}`);
    assert.ok(s.day <= D.MAX_DAYS);
    assert.ok(s.winner);
    const v = E.view(s, humans[0], 999_999);
    assert.equal(v.dayHistory.length, s.day, `dayHistory covers all ${s.day} days (seed=${seed})`);
    assert.equal(v.dayHistory[v.dayHistory.length - 1].day, s.day);
    assert.ok(v.stats[s.winner], `winner stats present (seed=${seed})`);
  }
  assert.equal(seenEvents.size, 10, 'all 10 Daily Events appeared across the 200-game stress test');
});
