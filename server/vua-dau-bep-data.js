'use strict';

// Vua Đầu Bếp Việt Nam — Authentic Rival Restaurants (Gap Closer Games) Catalog.
// Shared single source of truth for the server turn engine, bots, and rules.
// 6 Markets (Shelf Deck + 3 Face-Up Counter Slots) + The Island (Chợ Bến Thành),
// 8 Separate Restaurants (Specialty Cuisine +1⭐ & Level-Up Bonuses at 3/7/12⭐),
// 8 Separate Chefs (Authentic Powers disabled at The Island & Mystery Mart),
// Authentic Mystery Mart specials (Wine, Secret Sauce, Tofu, Chocolate, Alien Goo),
// Garbage Tokens, Double Cooktop, Marketing Upgrades, and 1-Card/Day Action Deck.

const MARKETS = {
  fruit: {
    name: 'Chợ Hoa Quả Miền Tây',
    shortName: 'Chợ Hoa Quả',
    cost: 100,
    emoji: '🍉',
    cards: [
      { name: 'Xoài Cát Hòa Lộc', cost: 100, emoji: '🥭', type: 'fruit', copies: 5 },
      { name: 'Dưa Hấu Long An', cost: 100, emoji: '🍉', type: 'fruit', copies: 4 },
      { name: 'Chanh Ớt Tươi', cost: 100, emoji: '🍋', type: 'fruit', copies: 5 },
    ],
  },
  vegetable: {
    name: 'Chợ Rau Củ Đà Lạt',
    shortName: 'Rau Củ Đà Lạt',
    cost: 100,
    emoji: '🥗',
    cards: [
      { name: 'Rau Thơm & Dưa Leo', cost: 100, emoji: '🥒', type: 'veg', copies: 5 },
      { name: 'Giá Đỗ & Hẹ', cost: 100, emoji: '🌿', type: 'veg', copies: 4 },
      { name: 'Hành Ngò Tươi', cost: 100, emoji: '🧅', type: 'veg', copies: 5 },
    ],
  },
  carbs: {
    name: 'Chợ Gạo & Bánh Phở',
    shortName: 'Gạo & Bánh Phở',
    cost: 100,
    emoji: '🌾',
    cards: [
      { name: 'Bánh Mì Sài Gòn', cost: 100, emoji: '🥖', type: 'carbs', copies: 5 },
      { name: 'Bánh Phở Tươi', cost: 100, emoji: '🍜', type: 'carbs', copies: 6 },
      { name: 'Gạo Tấm Thơm', cost: 100, emoji: '🍚', type: 'carbs', copies: 5 },
    ],
  },
  chop: {
    name: 'Lò Mổ & Hàng Thịt Tươi',
    shortName: 'Hàng Thịt Tươi',
    cost: 200,
    emoji: '🥩',
    cards: [
      { name: 'Thịt Ba Rọi', cost: 200, emoji: '🥓', type: 'meat', copies: 5 },
      { name: 'Sườn Heo Cốt Lết', cost: 200, emoji: '🍖', type: 'meat', copies: 5 },
      { name: 'Bắp Bò Tươi', cost: 200, emoji: '🥩', type: 'meat', copies: 6 },
    ],
  },
  dairy: {
    name: 'Vựa Hải Sản Vũng Tàu',
    shortName: 'Hải Sản Vũng Tàu',
    cost: 200,
    emoji: '🦐',
    cards: [
      { name: 'Tôm Sú Tươi', cost: 200, emoji: '🦐', type: 'seafood', copies: 6 },
      { name: 'Cua Biển Cà Mau', cost: 200, emoji: '🦀', type: 'seafood', copies: 5 },
      { name: 'Trứng Gà Ta', cost: 200, emoji: '🥚', type: 'dairy', copies: 5 },
    ],
  },
  mystery: {
    name: 'Phố Gia Vị Huyền Bí',
    shortName: 'Phố Gia Vị',
    cost: 300,
    emoji: '🌿',
    cards: [
      { name: 'Hồi Quế Thảo Mộc', cost: 300, emoji: '🍂', type: 'mystery', copies: 4, special: '' },
      { name: 'Mắm Ruốc Huế', cost: 300, emoji: '🏺', type: 'mystery', copies: 4, special: '' },
      { name: 'Nước Cốt Dừa Bến Tre', cost: 300, emoji: '🥥', type: 'mystery', copies: 4, special: '' },
      // Official Rival Restaurants Mystery Mart Special Items:
      { name: 'Rượu Nếp Cẩm', cost: 300, emoji: '🍷', type: 'wine', copies: 2, special: 'Thêm vào Món Đặc Sản khi nấu để +1⭐ (tối đa 1/món).' },
      { name: 'Sốt Bí Truyền', cost: 300, emoji: '🥫', type: 'secret_sauce', copies: 2, special: 'Thêm vào Món Cơ Bản khi nấu để +1⭐ (tối đa 1/món).' },
      { name: 'Đậu Hũ Hoàng Gia', cost: 300, emoji: '🧈', type: 'tofu', copies: 2, special: 'Thay thế mọi nguyên liệu Thịt và giảm -1 Rác Bếp khi nấu!' },
      { name: 'Sô-cô-la Đặc Sản', cost: 300, emoji: '🍫', type: 'chocolate', copies: 2, special: 'Không nấu được — mang tới Chợ Bến Thành bán lấy $500!' },
      { name: 'Gia Vị Ảo Thuật', cost: 300, emoji: '✨', type: 'wild', copies: 2, special: 'Thay thế bất kỳ 1 nguyên liệu bắt buộc nào khi nấu món!' },
    ],
  },
  // The Island: Upgrades, Action Cards, Garbage Disposal ($100), Chocolate Sale ($500), Discard Tray
  island: { name: 'Chợ Bến Thành (Đảo Trung Tâm)', shortName: 'Chợ Bến Thành', cost: 0, emoji: '🏮', cards: [] },
};

