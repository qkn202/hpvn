'use strict';

// Smart AI Bots for Real-Time Simultaneous Rival Restaurants Online Engine:
// - 3 AI Difficulty Levels: 'easy' | 'normal' | 'master' (default 'normal')
// - Chef-Specific Personality & Tactics (Cô Ba contested surcharge, Mệ Thảo smart Wok Away,
//   Dì Năm Shelf Deck discount, Chú Bảy/Bà Tám/Chị Hai market discounts)
// - Daily Event awareness (free_disposal, vip_chocolate, action_sale, discounts, storm, gourmet_festival)
// - Live Bidding Wars (botAuctionResponse), Action Cards (playOneCard), Shopping & Cooking
const D = require('./vua-dau-bep-data');
const R = require('./vua-dau-bep-rules');

function getDifficulty(s) {
  return D.AI_DIFFICULTIES.includes(s?.difficulty) ? s.difficulty : 'normal';
}

function rivalsSortedByLead(s, chef) {
  return Object.values(s.chefs)
    .filter(c => c !== chef)
    .sort((a, b) => (b.likes - a.likes) || (b.money - a.money));
}

function bestNextUpgrade(s, chef, diff) {
  if ((chef.upgrades || []).length >= D.MAX_UPGRADES) return null;
  let order;
  if (diff === 'master') {
    const leading = rivalsSortedByLead(s, chef).every(r => chef.likes >= r.likes);
    const nearFull = chef.inventory.length >= R.capacity(chef) - 1;
    order = ['upg_double_cooktop', 'upg_marketing', 'upg_vip', 'upg_celebrity', 'upg_delivery', 'upg_freezer', 'upg_bouncer'];
    if (nearFull) {
      order = ['upg_double_cooktop', 'upg_freezer', 'upg_marketing', 'upg_vip', 'upg_celebrity', 'upg_delivery', 'upg_bouncer'];
    }
    if (leading && chef.likes >= 10) {
      order = ['upg_double_cooktop', 'upg_bouncer', 'upg_marketing', 'upg_vip', 'upg_celebrity', 'upg_delivery', 'upg_freezer'];
    }
    if (s.day >= 14) {
      // Late game: prioritize instant star/cook acceleration over slow income ROI
      order = ['upg_double_cooktop', 'upg_celebrity', 'upg_delivery', 'upg_vip', 'upg_bouncer', 'upg_freezer', 'upg_marketing'];
    }
  } else if (diff === 'easy') {
    order = ['upg_freezer', 'upg_marketing', 'upg_bouncer', 'upg_vip', 'upg_double_cooktop', 'upg_delivery', 'upg_celebrity'];
  } else {
    order = ['upg_double_cooktop', 'upg_marketing', 'upg_vip', 'upg_freezer', 'upg_celebrity', 'upg_bouncer', 'upg_delivery'];
  }
  const buffer = diff === 'master' ? (s.day <= 5 ? 50 : 100) : (diff === 'easy' ? 250 : 150);
  const unowned = order
    .map(id => D.UPGRADES.find(u => u.id === id))
    .filter(u => u && !R.hasUpgrade(chef, u.id));
  if (diff === 'master') {
    // Master commits to its top 2 priority upgrades instead of settling for low-priority filler on Day 1
    return unowned.slice(0, 2).find(u => chef.money >= u.cost + buffer) || null;
  }
  return unowned.find(u => chef.money >= u.cost + buffer) || null;
}

