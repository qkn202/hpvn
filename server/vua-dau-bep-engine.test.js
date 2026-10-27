'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./vua-dau-bep-engine');
const R = require('./vua-dau-bep-rules');
const D = require('./vua-dau-bep-data');

const refused = (fn, pattern) => assert.throws(fn, error => error instanceof E.GameError && pattern.test(error.message));

test('a new table is dealt from its seed and starts on Bếp Sáng', () => {
  const a = E.newGame(42);
  assert.deepEqual(E.newGame(42), a);
  assert.equal(E.currentChef(a).id, 'lola');
  assert.deepEqual(a.humans, ['lola', 'angus']);
  for (const chef of Object.values(a.chefs)) {
    assert.equal(chef.activeRecipes.length, 2);
    assert.equal(chef.activeRecipes.filter(r => r.isGourmet).length, 1);
    assert.equal(chef.inventory.length, chef.id === 'lucrezia' ? 3 : 2);
  }
});

test('only the seat whose turn it is may act, in phase order', () => {
  const s = E.newGame(1);
  refused(() => E.act(s, 'angus', 'move', { to: 'chop' }), /Chưa tới lượt/);
  refused(() => E.act(s, 'lola', 'buy', { market: 'chop', name: 'Thịt Ba Rọi' }), /chọn quầy/);
  refused(() => E.act(s, 'lola', 'move', { to: 'nowhere' }), /không hợp lệ/);
  E.act(s, 'lola', 'move', { to: 'chop' });
  refused(() => E.act(s, 'lola', 'move', { to: 'fruit' }), /đã qua/);
  refused(() => E.act(s, 'lola', 'hack', {}), /không hợp lệ/);
});

test('ending the morning turn runs both market chefs and hands the day to Bếp Chiều', () => {
  const s = E.newGame(7);
  E.act(s, 'lola', 'end');
  assert.equal(E.currentChef(s).id, 'angus');
  assert.equal(s.day, 1);
  assert.ok(s.log.some(line => line.text.includes('Chú Bảy')));
  E.act(s, 'angus', 'end');
  assert.equal(s.day, 2);
  assert.equal(E.currentChef(s).id, 'lola');
  assert.ok(s.chefs.lola.money >= 300 + 200, 'daily income paid');
});

test('the evening seat can outbid what the morning seat bought; the morning seat is paid back', () => {
  const s = E.newGame(3);
  const lola = s.chefs.lola;
  const angus = s.chefs.angus;
  lola.money = 1000;
  angus.money = 1000;
  E.act(s, 'lola', 'move', { to: 'chop' });
  E.act(s, 'lola', 'buy', { market: 'chop', name: 'Thịt Ba Rọi' });
  refused(() => E.act(s, 'lola', 'buy', { market: 'chop', name: 'Thịt Ba Rọi' }), /đã mua/);
  const bought = lola.inventory.at(-1);
  assert.equal(lola.money, 800);
  s.chefs.chen.actionCards = [];
  s.chefs.lucrezia.actionCards = [];
  E.act(s, 'lola', 'end');
  assert.ok(lola.inventory.includes(bought), 'the noon bots never outbid');
  E.act(s, 'angus', 'move', { to: 'chop' });
  refused(() => E.act(s, 'angus', 'buy', { market: 'chop', name: 'Thịt Ba Rọi', bribe: 70 }), /\$50 hoặc \$100/);
  E.act(s, 'angus', 'buy', { market: 'chop', name: 'Thịt Ba Rọi', bribe: 100 });
  assert.equal(angus.money, 700);
  assert.equal(lola.money, 1100);
  assert.ok(angus.inventory.some(i => i.id === bought.id));
  assert.ok(!lola.inventory.some(i => i.id === bought.id));
});