const MARKET_KEYS = ['fruit', 'vegetable', 'carbs', 'chop', 'dairy', 'mystery'];
const COUNTER_SLOTS = 3;

const BASE_DAILY_INCOME = 300;
const ACTION_CARD_COST = 200;
const GARBAGE_DISPOSAL_COST = 100;
const CHOCOLATE_SELL_VALUE = 500;
const WIN_LIKES = 20;
const MAX_DAYS = 30;
const MAX_UPGRADES = 4;

// Authentic Rival Restaurants Upgrades (Max 4 clipped onto Mat, no duplicates)
const UPGRADES = [
  { id: 'upg_double_cooktop', name: 'Bếp Đôi Công Nghiệp', cost: 300, icon: '🔥', clipColor: '#ef4444',
    desc: 'Cho phép nấu CẢ 2 MÓN (Cơ Bản + Đặc Sản) cùng lúc trong 1 ngày (mặc định chỉ nấu 1 món/ngày)!' },
  { id: 'upg_marketing', name: 'Quảng Cáo Truyền Thông', cost: 300, icon: '📣', clipColor: '#f59e0b',
    desc: 'Tăng vĩnh viễn +$100 thu nhập nền mỗi sáng ($300 → $400).' },
  { id: 'upg_celebrity', name: 'KOL & Truyền Hình Ẩm Thực', cost: 400, icon: '🌟', clipColor: '#a855f7',
    desc: 'Tăng +$150 thu nhập nền mỗi sáng; khi bếp sạch rác (0 rác), mỗi món nấu +1⭐!' },
  { id: 'upg_freezer', name: 'Tủ Đông Công Nghiệp', cost: 200, icon: '🧊', clipColor: '#0ea5e9',
    desc: 'Mở rộng sức chứa kho từ 5 lên 8 nguyên liệu.' },
  { id: 'upg_vip', name: 'Thẻ VIP Chợ Sỉ', cost: 300, icon: '🏷️', clipColor: '#10b981',
    desc: 'Giảm $50 mọi nguyên liệu mua tại 6 chợ (tối thiểu $50).' },
  { id: 'upg_delivery', name: 'Xe Giao Hàng Siêu Tốc', cost: 250, icon: '🛵', clipColor: '#06b6d4',
    desc: 'Mỗi ngày mua thêm 1 thẻ nguyên liệu từ xa tại 1 chợ khác đang mở.' },
  { id: 'upg_bouncer', name: 'Bảo Vệ Quán 24/7', cost: 200, icon: '🛡️', clipColor: '#64748b',
    desc: '50% tỉ lệ chặn đứng các thẻ phá hoại (cướp tiền, trộm đồ, đổ rác).' },
];