// Score how valuable a single card is to `chef` (higher = more desirable)
function scoreCardForChef(s, chef, card, shopKey, diff) {
  const cost = R.cardCost(chef, card, shopKey, { fromShelf: false, state: s });
  if (chef.money < cost) return 0;

  const rest = R.restaurantOf(chef);
  const ev = s?.dailyEvent;
  let score = 0;

  for (const r of (chef.activeRecipes || [])) {
    const info = R.missingFor(chef, r);
    const neededCount = info.missing.filter(n => n === card.name).length;
    if (neededCount > 0) {
      const effectivelyMissing = Math.max(0, info.missing.length - info.wildCount);
      if (effectivelyMissing === 1) {
        // Completes a recipe immediately!
        const pv = R.previewCook(chef, r, { useAddon: !!R.eligibleAddonFor(chef, r), state: s });
        const winsNow = chef.likes + pv.netLikes >= D.WIN_LIKES;
        score = Math.max(score, (diff === 'master' ? 7 : 4.5) + (winsNow ? 8 : 0) + (r.isGourmet ? 1.5 : 0));
      } else {
        score = Math.max(score, (diff === 'master' ? 4 : 3) + (r.cuisine === rest.cuisine ? 1 : 0));
      }
      if (ev?.effect === 'gourmet_festival' && r.isGourmet) score += 1.5;
    }
  }

  // Mystery Mart specials
  if (card.type === 'wild') {
    const almostReady = chef.activeRecipes.some(r => R.missingFor(chef, r).missing.length === 1);
    score = Math.max(score, diff === 'master' ? (almostReady ? 7.5 : 5.5) : 3.5);
  } else if (card.type === 'tofu') {
    const needsMeat = R.needs(chef).some(n => R.ingredient(n)?.type === 'meat');
    if (needsMeat || (chef.garbage || 0) >= 1) {
      score = Math.max(score, diff === 'master' ? (needsMeat ? 5.5 : 3.5) : 3);
    }
  } else if (card.type === 'chocolate') {
    const chocVal = ev?.effect === 'vip_chocolate' ? 5.5 : 3;
    if (chef.money >= cost + 50 || ev?.effect === 'vip_chocolate') {
      score = Math.max(score, diff === 'master' ? chocVal : 2.5);
    }
  } else if (card.type === 'wine' && chef.activeRecipes.some(r => r.isGourmet)) {
    score = Math.max(score, diff === 'master' ? 3 : 2);
  } else if (card.type === 'secret_sauce' && chef.activeRecipes.some(r => !r.isGourmet)) {
    score = Math.max(score, diff === 'master' ? 2.5 : 1.8);
  }

  // Price efficiency bonus on Master
  if (diff === 'master' && score > 0) {
    if (cost <= 50) score += 1;
    else if (ev?.effect === 'storm_surcharge' && ev.targetMarket === shopKey && score < 7) score -= 1.5;
  }
  return score;
}

// Estimate how many rivals want face-up cards at a regular market (for Cô Ba surcharge / Mệ Thảo denial)
function rivalDemandAtMarket(s, chef, key) {
  const mState = s.markets?.[key];
  if (!mState) return 0;
  let demand = 0;
  for (const other of Object.values(s.chefs)) {
    if (other === chef) continue;
    const otherNeeds = R.needs(other);
    const wantsCounter = (mState.counter || []).some(sl =>
      sl?.card && !sl.claimedBy
      && (otherNeeds.includes(sl.card.name) || ['wild', 'tofu', 'chocolate'].includes(sl.card.type))
      && other.money >= R.cardCost(other, sl.card, key, { state: s })
    );
    if (wantsCounter) demand += 1;
  }
  return demand;
}

