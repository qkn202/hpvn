// HPVN integration (Phòng Sinh Hoạt Chung): asynchronous tables for 2–8 members run by the HPVN server
// (callable vuaDauBep through the parent bridge). Each member plays one chef; every in-game day the chefs
// take one turn each in a fixed order, and under four members market chefs (bots) fill the table. With two
// members Cô Ba plays in the morning, the bots at noon, Mệ Thảo in the evening. In a table the buttons below send actions to the
// server and the board is redrawn from its answer; the solo game (3 bots, nothing saved) stays as upstream.
// Loaded after the game script, so it reads the game's globals (gameState, render helpers, modal state).
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
  if (!identity) return; // opened outside HPVN: the upstream solo game
  document.documentElement.classList.add('hpvn-framed');

  // ---------- bridge ----------
  const pending = new Map();
  addEventListener('message', event => {
    const d = event.data;
    if (event.source !== window.parent || event.origin !== location.origin || d?.channel !== 'hpvn-game' || d.nonce !== identity.nonce) return;
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
    html.hpvn-framed header { margin-left: 52px; width: calc(100% - 52px); }
    .hpvn-panel { position: fixed; z-index: 60; background: rgba(12,10,9,.96); color: #fde68a; border: 1px solid rgba(245,158,11,.55); border-radius: 16px; font: 600 13px/1.4 system-ui, sans-serif; box-shadow: 0 20px 50px rgba(0,0,0,.6); }
    .hpvn-panel button { font: inherit; cursor: pointer; border-radius: 10px; padding: 7px 12px; border: 1px solid rgba(245,158,11,.6); background: #1c1917; color: #fde68a; }
    .hpvn-panel button.primary { background: #f59e0b; color: #0c0a09; border-color: #f59e0b; font-weight: 800; }
    .hpvn-panel button:disabled { opacity: .45; cursor: default; }
    #hpvn-lobby { inset: 0; border-radius: 0; overflow-y: auto; padding: 64px 16px 24px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
    #hpvn-lobby .box { width: min(560px, 100%); border: 1px solid #44403c; border-radius: 14px; padding: 14px; background: #0c0a09; }
    #hpvn-lobby h2 { margin: 0 0 6px; font-size: 18px; color: #fbbf24; }
    #hpvn-lobby p { margin: 0 0 10px; color: #d6d3d1; font-weight: 500; }
    #hpvn-lobby .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    #hpvn-lobby .table { width: 100%; text-align: left; display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; }
    #hpvn-lobby input, #hpvn-lobby select { font: inherit; width: 9em; padding: 7px 10px; border-radius: 10px; border: 1px solid #57534e; background: #1c1917; color: #fff; }
    #hpvn-lobby input { text-transform: uppercase; }
    #hpvn-lobby .chefs { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    #hpvn-lobby .chefs button { text-align: left; }
    #hpvn-lobby .seat { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1px solid #292524; }
    #hpvn-turn .board { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 2px 10px; color: #e7e5e4; font-weight: 500; }
    #hpvn-turn .board .now { color: #fbbf24; font-weight: 800; }
    .hpvn-badge { background: #16a34a; color: #fff; border-radius: 999px; padding: 1px 8px; font-size: 11px; }
    #hpvn-turn { left: 50%; transform: translateX(-50%); bottom: max(8px, env(safe-area-inset-bottom, 8px)); width: min(620px, calc(100% - 16px)); padding: 6px 10px; display: none; max-height: min(48dvh, 320px); overflow-y: auto; box-sizing: border-box; }
    #hpvn-solo { left: 50%; transform: translateX(-50%); bottom: max(8px, env(safe-area-inset-bottom, 8px)); padding: 4px; display: none; }
    #hpvn-turn .more { display: none; margin-top: 6px; }
    #hpvn-turn.open .more { display: block; }
    #hpvn-turn .more > * + * { margin-top: 6px; }
    html.hpvn-framed #event-toast.toast-floating { bottom: 64px; }
    #hpvn-turn .line { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: space-between; }
    #hpvn-turn .status { color: #fff; }
    #hpvn-turn .row { display: inline-flex; flex-wrap: wrap; gap: 6px; }
    #hpvn-turn button { padding: 4px 9px; font-size: 12px; }
    #hpvn-log-modal {
      position: fixed; inset: 0; z-index: 100;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: none; align-items: center; justify-content: center;
      padding: max(10px, env(safe-area-inset-top, 10px)) max(10px, env(safe-area-inset-right, 10px)) max(10px, env(safe-area-inset-bottom, 10px)) max(10px, env(safe-area-inset-left, 10px));
      box-sizing: border-box;
    }
    #hpvn-log-modal .hpvn-modal-card {
      width: min(520px, 100%);
      max-height: min(88dvh, calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 20px));
      background: rgba(18, 16, 14, 0.98);
      border: 2px solid #f59e0b;
      border-radius: 18px;
      box-shadow: 0 25px 50px rgba(0,0,0,0.85), 0 0 25px rgba(245, 158, 11, 0.25);
      display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box;
    }
    #hpvn-log-modal .hpvn-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid rgba(245, 158, 11, 0.3);
      background: rgba(12, 10, 9, 0.9);
    }
    #hpvn-log-modal .hpvn-modal-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 15px; font-weight: 900; color: #fbbf24;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    #hpvn-log-modal .hpvn-modal-close {
      width: 36px; height: 36px; border-radius: 999px;
      background: #292524; border: 1px solid #44403c; color: #a8a29e;
      font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: center;
      cursor: pointer; touch-action: manipulation;
    }
    #hpvn-log-modal .hpvn-modal-close:active { transform: scale(0.9); color: #fff; }
    #hpvn-log {
      flex: 1 1 auto; min-height: 0; max-height: calc(88dvh - 125px);
      overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
      padding: 10px 14px; color: #e7e5e4; font-weight: 500; font-size: 13px; line-height: 1.5;
      display: block; box-sizing: border-box;
    }
    #hpvn-log .hpvn-log-line {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 6px 0; border-bottom: 1px solid #292524;
    }
    #hpvn-log .hpvn-log-day {
      flex-shrink: 0; padding: 1px 7px; border-radius: 6px;
      background: #292524; border: 1px solid #44403c; color: #fbbf24;
      font-size: 10px; font-weight: 800; text-transform: uppercase;
    }
    #hpvn-log .hpvn-log-text { flex: 1; color: #d6d3d1; }
    #hpvn-log-modal .hpvn-modal-footer {
      padding: 10px 14px; border-top: 1px solid rgba(245, 158, 11, 0.25);
      background: rgba(12, 10, 9, 0.9); display: flex; justify-content: flex-end;
    }
    .hpvn-btn-full {
      width: 100%; min-height: 42px; font-weight: 900 !important;
      font-size: 13px !important; letter-spacing: 0.05em; text-transform: uppercase;
    }
  `;
  document.head.appendChild(css);
  if (typeof eventToast !== 'undefined' && eventToast) eventToast.classList.add('toast-hidden'); // the solo game's intro line
  const el = (tag, attrs = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), attrs);
    node.append(...children);
    return node;
  };
  const lobby = el('div', { id: 'hpvn-lobby', className: 'hpvn-panel hud-interactive' });
  const turnBar = el('div', { id: 'hpvn-turn', className: 'hpvn-panel hud-interactive' });
  // the solo game's way back to the tables
  const soloBar = el('div', { id: 'hpvn-solo', className: 'hpvn-panel hud-interactive' },
    el('button', { textContent: '🏠 Về sảnh bàn online', onclick: () => showLobby() }));
  const logBox = el('div', { id: 'hpvn-log' });
  const logModal = el('div', { id: 'hpvn-log-modal', className: 'hud-interactive' },
    el('div', { className: 'hpvn-modal-card' },
      el('div', { className: 'hpvn-modal-header' },
        el('div', { className: 'hpvn-modal-title' },
          el('span', { textContent: '📜' }),
          el('h3', { textContent: 'Nhật Ký Chợ' })),
        el('button', { className: 'hpvn-modal-close', textContent: '✕', onclick: closeLog })),
      logBox,
      el('div', { className: 'hpvn-modal-footer' },
        el('button', { className: 'primary hpvn-btn-full', textContent: 'Đóng Nhật Ký', onclick: closeLog }))));
  logModal.onclick = e => { if (e.target === logModal) closeLog(); };
  function closeLog() { logModal.style.display = 'none'; }
  function openLog() { logModal.style.display = 'flex'; logBox.scrollTop = 0; }
  document.body.append(lobby, turnBar, soloBar, logModal);
  for (const box of [lobby, turnBar, soloBar, logModal]) for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown']) box.addEventListener(type, e => e.stopPropagation(), { passive: true });

  // turn order of the day (same as the server's TURN_ORDER); the four chefs below exist only at HPVN tables
  const ORDER = ['lola', 'chen', 'lucrezia', 'hai', 'sau', 'tam', 'muoi', 'angus'];
  const NEW_CHEFS = {
    hai: { name: 'Chị Hai Hội An', short: 'Chị Hai', avatar: '👩‍🦰', colorHex: '#8b5cf6', restaurant: 'Cao Lầu & Mì Quảng Phố Hội 🍜🏮',
      powerName: 'Chợ Sớm Phố Hội', powerDesc: 'Giảm $50 khi mua ở Chợ Hoa Quả và Chợ Rau Củ.',
      powerEvolvedName: 'Bậc Thầy Món Quê', powerEvolvedDesc: 'Giảm $50 ở Chợ Hoa Quả, Chợ Rau Củ; món thường (2 nguyên liệu) +1 Like!' },
    sau: { name: 'Anh Sáu Hà Thành', short: 'Anh Sáu', avatar: '🧔', colorHex: '#2563eb', restaurant: 'Phở Gánh Hàng Chiếu 🍜🌙',
      powerName: 'Gánh Phở Gia Truyền', powerDesc: 'Bắt đầu với 1 Lì Xì Bếp Trưởng; mỗi món nấu xong +$50.',
      powerEvolvedName: 'Đệ Nhất Phở Hà Thành', powerEvolvedDesc: 'Mỗi món nấu xong +$50; món có Bánh Phở Tươi +1 Like!' },
    tam: { name: 'Bà Tám Đất Cảng', short: 'Bà Tám', avatar: '👩‍🦳', colorHex: '#f97316', restaurant: 'Bánh Đa Cua Hải Phòng 🦀🍜',
      powerName: 'Mối Ruột Vựa Hải Sản', powerDesc: 'Giảm $100 khi mua ở Vựa Hải Sản Vũng Tàu.',
      powerEvolvedName: 'Nữ Hoàng Hải Sản', powerEvolvedDesc: 'Giảm $100 ở Vựa Hải Sản; món có Tôm hoặc Cua +1 Like!' },
    muoi: { name: 'Út Mười Tây Nguyên', short: 'Út Mười', avatar: '🧑‍🌾', colorHex: '#65a30d', restaurant: 'Cơm Lam Gà Nướng Buôn Ma Thuột 🍗🎋',
      powerName: 'Gùi Tre Rộng', powerDesc: 'Kho chứa thêm 1 món; +$50 mỗi ngày.',
      powerEvolvedName: 'Phú Hộ Cao Nguyên', powerEvolvedDesc: 'Kho chứa thêm 1 món; +$100 mỗi ngày!' },
  };
  const OFFSETS = { lola: [0, 0], angus: [1.2, 0], chen: [-1.2, 0], lucrezia: [0, 1.2], hai: [0, -1.2], sau: [1.2, 1.2], tam: [-1.2, 1.2], muoi: [1.2, -1.2] };
  const MAX_PLAYERS = 8;
  const when = millis => new Date(millis).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  const inviteCode = (() => { try { return new URL(document.referrer).searchParams.get('room') || ''; } catch { return ''; } })();

  const INTRO = 'Mỗi bàn 2–8 người, mỗi người một bếp. Mỗi ngày các bếp đi chợ lần lượt theo số thứ tự (bàn dưới 4 người có bếp máy chơi chen vào). Bạn đi lượt lúc nào cũng được; lỡ hạn thì quản lý quán đi chợ thay (bàn 2 người hạn 24 giờ, bàn đông hạn ngắn hơn, tối thiểu 8 giờ). Ai đạt 20 ⭐ thắng vào cuối ngày.';
  const chefLabel = id => `${BASE[id].avatar} ${BASE[id].name}`;

  async function showLobby(note = '') {
    T = null;
    turnBar.style.display = 'none';
    soloBar.style.display = 'none';
    closeLog();
    lobby.style.display = 'flex';
    lobby.replaceChildren(el('div', { className: 'box' }, el('h2', { textContent: '🍲 Vua Đầu Bếp: bàn lệch giờ' }), el('p', { textContent: INTRO }),
      note ? el('p', { textContent: note, style: 'color:#fca5a5' }) : '', el('p', { textContent: 'Đang tải bàn của bạn…' })));
    let mine = [];
    try { mine = (await call({ op: 'mine' })).tables || []; } catch (error) { note = error.message; }
    const tableRows = mine.map(t => {
      const who = t.status === 'waiting' ? `${t.seated}/${t.size} người` : t.others.length ? `với ${t.others.join(', ')}` : 'với bếp máy';
      const label = `${t.code} · ${BASE[t.myChef]?.avatar || ''} · ${who}${t.day ? ` · ngày ${t.day}` : ''}`;
      const state = t.status === 'over' ? (t.winner ? 'Đã xong' : 'Đã đóng') : t.myTurn ? 'Đến lượt bạn!' : t.status === 'waiting' ? 'Chờ người vào' : 'Chờ người khác';
      return el('button', { className: 'table', onclick: () => openTable(t.code) }, el('span', { textContent: label }),
        el('span', { className: t.myTurn ? 'hpvn-badge' : '', textContent: state }));
    });
    const codeInput = el('input', { placeholder: 'MÃ BÀN', maxLength: 6, value: inviteCode });
    const sizePick = el('select', { ariaLabel: 'Số người' }, ...Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => el('option', { value: i + 2, textContent: `${i + 2} người` })));
    lobby.replaceChildren(
      el('div', { className: 'box' }, el('h2', { textContent: '🍲 Vua Đầu Bếp: bàn lệch giờ' }), el('p', { textContent: INTRO }),
        note ? el('p', { textContent: note, style: 'color:#fca5a5' }) : ''),
      el('div', { className: 'box' }, el('h2', { textContent: 'Bàn của bạn' }),
        ...(tableRows.length ? tableRows : [el('p', { textContent: 'Chưa có bàn nào.' })])),
      el('div', { className: 'box' }, el('h2', { textContent: 'Mở bàn mới' }),
        el('p', { textContent: 'Chọn số người và bếp của bạn (số là thứ tự đi chợ trong ngày: Cô Ba đi sớm nhất, Mệ Thảo chốt ngày). Đủ người là bàn tự bắt đầu; chủ bàn cũng có thể bắt đầu sớm khi có từ 2 người.' }),
        el('div', { className: 'row', style: 'margin-bottom:8px' }, el('span', { textContent: 'Số người:' }), sizePick),
        el('div', { className: 'chefs' }, ...ORDER.map((id, i) => el('button', { className: 'primary', textContent: `${i + 1}. ${chefLabel(id)}`,
          title: BASE[id].powerDesc || '', onclick: () => createTable(id, Number(sizePick.value)) })))),
      el('div', { className: 'box' }, el('h2', { textContent: 'Vào bàn bằng mã' }),
        el('div', { className: 'row' }, codeInput, el('button', { className: 'primary', textContent: 'Vào bàn', onclick: () => joinTable(codeInput.value.trim().toUpperCase()) }))),
      el('div', { className: 'box' }, el('h2', { textContent: 'Chơi thử' }),
        el('p', { textContent: 'Một mình với 3 bếp máy trên máy này, không lưu.' }),
        el('button', { textContent: 'Chơi thử với bếp máy', onclick: () => { lobby.style.display = 'none'; soloBar.style.display = 'block'; } })));
  }

  // a table that has not started: who sits where, invite, the host may start early
  function showWaiting(view) {
    turnBar.style.display = 'none';
    lobby.style.display = 'flex';
    const seated = Object.keys(view.seats).length;
    lobby.replaceChildren(
      el('div', { className: 'box' }, el('h2', { textContent: `Bàn ${view.code} · đang chờ ${seated}/${view.size} người` }),
        el('p', { textContent: view.isHost ? `Mời bạn bè qua Floo. Đủ ${view.size} người là bàn tự bắt đầu, hoặc bạn bắt đầu ngay khi có từ 2 người; bếp không có người sẽ bỏ qua (bàn dưới 4 người có bếp máy).` : 'Chờ chủ bàn bắt đầu, hoặc bàn tự bắt đầu khi đủ người.' }),
        ...ORDER.filter(id => view.seats[id]).map(id => el('div', { className: 'seat' }, el('span', { textContent: chefLabel(id) }),
          el('span', { textContent: `${view.seats[id].name}${id === view.myChef ? ' (bạn)' : ''}` }))),
        el('div', { className: 'row', style: 'margin-top:10px' },
          el('button', { className: 'primary', textContent: 'Mời qua Floo', onclick: () => request('vdb-invite', { code: view.code }).catch(() => {}) }),
          view.isHost ? el('button', { className: 'primary', textContent: `Bắt đầu với ${seated} người`, disabled: seated < 2, onclick: startTable }) : '',
          el('button', { textContent: '↻ Tải lại', onclick: () => refresh() }),
          el('button', { textContent: '🏠 Sảnh', onclick: () => showLobby() }),
          el('button', { textContent: 'Rời bàn', onclick: leaveTable }))));
  }

  async function createTable(seat, size) {
    try { enter(await call({ op: 'create', seat, size })); } catch (error) { showLobby(error.message); }
  }
  async function startTable() {
    try { enter(await call({ op: 'start', code: T.code })); } catch (error) { showLobby(error.message); }
  }
  async function joinTable(code) {
    if (!/^[A-Z0-9]{6}$/.test(code)) { showLobby('Mã bàn có 6 ký tự.'); return; }
    try { enter(await call({ op: 'join', code })); } catch (error) { showLobby(error.message); }
  }
  async function openTable(code) {
    try { enter(await call({ op: 'state', code })); } catch (error) { showLobby(error.message); }
  }

  // ---------- online table ----------
  let T = null; // { code, view }
  let busy = false;
  const BASE = Object.fromEntries([gameState.player, ...gameState.rivals].map(chef => [chef.id, chef]));
  for (const [id, chef] of Object.entries(NEW_CHEFS)) BASE[id] = { id, ...chef, level: 1, upgrades: [], inventory: [], actionCards: [], activeRecipes: [], garbageCan: [] };
  const seatBox = document.getElementById('btn-seat-lola')?.parentElement;
  // board pieces: the page has standees for its four chefs and dials for the three rivals; the new chefs get
  // standees on first use, and any chef without a dial of its own uses one that is never on the board
  const STANDEES = { lola: chefLola, angus: chefAngus, chen: chefChen, lucrezia: chefLucrezia };
  const DIALS = { angus: rivalDialAngus, chen: rivalDialChen, lucrezia: rivalDialLucrezia };
  const spareDial = createPhysicalMovementDial('', false);
  function standeeOf(id) {
    if (!STANDEES[id]) {
      STANDEES[id] = createAcrylicChefStandee(NEW_CHEFS[id].short, NEW_CHEFS[id].avatar, NEW_CHEFS[id].colorHex);
      STANDEES[id].position.set(0, boardHeight, boardCenterZ);
      scene.add(STANDEES[id]);
    }
    return STANDEES[id];
  }

  const ALL_MARKET_KEYS = ['fruit', 'vegetable', 'carbs', 'chop', 'dairy', 'mystery', 'island'];
  function getRandomMarketForDay(code, day, chefId, closedMarkets = []) {
    let hash = 0;
    const seed = `${code || 'VDB'}-day${day}-${chefId}`;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash |= 0;
    }
    const open = ALL_MARKET_KEYS.filter(m => !closedMarkets.includes(m));
    const list = open.length ? open : ALL_MARKET_KEYS;
    return list[Math.abs(hash) % list.length];
  }

  function enter(view) {
    if (seatBox) seatBox.style.display = 'none';
    if (typeof closeTransientUI === 'function') closeTransientUI();
    const first = !T || T.code !== view.code || !T.view?.state;
    T = { code: view.code, view: first ? null : T.view };
    if (view.status === 'waiting') { T.view = view; showWaiting(view); return; }
    lobby.style.display = 'none';
    apply(view, first);
  }

  function apply(view, first = false) {
    const before = first ? null : T.view;
    T.view = view;
    const st = view.state;
    const me = view.myChef;
    const seated = ORDER.filter(id => st.chefs[id]);
    const myTurn = view.status === 'playing' && st.turnChef === me;
    const isRandomMarketDay = T && view.status === 'playing' && st.day <= 5;
    const closed = (st.closed || []).map(c => c.market);
    const randomDest = isRandomMarketDay ? getRandomMarketForDay(T.code, st.day, me, closed) : null;
    for (const [id, chef] of Object.entries(st.chefs)) {
      const base = BASE[id];
      let dest = chef.currentLocation;
      if (id === me && myTurn && st.phase === 1) {
        dest = isRandomMarketDay ? randomDest : (!first ? base.selectedDestination : chef.currentLocation);
      }
      Object.assign(base, chef, {
        selectedDestination: dest, deliveryMarket: null,
        upgrades: chef.upgrades.map(u => ({ ...(availableUpgradesDeck.find(x => x.id === u.id) || {}), ...u })),
        actionCards: id === me ? chef.actionCards : Array.from({ length: chef.actionCardCount }, (_, i) => ({ id: `hidden-${i}` })),
      });
    }
    gameState.player = BASE[me];
    gameState.rivals = seated.filter(id => id !== me).map(id => BASE[id]);
    gameState.day = st.day;
    gameState.phase = myTurn ? st.phase : 0;
    gameState.closedMarkets = st.closed.map(c => c.market);
    gameState.dumpster = st.dumpster;
    gameState.hotSeat = false;
    for (const [key, market] of Object.entries(gameState.markets)) {
      for (const card of market.cards || []) {
        const claim = st.claims[`${key}|${card.name}`];
        card.claimedBy = claim ? { id: claim.id, name: BASE[claim.id].name, avatar: BASE[claim.id].avatar, baseCost: claim.baseCost, bribeCost: claim.bribeCost, itemInstanceId: claim.itemInstanceId } : null;
      }
    }
    for (const id of ORDER) {
      if (STANDEES[id] || st.chefs[id]) standeeOf(id).visible = !!st.chefs[id];
      if (DIALS[id]) DIALS[id].visible = !!st.chefs[id] && id !== me;
    }
    for (const id of seated) {
      const was = before?.state.chefs[id]?.currentLocation;
      const now = st.chefs[id].currentLocation;
      if (first || was !== now) {
        const pos = gameState.markets[now].pos;
        const [ox, oz] = OFFSETS[id];
        animateStandeeTo(standeeOf(id), { x: pos.x + ox, z: pos.z + oz });
        setDialNeedle(dialForChef(BASE[id]), now, !first);
        if (first) flipDial(dialForChef(BASE[id]), true);
      }
    }
    if (myTurn && st.phase === 1) {
      setDialNeedle(dialForChef(gameState.player), gameState.player.selectedDestination, false);
    }
    updateHUDStats();
    updateRecipeUI();
    updateLeaderboardUI();
    showPhase(myTurn ? st.phase : 0, first || before?.state.phase !== st.phase || before?.state.turnChef !== st.turnChef);
    drawTurnBar();
    drawLog();
    // what happened since this member last looked (bots at noon, the other member's turn, the autopilot)
    const seen = before ? before.state.logN : st.logN;
    const fresh = st.log.filter(line => line.n > seen);
    if (fresh.length) setToast(fresh.slice(-3).map(line => line.text).join('  '));
    if (st.over) showWinner(st);
  }

  const TAB_OFF = 'px-2 py-0.5 rounded-lg text-stone-400 transition-all';
  const TAB_ON = ['px-2 py-0.5 rounded-lg bg-amber-500 text-stone-950 font-black shadow transition-all',
    'px-2 py-0.5 rounded-lg bg-red-600 text-white font-black shadow transition-all',
    'px-2 py-0.5 rounded-lg bg-amber-500 text-stone-950 font-black shadow transition-all'];
  function showPhase(phase, moved) {
    const shown = phase || 1;
    [tab1, tab2, tab3].forEach((tab, i) => { tab.className = i + 1 === shown ? TAB_ON[i] : TAB_OFF; });
    [panel1, panel2, panel3].forEach((panel, i) => panel.classList.toggle('hidden', i + 1 !== shown));
    btnRevealDials.disabled = phase !== 1;
    syncDestButtons();
    const p = gameState.player;
    if (shown === 2) {
      turnBar.classList.remove('open');
      closeLog();
      marketTitle.innerText = gameState.markets[p.currentLocation].name.toUpperCase();
      buyQuota.innerText = `Đã mua: ${p.boughtCountToday} / ${getBuyLimit(p)} thẻ`;
      timerDisplay.innerText = '∞';
      renderMarketShelf();
      updateContestedAlert();
      if (moved) { const pos = gameState.markets[p.currentLocation].pos; tweenCamera(pos.x, 32, pos.z + 14, pos.x, 0, pos.z); }
    } else if (moved) {
      tweenCamera(0, 42, 28, 0, 0, 3.0);
    }
    btnNextDay.textContent = '✅ KẾT THÚC LƯỢT';
  }

  function drawTurnBar() {
    const { view } = T;
    const st = view.state;
    const me = view.myChef;
    const who = id => (view.seats[id] ? `${view.seats[id].name} (${BASE[id]?.name || id})` : `${BASE[id]?.name || id} 🤖`);
    let status;
    if (view.status === 'over') status = `Ván đã kết thúc: ${BASE[st.winner]?.name || ''} thắng.`;
    else if (st.turnChef === me) status = `Đến lượt bạn${view.deadline ? ` · hạn ${when(view.deadline)}` : ''}`;
    else status = `Đang chờ ${who(st.turnChef)} đi lượt${view.deadline ? ` · hạn ${when(view.deadline)}, quá hạn quản lý quán đi thay` : ''}`;
    const buttons = el('span', { className: 'row' },
      el('button', { textContent: '📜 Nhật ký', onclick: () => { if (logModal.style.display === 'flex') closeLog(); else openLog(); } }),
      el('button', { textContent: '↻', title: 'Tải lại bàn', onclick: () => refresh() }));
    const mine = st.offers.filter(o => o.to === me && st.turnChef === me);
    if (mine.length) turnBar.classList.add('open'); // an offer waits for an answer: show it
    const offers = mine.map(offer => el('div', { className: 'line' },
      el('span', { textContent: `📨 ${BASE[offer.from].name} đề nghị: ${offer.label}` }),
      el('span', {}, el('button', { className: 'primary', textContent: 'Đồng ý', onclick: () => act('answer', { offerId: offer.id, accept: true }) }), ' ',
        el('button', { textContent: 'Từ chối', onclick: () => act('answer', { offerId: offer.id, accept: false }) }))));
    // a one-line pill at the bottom (the board stays visible); tap it for the table menu, offers and the log
    const open = turnBar.classList.contains('open');
    turnBar.replaceChildren(
      el('div', { className: 'line' }, el('span', { className: 'status', textContent: `${mine.length ? '📨 ' : ''}${status}` }),
        el('span', { className: 'row' },
          // Sảnh keeps the seat (come back from the table list); Rời bàn gives the chef to the bots for good
          el('button', { textContent: '🏠 Sảnh', title: 'Về danh sách bàn, vẫn giữ chỗ', onclick: () => showLobby() }),
          view.status !== 'over' ? el('button', { textContent: '🚪 Rời bàn', title: 'Bỏ bàn này, bếp máy chơi thay', onclick: leaveTable }) : '',
          el('button', { textContent: open ? '▾ Thu gọn' : '▴ Bàn', onclick: () => { turnBar.classList.toggle('open'); drawTurnBar(); } }))),
      el('div', { className: 'more' }, el('div', { textContent: `Bàn ${view.code} · Ngày ${st.day} · thứ tự đi chợ:` }),
        el('div', { className: 'board' }, ...ORDER.filter(id => st.chefs[id]).map(id => el('span', { className: id === st.turnChef ? 'now' : '',
          textContent: `${id === st.turnChef ? '▶ ' : ''}${who(id)} · ${st.chefs[id].likes} ⭐${id === me ? ' (bạn)' : ''}` }))),
        buttons, ...offers));
    turnBar.style.display = 'block';
  }

  function drawLog() {
    const lines = (T?.view?.state?.log || []).slice(-50).reverse();
    if (!lines.length) {
      logBox.replaceChildren(el('div', { style: 'text-align:center; padding: 24px 12px; color: #a8a29e; font-style: italic;', textContent: 'Chưa có hoạt động nào trong nhật ký.' }));
      return;
    }
    logBox.replaceChildren(...lines.map(line => el('div', { className: 'hpvn-log-line' },
      el('span', { className: 'hpvn-log-day', textContent: `Ngày ${line.day}` }),
      el('span', { className: 'hpvn-log-text', textContent: line.text }))));
  }

  function showWinner(st) {
    const winner = BASE[st.winner];
    if (!winner || !modalVictory) return;
    const set = (id, text) => { const node = document.getElementById(id); if (node) node.innerText = text; };
    set('victory-winner-text', `NHÀ HÀNG [${winner.restaurant.toUpperCase()}] THẮNG VỚI ${winner.likes} ĐIỂM DANH TIẾNG!`);
    set('victory-stat-dishes', `${winner.cookedCount || 0} món`);
    set('victory-stat-money', `$${winner.money}`);
    set('victory-stat-upgrades', `${winner.upgrades.length}/4 nâng cấp`);
    set('victory-stat-level', winner.level === 2 ? '👑 Cấp 2 (Master Chef)' : '⭐ Cấp 1');
    modalVictory.classList.remove('hidden');
  }

  async function refresh() {
    if (!T || busy) return;
    try { enter(await call({ op: 'state', code: T.code })); } catch (error) { setToast(`⚠️ ${error.message}`, true); }
  }
  async function act(action, args = {}) {
    if (!T || busy) return null;
    busy = true;
    try {
      // `step`, not `action`: the bridge envelope's own `action` is 'vdb'
      const answer = await call({ op: 'act', code: T.code, version: T.view.version, step: action, args });
      apply(answer);
      return answer.result;
    } catch (error) {
      playSound('error');
      setToast(`⚠️ ${error.message}`, true);
      if (error.code === 'functions/aborted') { busy = false; await refresh(); }
      return null;
    } finally { busy = false; }
  }
  async function leaveTable() {
    if (!window.confirm(T.view.status === 'waiting' ? 'Rời bàn này? Bạn có thể vào lại bằng mã nếu bàn còn chỗ.' : 'Rời bàn này? Bếp của bạn sẽ do máy chơi tiếp, bạn không quay lại được.')) return;
    try { await call({ op: 'leave', code: T.code }); showLobby(); } catch (error) { setToast(`⚠️ ${error.message}`, true); }
  }
  setInterval(() => { if (T && document.visibilityState === 'visible' && (T.view.status === 'waiting' || T.view.state.turnChef !== T.view.myChef)) refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

  // ---------- the game's buttons, routed to the server while a table is open ----------
  const marketKeyOf = card => Object.keys(gameState.markets).find(key => (gameState.markets[key].cards || []).includes(card));
  const original = { buyIngredientCard, cookRecipe, trashIngredient, setupTargetSelector, dialForChef, updateLeaderboardUI, getCardCostFor, getPantryCapacity };
  // the new chefs' powers, for the prices and pantry the page shows (the server applies the rules)
  getCardCostFor = (chef, card, shopKey) => {
    let cost = original.getCardCostFor(chef, card, shopKey);
    if (chef?.id === 'tam' && shopKey === 'dairy') cost = Math.max(50, cost - 100);
    if (chef?.id === 'hai' && (shopKey === 'fruit' || shopKey === 'vegetable')) cost = Math.max(50, cost - 50);
    return cost;
  };
  getPantryCapacity = chef => original.getPantryCapacity(chef) + (chef?.id === 'muoi' ? 1 : 0);
  dialForChef = chef => (!T ? original.dialForChef(chef) : chef === gameState.player ? playerDial : DIALS[chef?.id] || spareDial);
  // the header ribbon lists every chef at the table, in turn order
  const ribbon = document.getElementById('lead-p-likes')?.closest('div');
  updateLeaderboardUI = () => {
    if (!T?.view?.state) { original.updateLeaderboardUI(); return; }
    const st = T.view.state;
    ribbon?.replaceChildren(el('span', { className: 'text-stone-400 font-bold', textContent: '🏆' }),
      ...ORDER.filter(id => st.chefs[id]).map(id => el('span', { className: 'font-bold cursor-pointer hover:underline', title: `${BASE[id].name} (Bấm để xem thẻ món & nguyên liệu)`, style: `color:${BASE[id].colorHex}`, onclick: () => typeof openRivalKitchensModal === 'function' && openRivalKitchensModal(id) },
        `${BASE[id].avatar} `, el('b', { className: 'text-amber-400', textContent: st.chefs[id].likes }))));
    const actBadge = document.getElementById('header-action-badge');
    if (actBadge) actBadge.innerText = gameState.player.actionCards.length;
  };
  buyIngredientCard = (card, idx) => {
    if (!T) return original.buyIngredientCard(card, idx);
    if (gameState.phase !== 2) { setToast('⚠️ Chỉ mua hàng được trong lượt của bạn, sau khi đã chọn quầy.', true); return; }
    if (card.type === 'action') return act('draw');
    if (card.type === 'upgrade') return openUpgradeShop();
    if (card.type === 'dumpster') return openDumpsterModal();
    if (card.claimedBy && card.claimedBy.id !== gameState.player.id && getClaimHolder(card)) return openSnatchModal(card, idx);
    return act('buy', { market: marketKeyOf(card), name: card.name });
  };
  cookRecipe = recipe => (T ? act('cook', { recipeId: recipe.id }) : original.cookRecipe(recipe));
  trashIngredient = itemId => (T ? act('trash', { itemId }) : original.trashIngredient(itemId));
  setupTargetSelector = card => {
    original.setupTargetSelector(card);
    if (!T || card.type !== 'kick_opponent') return;
    // async rule: ban any rival from the market you stand in for their next turn
    actionTargetLabel.innerText = 'CHỌN ĐỐI THỦ BỊ CẤM VÀO QUẦY BẠN ĐANG ĐỨNG Ở LƯỢT TỚI CỦA HỌ:';
    actionTargetsButtons.innerHTML = '';
    gameState.rivals.forEach(riv => {
      const btn = el('button', { className: 'p-2 rounded-lg border border-stone-700 bg-stone-900 hover:border-amber-400 text-xs font-bold flex flex-col items-center gap-1 cursor-pointer' },
        el('span', { className: 'text-lg', textContent: riv.avatar }), el('span', { textContent: riv.name }));
      btn.addEventListener('click', () => {
        selectedActionTarget = riv;
        actionTargetsButtons.querySelectorAll('button').forEach(b => b.classList.remove('border-amber-400', 'bg-amber-950/80'));
        btn.classList.add('border-amber-400', 'bg-amber-950/80');
        btnExecuteAction.disabled = false;
        btnExecuteAction.classList.remove('opacity-50', 'cursor-not-allowed');
      });
      actionTargetsButtons.appendChild(btn);
    });
  };
  const intercept = (node, run) => node?.addEventListener('click', event => {
    if (!T) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    run();
  }, true);
  const part = choice => (choice?.type === 'money' ? { money: choice.data } : { item: choice?.data?.id });
  intercept(btnRevealDials, () => act('move', { to: gameState.player.selectedDestination }));
  intercept(btnDoneBuying, () => act('done'));
  intercept(document.getElementById('btn-confirm-snatch'), () => {
    const card = currentSnatchCard;
    const bribe = currentBribeTier;
    closeSnatchModal();
    if (card) act('buy', { market: marketKeyOf(card), name: card.name, bribe });
  });
  intercept(btnNextDay, () => act('end'));
  intercept(btnBuyUpgrade, () => { const upgrade = selectedUpgrade; closeUpgradeShop(); if (upgrade) act('upgrade', { id: upgrade.id }); });
  intercept(btnClaimDumpster, () => { const index = selectedDumpsterItem; closeDumpsterModal(); if (index !== null) act('dumpster', { index }); });
  intercept(btnExecuteAction, () => {
    const card = selectedActionCard;
    const target = selectedActionTarget;
    closeActionCardsModal();
    if (card) act('play', { cardId: card.id, target: typeof target === 'object' && target ? target.id : target === 'self' ? undefined : target });
  });
  intercept(btnSubmitTrade, () => {
    if (!selectedPlayerOffer || !selectedRivalRequest) { setToast('⚠️ Chọn 1 món bạn đưa và 1 món bạn muốn nhận!', true); return; }
    const args = { give: part(selectedPlayerOffer), want: part(selectedRivalRequest) };
    const human = T.view.state.humans.includes(selectedRivalId);
    closeBarterModal();
    act(human ? 'offer' : 'trade', human ? { to: selectedRivalId, ...args } : { with: selectedRivalId, ...args })
      .then(result => { if (result && !human) setToast(result.accepted ? '🤝 Đối thủ đồng ý đổi!' : '❌ Đối thủ từ chối kèo này.', !result.accepted); });
  });

  // Phase 1: in multiplayer online mode during the first 5 days, market is assigned randomly and cannot be manually selected
  const origSyncDestButtons = typeof syncDestButtons === 'function' ? syncDestButtons : null;
  syncDestButtons = () => {
    if (origSyncDestButtons) origSyncDestButtons();
    const isRandomMarketDay = T && T.view?.status === 'playing' && T.view.state?.day <= 5 && T.view.state?.phase === 1;
    const descEl = document.querySelector('#panel-phase-1 p');
    const lbl = document.getElementById('selected-dest-label');
    const destBtns = document.querySelectorAll('.dest-btn');
    if (isRandomMarketDay) {
      if (descEl) descEl.textContent = '🎲 Ngày 1–5: Chợ được chỉ định ngẫu nhiên, bấm nút Đi chợ!';
      if (lbl && typeof destLabelText === 'function') {
        lbl.innerText = `🎲 NGẪU NHIÊN: ${destLabelText(gameState.player.selectedDestination)}`;
      }
      destBtns.forEach(b => {
        const isChosen = b.getAttribute('data-dest') === gameState.player.selectedDestination;
        b.style.opacity = isChosen ? '1' : '0.4';
        b.style.cursor = isChosen ? 'default' : 'not-allowed';
      });
    } else {
      if (descEl) descEl.textContent = 'Chọn quầy chợ, sau đó bấm nút Đi chợ!';
      destBtns.forEach(b => {
        b.style.opacity = '';
        b.style.cursor = '';
      });
    }
  };

  document.querySelectorAll('.dest-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      if (T && T.view?.status === 'playing' && T.view.state?.day <= 5 && T.view.state?.phase === 1) {
        e.stopImmediatePropagation();
        e.preventDefault();
        setToast('🎲 Trong 5 ngày đầu tiên, quầy chợ được chỉ định ngẫu nhiên!', true);
      }
    }, true);
  });

  showLobby();
})();
