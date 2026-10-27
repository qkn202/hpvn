'use strict';

// Vua Đầu Bếp (upstream qkn202/hpvn index.html): the catalog the server rules read. Names, prices and
// numbers are the upstream ones; the board's 3D positions stay in the game page.

const MARKETS = {
  fruit: { name: 'Chợ Hoa Quả Miền Tây', cards: [
    { name: 'Xoài Cát Hòa Lộc', cost: 100, emoji: '🥭', type: 'fruit' },
    { name: 'Dưa Hấu Long An', cost: 100, emoji: '🍉', type: 'fruit' },
    { name: 'Chanh Ớt Tươi', cost: 100, emoji: '🍋', type: 'fruit' }] },
  vegetable: { name: 'Chợ Rau Củ Đà Lạt', cards: [
    { name: 'Rau Thơm & Dưa Leo', cost: 100, emoji: '🥒', type: 'veg' },
    { name: 'Giá Đỗ & Hẹ', cost: 100, emoji: '🌿', type: 'veg' },
    { name: 'Hành Ngò Tươi', cost: 100, emoji: '🧅', type: 'veg' }] },
  carbs: { name: 'Chợ Gạo & Bánh Phở', cards: [
    { name: 'Bánh Mì Sài Gòn', cost: 100, emoji: '🥖', type: 'carbs' },
    { name: 'Bánh Phở Tươi', cost: 100, emoji: '🍜', type: 'carbs' },
    { name: 'Gạo Tấm Thơm', cost: 100, emoji: '🍚', type: 'carbs' }] },
  chop: { name: 'Lò Mổ & Hàng Thịt Tươi', cards: [
    { name: 'Thịt Ba Rọi', cost: 200, emoji: '🥓', type: 'meat' },
    { name: 'Sườn Heo Cốt Lết', cost: 200, emoji: '🍖', type: 'meat' },
    { name: 'Bắp Bò Tươi', cost: 200, emoji: '🥩', type: 'meat' }] },
  dairy: { name: 'Vựa Hải Sản Vũng Tàu', cards: [
    { name: 'Tôm Sú Tươi', cost: 200, emoji: '🦐', type: 'seafood' },
    { name: 'Cua Biển Cà Mau', cost: 200, emoji: '🦀', type: 'seafood' },
    { name: 'Trứng Gà Ta', cost: 200, emoji: '🥚', type: 'dairy' }] },
  mystery: { name: 'Phố Gia Vị Thuốc Bắc', cards: [
    { name: 'Hồi Quế Thảo Mộc', cost: 300, emoji: '🍂', type: 'mystery' },
    { name: 'Mắm Ruốc Huế', cost: 300, emoji: '🏺', type: 'mystery' },
    { name: 'Nước Cốt Dừa Bến Tre', cost: 300, emoji: '🥥', type: 'mystery' }] },
  // Chợ Bến Thành: action cards, kitchen upgrades and the dumpster instead of ingredients
  island: { name: 'Chợ Bến Thành & Vựa Sỉ', cards: [] },
};
const MARKET_KEYS = ['fruit', 'vegetable', 'carbs', 'chop', 'dairy', 'mystery'];
const ACTION_CARD_COST = 100;

const UPGRADES = [
  { id: 'upg_freezer', name: 'Tủ Đông Công Nghiệp', cost: 200, icon: '🧊' },
  { id: 'upg_vip', name: 'Thẻ VIP Giảm Giá', cost: 300, icon: '🏷️' },
  { id: 'upg_delivery', name: 'Xe Giao Hàng Siêu Tốc', cost: 250, icon: '🛵' },
  { id: 'upg_bouncer', name: 'Bảo Vệ Quán 24/7', cost: 200, icon: '🛡️' },
  { id: 'upg_neon', name: 'Biển Hiệu Đèn LED', cost: 450, icon: '📢' },
];