function chooseMarket(s, chef) {
  const diff = getDifficulty(s);
  const banned = (s.bans || []).filter(b => b.chef === chef.id).map(b => b.market);
  const open = key => !R.isClosed(s, key) && !banned.includes(key);
  const ev = s?.dailyEvent;
  const disposalCost = R.garbageDisposalCost(s);
  const actCost = R.actionCardCost(s);

  const hasChoc = chef.inventory.some(i => i.type === 'chocolate');

  // Check if a market holds a winning dish completion today (Master prioritizes winning over Island!)
  let winningMarket = null;
  if (diff === 'master' && chef.inventory.length < R.capacity(chef)) {
    for (const key of D.MARKET_KEYS) {
      if (!open(key)) continue;
      for (const sl of (s.markets?.[key]?.counter || [])) {
        if (!sl?.card || sl.claimedBy) continue;
        if (scoreCardForChef(s, chef, sl.card, key, 'master') >= 13) {
          winningMarket = key;
          break;
        }
      }
      if (winningMarket) break;
    }
  }
  if (winningMarket) return winningMarket;

  // Island priorities
  if (hasChoc && (diff !== 'easy' || R.rand(s) < 0.7)) return 'island';
  if (ev?.effect === 'free_disposal' && (chef.garbage || 0) >= 1 && (diff !== 'easy' || chef.garbage >= 2)) {
    return 'island';
  }
  const garbageThreshold = diff === 'easy' ? 3 : 2;
  if ((chef.garbage || 0) >= garbageThreshold && chef.money >= disposalCost * Math.min(2, chef.garbage)) {
    return 'island';
  }
  if (diff === 'master' && R.hasUpgrade(chef, 'upg_celebrity') && (chef.garbage || 0) >= 1 && chef.money >= disposalCost) {
    return 'island';
  }

  // Upgrade priority at Island
  const nextUpg = bestNextUpgrade(s, chef, diff);
  if (nextUpg) {
    if (diff === 'master') {
      const topTier = ['upg_double_cooktop', 'upg_marketing', 'upg_vip', 'upg_celebrity'].includes(nextUpg.id);
      const shouldInvest = chef.likes < 15 || nextUpg.id === 'upg_double_cooktop';
      if (shouldInvest && topTier && chef.inventory.length <= R.capacity(chef) - 1) return 'island';
      if (shouldInvest && R.rand(s) < 0.55) return 'island';
    } else if (diff === 'normal') {
      if (chef.money >= 550 && R.rand(s) < 0.45) return 'island';
    } else if (chef.money >= 650 && R.rand(s) < 0.25) {
      return 'island';
    }
  }

  // Easy AI sometimes wanders casually
  if (diff === 'easy' && R.rand(s) < 0.25) {
    const anyOpen = D.MARKET_KEYS.filter(open);
    if (anyOpen.length) return R.pick(s, anyOpen);
  }

  // Score all open markets
  const scores = {};
  const chefNeeds = R.needs(chef);

  for (const key of D.MARKET_KEYS) {
    if (!open(key)) continue;
    const mState = s.markets?.[key];
    if (!mState) continue;
    let total = 0;
    let counterMatches = 0;

    if (chef.inventory.length < R.capacity(chef)) {
      for (const sl of (mState.counter || [])) {
        if (!sl?.card || sl.claimedBy) continue;
        if (diff === 'easy') {
          if (chefNeeds.includes(sl.card.name) && chef.money >= R.cardCost(chef, sl.card, key, { state: s })) {
            total += 2;
            counterMatches += 1;
          }
        } else {
          const val = scoreCardForChef(s, chef, sl.card, key, diff);
          if (val > 0) {
            total += val;
            counterMatches += 1;
          }
        }
      }
      // Master bonus for buying multiple useful cards in a single trip
      if (diff === 'master' && counterMatches >= 2 && chef.inventory.length + 2 <= R.capacity(chef)) {
        total += 2;
      }

      // Shelf Deck opportunity (fair: uses public market card catalog, never peeks shelf order!)
      if (mState.shelf?.length > 0) {
        const shelfMatchesCatalog = chefNeeds.filter(n => D.MARKETS[key].cards.some(c => c.name === n)).length;
        const shelfCost = R.cardCost(chef, { cost: D.MARKETS[key].cost }, key, { fromShelf: true, state: s });
        if (shelfMatchesCatalog > 0 && chef.money >= shelfCost) {
          if (chef.id === 'lucrezia' && R.isRegularMarket(key) && diff !== 'easy') {
            // Dì Năm leverages her -$50 Shelf Deck discount at regular markets!
            total += diff === 'master' ? (2.5 + shelfMatchesCatalog * 0.75) : 1.5;
          } else {
            total += diff === 'master' ? (1.2 + shelfMatchesCatalog * 0.3) : 1;
          }
        }
      }
    }

    // Chef-specific market tactics (Normal & Master)
    if (diff !== 'easy' && R.isRegularMarket(key)) {
      if (chef.id === 'lola') {
        // Cô Ba targets contested regular markets to farm +$50 surcharge!
        const demand = rivalDemandAtMarket(s, chef, key);
        if (demand > 0) total += demand * (diff === 'master' ? 2.5 : 1.2);
      } else if (chef.id === 'angus' && diff === 'master') {
        // Mệ Thảo likes contesting the leader's regular market to Wok Away them!
        const leader = rivalsSortedByLead(s, chef)[0];
        if (leader) {
          const leaderWantsHere = (mState.counter || []).some(sl =>
            sl?.card && !sl.claimedBy && R.needs(leader).includes(sl.card.name)
          );
          if (leaderWantsHere && total > 0) total += 1.5;
        }
      } else if (chef.id === 'chen' && key === 'chop' && total > 0) {
        total += diff === 'master' ? 1.2 : 0.6;
      } else if (chef.id === 'tam' && key === 'dairy' && total > 0) {
        total += diff === 'master' ? 1.2 : 0.6;
      } else if (chef.id === 'hai' && (key === 'fruit' || key === 'vegetable') && total > 0) {
        total += diff === 'master' ? 1.0 : 0.5;
      }
    }

    if (total > 0) scores[key] = total;
  }

  const keys = Object.keys(scores);
  if (keys.length) {
    const best = Math.max(...keys.map(k => scores[k]));
    // On Master, break near-ties strictly; on Easy/Normal pick among top tied markets
    return R.pick(s, keys.filter(k => scores[k] >= best - 0.01));
  }

  if ((chef.garbage || 0) >= 1 && chef.money >= disposalCost) return 'island';
  if (chef.money >= actCost + 100 && chef.actionCards.length < (ev?.effect === 'action_sale' ? 3 : 2)) return 'island';
  const any = D.MARKET_KEYS.filter(open);
  return any.length ? R.pick(s, any) : 'island';
}

