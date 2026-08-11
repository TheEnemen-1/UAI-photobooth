# AI Photobooth — Face Filter + Hand Gesture Trigger + QR Download

## 1. Cấu trúc project
```
photobooth/
├── server.js              # backend: lưu ảnh/video, sinh QR code
├── package.json
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js              # toàn bộ logic camera + CV (chạy trong trình duyệt)
│   └── assets/
│       ├── filters/         # <-- BỎ ẢNH FILTER MẶT VÀO ĐÂY
│       └── frames/           # <-- BỎ ẢNH FRAME VÀO ĐÂY
└── uploads/                # ảnh/video người dùng chụp sẽ lưu tại đây
```

## 2. Chạy thử
```bash
npm install
npm start
```
Mở trình duyệt tại `http://localhost:3000` trên máy có camera (laptop cắm
USB camera hoặc dùng webcam sẵn có đều được — trình duyệt liệt kê cả 2 loại
trong dropdown "Camera" ở góc trên).

> ⚠️ Camera trên trình duyệt **chỉ hoạt động qua HTTPS hoặc localhost**. Nếu
> deploy thật (không phải localhost), bạn cần HTTPS (ví dụ dùng Caddy/Nginx +
> Let's Encrypt, hoặc ngrok khi test).

## 3. Cách cung cấp ẢNH FILTER MẶT (để tôi/bạn add vào)

Bạn gửi cho tôi (hoặc tự bỏ vào `public/assets/filters/`) một file:

- **Định dạng:** PNG, **nền trong suốt** (transparent background) — bắt buộc,
  nếu không ảnh sẽ đè kín cả mặt.
- **Bố cục ảnh:** vẽ/canh sao cho **2 mắt của filter nằm ngang giữa ảnh**
  theo chiều rộng — vì code sẽ neo (anchor) ảnh theo đường nối 2 mắt thật
  của người dùng và tự scale theo khoảng cách 2 mắt, tự xoay theo góc
  nghiêng đầu. Nhờ vậy filter **tự fit với mọi khuôn mặt** (nam/nữ, to/nhỏ)
  mà không cần chỉnh tay từng người.
- **Kích thước gốc:** khuyến nghị ảnh vuông hoặc gần vuông, ví dụ 512x512 –
  1024x1024px, để không bị vỡ nét khi scale.
- Đặt file, ví dụ: `public/assets/filters/glasses.png`

Trong `app.js`, chỗ nạp filter mặc định (bạn có thể thay `filterInput`
bằng load sẵn 1 file cố định thay vì để user chọn):
```js
// Thay vì chờ user chọn file, load sẵn 1 filter cố định lúc khởi động:
filterImg = await loadImageFromUrl("/assets/filters/glasses.png");
```
(cần thêm hàm `loadImageFromUrl` tương tự `loadImageFile` nhưng dùng `img.src = url` trực tiếp)

Nếu ảnh filter của bạn không neo theo mắt mà theo vị trí khác (ví dụ vương
miện phải neo phía trên trán, tai thỏ phải neo 2 bên đầu...), báo tôi loại
filter cụ thể — mình sẽ đổi landmark neo trong hàm `drawFaceFilter()`
(hiện đang dùng landmark 33/263 = khoé mắt trái/phải, landmark 1 = đầu mũi;
FaceLandmarker có tổng cộng 478 điểm nên neo được ở bất kỳ vị trí nào trên
mặt: trán, cằm, tai, v.v.)

## 4. Cách cung cấp ẢNH FRAME (khung ghép cuối)

- Cũng là PNG nền trong suốt, kích thước đúng tỉ lệ khung hình chụp
  (mặc định code đang chụp theo tỉ lệ 3:4 — khớp với `aspect-ratio: 3/4`
  trong `style.css`). Nếu bạn dùng tỉ lệ khác (1:1, 9:16...) báo tôi để
  chỉnh lại canvas cho khớp.
- Frame sẽ được `drawImage` phủ toàn bộ lên trên ảnh cuối (logo, viền,
  text trang trí...) ở bước `capturePhoto()`.

## 5. Cơ chế nhận diện cử chỉ tay ("khung hình chữ nhật" kiểu Son Heung Min)

- Dùng MediaPipe HandLandmarker nhận diện tối đa 2 tay.
- Với **mỗi tay riêng biệt** (không cần 2 tay chạm nhau, tách xa nhau vẫn
  được — đúng như bạn mô tả): kiểm tra ngón cái + ngón trỏ **duỗi thẳng**,
  3 ngón còn lại **gập lại**, và góc giữa ngón cái–ngón trỏ tại cổ tay nằm
  trong khoảng ~55°–130° (tạo dáng chữ "L" giống góc khung ảnh).
- Khi **cả 2 tay** cùng đạt dáng đó **liên tục 1 giây** → bắt đầu đếm
  ngược 3 giây → hết đếm ngược thì chụp ảnh, đồng thời video được quay
  **đúng trong khoảng 3 giây đếm ngược đó** (video 3s ngay trước lúc chụp).
- Bạn có thể tinh chỉnh độ nhạy tại các hằng số đầu file `app.js`:
  `HOLD_MS` (thời gian giữ tư thế), `COUNTDOWN_S` (thời gian đếm ngược),
  và ngưỡng góc trong `isSingleHandFrameShape()`.

## 6. Luồng QR code

- Sau khi chụp, ảnh + video được upload lên `/api/save`.
- Server lưu vào `uploads/<sessionId>/photo.png` và `video.webm`, sinh QR
  code trỏ tới `http://<IP-LAN-máy-chủ>:3000/d/<sessionId>` — trang này
  cho phép xem & tải cả ảnh lẫn video.
- **Lưu ý:** để điện thoại khách quét QR mở được, điện thoại phải **cùng
  mạng Wi-Fi** với máy chạy server (vì code tự lấy IP LAN). Nếu deploy lên
  server thật có domain/HTTPS, đặt biến môi trường `BASE_URL`, ví dụ:
  ```bash
  BASE_URL=https://photobooth.mysite.com PORT=3000 npm start
  ```

## 7. Việc cần làm tiếp theo (gợi ý)
- [ ] Gửi ảnh filter mặt thật (PNG nền trong suốt) để mình ghép cố định.
- [ ] Gửi ảnh frame trang trí cuối để mình ghép cố định.
- [ ] Nếu muốn nhiều filter/frame để chọn (không chỉ 1 filter cố định),
      mình có thể làm thêm màn hình chọn trước khi vào camera.
- [ ] Deploy: cần HTTPS cho domain thật; nếu chỉ dùng nội bộ sự kiện (LAN),
      chạy `npm start` trên 1 máy là đủ, các máy khác vào bằng IP LAN.