// Authentic Rival Restaurants Action Cards (Kept secret, strictly max 1 played per day)
const ACTION_CARDS = [
  { type: 'steal_money', name: 'Cướp Khách Giờ Vàng', emoji: '🦹', badge: 'CƯỚP TIỀN',
    desc: 'Kéo khách và lấy $100 từ 1 quán đối thủ (Bảo Vệ chặn 50%)!' },
  { type: 'steal_item', name: 'Mượn Tạm Nguyên Liệu', emoji: '🥢', badge: 'TRỘM ĐỒ',
    desc: 'Bốc trộm 1 nguyên liệu ngẫu nhiên từ kho đối thủ (Bảo Vệ chặn 50%)!' },
  { type: 'close_market', name: 'Phong Tỏa VSATTP', emoji: '🛑', badge: 'PHONG TỎA',
    desc: 'Phong tỏa 1 quầy chợ trọn một vòng: không ai mua được hàng ở đó!' },
  { type: 'kick_opponent', name: 'Cưỡng Chế Đổi Chợ', emoji: '🛵', badge: 'ĐUỔI CHỢ',
    desc: 'Đuổi 1 đối thủ đứng cùng chợ văng sang quầy chợ khác ngay lập tức!' },
  { type: 'dump_garbage', name: 'Đổ Rác Sang Hàng Xóm', emoji: '🗑️', badge: 'DÍ RÁC',
    desc: 'Chuyển 1 Túi Rác của bạn (hoặc tạo 1 Túi Rác mới) sang bếp đối thủ (-1⭐ khi nấu)!' },
  { type: 'five_star_review', name: 'Đánh Giá 5 Sao', emoji: '⭐', badge: 'CỘNG SAO',
    desc: 'Món ăn tiếp theo bạn nấu trong hôm nay được thưởng nóng +2⭐ Danh Tiếng!' },
  { type: 'lucky_money', name: 'Lì Xì Bếp Trưởng', emoji: '🧧', badge: 'TIỀN THƯỞNG',
    desc: 'Thực khách sành ăn thưởng nóng ngay +$200 tiền mặt!' },
  { type: 'wild_substitute', name: 'Ảo Thuật Ẩm Thực', emoji: '✨', badge: 'NGUYÊN LIỆU WILD',
    desc: 'Thêm 1 Gia Vị Ảo Thuật (thay mọi nguyên liệu bắt buộc; kho đầy đổi +$200)!' },
];

