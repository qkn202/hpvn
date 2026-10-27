# 🍲 Vua Đầu Bếp Việt Nam - Đại Chiến Ẩm Thực 3D

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Demo-success?style=for-the-badge&logo=github)](https://qkn202.github.io/hpvn/)
[![Three.js](https://img.shields.io/badge/Three.js-WebGL%203D-black?style=for-the-badge&logo=three.js)](https://threejs.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)

Một tựa game cờ bàn chiến thuật ẩm thực 3D (Culinary Battle Board Game) thuần Việt, nơi người chơi bước vào cuộc đua tranh tài tại Chợ Bến Thành để trở thành Bếp Trưởng Huyền Thoại!

Trải nghiệm ngay bản phát hành trực tuyến tại: 👉 **[https://qkn202.github.io/hpvn/](https://qkn202.github.io/hpvn/)**

---

## 🌟 Tính Năng Nổi Bật

- **Đồ họa 3D tương tác**: Được xây dựng trên nền tảng **Three.js** kết hợp giao diện responsive với **Tailwind CSS**, tối ưu hóa cho cả desktop lẫn thiết bị di động.
- **Hoạt động độc lập hoàn toàn (Self-contained)**: Toàn bộ engine, logic, CSS và tài nguyên hình ảnh được đóng gói gọn gàng, không phụ thuộc vào CDN bên ngoài hay máy chủ backend phức tạp.
- **11 món ăn truyền thống Việt Nam**:
  - Phở Bò, Bún Bò Huế, Bún Chả Cua
  - Bánh Mì Sài Gòn, Bánh Xèo, Bánh Khọt
  - Cơm Tấm Sườn, Cơm Tấm Trứng
  - Nem Rán, Gỏi Cuốn, Lẩu Bò
- **3 Giai đoạn thi đấu kịch tính mỗi vòng**:
  1. **Giai đoạn 1 - Đến chợ mua đồ**: Lựa chọn quầy chợ mục tiêu và di chuyển chiến thuật.
  2. **Giai đoạn 2 - Mua Sắm & Thương Lượng**: Thu thập nguyên liệu tại Chợ Bến Thành, đấu giá tài nguyên và trao đổi tự do cùng 3 đối thủ.
  3. **Giai đoạn 3 - Nấu Món & Phục Vụ**: Hoàn thiện các món ăn danh tiếng khi gom đủ nguyên liệu để tích lũy Sao (⭐ Likes) và Tiền thưởng.
- **Kho thẻ hành động & Nâng cấp bếp**: Sử dụng thẻ kỹ năng đặc biệt và mua sắm trang thiết bị nâng cấp vĩnh viễn cho căn bếp.

---

## 🎮 Cách Chơi

### 1. Chơi trực tiếp trên trình duyệt (Khuyến nghị)
👉 Truy cập ngay: **[https://qkn202.github.io/hpvn/](https://qkn202.github.io/hpvn/)**

### 2. Chạy trên máy cục bộ (Offline)
1. Clone mã nguồn về máy:
   ```bash
   git clone https://github.com/qkn202/hpvn.git
   ```
2. Mở trực tiếp tệp `index.html` bằng bất kỳ trình duyệt web nào (Chrome, Safari, Edge, Firefox).

---

## 📁 Cấu Trúc Thư Mục

```
hpvn/
├── index.html           # Toàn bộ mã nguồn giao diện, 3D Canvas và logic game
├── images/
│   └── dishes/          # Hình ảnh minh họa 11 món ăn đặc sắc
├── hpvn.js              # Lớp HPVN: bàn chơi nhiều người qua máy chủ HPVN (chỉ bật khi mở trong HPVN)
├── server/              # Engine lượt chơi bàn HPVN chạy trên máy chủ (data, rules, bots, engine + test)
├── scripts/             # build-hpvn (xuất dist/) và test-hpvn-core (kiểm tra lớp HPVN)
├── .gitignore           # Cấu hình bỏ qua tệp rác hệ thống
└── README.md            # Tài liệu giới thiệu và hướng dẫn chơi
```

Kiểm tra: `npm run test:hpvn` (lớp HPVN), `npm run test:engine` (engine máy chủ, Node ≥ 22). Mỗi lần sửa `hpvn.js` phải cập nhật `?v=` trong `index.html` (10 ký tự đầu sha256 của `hpvn.js`), `test:hpvn` báo giá trị đúng.

---

## 📜 Bản Quyền & Giấy Phép
Dự án được phát triển phục vụ mục đích giải trí và trải nghiệm văn hóa ẩm thực Việt Nam.