test('a cooked item leaves its shelf card sold out until the round passes', () => {
  const s = E.newGame(5);
  const lola = s.chefs.lola;
  lola.money = 1000;
  lola.inventory = [];
  lola.activeRecipes[0] = { ...lola.activeRecipes[0], requires: ['Thịt Ba Rọi'], likes: 2, isGourmet: false };
  E.act(s, 'lola', 'move', { to: 'chop' });
  E.act(s, 'lola', 'buy', { market: 'chop', name: 'Thịt Ba Rọi' });
  E.act(s, 'lola', 'cook', { recipeId: lola.activeRecipes[0].id });
  assert.equal(lola.likes, 2);
  E.act(s, 'lola', 'end');
  E.act(s, 'angus', 'move', { to: 'chop' });
  s.chefs.angus.money = 1000;
  refused(() => E.act(s, 'angus', 'buy', { market: 'chop', name: 'Thịt Ba Rọi', bribe: 50 }), /bán hết/);
  E.act(s, 'angus', 'end');
  assert.equal(s.claims['chop|Thịt Ba Rọi'], undefined, 'restocked after one round');
});

test('a closure lasts one round and a ban keeps the rival out of your market on their next turn', () => {
  const s = E.newGame(9);
  const lola = s.chefs.lola;
  lola.actionCards = [R.actionCard(s, 'close_market'), R.actionCard(s, 'kick_opponent')];
  E.act(s, 'lola', 'move', { to: 'dairy' });
  E.act(s, 'lola', 'play', { cardId: lola.actionCards[0].id, target: 'mystery' });
  E.act(s, 'lola', 'play', { cardId: lola.actionCards[0].id, target: 'angus' });
  E.act(s, 'lola', 'end');
  refused(() => E.act(s, 'angus', 'move', { to: 'dairy' }), /Cưỡng Chế/);
  E.act(s, 'angus', 'move', { to: 'mystery' });
  refused(() => E.act(s, 'angus', 'buy', { market: 'mystery', name: 'Mắm Ruốc Huế' }), /phong tỏa/);
  E.act(s, 'angus', 'end');
  assert.deepEqual(s.bans, []);
  assert.deepEqual(s.closed, [], 'reopened when the closer plays again');
});

test('a bouncer stops theft and the card is kept', () => {
  const s = E.newGame(11);
  const lola = s.chefs.lola;
  s.chefs.angus.upgrades.push({ id: 'upg_bouncer' });
  lola.actionCards = [R.actionCard(s, 'steal_money')];
  E.act(s, 'lola', 'move', { to: 'fruit' });
  refused(() => E.act(s, 'lola', 'play', { cardId: lola.actionCards[0].id, target: 'angus' }), /Bảo Vệ/);
  assert.equal(lola.actionCards.length, 1);
  E.act(s, 'lola', 'play', { cardId: lola.actionCards[0].id, target: 'chen' });
  assert.equal(lola.money, 400);
});

test('members trade by offer: Bếp Chiều answers in their own turn, unanswered offers lapse', () => {
  const s = E.newGame(13);
  const [lolaItem] = s.chefs.lola.inventory;
  E.act(s, 'lola', 'offer', { to: 'angus', give: { item: lolaItem.id }, want: { money: 150 } });
  refused(() => E.act(s, 'lola', 'trade', { with: 'angus', give: { money: 50 }, want: { money: 50 } }), /chọn quầy|lời đề nghị/);
  E.act(s, 'lola', 'end');
  const [offer] = s.offers;
  const angusMoney = s.chefs.angus.money;
  E.act(s, 'angus', 'answer', { offerId: offer.id, accept: true });
  assert.ok(s.chefs.angus.inventory.some(i => i.id === lolaItem.id));
  assert.equal(s.chefs.angus.money, angusMoney - 150);
  E.act(s, 'angus', 'offer', { to: 'lola', give: { money: 10 }, want: { money: 10 } });
  E.act(s, 'angus', 'end');
  E.act(s, 'lola', 'end');
  assert.deepEqual(s.offers, [], 'Bếp Sáng let it lapse by ending her turn');
});

test('a refused bot trade cannot be re-rolled the same day', () => {
  for (let seed = 0; seed < 50; seed++) {
    const s = E.newGame(seed);
    E.act(s, 'lola', 'move', { to: 'fruit' });
    const chen = s.chefs.chen;
    const want = { item: chen.inventory[0].id };
    const result = E.act(s, 'lola', 'trade', { with: 'chen', give: { money: 10 }, want });
    if (result.accepted) continue;
    refused(() => E.act(s, 'lola', 'trade', { with: 'chen', give: { money: 10 }, want }), /từ chối/);
    return;
  }
  assert.fail('no refusal in 50 seeds');
});