// 8 Authentic Vietnamese Restaurants (Separate from Chefs! Each has Specialty Cuisine +1⭐ & 3/7/12⭐ Level-Ups)
const RESTAURANTS = {
  rest_pho_saigon: {
    id: 'rest_pho_saigon',
    name: 'Bếp Cô Ba • Phở & Bánh Mì',
    shortName: 'Phở & Bánh Mì',
    icon: '🍲🥖',
    cuisine: 'banh_mi',
    cuisineLabel: 'Bánh Mì & Đường Phố',
    colorHex: '#ec4899',
    milestones: {
      3: { label: '+$150 vốn quay vòng', effect: 'cash', amount: 150 },
      7: { label: 'Nhận ngay 1 Gia Vị Ảo Thuật ✨', effect: 'wild', amount: 1 },
      12: { label: 'Dọn sạch Rác & Bốc 1 Thẻ Hành Động', effect: 'card_and_clean', amount: 3 },
    },
  },
  rest_bunbo_hue: {
    id: 'rest_bunbo_hue',
    name: 'Bún Bò Cung Đình Xứ Huế',
    shortName: 'Bún Bò Huế',
    icon: '🍜🌶️',
    cuisine: 'cung_dinh',
    cuisineLabel: 'Ẩm Thực Cung Đình',
    colorHex: '#dc2626',
    milestones: {
      3: { label: 'Bốc miễn phí 1 Thẻ Hành Động', effect: 'card', amount: 1 },
      7: { label: 'Dọn sạch toàn bộ Rác & +$100', effect: 'clean_all_cash', amount: 100 },
      12: { label: 'Dọn sạch Rác & +1 Gia Vị Ảo Thuật ✨', effect: 'clean_and_wild', amount: 1 },
    },
  },
  rest_comtam: {
    id: 'rest_comtam',
    name: 'Cơm Tấm Ba Ghiền Sài Gòn',
    shortName: 'Cơm Tấm Sườn',
    icon: '🍚🍖',
    cuisine: 'com_nuong',
    cuisineLabel: 'Cơm Tấm & Đồ Nướng',
    colorHex: '#0d9488',
    milestones: {
      3: { label: 'Nhận ngay 1 Gia Vị Ảo Thuật ✨', effect: 'wild', amount: 1 },
      7: { label: 'Mở rộng kho +1 ô & +$100', effect: 'pantry_and_cash', amount: 100 },
      12: { label: 'Dọn sạch Rác & +1 Gia Vị Ảo Thuật ✨', effect: 'clean_and_wild', amount: 1 },
    },
  },
  rest_banhxeo: {
    id: 'rest_banhxeo',
    name: 'Bánh Xèo & Gỏi Cuốn Miền Tây',
    shortName: 'Bánh Xèo Miền Tây',
    icon: '🥞🦐',
    cuisine: 'mien_tay',
    cuisineLabel: 'Đặc Sản Miền Tây',
    colorHex: '#eab308',
    milestones: {
      3: { label: 'Nhận ngay 1 Gia Vị Ảo Thuật ✨', effect: 'wild', amount: 1 },
      7: { label: 'Giảm $50 mọi lần mua chợ', effect: 'discount', amount: 50 },
      12: { label: '+$200 tiền mặt & Dọn sạch 2 Rác', effect: 'cash_and_clean2', amount: 200 },
    },
  },
  rest_phohoi: {
    id: 'rest_phohoi',
    name: 'Cao Lầu & Mì Quảng Phố Hội',
    shortName: 'Cao Lầu Phố Hội',
    icon: '🏮🥢',
    cuisine: 'pho_hoi',
    cuisineLabel: 'Món Quê Phố Hội',
    colorHex: '#8b5cf6',
    milestones: {
      3: { label: 'Dọn sạch Rác & +$100', effect: 'clean_all_cash', amount: 100 },
      7: { label: 'Bốc 1 Thẻ Hành Động & +$100', effect: 'card_and_cash', amount: 100 },
      12: { label: 'Dọn sạch Rác & +1 Gia Vị Ảo Thuật ✨', effect: 'clean_and_wild', amount: 1 },
    },
  },
  rest_hanoi: {
    id: 'rest_hanoi',
    name: 'Phở Gánh Hàng Chiếu Hà Thành',
    shortName: 'Phở Hà Thành',
    icon: '🌙🍲',
    cuisine: 'pho_bun',
    cuisineLabel: 'Phở & Bún Truyền Thống',
    colorHex: '#2563eb',
    milestones: {
      3: { label: '+$150 tiền mặt', effect: 'cash', amount: 150 },
      7: { label: 'Dọn 1 Rác & +$150 tiền mặt', effect: 'cash_and_clean', amount: 150 },
      12: { label: 'Dọn sạch Rác & +1 Gia Vị Ảo Thuật ✨', effect: 'clean_and_wild', amount: 1 },
    },
  },
  rest_haiphong: {
    id: 'rest_haiphong',
    name: 'Bánh Đa Cua & Hải Sản Đất Cảng',
    shortName: 'Hải Sản Đất Cảng',
    icon: '🦀🔥',
    cuisine: 'hai_san',
    cuisineLabel: 'Hải Sản Tươi Sống',
    colorHex: '#f97316',
    milestones: {
      3: { label: 'Giảm $50 ở Vựa Hải Sản', effect: 'seafood_discount', amount: 50 },
      7: { label: 'Nhận ngay 1 Gia Vị Ảo Thuật ✨', effect: 'wild', amount: 1 },
      12: { label: 'Dọn sạch Rác & +1 Gia Vị Ảo Thuật ✨', effect: 'clean_and_wild', amount: 1 },
    },
  },
  rest_taynguyen: {
    id: 'rest_taynguyen',
    name: 'Cơm Lam & Lẩu Nướng Cao Nguyên',
    shortName: 'Ẩm Thực Cao Nguyên',
    icon: '🎋🍗',
    cuisine: 'tay_nguyen',
    cuisineLabel: 'Lẩu & Nướng Cao Nguyên',
    colorHex: '#65a30d',
    milestones: {
      3: { label: 'Mở rộng kho +1 ô & +$100', effect: 'pantry_and_cash', amount: 100 },
      7: { label: '+$100 thu nhập mỗi ngày', effect: 'income', amount: 100 },
      12: { label: 'Dọn sạch Rác & 1 Gia Vị Ảo Thuật ✨', effect: 'clean_and_wild', amount: 1 },
    },
  },
};
const RESTAURANT_IDS = Object.keys(RESTAURANTS);

