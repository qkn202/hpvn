// HPVN Real-Time Multiplayer Integration (Phòng Sinh Hoạt Chung):
// Simultaneous 3-phase real-time Rival Restaurants gameplay for 2–8 members — identical to playing with bots:
//   Phase 1 (Money & Move): Secret simultaneous Movement Wheel lock → reveal together!
//   Phase 2 (Buy & Barter): Shared 60-second real-time Sand Timer, Live Bidding War (<dialog>) on contested
//           Counter cards (pauses 60s clock, 10s gavel/bid), Live Human-to-Human Barter popups,
//           Blind Shelf Draw, Island Hub ($100 Garbage / $200 Action Card / Upgrades / $500 Chocolate),
//           and strictly 1 Action Card/day!
//   Phase 3 (Cook & Counter): Simultaneous cooking (Double Cooktop supported), instant 20⭐ victory!
(() => {
  'use strict';
  function readIdentity() {
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      const data = JSON.parse(params.get('hpvn-handoff') || 'null');
      if (window.parent === window || new URL(document.referrer).origin !== location.origin || !data || typeof data.uid !== 'string') return null;
      if (data.nonce !== params.get('hpvn-ticket') || !(Math.abs(Date.now() - data.issuedAt) < 10 * 60 * 1000)) return null;
      return data;
    } catch { return null; }
  }
  const identity = readIdentity();
  if (!identity) return; // opened outside HPVN: solo game
  document.documentElement.classList.add('hpvn-framed');
  if (typeof window.closeStartScreen === 'function') window.closeStartScreen();

  // ---------- bridge (request-response + optional real-time push from parent) ----------
  const pending = new Map();
  addEventListener('message', event => {
    const d = event.data;
    if (event.source !== window.parent || event.origin !== location.origin || d?.channel !== 'hpvn-game' || d.nonce !== identity.nonce) return;
    if (d.type === 'vdb-state' && d.view) {
      if (T && d.view.code === T.code && (!T.view || d.view.version >= T.view.version)) enter(d.view);
      return;
    }
    const wait = pending.get(d.id);
    if (!wait) return;
    clearTimeout(wait.timer); pending.delete(d.id);
    if (d.error) wait.reject(Object.assign(new Error(d.error), { code: d.code })); else wait.resolve(d.result);
  });
  let seq = 0;
  const request = (action, data = {}) => new Promise((resolve, reject) => {
    const id = `vdb-${Date.now()}-${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Chưa nhận được phản hồi từ HPVN. Thử lại nhé.')); }, 30000);
    pending.set(id, { resolve, reject, timer });
    window.parent.postMessage({ ...data, channel: 'hpvn-game', nonce: identity.nonce, id, action }, location.origin);
  });
  const call = data => request('vdb', data);

  // ---------- page chrome ----------
  const css = document.createElement('style');
  css.textContent = `
    html.hpvn-framed header { align-self: flex-start; margin-left: 52px; width: calc(100% - 52px); box-sizing: border-box; }
    @media (max-width: 640px) {
      html.hpvn-framed header { align-self: flex-start; margin-left: 46px; width: calc(100% - 46px); }
    }
    .hpvn-panel { position: fixed; z-index: 40; background: rgba(12,10,9,.96); color: #fde68a; border: 1px solid rgba(245,158,11,.55); border-radius: 16px; font: 600 13px/1.4 system-ui, sans-serif; box-shadow: 0 20px 50px rgba(0,0,0,.6); }
    .hpvn-panel button { font: inherit; cursor: pointer; border-radius: 10px; padding: 7px 12px; border: 1px solid rgba(245,158,11,.6); background: #1c1917; color: #fde68a; }
    .hpvn-panel button.primary { background: #f59e0b; color: #0c0a09; border-color: #f59e0b; font-weight: 800; }
    .hpvn-panel button:disabled { opacity: .45; cursor: default; }
    #hpvn-lobby { inset: 0; z-index: 60; border-radius: 0; overflow-y: auto; padding: 64px 16px 24px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
    #hpvn-lobby .box { width: min(580px, 100%); border: 1px solid #44403c; border-radius: 14px; padding: 14px; background: #0c0a09; }
    #hpvn-lobby h2 { margin: 0 0 6px; font-size: 18px; color: #fbbf24; }
    #hpvn-lobby p { margin: 0 0 10px; color: #d6d3d1; font-weight: 500; }
    #hpvn-lobby .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    #hpvn-lobby .table { width: 100%; text-align: left; display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; }
    #hpvn-lobby input, #hpvn-lobby select { font: inherit; padding: 7px 10px; border-radius: 10px; border: 1px solid #57534e; background: #1c1917; color: #fff; }
    #hpvn-lobby input { width: 9em; text-transform: uppercase; }
    #hpvn-lobby .chefs { display: grid; grid-template-columns: repeat(auto-fill, minmax(155px, 1fr)); gap: 8px; }
    #hpvn-lobby .chefs button { text-align: left; }
    #hpvn-lobby .seat { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1px solid #292524; }
    #hpvn-turn .board { display: grid; grid-template-columns: repeat(auto-fill, minmax(175px, 1fr)); gap: 2px 10px; color: #e7e5e4; font-weight: 500; }
    #hpvn-turn .board .now { color: #fbbf24; font-weight: 800; }
    .hpvn-badge { background: #16a34a; color: #fff; border-radius: 999px; padding: 1px 8px; font-size: 11px; }
    .hpvn-live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: #22c55e; margin-right: 5px; box-shadow: 0 0 8px #22c55e; flex-shrink: 0; }
    .hpvn-live-dot.syncing { background: #fbbf24; box-shadow: 0 0 8px #fbbf24; }
    .hpvn-live-dot.offline { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
    .hpvn-sync-pill { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 999px; font-size: 9.5px; font-weight: 900; margin-right: 6px; flex-shrink: 0; background: rgba(22, 163, 74, 0.25); border: 1px solid rgba(34, 197, 94, 0.55); color: #86efac; }
    .hpvn-sync-pill.syncing { background: rgba(245, 158, 11, 0.25); border-color: rgba(251, 191, 36, 0.55); color: #fde68a; }
    .hpvn-sync-pill.offline { background: rgba(220, 38, 38, 0.28); border-color: rgba(248, 113, 113, 0.6); color: #fecaca; }
    .hpvn-emote-bar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(245, 158, 11, 0.22); }
    .hpvn-emote-label { font-size: 10px; color: #a8a29e; font-weight: 800; margin-right: 2px; }
    .hpvn-emote-btn { padding: 2px 7px !important; font-size: 14px !important; line-height: 1.2; border-radius: 999px !important; background: #1c1917 !important; border: 1px solid rgba(245, 158, 11, 0.45) !important; min-width: 30px; min-height: 26px; transition: transform 0.12s ease; }
    .hpvn-emote-btn:hover:not(:disabled) { transform: scale(1.14); border-color: #fbbf24 !important; }
    .hpvn-chef-chip { display: inline-flex; align-items: center; gap: 7px; }
    .hpvn-chef-img { width: 24px; height: 24px; border-radius: 999px; object-fit: cover; border: 1.5px solid rgba(251, 191, 36, 0.7); flex-shrink: 0; }
    #hpvn-turn { left: 50%; transform: translateX(-50%); bottom: max(8px, env(safe-area-inset-bottom, 8px)); width: min(660px, calc(100% - 16px)); padding: 6px 10px; display: none; max-height: min(48dvh, 320px); overflow-y: auto; box-sizing: border-box; }
    #hpvn-solo { left: 50%; transform: translateX(-50%); bottom: max(8px, env(safe-area-inset-bottom, 8px)); padding: 4px; display: none; }
    #hpvn-turn .more { display: none; margin-top: 6px; }
    #hpvn-turn.open .more { display: block; }
    #hpvn-turn .more > * + * { margin-top: 6px; }
    html.hpvn-framed #event-toast.toast-floating { top: calc(var(--hdr-h, 78px) + 6px) !important; bottom: auto !important; }
    html.hpvn-framed #banner-bot-trade { z-index: 55 !important; }
    html.hpvn-framed.hpvn-has-bottom-bar #hud-main-deck {
      margin-bottom: calc(var(--hpvn-bar-h, 64px) + max(12px, calc(env(safe-area-inset-bottom, 8px) + 4px))) !important;
      padding-bottom: 0 !important;
    }
    html.hpvn-framed.hpvn-has-bottom-bar #hud-main-deck[data-tab="controls"] {
      max-height: none !important;
    }
    html.hpvn-framed.hpvn-has-bottom-bar #hud-main-deck[data-tab="mat"] {
      max-height: min(62dvh, calc(100dvh - var(--hdr-h, 88px) - var(--hpvn-bar-h, 64px) - 20px)) !important;
    }
    @media (max-width: 767px) {
      html.hpvn-framed.hpvn-has-bottom-bar #hud-main-deck {
        border-radius: 16px !important;
        border-bottom-width: 3px !important;
      }
      html.hpvn-framed.hpvn-has-bottom-bar #hud-main-deck[data-sheet="half"] {
        max-height: min(46dvh, calc(100dvh - var(--hdr-h, 128px) - var(--hpvn-bar-h, 68px) - 96px)) !important;
      }
      html.hpvn-framed.hpvn-has-bottom-bar #hud-main-deck[data-sheet="full"] {
        max-height: min(74dvh, calc(100dvh - var(--hdr-h, 128px) - var(--hpvn-bar-h, 68px) - 22px)) !important;
      }
      html.hpvn-framed.hpvn-has-bottom-bar #hud-mat-section,
      html.hpvn-framed.hpvn-has-bottom-bar #mat-phase-controller-area {
        padding-bottom: 14px !important;
        scroll-padding-bottom: 20px !important;
      }
    }
    #hpvn-turn .line { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: space-between; min-width: 0; }
    #hpvn-turn .status { color: #fff; display: flex; align-items: center; min-width: 0; flex: 1 1 180px; overflow-wrap: break-word; font-size: 12px; }
    #hpvn-turn .row { display: inline-flex; flex-wrap: wrap; gap: 6px; flex-shrink: 0; }
    #hpvn-turn button { padding: 4px 9px; font-size: 12px; }
    #hpvn-log-modal {
      position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      display: none; align-items: center; justify-content: center;
      padding: max(10px, env(safe-area-inset-top, 10px)) max(10px, env(safe-area-inset-right, 10px)) max(10px, env(safe-area-inset-bottom, 10px)) max(10px, env(safe-area-inset-left, 10px));
      box-sizing: border-box;
    }
    #hpvn-log-modal .hpvn-modal-card {
      width: min(520px, 100%); max-height: min(88dvh, calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 20px));
      background: rgba(18, 16, 14, 0.98); border: 2px solid #f59e0b; border-radius: 18px;
      box-shadow: 0 25px 50px rgba(0,0,0,0.85); display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box;
    }
    #hpvn-log-modal .hpvn-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid rgba(245, 158, 11, 0.3); background: rgba(12, 10, 9, 0.9); }
    #hpvn-log-modal .hpvn-modal-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 900; color: #fbbf24; text-transform: uppercase; }
    #hpvn-log-modal .hpvn-modal-close { width: 36px; height: 36px; border-radius: 999px; background: #292524; border: 1px solid #44403c; color: #a8a29e; font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    #hpvn-log { flex: 1 1 auto; min-height: 0; max-height: calc(88dvh - 125px); overflow-y: auto; overscroll-behavior: contain; padding: 10px 14px; color: #e7e5e4; font-weight: 500; font-size: 13px; line-height: 1.5; }
    #hpvn-log .hpvn-log-line { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 1px solid #292524; }
    #hpvn-log .hpvn-log-day { flex-shrink: 0; padding: 1px 7px; border-radius: 6px; background: #292524; border: 1px solid #44403c; color: #fbbf24; font-size: 10px; font-weight: 800; }
    #hpvn-log .hpvn-log-text { flex: 1; color: #d6d3d1; }
    #hpvn-log-modal .hpvn-modal-footer { padding: 10px 14px; border-top: 1px solid rgba(245, 158, 11, 0.25); background: rgba(12, 10, 9, 0.9); display: flex; justify-content: flex-end; }
    .hpvn-btn-full { width: 100%; min-height: 42px; font-weight: 900 !important; font-size: 13px !important; text-transform: uppercase; }
  `;
  document.head.appendChild(css);
  if (typeof eventToast !== 'undefined' && eventToast) eventToast.classList.add('toast-hidden');
  const el = (tag, attrs = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), attrs);
    node.append(...children);
    return node;
  };
  const lobby = el('div', { id: 'hpvn-lobby', className: 'hpvn-panel hud-interactive' });
  const turnBar = el('div', { id: 'hpvn-turn', className: 'hpvn-panel hud-interactive' });
  const soloBar = el('div', { id: 'hpvn-solo', className: 'hpvn-panel hud-interactive' },
    el('button', { textContent: '🏠 Về sảnh bàn online', onclick: () => showLobby() }));
  const logBox = el('div', { id: 'hpvn-log' });
  const logModal = el('div', { id: 'hpvn-log-modal', className: 'hud-interactive' },
    el('div', { className: 'hpvn-modal-card' },
      el('div', { className: 'hpvn-modal-header' },
        el('div', { className: 'hpvn-modal-title' }, el('span', { textContent: '📜' }), el('h3', { textContent: 'Nhật Ký Chợ Trực Tiếp' })),
        el('button', { className: 'hpvn-modal-close', textContent: '✕', onclick: closeLog })),
      logBox,
      el('div', { className: 'hpvn-modal-footer' },
        el('button', { className: 'primary hpvn-btn-full', textContent: 'Đóng Nhật Ký', onclick: closeLog }))));
  logModal.onclick = e => { if (e.target === logModal) closeLog(); };
  function closeLog() { logModal.style.display = 'none'; if (typeof window.sync3DBoardOverlays === 'function') window.sync3DBoardOverlays(); }
  function openLog() { logModal.style.display = 'flex'; logBox.scrollTop = 0; if (typeof window.sync3DBoardOverlays === 'function') window.sync3DBoardOverlays(); }
  document.body.append(lobby, turnBar, soloBar, logModal);
  for (const box of [lobby, turnBar, soloBar, logModal]) {
    for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown']) box.addEventListener(type, e => e.stopPropagation(), { passive: true });
  }

  function syncBottomBarClearance() {
    let h = 0;
    if (turnBar.style.display !== 'none') {
      if (turnBar.classList.contains('open')) {
        const line = turnBar.querySelector(':scope > .line');
        const em = turnBar.querySelector('#hpvn-emote-bar');
        h = (line ? Math.ceil(line.getBoundingClientRect().height) : 34) + (em ? Math.ceil(em.getBoundingClientRect().height + 6) : 0) + 14;
      } else {
        h = Math.ceil(turnBar.getBoundingClientRect().height);
      }
    } else if (soloBar.style.display !== 'none') {
      h = Math.ceil(soloBar.getBoundingClientRect().height);
    }
    document.documentElement.classList.toggle('hpvn-has-bottom-bar', h > 0);
    document.documentElement.style.setProperty('--hpvn-bar-h', `${h > 0 ? Math.max(44, h) : 0}px`);
    if (typeof window.sync3DBoardOverlays === 'function') window.sync3DBoardOverlays();
  }
  if (typeof ResizeObserver === 'function') {
    const barRo = new ResizeObserver(syncBottomBarClearance);
    barRo.observe(turnBar);
    barRo.observe(soloBar);
  }
  window.addEventListener('resize', syncBottomBarClearance);

  const ORDER = ['lola', 'chen', 'lucrezia', 'hai', 'sau', 'tam', 'muoi', 'angus'];
  const OFFSETS = { lola: [0, 0], angus: [1.2, 0], chen: [-1.2, 0], lucrezia: [0, 1.2], hai: [0, -1.2], sau: [1.2, 1.2], tam: [-1.2, 1.2], muoi: [1.2, -1.2] };
  const MAX_PLAYERS = 8;
  const inviteCode = (() => { try { return new URL(document.referrer).searchParams.get('room') || ''; } catch { return ''; } })();

  const INTRO = '⚡ CHẾ ĐỘ ONLINE THỜI GIAN THỰC (REAL-TIME) CHUẨN RIVAL RESTAURANTS! 2–8 người cùng xoay Đĩa bí mật, cùng tranh mua 60 giây đồng thời, nổ ra Đấu Giá Tranh Mua trực tiếp (tạm dừng đồng hồ 60s), đổi đồ & đẩy rác trực tiếp, nấu món đồng loạt. Ai đạt 20⭐ trước thắng ngay!';
  let T = null;
  let busy = false;
  let polling = false;
  let pollTimer = null;
  let usedOnlineTable = false;
  let lastSyncClientMs = 0;
  let lastTickSentAt = 0;
  let activeOnlineOfferId = null;
  let syncStatus = 'live'; // 'live' | 'syncing' | 'offline'
  let lastOnlineTickSec = -1;
  let lastEmoteSentAt = 0;
  const seenEmoteIds = new Set();
  const QUICK_EMOTES = ['🔥', '😱', '🤝', '😈', '👏', '😂'];
  window.__hpvnOpenLog = () => { if (T) { openLog(); return true; } return false; };

  function setSyncState(nextState) {
    if (syncStatus === nextState) return;
    syncStatus = nextState;
    const dot = turnBar.querySelector('.hpvn-live-dot');
    const pill = turnBar.querySelector('.hpvn-sync-pill');
    if (dot) dot.className = `hpvn-live-dot${nextState === 'live' ? '' : ' ' + nextState}`;
    if (pill) {
      pill.className = `hpvn-sync-pill${nextState === 'live' ? '' : ' ' + nextState}`;
      pill.textContent = nextState === 'syncing' ? 'ĐỒNG BỘ…' : nextState === 'offline' ? 'THỬ LẠI' : 'LIVE';
    }
  }

  function makeChefChip(id, labelText) {
    const img = el('img', {
      src: `./images/chefs/${id}.webp`,
      alt: BASE[id]?.name || id,
      className: 'hpvn-chef-img',
    });
    img.onerror = () => { img.style.display = 'none'; };
    return el('span', { className: 'hpvn-chef-chip' }, img, el('span', { textContent: labelText }));
  }

  const BASE = Object.fromEntries([gameState.player, ...gameState.rivals].map(chef => [chef.id, chef]));
  for (const id of ORDER) {
    if (!BASE[id] && typeof CHEFS_CATALOG !== 'undefined' && CHEFS_CATALOG[id]) {
      const c = CHEFS_CATALOG[id];
      const r = (typeof RESTAURANTS !== 'undefined' && RESTAURANTS[c.defaultRestaurant]) || { id: 'rest_pho_saigon', name: c.name };
      BASE[id] = {
        id, ...c, restaurantId: r.id, restaurant: r.name,
        level: 1, likes: 0, money: 300, garbage: 0, cookedToday: 0, cookedCount: 0,
        unlockedMilestones: [], upgrades: [], inventory: [], actionCards: [], activeRecipes: [], garbageCan: [],
      };
    }
  }

  const soloBtnRevealText = btnRevealDials ? btnRevealDials.textContent : '🛎️ 3, 2, 1... MỞ ĐĨA ĐI CHỢ!';
  const soloBtnDoneText = btnDoneBuying ? btnDoneBuying.textContent : '🔔 Rung Chuông (Sang Nấu Món)';
  const soloBtnNextDayText = typeof btnNextDay !== 'undefined' && btnNextDay ? btnNextDay.textContent : '☀️ Sang Ngày Mới & Nhập Quầy Chợ';
  const btnRestartEl = document.getElementById('btn-restart-game');
  const soloBtnRestartText = btnRestartEl ? btnRestartEl.textContent : '🔄 CHƠI VÁN MỚI';
  const soloStateSnapshot = JSON.stringify({
    playerId: gameState.player.id,
    rivalIds: gameState.rivals.map(r => r.id),
    chefs: Object.fromEntries([gameState.player, ...gameState.rivals].map(c => [c.id, {
      restaurantId: c.restaurantId, restaurant: c.restaurant,
      money: c.money, likes: c.likes, tierIdx: c.tierIdx, level: c.level, garbage: c.garbage,
      cookedCount: c.cookedCount, cookedToday: c.cookedToday, unlockedMilestones: c.unlockedMilestones,
      milestoneIncomeBonus: c.milestoneIncomeBonus, milestonePantryBonus: c.milestonePantryBonus,
      milestoneDiscount: c.milestoneDiscount, milestoneSeafoodDiscount: c.milestoneSeafoodDiscount,
      milestoneCookBonus: c.milestoneCookBonus, reviewBonusToday: c.reviewBonusToday,
      currentLocation: c.currentLocation, selectedDestination: c.selectedDestination,
      inventory: c.inventory, activeRecipes: c.activeRecipes, actionCards: c.actionCards,
      upgrades: c.upgrades, garbageCan: c.garbageCan, boughtCountToday: c.boughtCountToday,
      deliveryUsedToday: c.deliveryUsedToday, isDialFaceUp: c.isDialFaceUp, cardDay: c.cardDay, chefPowerDay: c.chefPowerDay,
    }])),
    markets: Object.fromEntries(MARKET_KEYS.map(k => [k, { shelf: gameState.markets[k].shelf, cards: gameState.markets[k].cards }])),
    dumpster: gameState.dumpster || [],
  });

  const chefLabel = id => `${BASE[id]?.avatar || ''} ${BASE[id]?.name || id}`;

  function getPlayerName(id, seatsObj = T?.view?.seats) {
    if (!seatsObj) return '';
    const seat = seatsObj[id];
    if (!seat) return '';
    if (typeof seat === 'string') return seat;
    return seat.name || seat.username || seat.displayName || seat.nick || '';
  }

  function who(id, seatsObj = T?.view?.seats) {
    const pName = getPlayerName(id, seatsObj);
    const cName = BASE[id]?.name || id;
    if (pName) return `${pName} (${cName})`;
    const isHuman = T?.view?.state?.humans?.includes(id);
    return isHuman ? cName : `${cName} 🤖`;
  }

  function stopPolling() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function schedulePoll() {
    stopPolling();
    if (!T || document.visibilityState !== 'visible') return;
    const v = T.view;
    if (v?.status === 'over') return;
    let delay = 2500;
    if (v?.status === 'playing') {
      const st = v.state;
      if (st?.auction) delay = 500;
      else if (st?.phase === 2) delay = 900;
      else delay = 1500;
    }
    pollTimer = setTimeout(async () => {
      if (!T || busy || polling || document.visibilityState !== 'visible') { schedulePoll(); return; }
      polling = true;
      setSyncState('syncing');
      try {
        const latest = await call({ op: 'state', code: T.code });
        setSyncState('live');
        if (T && latest && latest.code === T.code) {
          const cur = T.view?.state;
          const nxt = latest.state;
          const lastCurEm = cur?.emotes?.length ? cur.emotes[cur.emotes.length - 1]?.id : null;
          const lastNxtEm = nxt?.emotes?.length ? nxt.emotes[nxt.emotes.length - 1]?.id : null;
          const changed = !T.view || latest.version !== T.view.version || latest.status !== T.view.status
            || nxt?.phase !== cur?.phase || nxt?.logN !== cur?.logN
            || Boolean(nxt?.timerPaused) !== Boolean(cur?.timerPaused)
            || Boolean(nxt?.auction) !== Boolean(cur?.auction)
            || nxt?.auction?.currentBid !== cur?.auction?.currentBid
            || nxt?.auction?.leader !== cur?.auction?.leader
            || (nxt?.offers?.length || 0) !== (cur?.offers?.length || 0)
            || lastNxtEm !== lastCurEm;
          if (changed) {
            enter(latest);
          } else {
            // Re-anchor server clock smoothly even when version didn't change
            T.view = latest;
            lastSyncClientMs = Date.now();
          }
        }
      } catch {
        setSyncState('offline');
      }
      polling = false;
      schedulePoll();
    }, delay);
  }

  async function showLobby(note = '') {
    stopPolling();
    T = null;
    window.__hpvnBellMeta = null;
    window.__hpvnRivalMeta = null;
    if (typeof window.closeStartScreen === 'function') window.closeStartScreen();
    document.documentElement.classList.remove('hpvn-online-active');
    if (typeof window.setUrgentTimerState === 'function') window.setUrgentTimerState(false);
    turnBar.style.display = 'none';
    soloBar.style.display = 'none';
    closeLog();
    if (typeof closeTransientUI === 'function') closeTransientUI();
    if (typeof modalVictory !== 'undefined' && modalVictory) modalVictory.classList.add('hidden');
    lobby.style.display = 'flex';
    syncBottomBarClearance();
    lobby.replaceChildren(el('div', { className: 'box' }, el('h2', { textContent: '🍲 Vua Đầu Bếp: Online Thời Gian Thực' }), el('p', { textContent: INTRO }),
      note ? el('p', { textContent: note, style: 'color:#fca5a5' }) : '', el('p', { textContent: 'Đang tải bàn của bạn…' })));
    let mine = [];
    try { mine = (await call({ op: 'mine' })).tables || []; } catch (error) { note = error.message; }
    const tableRows = mine.map(t => {
      const whoLabel = t.status === 'waiting' ? `${t.seated}/${t.size} người` : t.others.length ? `với ${t.others.join(', ')}` : 'với bếp máy';
      const label = `${t.code} · ${BASE[t.myChef]?.avatar || ''} · ${whoLabel}${t.day ? ` · ngày ${t.day}` : ''}`;
      const state = t.status === 'over' ? (t.winner ? 'Đã xong' : 'Đã đóng') : t.status === 'waiting' ? 'Chờ người vào' : '⚡ Đang đấu trực tiếp!';
      return el('button', { className: 'table', onclick: () => openTable(t.code) }, el('span', { textContent: label }),
        el('span', { className: t.status === 'playing' ? 'hpvn-badge' : '', textContent: state }));
    });
    const codeInput = el('input', { placeholder: 'MÃ BÀN', maxLength: 6, value: inviteCode });
    const sizePick = el('select', { ariaLabel: 'Số người' }, ...Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => el('option', { value: i + 2, textContent: `${i + 2} người` })));
    const restPick = el('select', { ariaLabel: 'Chọn Nhà Hàng' },
      el('option', { value: '', textContent: 'Nhà Hàng mặc định theo Đầu Bếp' }),
      ...(typeof RESTAURANTS !== 'undefined' ? Object.values(RESTAURANTS).map(r => el('option', { value: r.id, textContent: `${r.icon} ${r.shortName} (+1⭐ ${r.cuisineLabel})` })) : []));

    lobby.replaceChildren(
      el('div', { className: 'box' }, el('h2', { textContent: '🍲 Vua Đầu Bếp: Online Thời Gian Thực (Real-Time)' }), el('p', { textContent: INTRO }),
        note ? el('p', { textContent: note, style: 'color:#fca5a5' }) : ''),
      el('div', { className: 'box' }, el('h2', { textContent: 'Bàn của bạn' }),
        ...(tableRows.length ? tableRows : [el('p', { textContent: 'Chưa có bàn nào.' })])),
      el('div', { className: 'box' }, el('h2', { textContent: 'Mở bàn Real-Time mới' }),
        el('p', { textContent: 'Chọn số người, Nhà Hàng (tùy chọn) và Đầu Bếp của bạn:' }),
        el('div', { className: 'row', style: 'margin-bottom:8px' }, el('span', { textContent: 'Số người:' }), sizePick, restPick),
        el('div', { className: 'chefs' }, ...ORDER.map((id, i) => el('button', { className: 'primary',
          title: BASE[id]?.powerDesc || '', onclick: () => createTable(id, Number(sizePick.value), restPick.value || undefined) },
          makeChefChip(id, `${i + 1}. ${BASE[id]?.name || id}`))))),
      el('div', { className: 'box' }, el('h2', { textContent: 'Vào bàn bằng mã' }),
        el('div', { className: 'row' }, codeInput, el('button', { className: 'primary', textContent: 'Vào bàn', onclick: () => joinTable(codeInput.value.trim().toUpperCase()) }))),
      el('div', { className: 'box' }, el('h2', { textContent: 'Chơi thử với máy' }),
        el('p', { textContent: 'Một mình với 3 bếp máy theo luật chuẩn Rival Restaurants (60s real-time, không lưu).' }),
        el('button', { textContent: 'Chơi thử với bếp máy', onclick: () => enterSoloMode() })));
  }

  function enterSoloMode() {
    stopPolling();
    T = null;
    window.__hpvnBellMeta = null;
    window.__hpvnRivalMeta = null;
    if (typeof window.closeStartScreen === 'function') window.closeStartScreen();
    document.documentElement.classList.remove('hpvn-online-active');
    if (typeof window.setUrgentTimerState === 'function') window.setUrgentTimerState(false);
    lobby.style.display = 'none';
    turnBar.style.display = 'none';
    closeLog();
    if (typeof closeTransientUI === 'function') closeTransientUI();
    if (typeof modalVictory !== 'undefined' && modalVictory) modalVictory.classList.add('hidden');
    soloBar.style.display = 'block';
    if (typeof window.renderDailyEventBanner === 'function') window.renderDailyEventBanner(gameState.dailyEvent || null);
    if (btnRestartEl) btnRestartEl.textContent = soloBtnRestartText;
    if (btnRevealDials) btnRevealDials.textContent = soloBtnRevealText;
    if (btnDoneBuying) btnDoneBuying.textContent = soloBtnDoneText;
    if (btnNextDay) btnNextDay.textContent = soloBtnNextDayText;
    if (usedOnlineTable) {
      usedOnlineTable = false;
      if (seatBox) seatBox.style.display = '';
      if (btnOpenPairing) btnOpenPairing.style.display = '';
      if (ribbon && soloRibbonNodes.length) ribbon.replaceChildren(...soloRibbonNodes);
      const snap = JSON.parse(soloStateSnapshot);
      for (const [id, data] of Object.entries(snap.chefs)) {
        if (BASE[id]) {
          delete BASE[id].playerName;
          Object.assign(BASE[id], data, { deliveryMarket: null, pendingGarbage: 0, garbageBeforeCook: null });
        }
      }
      gameState.player = BASE[snap.playerId];
      gameState.rivals = snap.rivalIds.map(id => BASE[id]);
      if (gameState.chefs) { gameState.chefs.lola = BASE.lola; gameState.chefs.angus = BASE.angus; }
      gameState.activeChefId = 'lola';
      gameState.day = 1;
      gameState.phase = 1;
      gameState.closedMarkets = [];
      gameState.dumpster = snap.dumpster;
      gameState.hotSeat = false;
      gameState.gameOver = false;
      gameState.winner = null;
      for (const k of MARKET_KEYS) {
        if (gameState.markets[k] && snap.markets[k]) {
          gameState.markets[k].shelf = snap.markets[k].shelf;
          gameState.markets[k].cards = snap.markets[k].cards;
          delete gameState.markets[k].shelfCount;
        }
      }
      for (const id of ORDER) {
        const isBase = snap.playerId === id || snap.rivalIds.includes(id);
        if (STANDEES[id]) {
          STANDEES[id].visible = isBase;
          if (isBase && BASE[id] && gameState.markets[BASE[id].currentLocation]) {
            const pos = gameState.markets[BASE[id].currentLocation].pos;
            const [ox, oz] = OFFSETS[id];
            animateStandeeTo(STANDEES[id], { x: pos.x + ox, z: pos.z + oz });
          }
        }
        if (DIALS[id]) DIALS[id].visible = isBase && id !== snap.playerId;
      }
      [tab1, tab2, tab3].forEach((tab, i) => { tab.className = i === 0 ? TAB_ON[0] : TAB_OFF; });
      [panel1, panel2, panel3].forEach((panel, i) => panel.classList.toggle('hidden', i !== 0));
      if (btnRevealDials) btnRevealDials.disabled = false;
      if (typeof timerDisplay !== 'undefined' && timerDisplay) timerDisplay.innerText = '01:00';
      if (typeof sandTimerFill !== 'undefined' && sandTimerFill) sandTimerFill.style.width = '100%';
      syncDestButtons();
      if (typeof window.syncDeckPhaseAttr === 'function') window.syncDeckPhaseAttr();
      updateHUDStats();
      updateRecipeUI();
      updateLeaderboardUI();
      if (typeof window.focusGameStage === 'function') window.focusGameStage('overview');
      else if (typeof tweenCamera === 'function') tweenCamera(0, 42, 28, 0, 0, 3.0);
    }
    if (typeof window.renderRivalTabletopFlanks === 'function') window.renderRivalTabletopFlanks(true);
    syncBottomBarClearance();
  }

  function showWaiting(view) {
    turnBar.style.display = 'none';
    lobby.style.display = 'flex';
    syncBottomBarClearance();
    const seated = Object.keys(view.seats).length;
    lobby.replaceChildren(
      el('div', { className: 'box' }, el('h2', { textContent: `⚡ Bàn Real-Time ${view.code} · chờ ${seated}/${view.size} người` }),
        el('p', { textContent: view.isHost ? `Mời bạn bè vào cùng lúc để đấu thời gian thực 60 giây! Bắt đầu ngay khi có từ 2 người (bàn dưới 4 người có bếp máy).` : 'Chờ chủ bàn bắt đầu (tự cập nhật mỗi 2.5 giây)...' }),
        ...ORDER.filter(id => view.seats[id]).map(id => el('div', { className: 'seat' }, el('span', { textContent: chefLabel(id) }),
          el('span', { textContent: `${who(id, view.seats)}${id === view.myChef ? ' (bạn)' : ''}` }))),
        el('div', { className: 'row', style: 'margin-top:10px' },
          el('button', { className: 'primary', textContent: 'Mời qua Floo', onclick: () => request('vdb-invite', { code: view.code }).catch(() => {}) }),
          view.isHost ? el('button', { className: 'primary', textContent: `⚡ Bắt đầu Real-Time (${seated} người)`, disabled: seated < 2, onclick: startTable }) : '',
          el('button', { textContent: '↻ Tải lại', onclick: () => refresh() }),
          el('button', { textContent: '🏠 Sảnh', onclick: () => showLobby() }),
          el('button', { textContent: 'Rời bàn', onclick: leaveTable }))));
    schedulePoll();
  }

  async function createTable(seat, size, restaurant) {
    const payload = { op: 'create', seat, size };
    if (restaurant) payload.restaurant = restaurant;
    try { enter(await call(payload)); } catch (error) { showLobby(error.message); }
  }
  async function startTable() { try { enter(await call({ op: 'start', code: T.code })); } catch (error) { showLobby(error.message); } }
  async function joinTable(code) {
    if (!/^[A-Z0-9]{6}$/.test(code)) { showLobby('Mã bàn có 6 ký tự.'); return; }
    try { enter(await call({ op: 'join', code })); } catch (error) { showLobby(error.message); }
  }
  async function openTable(code) { try { enter(await call({ op: 'state', code })); } catch (error) { showLobby(error.message); } }

  // ---------- 3D board pieces ----------
  const seatBox = document.getElementById('btn-seat-lola')?.parentElement;
  const btnOpenPairing = document.getElementById('btn-open-pairing');
  const STANDEES = { lola: chefLola, angus: chefAngus, chen: chefChen, lucrezia: chefLucrezia };
  const DIALS = { angus: rivalDialAngus, chen: rivalDialChen, lucrezia: rivalDialLucrezia };
  const spareDial = createPhysicalMovementDial('');
  function standeeOf(id) {
    if (!STANDEES[id]) {
      const c = BASE[id] || { short: id, avatar: '👨‍🍳', colorHex: '#f59e0b' };
      STANDEES[id] = createAcrylicChefStandee(c.short || c.name, c.avatar, c.colorHex);
      STANDEES[id].position.set(0, boardHeight, boardCenterZ);
      scene.add(STANDEES[id]);
      if (window.VdbAAA && typeof window.VdbAAA.upgradeChefStandee === 'function') {
        window.VdbAAA.upgradeChefStandee(STANDEES[id], id, c.short || c.name, c.avatar, c.colorHex);
      }
    }
    return STANDEES[id];
  }

  function enter(view) {
    usedOnlineTable = true;
    if (seatBox) seatBox.style.display = 'none';
    if (btnOpenPairing) btnOpenPairing.style.display = 'none';
    const first = !T || T.code !== view.code || !T.view?.state;
    T = { code: view.code, view: first ? null : T.view };
    if (view.status === 'waiting') {
      document.documentElement.classList.remove('hpvn-online-active');
      T.view = view;
      showWaiting(view);
      return;
    }
    document.documentElement.classList.add('hpvn-online-active');
    lobby.style.display = 'none';
    apply(view, first);
    schedulePoll();
  }

  // ---------- Live Online Real-Time Clock + Auction + Human Trade Sync ----------
  function computeRemainingMs(st) {
    if (!st || st.phase !== 2) return 0;
    const base = typeof st.phase2RemainingMs === 'number' ? st.phase2RemainingMs : 60000;
    if (st.timerPaused || st.auction) return base;
    return Math.max(0, base - Math.max(0, Date.now() - lastSyncClientMs));
  }

  function computeAuctionRemainingMs(auc) {
    if (!auc) return 0;
    const base = typeof auc.remainingMs === 'number' ? auc.remainingMs : 10000;
    return Math.max(0, base - Math.max(0, Date.now() - lastSyncClientMs));
  }

  function syncLiveClockUI() {
    if (!T || T.view?.status !== 'playing') return;
    const st = T.view.state;
    if (!st || st.over || st.phase !== 2) {
      if (lastOnlineTickSec !== -1) {
        lastOnlineTickSec = -1;
        if (typeof window.setUrgentTimerState === 'function') window.setUrgentTimerState(false);
      }
      return;
    }

    const remMs = computeRemainingMs(st);
    const secs = Math.ceil(remMs / 1000);
    const mins = String(Math.floor(secs / 60)).padStart(2, '0');
    const secStr = String(secs % 60).padStart(2, '0');
    if (typeof timerDisplay !== 'undefined' && timerDisplay) timerDisplay.innerText = `${mins}:${secStr}`;
    const isPaused = !!(st.timerPaused || st.auction);
    if (typeof timerPausedPill !== 'undefined' && timerPausedPill) timerPausedPill.classList.toggle('hidden', !isPaused);
    if (typeof sandTimerFill !== 'undefined' && sandTimerFill) {
      sandTimerFill.style.width = `${Math.max(0, Math.min(100, (remMs / 60000) * 100))}%`;
      sandTimerFill.classList.toggle('paused', isPaused);
    }
    if (typeof update3DSandTimer === 'function') update3DSandTimer(remMs / 60000);

    const isUrgent = !isPaused && secs <= 10 && secs > 0;
    if (typeof window.setUrgentTimerState === 'function') window.setUrgentTimerState(isUrgent);
    if (typeof window.syncTabletopBellTimer === 'function') {
      window.syncTabletopBellTimer(remMs / 60000, `${mins}:${secStr}`, isPaused, isUrgent);
    }
    if (isUrgent && secs !== lastOnlineTickSec) {
      lastOnlineTickSec = secs;
      if (window.VdbAAA?.audio?.tickCountdown) window.VdbAAA.audio.tickCountdown(secs);
    } else if (!isUrgent) {
      lastOnlineTickSec = -1;
    }

    // Update live auction gavel countdown text if open
    if (st.auction) {
      const aRem = Math.ceil(computeAuctionRemainingMs(st.auction) / 1000);
      const logEl = document.getElementById('bid-log-text');
      if (logEl && logEl.dataset.baseMsg) logEl.textContent = `${logEl.dataset.baseMsg} (⏳ Gõ búa sau ${aRem}s)`;
      if (aRem <= 0 && !busy && Date.now() - lastTickSentAt > 1200) {
        lastTickSentAt = Date.now();
        act('tick');
      }
      return;
    }

    // Trigger server clock sync when 60s timer hits 0 OR ~8s bot shop threshold passes
    if (!isPaused && !busy && Date.now() - lastTickSentAt > 1500) {
      const elapsed = 60000 - remMs;
      if (remMs <= 0 || (elapsed >= 8500 && st.botShoppedDay !== st.day)) {
        lastTickSentAt = Date.now();
        act('tick');
      }
    }
  }
  setInterval(syncLiveClockUI, 250);

  function syncOnlineAuctionModal(st, me) {
    const dlg = document.getElementById('modal-bidding-war');
    if (!dlg) return;
    const auc = st.auction;
    if (!auc) {
      if (dlg.open) dlg.close();
      return;
    }
    const amBidder = auc.bidders.includes(me) && !auc.folded.includes(me);
    if (!amBidder) {
      if (dlg.open) dlg.close();
      return;
    }
    const leaderChef = BASE[auc.leader] || { avatar: '👨‍🍳', name: auc.leader };
    const rivalsList = auc.bidders.filter(id => id !== me).map(id => `${BASE[id]?.avatar || ''} ${who(id)}${auc.folded.includes(id) ? ' (Bỏ)' : ''}`).join(', ');
    document.getElementById('bid-item-emoji').textContent = auc.card?.emoji || '📦';
    document.getElementById('bid-item-name').textContent = `${auc.card?.name || ''} (Gốc $${auc.baseCost})`;
    document.getElementById('bid-competitors').textContent = `Tranh trực tiếp với: ${rivalsList}`;
    document.getElementById('bid-current-price').textContent = `$${auc.currentBid}`;
    document.getElementById('bid-current-leader').textContent = `Đang dẫn đầu: ${auc.leader === me ? '👑 BẠN' : `${leaderChef.avatar} ${who(auc.leader)}`}`;
    const logEl = document.getElementById('bid-log-text');
    const baseMsg = auc.leader === me
      ? `👑 Bạn đang dẫn đầu $${auc.currentBid}! Chờ đối thủ nâng giá hoặc gõ búa!`
      : `⚔️ ${who(auc.leader)} đang dẫn đầu $${auc.currentBid}! Bạn nâng giá hay bỏ cuộc?`;
    logEl.dataset.baseMsg = baseMsg;
    logEl.textContent = `${baseMsg} (⏳ Gõ búa sau ${Math.ceil(computeAuctionRemainingMs(auc) / 1000)}s)`;

    const myMoney = st.chefs[me]?.money || 0;
    const btn50 = document.getElementById('btn-bid-raise-50');
    const btn100 = document.getElementById('btn-bid-raise-100');
    const btnFold = document.getElementById('btn-bid-fold');
    if (btn50) btn50.disabled = auc.leader === me || myMoney < auc.currentBid + 50;
    if (btn100) btn100.disabled = auc.leader === me || myMoney < auc.currentBid + 100;
    if (btnFold) btnFold.disabled = auc.leader === me;
    if (!dlg.open) {
      playSound('gavel');
      if (window.VdbAAA?.vfx?.gavelSmash) window.VdbAAA.vfx.gavelSmash();
      dlg.showModal();
    }
  }

  function syncIncomingHumanOffer(st, me) {
    const banner = document.getElementById('banner-bot-trade');
    if (!banner) return;
    const incoming = (st.offers || []).find(o => o.to === me);
    if (!incoming || st.phase !== 2) {
      if (activeOnlineOfferId) { banner.classList.add('hidden'); activeOnlineOfferId = null; }
      return;
    }
    const isNew = activeOnlineOfferId !== incoming.id;
    activeOnlineOfferId = incoming.id;
    const fromChef = BASE[incoming.from] || { avatar: '👨‍🍳', name: incoming.from };
    const pImg = document.getElementById('bot-trade-portrait-img');
    const pAv = document.getElementById('bot-trade-avatar');
    if (pImg) {
      pImg.style.display = '';
      pImg.src = `./images/chefs/${incoming.from}.webp`;
      pImg.alt = fromChef.name;
    }
    if (pAv) {
      pAv.style.display = 'none';
      pAv.textContent = fromChef.avatar;
    }
    document.getElementById('bot-trade-title').textContent = `📨 ${who(incoming.from).toUpperCase()} GỬI KÈO TRỰC TIẾP!`;
    document.getElementById('bot-trade-desc').textContent = `Đề nghị đổi: ${incoming.label}`;
    banner.classList.remove('hidden');
    if (isNew) playSound('bell');
  }

  function apply(view, first = false) {
    const before = first ? null : T.view;
    T.view = view;
    lastSyncClientMs = Date.now();
    const st = view.state;
    const me = view.myChef;
    const seated = (st.turnOrder || ORDER).filter(id => st.chefs[id]);
    const phaseChanged = first || before?.state?.phase !== st.phase || before?.state?.day !== st.day;
    const locChanged = !first && before?.state?.chefs?.[me]?.currentLocation !== st.chefs?.[me]?.currentLocation;
    const prevLikes = before?.state?.chefs?.[me]?.likes ?? null;
    const prevMoney = before?.state?.chefs?.[me]?.money ?? null;
    const prevMilestones = (before?.state?.chefs?.[me]?.unlockedMilestones || []).length;

    for (const [id, chef] of Object.entries(st.chefs)) {
      const base = BASE[id];
      base.playerName = getPlayerName(id);
      let dest = chef.currentLocation;
      if (id === me && st.phase === 1) {
        dest = st.myDial || (!first ? base.selectedDestination : chef.currentLocation);
      }
      const restMeta = (typeof RESTAURANTS !== 'undefined' && RESTAURANTS[chef.restaurantId]) || null;
      const keepDelivery = (id === me && st.phase === 2 && !chef.deliveryUsedToday && base.deliveryMarket && base.deliveryMarket !== chef.currentLocation)
        ? base.deliveryMarket
        : null;
      Object.assign(base, chef, {
        restaurant: restMeta ? restMeta.name : base.restaurant,
        selectedDestination: dest,
        deliveryMarket: keepDelivery,
        upgrades: (chef.upgrades || []).map(u => ({ ...(availableUpgradesDeck.find(x => x.id === u.id) || {}), ...u })),
        actionCards: id === me ? (chef.actionCards || []) : Array.from({ length: chef.actionCardCount || 0 }, (_, i) => ({ id: `hidden-${i}` })),
      });
    }
    gameState.player = BASE[me];
    gameState.rivals = seated.filter(id => id !== me).map(id => BASE[id]);
    gameState.day = st.day;
    gameState.phase = st.phase;
    gameState.dailyEvent = st.dailyEvent || null;
    gameState.closedMarkets = (st.closed || []).map(c => c.market);
    gameState.dumpster = st.dumpster || [];
    gameState.hotSeat = false;

    for (const key of MARKET_KEYS) {
      const gm = gameState.markets[key];
      const sm = st.markets?.[key];
      if (sm && Array.isArray(sm.counter)) {
        gm.shelfCount = typeof sm.shelfCount === 'number' ? sm.shelfCount : 0;
        gm.cards = sm.counter.map((slot, idx) => {
          if (!slot || !slot.card) return null;
          const cl = slot.claimedBy || st.claims?.[`${key}|${idx}`] || null;
          return {
            ...slot.card, slotIdx: idx, pos: gm.slotPositions?.[idx],
            claimedBy: cl ? { id: cl.id, name: BASE[cl.id]?.name || cl.id, avatar: BASE[cl.id]?.avatar || '👤', baseCost: cl.baseCost, bribeCost: cl.bribeCost || 50, itemInstanceId: cl.itemInstanceId } : null,
          };
        });
      }
    }

    for (const id of ORDER) {
      if (STANDEES[id] || st.chefs[id]) standeeOf(id).visible = !!st.chefs[id];
      if (DIALS[id]) DIALS[id].visible = !!st.chefs[id] && id !== me;
    }
    for (const id of seated) {
      const was = before?.state?.chefs?.[id]?.currentLocation;
      const now = st.chefs[id].currentLocation;
      if (first || was !== now || (before?.state?.phase === 1 && st.phase === 2)) {
        const pos = gameState.markets[now].pos;
        const [ox, oz] = OFFSETS[id];
        animateStandeeTo(standeeOf(id), { x: pos.x + ox, z: pos.z + oz });
        setDialNeedle(dialForChef(BASE[id]), now, !first);
        if (st.phase >= 2) flipDial(dialForChef(BASE[id]), true);
      }
    }
    if (st.phase === 1) {
      setDialNeedle(dialForChef(gameState.player), gameState.player.selectedDestination, false);
      for (const id of seated) {
        if (id !== me && DIALS[id]) DIALS[id].rotation.x = Math.PI; // keep rival dials secret face-down in Phase 1!
      }
    }

    // Simultaneous Dial Reveal Banner on Phase 1 -> 2 transition
    if (!first && before?.state?.phase === 1 && st.phase === 2 && typeof window.showDialRevealBanner === 'function') {
      window.showDialRevealBanner(seated.map(id => BASE[id]));
    }

    // Daily Event strip sync
    if (typeof window.renderDailyEventBanner === 'function') {
      window.renderDailyEventBanner(st.dailyEvent || null);
    }

    // Online Quick Emotes rendering via VdbAAA.vfx.floatingEmote()
    const emList = Array.isArray(st.emotes) ? st.emotes : [];
    if (first) {
      emList.forEach(em => { if (em && em.id) seenEmoteIds.add(em.id); });
    } else {
      emList.forEach(em => {
        if (!em || !em.id || seenEmoteIds.has(em.id)) return;
        seenEmoteIds.add(em.id);
        playSound('emote');
        if (window.VdbAAA?.vfx?.floatingEmote) {
          window.VdbAAA.vfx.floatingEmote(who(em.from), BASE[em.from]?.avatar || '👨‍🍳', em.emoji);
        }
      });
    }

    // Online tactile VFX on local chef delta
    if (!first && st.chefs[me]) {
      const nowLikes = st.chefs[me].likes || 0;
      const nowMoney = st.chefs[me].money || 0;
      const nowMilestones = (st.chefs[me].unlockedMilestones || []).length;
      if (prevLikes !== null && nowLikes > prevLikes && window.VdbAAA?.vfx?.cookBurst) {
        window.VdbAAA.vfx.cookBurst(document.getElementById('recipes-container'), nowLikes - prevLikes);
      }
      if (prevMoney !== null && nowMoney !== prevMoney && window.VdbAAA?.vfx?.coinFly) {
        window.VdbAAA.vfx.coinFly(document.getElementById('player-money'), nowMoney - prevMoney);
      }
      if (nowMilestones > prevMilestones && !st.over && nowLikes < WIN_LIKES && window.VdbAAA?.vfx?.milestoneBurst) {
        const latestMs = st.chefs[me].unlockedMilestones[nowMilestones - 1];
        window.VdbAAA.vfx.milestoneBurst(latestMs);
      }
    }

    updateHUDStats();
    updateRecipeUI();
    updateLeaderboardUI();
    showPhase(st, me, phaseChanged, locChanged);
    syncOnlineAuctionModal(st, me);
    syncIncomingHumanOffer(st, me);
    syncLiveClockUI();
    drawTurnBar();
    drawLog();

    const seen = before ? before.state.logN : st.logN;
    const fresh = (st.log || []).filter(line => line.n > seen);
    if (fresh.length && !st.over) setToast(fresh.slice(-2).map(line => line.text).join('  '));
    if (st.over) showWinner(st);
  }

  const TAB_OFF = 'px-2 py-0.5 rounded-lg text-stone-400 transition-all';
  const TAB_ON = [
    'px-2 py-0.5 rounded-lg bg-amber-500 text-stone-950 font-black shadow transition-all',
    'px-2 py-0.5 rounded-lg bg-red-600 text-white font-black shadow transition-all',
    'px-2 py-0.5 rounded-lg bg-amber-500 text-stone-950 font-black shadow transition-all',
  ];

  function showPhase(st, me, moved, locChanged = false) {
    const shown = st.phase || 1;
    const totalH = (st.humans || []).length;
    window.__hpvnBellMeta = {
      phase: shown,
      totalH,
      dialLocked: !!st.myDial,
      dialReadyCnt: (st.dialReady || []).filter(id => (st.humans || []).includes(id)).length,
      doneMe: (st.readyDone || []).includes(me),
      doneCnt: (st.readyDone || []).length,
      readyNextMe: (st.readyNextDay || []).includes(me),
      readyNextCnt: (st.readyNextDay || []).length,
    };
    window.__hpvnRivalMeta = {
      phase: shown,
      humans: Array.isArray(st.humans) ? st.humans : [],
      dialReady: Array.isArray(st.dialReady) ? st.dialReady : [],
      readyDone: Array.isArray(st.readyDone) ? st.readyDone : [],
      readyNextDay: Array.isArray(st.readyNextDay) ? st.readyNextDay : [],
    };
    if (typeof hudMainDeck !== 'undefined' && hudMainDeck) hudMainDeck.dataset.phase = String(shown);
    if (typeof window.syncDeckPhaseAttr === 'function') window.syncDeckPhaseAttr();
    [tab1, tab2, tab3].forEach((tab, i) => { tab.className = i + 1 === shown ? TAB_ON[i] : TAB_OFF; });
    [panel1, panel2, panel3].forEach((panel, i) => panel.classList.toggle('hidden', i + 1 !== shown));
    syncDestButtons();
    const p = gameState.player;

    if (shown === 1) {
      const locked = !!st.myDial;
      const lockedCnt = (st.dialReady || []).filter(id => (st.humans || []).includes(id)).length;
      btnRevealDials.disabled = false;
      btnRevealDials.textContent = locked
        ? `⏳ ĐÃ KHÓA (${lockedCnt}/${totalH}) · ĐỔI CHỢ`
        : '🛎️ KHÓA ĐĨA BÍ MẬT!';
      if (moved) {
        if (typeof window.focusGameStage === 'function') window.focusGameStage('overview');
        else tweenCamera(0, 42, 28, 0, 0, 3.0);
      }
    } else if (shown === 2) {
      if (moved || locChanged) {
        if (moved) {
          turnBar.classList.remove('open');
          closeLog();
        }
        const pos = gameState.markets[p.currentLocation].pos;
        if (typeof window.focusGameStage === 'function') {
          window.focusGameStage(p.currentLocation === 'island' ? 'island' : 'market', pos);
        } else {
          tweenCamera(pos.x, 32, pos.z + 14, pos.x, 0, pos.z);
        }
      }
      marketTitle.innerText = gameState.markets[p.currentLocation].name.toUpperCase();
      if (typeof updateBuyQuotaText === 'function') updateBuyQuotaText();
      const doneMe = (st.readyDone || []).includes(me);
      const doneCnt = (st.readyDone || []).length;
      btnDoneBuying.textContent = doneMe
        ? `✅ Đã Xong (${doneCnt}/${totalH})`
        : `🔔 Rung Chuông (${doneCnt}/${totalH})`;
      renderMarketShelf();
      updateContestedAlert();
    } else if (shown === 3) {
      if (moved) {
        if (typeof closeTransientUI === 'function') closeTransientUI();
        if (typeof window.focusGameStage === 'function') window.focusGameStage('overview');
        else tweenCamera(0, 36, 22, 0, 0, 6.0);
      }
      const readyMe = (st.readyNextDay || []).includes(me);
      const readyCnt = (st.readyNextDay || []).length;
      btnNextDay.textContent = readyMe
        ? `⏳ Đã sẵn sàng (${readyCnt}/${totalH}) — Chờ đối thủ nấu xong`
        : `☀️ Sẵn Sàng Sang Ngày Mới (${readyCnt}/${totalH})`;
    }
    if (typeof window.renderTabletopZone === 'function') window.renderTabletopZone();
    if (typeof window.renderRivalTabletopFlanks === 'function') window.renderRivalTabletopFlanks();
    if (typeof window.sync3DBoardOverlays === 'function') window.sync3DBoardOverlays();
  }

  function drawTurnBar() {
    const { view } = T;
    const st = view.state;
    const me = view.myChef;
    const totalH = (st.humans || []).length;
    let statusText;
    if (view.status === 'over') {
      statusText = `Ván kết thúc: ${BASE[st.winner]?.name || ''} thắng!`;
    } else if (st.phase === 1) {
      const cnt = (st.dialReady || []).filter(id => (st.humans || []).includes(id)).length;
      statusText = st.myDial
        ? `GĐ1: Bạn đã khóa đĩa (${cnt}/${totalH}) — chờ người khác mở đĩa cùng lúc`
        : `GĐ1: Xoay Đĩa chọn chợ bí mật! (${cnt}/${totalH} đã khóa)`;
    } else if (st.phase === 2) {
      statusText = st.auction
        ? `🔨 ĐẤU GIÁ TRỰC TIẾP: ${st.auction.card?.name} ($${st.auction.currentBid}) — 60s TẠM DỪNG!`
        : `⚡ GĐ2 REAL-TIME: Mọi người cùng mua & đổi trong 60 giây!`;
    } else {
      const cnt = (st.readyNextDay || []).length;
      statusText = `🍳 GĐ3: Mọi người cùng nấu món! (${cnt}/${totalH} sẵn sàng ngày mới)`;
    }

    const buttons = el('span', { className: 'row' },
      el('button', { textContent: '📜 Nhật ký', onclick: () => { if (logModal.style.display === 'flex') closeLog(); else openLog(); } }),
      el('button', { textContent: '↻', title: 'Đồng bộ ngay', onclick: () => refresh() }));
    const open = turnBar.classList.contains('open');
    const syncLabel = syncStatus === 'syncing' ? 'ĐỒNG BỘ…' : syncStatus === 'offline' ? 'THỬ LẠI' : 'LIVE';
    const emoteRow = (view.status === 'playing' || view.status === 'over')
      ? el('div', { id: 'hpvn-emote-bar', className: 'hpvn-emote-bar' },
          el('span', { className: 'hpvn-emote-label', textContent: 'Biểu cảm:' }),
          ...QUICK_EMOTES.map(emoji => el('button', {
            type: 'button',
            className: 'hpvn-emote-btn',
            title: `Gửi biểu cảm ${emoji}`,
            ariaLabel: `Gửi biểu cảm ${emoji}`,
            textContent: emoji,
            onclick: () => sendQuickEmote(emoji),
          })))
      : '';
    turnBar.replaceChildren(
      el('div', { className: 'line' },
        el('span', { className: 'status' },
          el('span', { className: `hpvn-live-dot${syncStatus === 'live' ? '' : ' ' + syncStatus}` }),
          el('span', { className: `hpvn-sync-pill${syncStatus === 'live' ? '' : ' ' + syncStatus}`, textContent: syncLabel }),
          statusText),
        el('span', { className: 'row' },
          el('button', { textContent: '🏠 Sảnh', onclick: () => showLobby() }),
          view.status !== 'over' ? el('button', { textContent: '🚪 Rời bàn', onclick: leaveTable }) : '',
          el('button', { textContent: open ? '▾ Thu gọn' : '▴ Bàn', onclick: () => { turnBar.classList.toggle('open'); drawTurnBar(); } }))),
      emoteRow,
      el('div', { className: 'more' }, el('div', { textContent: `⚡ Bàn Real-Time ${view.code} · Ngày ${st.day} · Giai đoạn ${st.phase}:` }),
        el('div', { className: 'board' }, ...(st.turnOrder || ORDER).filter(id => st.chefs[id]).map(id => {
          const isH = (st.humans || []).includes(id);
          const readyIcon = !isH ? '🤖'
            : st.phase === 1 ? ((st.dialReady || []).includes(id) ? '✅' : '⏳')
              : st.phase === 2 ? ((st.readyDone || []).includes(id) ? '🔔' : '⚡')
                : ((st.readyNextDay || []).includes(id) ? '✅' : '🍳');
          return el('span', { className: id === me ? 'now' : '',
            textContent: `${readyIcon} ${who(id)} · ${st.chefs[id].likes}⭐ · ${st.chefs[id].garbage || 0}🗑️` });
        })),
        buttons));
    turnBar.style.display = 'block';
    syncBottomBarClearance();
  }

  function sendQuickEmote(emoji) {
    if (!T || (T.view?.status !== 'playing' && T.view?.status !== 'over')) return;
    const now = Date.now();
    if (now - lastEmoteSentAt < 1550) return;
    lastEmoteSentAt = now;
    playSound('emote');
    act('emote', { emoji });
  }

  function drawLog() {
    const lines = (T?.view?.state?.log || []).slice(-50).reverse();
    if (!lines.length) {
      logBox.replaceChildren(el('div', { style: 'text-align:center; padding: 24px 12px; color: #a8a29e; font-style: italic;', textContent: 'Chưa có hoạt động nào.' }));
      return;
    }
    logBox.replaceChildren(...lines.map(line => el('div', { className: 'hpvn-log-line' },
      el('span', { className: 'hpvn-log-day', textContent: `Ngày ${line.day}` }),
      el('span', { className: 'hpvn-log-text', textContent: line.text }))));
  }

  function showWinner(st) {
    stopPolling();
    const winner = BASE[st.winner];
    if (!winner || !modalVictory) return;
    if (typeof eventToast !== 'undefined' && eventToast) eventToast.classList.add('toast-hidden');
    document.getElementById('modal-level-up')?.classList.add('hidden');
    const set = (id, text) => { const node = document.getElementById(id); if (node) node.innerText = text; };
    const wState = st.chefs[st.winner] || winner;
    const vImg = document.getElementById('victory-portrait-img');
    const vEm = document.getElementById('victory-portrait-emoji');
    if (vImg) {
      vImg.style.display = '';
      vImg.src = `./images/chefs/${st.winner}.webp`;
      vImg.alt = winner.name;
    }
    if (vEm) {
      vEm.style.display = 'none';
      vEm.textContent = winner.avatar || '🏆';
    }
    set('victory-winner-text', `${winner.avatar} ${winner.name} • [${(winner.restaurant || '').toUpperCase()}] THẮNG VỚI ${wState.likes} ⭐!`);
    set('victory-stat-dishes', `${wState.cookedCount || 0} món`);
    set('victory-stat-money', `$${wState.money}`);
    set('victory-stat-upgrades', `${(wState.upgrades || []).length}/4 nâng cấp`);
    set('victory-stat-level', `${wState.garbage || 0}🗑️ • Mốc ${(wState.unlockedMilestones || []).slice(-1)[0] || 0}⭐`);
    if (typeof window.renderVictoryBreakdown === 'function') {
      const seated = (st.turnOrder || ORDER).filter(id => st.chefs[id]);
      const chefsArr = seated.map(id => ({ ...BASE[id], ...st.chefs[id], id, displayName: who(id) }));
      window.renderVictoryBreakdown({
        chefs: chefsArr,
        dayHistory: st.dayHistory || [],
        stats: st.stats || {},
        winnerId: st.winner,
      });
    }
    if (btnRestartEl) btnRestartEl.textContent = '🏠 VỀ SẢNH BÀN ONLINE';
    modalVictory.classList.remove('hidden');
    if (window.VdbAAA?.vfx?.victoryConfetti) window.VdbAAA.vfx.victoryConfetti();
  }

  async function refresh() {
    if (!T || busy) return;
    setSyncState('syncing');
    try {
      const latest = await call({ op: 'state', code: T.code });
      setSyncState('live');
      enter(latest);
    } catch (error) {
      setSyncState('offline');
      setToast(`⚠️ ${error.message}`, true);
    }
  }

  // Concurrent-safe act() with automatic 1-time retry on version conflict ('functions/aborted')
  async function act(action, args = {}, retried = false) {
    if (!T || busy) return null;
    busy = true;
    setSyncState('syncing');
    try {
      const answer = await call({ op: 'act', code: T.code, version: T.view.version, step: action, args });
      setSyncState('live');
      apply(answer);
      return answer.result;
    } catch (error) {
      if (error.code === 'functions/aborted' && !retried) {
        busy = false;
        await refresh();
        if (action !== 'tick') return act(action, args, true);
        return null;
      }
      setSyncState('live');
      if (action !== 'tick') {
        playSound('error');
        setToast(`⚠️ ${error.message}`, true);
      }
      return null;
    } finally { busy = false; }
  }

  async function leaveTable() {
    const msg = T.view.status === 'waiting' ? 'Rời bàn chờ này?' : 'Rời bàn này? Bếp máy sẽ tự động chơi thay vị trí của bạn.';
    let ok = true;
    if (typeof window.rrConfirm === 'function') {
      ok = await window.rrConfirm({
        icon: '🚪',
        title: 'Rời Bàn Online?',
        message: msg,
        confirmText: 'Rời bàn',
        cancelText: 'Ở lại',
        danger: true,
      });
    }
    if (!ok) return;
    try { await call({ op: 'leave', code: T.code }); showLobby(); } catch (error) { setToast(`⚠️ ${error.message}`, true); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { refresh(); schedulePoll(); }
    else stopPolling();
  });

  // ---------- Hook ALL game actions to the real-time server ----------
  const marketKeyOf = card => Object.keys(gameState.markets).find(key => (gameState.markets[key].cards || []).includes(card));
  const original = {
    buyIngredientCard, buyShelfCard, disposeGarbageAtIsland, sellChocolateAtIsland, useChefPower,
    cookRecipe, trashIngredient, setupTargetSelector, dialForChef, updateLeaderboardUI,
  };

  dialForChef = chef => (!T ? original.dialForChef(chef) : chef === gameState.player ? playerDial : DIALS[chef?.id] || spareDial);

  const ribbon = document.getElementById('lead-p-likes')?.closest('div');
  const soloRibbonNodes = ribbon ? [...ribbon.childNodes] : [];
  updateLeaderboardUI = () => {
    if (!T?.view?.state) { original.updateLeaderboardUI(); return; }
    const st = T.view.state;
    const me = T.view.myChef;
    ribbon?.replaceChildren(el('span', { className: 'text-stone-400 font-bold', textContent: '🏆' }),
      ...(st.turnOrder || ORDER).filter(id => st.chefs[id]).map(id => el('span', {
        className: `font-bold cursor-pointer hover:underline ${id === me ? 'ring-2 ring-amber-400 rounded-lg px-1.5 py-0.5 bg-amber-950/80 shadow' : ''}`,
        title: `${who(id)} — ${st.chefs[id].likes}⭐, ${st.chefs[id].garbage || 0}🗑️ (Bấm xem bếp)`,
        style: `color:${BASE[id]?.colorHex || '#fbbf24'}`,
        onclick: () => typeof openRivalKitchensModal === 'function' && openRivalKitchensModal(id),
      }, `${BASE[id]?.avatar || '👨‍🍳'} `, el('b', { className: 'text-amber-400', textContent: st.chefs[id].likes }))));
    const actBadge = document.getElementById('header-action-badge');
    if (actBadge) actBadge.innerText = gameState.player.actionCards.length;
  };

  buyIngredientCard = (card, idx) => {
    if (!T) return original.buyIngredientCard(card, idx);
    if (gameState.phase !== 2) { setToast('⚠️ Chỉ mua hàng được trong Giai đoạn 2 (60s Real-Time)!', true); return; }
    if (card.type === 'action') return act('draw');
    if (card.type === 'upgrade') return openUpgradeShop();
    if (card.type === 'dumpster') return openDumpsterModal();
    if (card.type === 'dispose_garbage') return act('disposeGarbage', { count: 1 });
    if (card.type === 'sell_chocolate') return act('sellSpecialty', {});
    if (card.claimedBy && card.claimedBy.id !== gameState.player.id && getClaimHolder(card)) return openSnatchModal(card, idx);
    return act('buy', { market: marketKeyOf(card), slotIndex: typeof card.slotIdx === 'number' ? card.slotIdx : idx, name: card.name });
  };

  buyShelfCard = marketKey => {
    if (!T) return original.buyShelfCard(marketKey);
    if (gameState.phase !== 2) { setToast('⚠️ Chỉ bốc Kệ Úp được trong Giai đoạn 2!', true); return; }
    return act('buyShelf', { market: marketKey || gameState.player.deliveryMarket || gameState.player.currentLocation });
  };

  disposeGarbageAtIsland = (count = 1) => (!T ? original.disposeGarbageAtIsland(count) : act('disposeGarbage', { count }));
  sellChocolateAtIsland = itemId => (!T ? original.sellChocolateAtIsland(itemId) : act('sellSpecialty', itemId ? { itemId } : {}));
  useChefPower = targetId => {
    if (!T) return original.useChefPower(targetId);
    const t = targetId || gameState.rivals.find(r => r.currentLocation === gameState.player.currentLocation)?.id;
    return act('chefPower', { target: t });
  };
  cookRecipe = (recipe, useAddon = false) => (T ? act('cook', { recipeId: recipe.id, useAddon: !!useAddon }) : original.cookRecipe(recipe, useAddon));
  trashIngredient = itemId => (T ? act('trash', { itemId }) : original.trashIngredient(itemId));

  const intercept = (node, run) => node?.addEventListener('click', event => {
    if (!T) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    run();
  }, true);

  const part = choice => {
    if (!choice) return null;
    if (choice.type === 'money') return { money: choice.data };
    if (choice.type === 'garbage_bribe') return { garbage: 1, money: choice.data };
    if (choice.type === 'nothing') return { nothing: true };
    if (choice.type === 'garbage') return { garbage: 1 };
    return { item: choice.data?.id };
  };

  intercept(btnRevealDials, () => {
    flipDial(playerDial, false);
    act('move', { to: gameState.player.selectedDestination });
  });
  intercept(btnDoneBuying, () => act('done'));
  intercept(document.getElementById('btn-confirm-snatch'), () => {
    const card = currentSnatchCard, bribe = currentBribeTier;
    closeSnatchModal();
    if (card) act('buy', { market: marketKeyOf(card), slotIndex: typeof card.slotIdx === 'number' ? card.slotIdx : currentSnatchIdx, name: card.name, bribe });
  });
  // Live Online Bidding War buttons!
  intercept(document.getElementById('btn-bid-raise-50'), () => act('bid', { raise: 50 }));
  intercept(document.getElementById('btn-bid-raise-100'), () => act('bid', { raise: 100 }));
  intercept(document.getElementById('btn-bid-fold'), () => act('fold'));
  // Live Online Incoming Human Trade Offer Banner buttons!
  intercept(document.getElementById('btn-bot-trade-accept'), () => {
    const oid = activeOnlineOfferId;
    if (oid) act('answer', { offerId: oid, accept: true });
  });
  intercept(document.getElementById('btn-bot-trade-decline'), () => {
    const oid = activeOnlineOfferId;
    if (oid) act('answer', { offerId: oid, accept: false });
  });
  intercept(btnNextDay, () => act('end'));
  intercept(btnRestartEl, () => {
    if (typeof modalVictory !== 'undefined' && modalVictory) modalVictory.classList.add('hidden');
    showLobby();
  });
  intercept(btnBuyUpgrade, () => { const u = selectedUpgrade; closeUpgradeShop(); if (u) act('upgrade', { id: u.id }); });
  intercept(btnClaimDumpster, () => { const idx = selectedDumpsterItem; closeDumpsterModal(); if (idx !== null) act('dumpster', { index: idx }); });
  intercept(btnExecuteAction, () => {
    const card = selectedActionCard, target = selectedActionTarget;
    closeActionCardsModal();
    if (card) act('play', { cardId: card.id, target: typeof target === 'object' && target ? target.id : target === 'self' ? undefined : target });
  });
  intercept(btnSubmitTrade, () => {
    if (!selectedPlayerOffer || !selectedRivalRequest) { setToast('⚠️ Chọn 1 mục bạn đưa và 1 mục bạn yêu cầu!', true); return; }
    const args = { give: part(selectedPlayerOffer), want: part(selectedRivalRequest) };
    const human = T.view.state.humans.includes(selectedRivalId);
    closeBarterModal();
    act(human ? 'offer' : 'trade', human ? { to: selectedRivalId, ...args } : { with: selectedRivalId, ...args })
      .then(result => {
        if (human) setToast('📨 Đã gửi kèo trực tiếp — đối thủ thấy popup ngay lập tức!');
        else if (result) setToast(result.accepted ? '🤝 Đối thủ đồng ý đổi!' : '❌ Đối thủ từ chối kèo này.', !result.accepted);
      });
  });

  showLobby();
})();