test('a member sees no seed and only a count of the rivals\' action cards', () => {
  const s = E.newGame(17);
  const seen = E.view(s, 'angus');
  assert.equal(seen.rng, undefined);
  assert.deepEqual(seen.chefs.lola.actionCards, []);
  assert.equal(seen.chefs.lola.actionCardCount, 2);
  assert.equal(seen.chefs.angus.actionCards.length, 1);
  assert.equal(seen.turnChef, 'lola');
});

test('autopilot games always end with a winner and never break the pantry or money rules', () => {
  for (let seed = 0; seed < 120; seed++) {
    const s = E.newGame(seed * 7919);
    let guard = 0;
    while (!s.over && guard++ < 500) {
      E.autoplay(s);
      for (const chef of Object.values(s.chefs)) {
        assert.ok(chef.money >= 0, `money ${seed}`);
        assert.ok(chef.inventory.length <= R.capacity(chef), `pantry ${seed}`);
        assert.ok(chef.upgrades.length <= 4);
      }
    }
    assert.ok(s.over, `seed ${seed} finished`);
    assert.ok(s.day <= 30);
    assert.ok(s.winner);
  }
});

test('a member who leaves is replaced by the bots and the other member keeps playing', () => {
  const s = E.newGame(21);
  E.leave(s, 'angus');
  E.act(s, 'lola', 'end');
  assert.equal(s.day, 2);
  assert.equal(E.currentChef(s).id, 'lola');
});

test('eight members: one turn each per day in TURN_ORDER, no bots, and the game still ends', () => {
  const s = E.newGame(31, ['muoi', 'lola', 'tam', 'chen', 'hai', 'angus', 'sau', 'lucrezia']);
  assert.deepEqual(R.order(s), ['lola', 'chen', 'lucrezia', 'hai', 'sau', 'tam', 'muoi', 'angus']);
  for (const id of R.order(s)) { assert.equal(E.currentChef(s).id, id); E.act(s, id, 'end'); }
  assert.equal(s.day, 2);
  assert.equal(s.chefs.muoi.inventory.length, 2);
  assert.equal(s.chefs.sau.actionCards[0].type, 'lucky_money');
  let guard = 0;
  while (!s.over && guard++ < 1000) E.autoplay(s);
  assert.ok(s.over && s.winner);
});

test('a claim at an eight-chef table lasts until every chef has played once', () => {
  const s = E.newGame(33, D.TURN_ORDER);
  s.chefs.lola.money = 1000;
  E.act(s, 'lola', 'move', { to: 'chop' });
  E.act(s, 'lola', 'buy', { market: 'chop', name: 'Bắp Bò Tươi' });
  assert.equal(s.claims['chop|Bắp Bò Tươi'].left, 8);
});

test('the new chefs\' powers: Bà Tám pays less for seafood, Út Mười has a bigger pantry, Anh Sáu earns per dish', () => {
  const s = E.newGame(35, D.TURN_ORDER);
  const shrimp = D.MARKETS.dairy.cards[0];
  assert.equal(R.cardCost(s.chefs.tam, shrimp, 'dairy'), 100);
  assert.equal(R.cardCost(s.chefs.hai, D.MARKETS.fruit.cards[0], 'fruit'), 50);
  assert.equal(R.capacity(s.chefs.muoi), 6);
  assert.equal(R.dailyPerk(s.chefs.muoi), 50);
  const sau = s.chefs.sau;
  sau.inventory = [R.item(s, 'Bánh Mì Sài Gòn'), R.item(s, 'Trứng Gà Ta')];
  sau.activeRecipes[0] = R.dealRecipe(s, D.BASIC_RECIPES.find(r => r.id === 'rec_trung_opla_banhmi'));
  const money = sau.money;
  R.cook(s, sau, sau.activeRecipes[0]);
  assert.equal(sau.money, money + 50);
});