// desc: the async rules (closure and ban last until the rival's next turn is over)
const ACTION_CARDS = [
  { type: 'steal_money', name: 'Cướp Khách Giờ Vàng', emoji: '🦹', badge: 'CƯỚP TIỀN', desc: 'Kéo khách và móc ví $100 từ 1 quán đối thủ!' },
  { type: 'steal_item', name: 'Mượn Tạm Nguyên Liệu', emoji: '🥢', badge: 'TRỘM ĐỒ', desc: 'Bốc trộm 1 nguyên liệu ngẫu nhiên từ kho của đối thủ!' },
  { type: 'close_market', name: 'Phong Tỏa VSATTP', emoji: '🛑', badge: 'PHONG TỎA', desc: 'Phong tỏa 1 quầy chợ trọn một vòng: không ai mua được ở đó cho tới lượt sau của bạn!' },
  { type: 'kick_opponent', name: 'Cưỡng Chế Đổi Chợ', emoji: '🛵', badge: 'ĐUỔI CHỢ', desc: 'Cấm 1 đối thủ bước vào quầy bạn đang đứng ở lượt kế tiếp của họ!' },
  { type: 'lucky_money', name: 'Lì Xì Bếp Trưởng', emoji: '🧧', badge: 'TIỀN THƯỞNG', desc: 'Nhận ngay $150 tiền boa từ thực khách sành ăn!' },
  { type: 'wild_substitute', name: 'Ảo Thuật Ẩm Thực', emoji: '✨', badge: 'NẤU LIỀU', desc: 'Thêm 1 Nguyên Liệu Ảo Thuật thay được bất kỳ món còn thiếu (kho đầy: +$200)!' },
];

const recipe = (id, name, likes, requires) => ({ id, name, likes, requires, isGourmet: requires.length === 3 });
const BASIC_RECIPES = [
  recipe('rec_banhmi', 'Bánh Mì Kẹp Thịt Chả', 2, ['Bánh Mì Sài Gòn', 'Rau Thơm & Dưa Leo']),
  recipe('rec_goicuon', 'Gỏi Cuốn Tôm Thịt', 2, ['Bánh Phở Tươi', 'Tôm Sú Tươi']),
  recipe('rec_comtam_trung', 'Cơm Tấm Trứng Ốp La', 2, ['Gạo Tấm Thơm', 'Trứng Gà Ta']),
  recipe('rec_buncha_cua', 'Bún Chả Cua Huế', 2, ['Bánh Phở Tươi', 'Rau Thơm & Dưa Leo']),
  recipe('rec_nemran', 'Nem Rán Hà Nội', 2, ['Bánh Phở Tươi', 'Thịt Ba Rọi']),
  recipe('rec_banhkhot', 'Bánh Khọt Vũng Tàu', 3, ['Gạo Tấm Thơm', 'Tôm Sú Tươi']),
  recipe('rec_banhmi_thitnuong', 'Bánh Mì Thịt Ba Rọi', 2, ['Bánh Mì Sài Gòn', 'Thịt Ba Rọi']),
  recipe('rec_goi_tom_xoai', 'Gỏi Tôm Xoài Cát Chua Cay', 3, ['Tôm Sú Tươi', 'Xoài Cát Hòa Lộc']),
  recipe('rec_cua_rangmuoi', 'Cua Biển Rang Muối Ớt', 3, ['Cua Biển Cà Mau', 'Chanh Ớt Tươi']),
  recipe('rec_trung_opla_banhmi', 'Bánh Mì Trứng Ốp La', 2, ['Bánh Mì Sài Gòn', 'Trứng Gà Ta']),
];
const GOURMET_RECIPES = [
  recipe('rec_pho', 'Phở Bò Tái Nạm Cung Đình', 5, ['Bánh Phở Tươi', 'Bắp Bò Tươi', 'Hồi Quế Thảo Mộc']),
  recipe('rec_bunbo', 'Bún Bò Giò Heo Cung Đình', 5, ['Bánh Phở Tươi', 'Bắp Bò Tươi', 'Mắm Ruốc Huế']),
  recipe('rec_comtam_suon', 'Cơm Tấm Sườn Cốt Lết', 5, ['Gạo Tấm Thơm', 'Sườn Heo Cốt Lết', 'Trứng Gà Ta']),
  recipe('rec_banhxeo', 'Bánh Xèo Tôm Nhảy Nước Dừa', 5, ['Gạo Tấm Thơm', 'Tôm Sú Tươi', 'Nước Cốt Dừa Bến Tre']),
  recipe('rec_laubo', 'Lẩu Bò Nhúng Dấm Thảo Mộc', 6, ['Bắp Bò Tươi', 'Hồi Quế Thảo Mộc', 'Bánh Phở Tươi']),
  recipe('rec_bokho', 'Bò Kho Bánh Mì Hồi Quế', 5, ['Bắp Bò Tươi', 'Bánh Mì Sài Gòn', 'Hồi Quế Thảo Mộc']),
  recipe('rec_cuahap_nuocdua', 'Cua Biển Hấp Nước Cốt Dừa', 5, ['Cua Biển Cà Mau', 'Nước Cốt Dừa Bến Tre', 'Hành Ngò Tươi']),
  recipe('rec_buncha_cuahap', 'Bún Chả Cua Nước Dừa Huế', 6, ['Bánh Phở Tươi', 'Cua Biển Cà Mau', 'Mắm Ruốc Huế']),
  recipe('rec_suon_nuong_chua_ngot', 'Sườn Nướng Xoài Cát Cung Đình', 5, ['Sườn Heo Cốt Lết', 'Xoài Cát Hòa Lộc', 'Chanh Ớt Tươi']),
];