// Authentic Recipes (Basic = 1-3⭐, 1 garbage; Gourmet = 4-6⭐, 2 garbage)
// Balanced: EXACTLY 3 specialty recipes per cuisine across all 8 Vietnamese Restaurants!
const recipe = (id, name, likes, requires, cuisine, garbage) => ({
  id, name, likes, requires, cuisine, garbage, isGourmet: requires.length === 3,
});

const BASIC_RECIPES = [
  recipe('rec_banhmi', 'Bánh Mì Kẹp Thịt Chả', 2, ['Bánh Mì Sài Gòn', 'Rau Thơm & Dưa Leo'], 'banh_mi', 1),
  recipe('rec_goicuon', 'Gỏi Cuốn Tôm Thịt', 2, ['Bánh Phở Tươi', 'Tôm Sú Tươi'], 'mien_tay', 1),
  recipe('rec_comtam_trung', 'Cơm Tấm Trứng Ốp La', 2, ['Gạo Tấm Thơm', 'Trứng Gà Ta'], 'com_nuong', 1),
  recipe('rec_comtam_bicha', 'Cơm Tấm Ba Rọi Nướng', 3, ['Gạo Tấm Thơm', 'Thịt Ba Rọi'], 'com_nuong', 1),
  recipe('rec_buncha_cua', 'Bún Chả Cua Huế', 2, ['Bánh Phở Tươi', 'Rau Thơm & Dưa Leo'], 'cung_dinh', 1),
  recipe('rec_nemran', 'Nem Rán Hà Nội', 2, ['Bánh Phở Tươi', 'Thịt Ba Rọi'], 'pho_bun', 1),
  recipe('rec_banhkhot', 'Bánh Khọt Vũng Tàu', 3, ['Gạo Tấm Thơm', 'Tôm Sú Tươi'], 'hai_san', 1),
  recipe('rec_banhmi_thitnuong', 'Bánh Mì Thịt Ba Rọi', 2, ['Bánh Mì Sài Gòn', 'Thịt Ba Rọi'], 'banh_mi', 1),
  recipe('rec_goi_tom_xoai', 'Gỏi Tôm Xoài Cát Chua Cay', 3, ['Tôm Sú Tươi', 'Xoài Cát Hòa Lộc'], 'mien_tay', 1),
  recipe('rec_cua_rangmuoi', 'Cua Biển Rang Muối Ớt', 3, ['Cua Biển Cà Mau', 'Chanh Ớt Tươi'], 'hai_san', 1),
  recipe('rec_trung_opla_banhmi', 'Bánh Mì Trứng Ốp La', 2, ['Bánh Mì Sài Gòn', 'Trứng Gà Ta'], 'pho_hoi', 1),
  recipe('rec_pho_tron', 'Phở Trộn Rau Thơm Hà Nội', 2, ['Bánh Phở Tươi', 'Giá Đỗ & Hẹ'], 'pho_bun', 1),
  recipe('rec_suon_cham_ot', 'Sườn Nướng Chanh Ớt Cao Nguyên', 3, ['Sườn Heo Cốt Lết', 'Chanh Ớt Tươi'], 'tay_nguyen', 1),
  recipe('rec_suon_hanh_ngo', 'Sườn Nướng Hành Ngò Tây Nguyên', 3, ['Sườn Heo Cốt Lết', 'Hành Ngò Tươi'], 'tay_nguyen', 1),
];

