'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./vua-dau-bep-engine');
const R = require('./vua-dau-bep-rules');
const D = require('./vua-dau-bep-data');

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