// Bot Mệ Thảo (Angus Khan) automatic Wok Away at start of Phase 2
function botWokAway(s, angus) {
  if (!angus || s.humans.includes('angus')) return false;
  if (!R.isRegularMarket(angus.currentLocation) || angus.chefPowerDay === s.day) return false;
  const sameSpot = Object.values(s.chefs).filter(c => c !== angus && c.currentLocation === angus.currentLocation);
  if (!sameSpot.length) return false;

  const diff = getDifficulty(s);
  if (diff === 'easy' && R.rand(s) >= 0.35) return false;
  if (diff === 'normal' && R.rand(s) >= 0.65) return false;
  // Master always uses Wok Away when contesting a regular market!

  // Pick victim: Master & Normal target the leading rival at this market!
  const sortedVictims = [...sameSpot].sort((a, b) => (b.likes - a.likes) || (b.money - a.money));
  const victim = diff === 'easy' ? R.pick(s, sameSpot) : sortedVictims[0];

  const opts = D.MARKET_KEYS.filter(k => k !== angus.currentLocation && !R.isClosed(s, k));
  let newM = 'island';
  if (opts.length) {
    if (diff === 'master') {
      // Kick the leading rival to the WORST open market for them (0 needed counter cards, storm preferred!)
      const victimNeeds = R.needs(victim);
      const scoredOpts = opts.map(k => {
        const counterMatches = (s.markets?.[k]?.counter || []).filter(
          sl => sl?.card && !sl.claimedBy && victimNeeds.includes(sl.card.name)
        ).length;
        const stormPenalty = (s.dailyEvent?.effect === 'storm_surcharge' && s.dailyEvent.targetMarket === k) ? -1 : 0;
        return { key: k, badness: counterMatches * 3 + stormPenalty };
      });
      const minBadness = Math.min(...scoredOpts.map(o => o.badness));
      newM = R.pick(s, scoredOpts.filter(o => o.badness === minBadness).map(o => o.key));
    } else {
      newM = R.pick(s, opts);
    }
  }

  victim.currentLocation = newM;
  angus.chefPowerDay = s.day;
  R.say(s, `🔥 Mệ Thảo dùng Đuổi Chợ (Wok Away): đá ${R.chefName(victim.id)} văng sang ${R.marketName(newM)}!`);
  return true;
}