const GOURMET_RECIPES = [
  recipe('rec_pho', 'Phở Bò Tái Nạm Cung Đình', 5, ['Bánh Phở Tươi', 'Bắp Bò Tươi', 'Hồi Quế Thảo Mộc'], 'pho_bun', 2),
  recipe('rec_bunbo', 'Bún Bò Giò Heo Cung Đình', 5, ['Bánh Phở Tươi', 'Bắp Bò Tươi', 'Mắm Ruốc Huế'], 'cung_dinh', 2),
  recipe('rec_comtam_suon', 'Cơm Tấm Sườn Cốt Lết', 5, ['Gạo Tấm Thơm', 'Sườn Heo Cốt Lết', 'Trứng Gà Ta'], 'com_nuong', 2),
  recipe('rec_banhxeo', 'Bánh Xèo Tôm Nhảy Nước Dừa', 5, ['Gạo Tấm Thơm', 'Tôm Sú Tươi', 'Nước Cốt Dừa Bến Tre'], 'mien_tay', 2),
  recipe('rec_laubo', 'Lẩu Bò Nhúng Dấm Thảo Mộc', 6, ['Bắp Bò Tươi', 'Hồi Quế Thảo Mộc', 'Bánh Phở Tươi'], 'tay_nguyen', 2),
  recipe('rec_bokho', 'Bò Kho Bánh Mì Hồi Quế', 5, ['Bắp Bò Tươi', 'Bánh Mì Sài Gòn', 'Hồi Quế Thảo Mộc'], 'banh_mi', 2),
  recipe('rec_cuahap_nuocdua', 'Cua Biển Hấp Nước Cốt Dừa', 5, ['Cua Biển Cà Mau', 'Nước Cốt Dừa Bến Tre', 'Hành Ngò Tươi'], 'hai_san', 2),
  recipe('rec_buncha_cuahap', 'Bún Chả Cua Nước Dừa Huế', 6, ['Bánh Phở Tươi', 'Cua Biển Cà Mau', 'Mắm Ruốc Huế'], 'cung_dinh', 2),
  recipe('rec_suon_nuong_chua_ngot', 'Sườn Nướng Xoài Cát Phố Hội', 5, ['Sườn Heo Cốt Lết', 'Xoài Cát Hòa Lộc', 'Chanh Ớt Tươi'], 'pho_hoi', 2),
  recipe('rec_caolau_phohoi', 'Cao Lầu Thịt Xá Xíu Phố Hội', 5, ['Bánh Phở Tươi', 'Thịt Ba Rọi', 'Hành Ngò Tươi'], 'pho_hoi', 2),
];