// A table seats 2–8 members, one chef each; under 4 members the market chefs (bots) fill the table to 4.
// Every in-game day the chefs at the table play in TURN_ORDER (Cô Ba first, Mệ Thảo last), so at a
// two-member table Bếp Sáng (Cô Ba) plays in the morning, the bots at noon and Bếp Chiều (Mệ Thảo) at night.
const CHEFS = {
  lola: { name: 'Cô Ba Sài Gòn', avatar: '👩‍🍳', start: 'fruit', cards: ['steal_money', 'close_market'] },
  chen: { name: 'Chú Bảy Chợ Lớn', avatar: '👨‍🍳', start: 'vegetable', cards: [] },
  lucrezia: { name: 'Dì Năm Miền Tây', avatar: '👩‍🌾', start: 'carbs', cards: [] },
  hai: { name: 'Chị Hai Hội An', avatar: '👩‍🦰', start: 'fruit', cards: [] },
  sau: { name: 'Anh Sáu Hà Thành', avatar: '🧔', start: 'carbs', cards: ['lucky_money'] },
  tam: { name: 'Bà Tám Đất Cảng', avatar: '👩‍🦳', start: 'dairy', cards: [] },
  muoi: { name: 'Út Mười Tây Nguyên', avatar: '🧑‍🌾', start: 'mystery', cards: [] },
  angus: { name: 'Mệ Thảo Xứ Huế', avatar: '👵', start: 'chop', cards: ['steal_money'] },
};
const TURN_ORDER = Object.keys(CHEFS);
// who joins next gets the first free chef here; bots fill a small table in the same order
const SEAT_PICK = ['lola', 'angus', 'chen', 'lucrezia', 'hai', 'sau', 'tam', 'muoi'];
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MIN_CHEFS = 4;

const STARTING_DUMPSTER = ['Bánh Phở Tươi', 'Rau Thơm & Dưa Leo', 'Chanh Ớt Tươi', 'Gạo Tấm Thơm'];
const INCOME_PER_TIER = [200, 200, 250, 250, 300, 300];
const WIN_LIKES = 20;
const MAX_DAYS = 30;

module.exports = {
  MARKETS, MARKET_KEYS, ACTION_CARD_COST, UPGRADES, ACTION_CARDS, BASIC_RECIPES, GOURMET_RECIPES,
  CHEFS, TURN_ORDER, SEAT_PICK, MIN_PLAYERS, MAX_PLAYERS, MIN_CHEFS, STARTING_DUMPSTER, INCOME_PER_TIER, WIN_LIKES, MAX_DAYS,
};