function playOneCard(s, chef) {
  if (!chef.actionCards.length || chef.cardDay === s.day) return;
  const diff = getDifficulty(s);

  // Easy AI is conservative with Action Cards
  if (diff === 'easy' && R.rand(s) < 0.45) return;

  const byLeader = rivalsSortedByLead(s, chef);
  const leader = byLeader[0] || null;
  const find = (...types) => chef.actionCards.find(c => types.includes(c.type));
  let card = null;
  let text = '';

  const canCookAny = chef.activeRecipes.some(r => R.canCook(chef, r));
  const oneMissingAny = chef.activeRecipes.some(r => {
    const m = R.missingFor(chef, r);
    return m.missing.length - m.wildCount === 1;
  });

  if ((card = find('lucky_money'))) {
    chef.money += 200;
    R.trackPeakMoney(chef);
    text = 'nhận Lì Xì Bếp Trưởng +$200';
  } else if ((card = find('five_star_review')) && canCookAny) {
    chef.reviewBonusToday = (chef.reviewBonusToday || 0) + 2;
    text = 'dùng Đánh Giá 5 Sao (+2⭐ cho món nấu hôm nay)';
  } else if ((card = find('wild_substitute')) && chef.inventory.length < R.capacity(chef) && oneMissingAny) {
    text = `dùng Ảo Thuật Ẩm Thực (${R.addWild(s, chef)})`;
  } else if (diff !== 'easy' || R.rand(s) < 0.35) {
    card = null;
    const dumpG = find('dump_garbage');
    const stealMoney = find('steal_money');
    const stealItem = find('steal_item');
    const close = find('close_market');
    const kick = find('kick_opponent');

    const moneyTarget = byLeader.find(c => !R.hasUpgrade(c, 'upg_bouncer') && c.money >= 100)
      || byLeader.find(c => c.money > 0);
    const itemTarget = byLeader.find(c => !R.hasUpgrade(c, 'upg_bouncer') && c.inventory.length > 0)
      || byLeader.find(c => c.inventory.length > 0);
    const closeTarget = byLeader.find(c =>
      D.MARKET_KEYS.includes(c.currentLocation)
      && c.currentLocation !== chef.currentLocation
      && !R.isClosed(s, c.currentLocation)
    );
    const kickTarget = byLeader.find(c =>
      c.currentLocation === chef.currentLocation && D.MARKET_KEYS.includes(chef.currentLocation)
    );

    // Master smart garbage dumping: dump onto the leader when holding garbage OR when leader is pulling ahead!
    const shouldDump = dumpG && leader && (
      (chef.garbage || 0) > 0
      || (diff === 'master' && leader.likes >= 6)
      || (diff === 'normal' && leader.likes >= 12)
    );

    if (shouldDump) {
      // Master prefers top contender without Bouncer if within 2⭐ of #1, else hits #1 leader
      const target = (diff === 'master'
        ? (byLeader.find(c => !R.hasUpgrade(c, 'upg_bouncer') && c.likes >= leader.likes - 2) || leader)
        : leader);
      if (R.hasUpgrade(target, 'upg_bouncer') && R.rand(s) < 0.5) {
        text = `định đổ rác sang ${R.chefName(target.id)} nhưng bị Bảo Vệ chặn`;
      } else {
        if ((chef.garbage || 0) > 0) chef.garbage = Math.max(0, chef.garbage - 1);
        target.garbage = (target.garbage || 0) + 1;
        R.ensureStats(chef).garbageDumped += 1;
        text = `đổ 1 Túi Rác 🗑️ sang ${R.chefName(target.id)}`;
      }
      card = dumpG;
    } else if (kick && kickTarget && diff === 'master') {
      const opts = D.MARKET_KEYS.filter(k => k !== chef.currentLocation && !R.isClosed(s, k));
      const newM = opts.length ? R.pick(s, opts) : 'island';
      kickTarget.currentLocation = newM;
      card = kick;
      text = `dùng Cưỡng Chế Đổi Chợ đá ${R.chefName(kickTarget.id)} sang ${R.marketName(newM)}`;
    } else if (stealMoney && moneyTarget) {
      if (R.hasUpgrade(moneyTarget, 'upg_bouncer') && R.rand(s) < 0.5) {
        text = `định cướp tiền của ${R.chefName(moneyTarget.id)} nhưng bị Bảo Vệ chặn`;
      } else {
        const amt = Math.min(100, moneyTarget.money);
        moneyTarget.money -= amt;
        chef.money += amt;
        R.trackPeakMoney(chef);
        text = `cướp $${amt} của ${R.chefName(moneyTarget.id)}`;
      }
      card = stealMoney;
    } else if (stealItem && itemTarget && chef.inventory.length < R.capacity(chef)) {
      if (R.hasUpgrade(itemTarget, 'upg_bouncer') && R.rand(s) < 0.5) {
        text = `định trộm đồ của ${R.chefName(itemTarget.id)} nhưng bị Bảo Vệ chặn`;
      } else {
        const [taken] = itemTarget.inventory.splice(Math.floor(R.rand(s) * itemTarget.inventory.length), 1);
        chef.inventory.push(taken);
        text = `trộm ${taken.emoji} ${taken.name} của ${R.chefName(itemTarget.id)}`;
      }
      card = stealItem;
    } else if (close && closeTarget) {
      s.closed.push({ market: closeTarget.currentLocation, by: chef.id, left: 1 });
      card = close;
      text = `phong tỏa ${R.marketName(closeTarget.currentLocation)}`;
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
  const diff = getDifficulty(s);
  const key = chef.currentLocation;
  if (R.isClosed(s, key)) return;

  if (key === 'island') {
    const chocPrice = R.chocolateSellValue(s);
    let chocIdx;
    while ((chocIdx = chef.inventory.findIndex(i => i.type === 'chocolate')) !== -1) {
      const [sold] = chef.inventory.splice(chocIdx, 1);
      const tpl = R.ingredient(sold.name);
      if (tpl) s.dumpster.push(tpl);
      chef.money += chocPrice;
      R.trackPeakMoney(chef);
      R.say(s, `🍫 ${R.chefName(chef.id)} bán Sô-cô-la Đặc Sản thu +$${chocPrice}!`);
    }

    const disposalCost = R.garbageDisposalCost(s);
    if ((chef.garbage || 0) > 0) {
      if (disposalCost === 0) {
        const qty = chef.garbage;
        chef.garbage = 0;
        R.say(s, `🧹 ${R.chefName(chef.id)} dọn miễn phí ${qty} Túi Rác ($0 - Ngày Xanh Đô Thị).`);
      } else if (chef.money >= disposalCost && (diff !== 'easy' || chef.garbage >= 2)) {
        const qty = Math.min(chef.garbage, Math.floor(chef.money / disposalCost));
        if (qty > 0) {
          chef.money -= qty * disposalCost;
          chef.garbage -= qty;
          R.say(s, `🧹 ${R.chefName(chef.id)} trả $${qty * disposalCost} dọn ${qty} Túi Rác.`);
        }
      }
    }

    const upgrade = bestNextUpgrade(s, chef, diff);
    if (upgrade) {
      chef.money -= upgrade.cost;
      chef.upgrades.push({ ...upgrade });
      R.say(s, `🛠️ ${R.chefName(chef.id)} mua nâng cấp ${upgrade.icon} ${upgrade.name}.`);
    }

    const actCost = R.actionCardCost(s);
    const maxCards = diff === 'master' && s.dailyEvent?.effect === 'action_sale' ? 3 : (diff === 'easy' ? 1 : 2);
    const actBuffer = diff === 'master' ? 100 : 150;
    if (chef.money >= actCost + actBuffer && chef.actionCards.length < maxCards) {
      chef.money -= actCost;
      chef.actionCards.push(R.actionCard(s, R.pick(s, D.ACTION_CARDS).type));
    }

    const wanted = R.needs(chef);
    const found = s.dumpster.findIndex(d =>
      wanted.includes(d.name)
      || (diff === 'master' && ['wild', 'tofu', 'chocolate', 'wine', 'secret_sauce'].includes(d.type))
    );
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

  // Order counter slots: Master prioritizes highest-value cards first!
  const counterSlots = [...(mState.counter || [])];
  if (diff === 'master') {
    counterSlots.sort((a, b) => {
      const sa = (a?.card && !a.claimedBy) ? scoreCardForChef(s, chef, a.card, key, 'master') : -1;
      const sb = (b?.card && !b.claimedBy) ? scoreCardForChef(s, chef, b.card, key, 'master') : -1;
      return sb - sa;
    });
  }

  for (const slot of counterSlots) {
    if (chef.inventory.length >= R.capacity(chef)) break;
    if (diff === 'easy' && boughtHere >= 1) break; // Casual shopping: max 1 counter buy per visit
    if (!slot || !slot.card || slot.claimedBy) continue;
    const card = slot.card;
    const isSpecialGood = ['wild', 'tofu', 'chocolate'].includes(card.type)
      || (card.type === 'wine' && chef.activeRecipes.some(r => r.isGourmet))
      || (card.type === 'secret_sauce' && chef.activeRecipes.some(r => !r.isGourmet));
    const wants = R.needs(chef).includes(card.name) || (diff !== 'easy' && isSpecialGood);
    if (!wants) continue;
    const cost = R.cardCost(chef, card, key, { fromShelf: false, state: s });
    if (chef.money < cost) continue;
    chef.money -= cost;
    const surchargeOwner = R.marketSurchargeOwner(s, chef, key);
    if (surchargeOwner) {
      surchargeOwner.money += 50;
      R.trackPeakMoney(surchargeOwner);
    }
    const bought = { id: R.newId(s, 'ing'), ...card, cost };
    chef.inventory.push(bought);
    const claim = { id: chef.id, itemInstanceId: bought.id, baseCost: cost, bribeCost: 50, left: 1 };
    slot.claimedBy = claim;
    s.claims[R.claimKey(key, slot.slotIdx)] = claim;
    chef.boughtCountToday += 1;
    boughtHere += 1;
    R.say(s, `🛒 ${R.chefName(chef.id)} mua ${card.emoji} ${card.name} ($${cost}).`);
  }

  // Shelf Deck draw (Dì Năm leverages her -$50 Shelf Deck discount at regular markets!)
  const lucreziaBonusDraw = chef.id === 'lucrezia' && R.isRegularMarket(key) && diff === 'master';
  if ((boughtHere === 0 || lucreziaBonusDraw) && mState.shelf.length > 0 && chef.inventory.length < R.capacity(chef)) {
    const shelfCost = R.cardCost(chef, { cost: D.MARKETS[key].cost }, key, { fromShelf: true, state: s });
    const hasNeededInMarket = R.needs(chef).some(n => D.MARKETS[key].cards.some(c => c.name === n));
    const wantsShelf = hasNeededInMarket && chef.money >= shelfCost && (diff !== 'easy' || R.rand(s) < 0.5);
    if (wantsShelf) {
      const drawn = mState.shelf.shift();
      chef.money -= shelfCost;
      const surchargeOwner = R.marketSurchargeOwner(s, chef, key);
      if (surchargeOwner) {
        surchargeOwner.money += 50;
        R.trackPeakMoney(surchargeOwner);
      }
      chef.inventory.push({ id: R.newId(s, 'ing'), ...drawn, cost: shelfCost });
      chef.boughtCountToday += 1;
      R.say(s, `📦 ${R.chefName(chef.id)} bốc Kệ Úp ${R.marketName(key)} được ${drawn.emoji} ${drawn.name} ($${shelfCost}).`);
    }
  }

  // Master AI utilizes Remote Delivery upgrade (`upg_delivery`) to grab a needed card from another open market!
  if (diff === 'master' && R.hasUpgrade(chef, 'upg_delivery') && !chef.deliveryUsedToday && chef.inventory.length < R.capacity(chef)) {
    let bestRemote = null;
    for (const otherKey of D.MARKET_KEYS) {
      if (otherKey === key || R.isClosed(s, otherKey)) continue;
      for (const slot of (s.markets?.[otherKey]?.counter || [])) {
        if (!slot?.card || slot.claimedBy) continue;
        const val = scoreCardForChef(s, chef, slot.card, otherKey, 'master');
        if (val >= 4 && (!bestRemote || val > bestRemote.val)) {
          bestRemote = { market: otherKey, slot, val };
        }
      }
    }
    if (bestRemote) {
      const { market: rKey, slot } = bestRemote;
      const cost = R.cardCost(chef, slot.card, rKey, { fromShelf: false, state: s });
      if (chef.money >= cost) {
        chef.money -= cost;
        const surchargeOwner = R.marketSurchargeOwner(s, chef, rKey);
        if (surchargeOwner) {
          surchargeOwner.money += 50;
          R.trackPeakMoney(surchargeOwner);
        }
        const bought = { id: R.newId(s, 'ing'), ...slot.card, cost };
        chef.inventory.push(bought);
        const claim = { id: chef.id, itemInstanceId: bought.id, baseCost: cost, bribeCost: 50, left: 1 };
        slot.claimedBy = claim;
        s.claims[R.claimKey(rKey, slot.slotIdx)] = claim;
        chef.deliveryUsedToday = true;
        R.say(s, `🛵 ${R.chefName(chef.id)} đặt giao từ xa ${slot.card.emoji} ${slot.card.name} tại ${R.marketName(rKey)} ($${cost}).`);
      }
    }
  }
}

function botShopAndCard(s, chef) {
  playOneCard(s, chef);
  trashIfFull(s, chef);
  shop(s, chef);
  R.syncAllPeakMoney(s);
}

function botCookAll(s, chef) {
  const diff = getDifficulty(s);
  const candidates = [...chef.activeRecipes].sort((a, b) => {
    const pa = R.previewCook(chef, a, { useAddon: !!R.eligibleAddonFor(chef, a), state: s }).netLikes;
    const pb = R.previewCook(chef, b, { useAddon: !!R.eligibleAddonFor(chef, b), state: s }).netLikes;
    return (pb - pa) || (b.likes - a.likes);
  });
  const disposalCost = R.garbageDisposalCost(s);
  for (const recipe of candidates) {
    if (s.over) break;
    if (!R.canCook(chef, recipe)) continue;
    const previewNoAddon = R.previewCook(chef, recipe, { useAddon: false, state: s });
    if (previewNoAddon.netLikes === 0 && (chef.garbage || 0) >= 2 && chef.money >= disposalCost) continue;
    const hasAddon = !!R.eligibleAddonFor(chef, recipe);
    const useAddon = diff === 'easy' ? (hasAddon && R.rand(s) < 0.5) : hasAddon;
    R.cook(s, chef, recipe, { useAddon });
  }
}

function botAuctionResponse(s, bot, auc) {
  if (!bot || bot.inventory.length >= R.capacity(bot)) return 0;
  const diff = getDifficulty(s);
  const needed = R.needs(bot).includes(auc.card.name);
  const isWildOrTofu = auc.card.type === 'wild' || auc.card.type === 'tofu';
  const isVipChoc = auc.card.type === 'chocolate' && s?.dailyEvent?.effect === 'vip_chocolate';

  let maxPremium;
  if (diff === 'easy') {
    // Easy: lower auction ceiling (+$50 on needed/wild, $0 otherwise)
    maxPremium = (needed || isWildOrTofu) ? 50 : 0;
  } else if (diff === 'master') {
    // Master: aggressive auction bidding on needed/wild cards (+$150, +$200 if winning dish!)
    if (needed || isWildOrTofu || isVipChoc) {
      const completesWin = bot.activeRecipes.some(r => {
        const m = R.missingFor(bot, r);
        const matches = m.missing.includes(auc.card.name) || auc.card.type === 'wild';
        if (!matches || m.missing.length - m.wildCount > 1) return false;
        const pv = R.previewCook(bot, r, { useAddon: !!R.eligibleAddonFor(bot, r), state: s });
        return bot.likes + pv.netLikes >= D.WIN_LIKES;
      });
      maxPremium = completesWin ? 200 : 150;
    } else if (auc.card.type === 'chocolate' || auc.card.type === 'wine' || auc.card.type === 'secret_sauce') {
      maxPremium = 100;
    } else {
      maxPremium = 50;
    }
  } else {
    // Normal: balanced baseline (+$100 needed/wild, +$50 otherwise)
    maxPremium = (needed || isWildOrTofu) ? 100 : 50;
  }

  const maxWilling = Math.min(bot.money, auc.baseCost + maxPremium);
  if (diff === 'master' && (needed || isWildOrTofu) && auc.currentBid + 100 <= maxWilling && bot.money >= auc.currentBid + 200) {
    return 100;
  }
  if (auc.currentBid + 50 <= maxWilling) return 50;
  return 0;
}

function acceptsTrade(s, chef, give, want) {
  const diff = getDifficulty(s);
  const wanted = R.needs(chef);

  if (give.garbage) {
    const unitReq = diff === 'easy'
      ? 100
      : (diff === 'master'
        ? (((chef.garbage || 0) === 0 && !R.hasUpgrade(chef, 'upg_celebrity')) ? 150 : 200)
        : ((chef.garbage || 0) === 0 ? 100 : 150));
    if ((give.money || 0) >= unitReq * give.garbage && !want.item && !want.money) return true;
    if (give.item && (wanted.includes(give.item.name) || give.item.type === 'wild')
      && (!want.item || !wanted.includes(want.item.name))) {
      return true;
    }
    return false;
  }

  if (want.garbage && !want.item && (!want.money || want.money <= (diff === 'master' ? 150 : 100))) return true;
  if (give.item && (wanted.includes(give.item.name) || give.item.type === 'wild')) {
    if (diff === 'master' && want.item && wanted.includes(want.item.name) && give.item.type !== 'wild') {
      // Master only swaps needed-for-needed if give completes a recipe
      return chef.activeRecipes.some(r => R.missingFor(chef, r).missing.length === 1 && R.missingFor(chef, r).missing.includes(give.item.name));
    }
    return true;
  }
  const wantNeeded = !!want.item && wanted.includes(want.item.name);
  if ((give.money || 0) >= (diff === 'master' ? 250 : 200) && !wantNeeded) return true;
  if (wantNeeded) return false;
  return R.rand(s) > (diff === 'easy' ? 0.25 : (diff === 'master' ? 0.65 : 0.35));
}

module.exports = {
  getDifficulty, chooseMarket, botWokAway, botShopAndCard, botCookAll, botAuctionResponse, acceptsTrade,
};