// 8 Chefs (preserving seat IDs for 2-8 player HPVN compatibility).
// Authentic Rival Restaurants Rule: Market Chef Powers do NOT apply at The Island or Mystery Mart!
const CHEFS = {
  lola: {
    name: 'Cô Ba Sài Gòn', short: 'Cô Ba', avatar: '👩‍🍳', start: 'fruit', colorHex: '#ec4899',
    defaultRestaurant: 'rest_pho_saigon',
    cards: ['steal_money', 'close_market'],
    powerName: 'Thu Phí Bến Bãi (Surcharge)',
    powerDesc: 'Đối thủ mua hàng cùng chợ thường với Cô Ba phải nộp phụ phí +$50 cho Cô Ba (không tác dụng ở Đảo/Phố Gia Vị); nhận +$50 mỗi sáng.',
  },
  chen: {
    name: 'Chú Bảy Chợ Lớn', short: 'Chú Bảy', avatar: '👨‍🍳', start: 'vegetable', colorHex: '#0d9488',
    defaultRestaurant: 'rest_comtam',
    cards: [],
    powerName: 'Mối Ruột Hàng Thịt',
    powerDesc: 'Giảm $100 khi mua nguyên liệu tại Hàng Thịt Tươi (chợ thịt).',
  },
  lucrezia: {
    name: 'Dì Năm Miền Tây', short: 'Dì Năm', avatar: '👩‍🌾', start: 'carbs', colorHex: '#eab308',
    defaultRestaurant: 'rest_banhxeo',
    cards: [],
    powerName: 'Tay Bốc Kệ Úp',
    powerDesc: 'Mua úp từ Kệ Úp tại 5 chợ thường được giảm $50 (tối thiểu $50); khởi đầu thêm 1 Rau Thơm.',
  },
  hai: {
    name: 'Chị Hai Hội An', short: 'Chị Hai', avatar: '👩‍🦰', start: 'fruit', colorHex: '#8b5cf6',
    defaultRestaurant: 'rest_phohoi',
    cards: [],
    powerName: 'Chợ Sớm Phố Hội',
    powerDesc: 'Giảm $50 khi mua nguyên liệu ở Chợ Hoa Quả và Chợ Rau Củ.',
  },
  sau: {
    name: 'Anh Sáu Hà Thành', short: 'Anh Sáu', avatar: '🧔', start: 'carbs', colorHex: '#2563eb',
    defaultRestaurant: 'rest_hanoi',
    cards: [],
    powerName: 'Gánh Phở Gia Truyền',
    powerDesc: 'Mỗi món nấu xong nhận thêm +$50 tiền mặt thưởng từ thực khách sành ăn.',
  },
  tam: {
    name: 'Bà Tám Đất Cảng', short: 'Bà Tám', avatar: '👩‍🦳', start: 'dairy', colorHex: '#f97316',
    defaultRestaurant: 'rest_haiphong',
    cards: [],
    powerName: 'Mối Ruột Vựa Hải Sản',
    powerDesc: 'Giảm $100 khi mua nguyên liệu tại Vựa Hải Sản Vũng Tàu.',
  },
  muoi: {
    name: 'Út Mười Tây Nguyên', short: 'Út Mười', avatar: '🧑‍🌾', start: 'mystery', colorHex: '#65a30d',
    defaultRestaurant: 'rest_taynguyen',
    cards: [],
    powerName: 'Gùi Tre Rộng',
    powerDesc: 'Kho chứa thêm +1 ô nguyên liệu và nhận thêm +$50 mỗi sáng.',
  },
  angus: {
    name: 'Mệ Thảo Xứ Huế', short: 'Mệ Thảo', avatar: '👵', start: 'chop', colorHex: '#dc2626',
    defaultRestaurant: 'rest_bunbo_hue',
    cards: ['steal_money'],
    powerName: 'Đuổi Chợ (Wok Away)',
    powerDesc: '1 lần/ngày tại 5 chợ thường (không tác dụng ở Đảo/Phố Gia Vị): đuổi 1 đối thủ ra khỏi chợ của Mệ Thảo!',
  },
};

const TURN_ORDER = Object.keys(CHEFS);
const SEAT_PICK = ['lola', 'angus', 'chen', 'lucrezia', 'hai', 'sau', 'tam', 'muoi'];
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MIN_CHEFS = 4;

const STARTING_DUMPSTER = ['Bánh Phở Tươi', 'Rau Thơm & Dưa Leo', 'Chanh Ớt Tươi', 'Gạo Tấm Thơm'];
// Keep legacy export name INCOME_PER_TIER for compatibility (authentic Rival Restaurants uses $300 baseline + Marketing)
const INCOME_PER_TIER = [300, 300, 300, 300, 300, 300];
const MILESTONE_POINTS = [3, 7, 12];

module.exports = {
  MARKETS, MARKET_KEYS, COUNTER_SLOTS,
  BASE_DAILY_INCOME, ACTION_CARD_COST, GARBAGE_DISPOSAL_COST, CHOCOLATE_SELL_VALUE,
  UPGRADES, MAX_UPGRADES, ACTION_CARDS,
  RESTAURANTS, RESTAURANT_IDS, MILESTONE_POINTS,
  BASIC_RECIPES, GOURMET_RECIPES,
  CHEFS, TURN_ORDER, SEAT_PICK, MIN_PLAYERS, MAX_PLAYERS, MIN_CHEFS,
  STARTING_DUMPSTER, INCOME_PER_TIER, WIN_LIKES, MAX_DAYS,
};
