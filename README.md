# 📸 AI Photobooth - Gesture Trigger & Beauty Filter

Dự án Photobooth thông minh sử dụng trí tuệ nhân tạo (Computer Vision) để nhận diện cử chỉ tay, tự động chụp series 4 ảnh và áp dụng bộ lọc làm đẹp chuẩn Hàn Quốc.

## ✨ Tính năng nổi bật
- **AI Hand Gesture:** Nhận diện cử chỉ 2 tay hình chữ L (khung ảnh) để bắt đầu chụp.
- **Beauty Filter:** Tự động làm mịn da, nâng tông trắng hồng và tăng sáng cho ảnh.
- **Auto-Capture:** Chụp liên tục 4 tấm ảnh với đồng hồ đếm ngược 3 giây cho mỗi tấm.
- **QR Code Download:** Sinh mã QR tại chỗ để tải ảnh về điện thoại (hỗ trợ mạng LAN).
- **Modern UI:** Giao diện tone Xanh lam - Cam hiện đại, trực quan.

## 🛠 Công nghệ sử dụng
- **Backend:** Python Flask
- **AI/CV:** MediaPipe (Hand Landmarker), OpenCV
- **Frontend:** JavaScript (ES6 Modules), CSS3, HTML5
- **QR System:** Python qrcode library

## 📋 Yêu cầu hệ thống
- Python 3.8 trở lên
- Webcam (Tích hợp hoặc USB)
- Kết nối mạng WiFi (Nếu muốn dùng tính năng tải ảnh qua QR)

## 🚀 Hướng dẫn cài đặt

**Cài đặt thư viện:**
  ```bash
  pip install flask opencv-python mediapipe qrcode pillow
  pip install -r requirements.txt

1. Cấu trúc thư mục:
Đảm bảo cấu trúc thư mục như sau:
UAI-PHOTOBOOTH/
├── static/              # Chứa file tĩnh
│   ├── app.js           # (Cập nhật code mới)
│   └── style.css        # (Cập nhật tone Xanh - Cam)
├── templates/           # Chứa file HTML
│   ├── index.html       # (Giao diện chính)
│   └── download.html    # (File mới - trang tải ảnh cho điện thoại)
├── uploads/             # Nơi lưu ảnh chụp
├── server.py            # (File mới - Backend Python)
└── requirements.txt     # (File mới - Danh sách thư viện cần cài)

2. Chạy ứng dụng:
python server.py

3. Truy cập:
Mở trình duyệt tại: http://localhost:5000
Để dùng điện thoại quét QR: Dùng địa chỉ IP LAN hiển thị ở Terminal (ví dụ: http://192.168.1.15:5000).

💡 Cách sử dụng
1. Đứng trước camera sao cho thấy rõ từ ngực trở lên.
2. Giơ 2 tay tạo hình chữ L (ngón cái nằm ngang, ngón trỏ thẳng đứng).
3. Khi AI hiện điểm xanh và báo "Đang giữ...", hãy giữ nguyên trong 1 giây.
4. Chờ đếm ngược 3-2-1 để chụp từng tấm ảnh (tổng cộng 4 lần).
5. Quét mã QR hiện ra trên màn hình bằng điện thoại để nhận ảnh.
⚠️ Lưu ý quan trọng
- Lỗi QR: Nếu điện thoại không truy cập được link, hãy kiểm tra xem điện thoại và máy tính có bắt chung một WiFi hay không, và đảm bảo đã tắt Firewall trên máy tính.
- Nhận diện tay: Đảm bảo bàn tay không bị che khuất và đủ ánh sáng để AI hoạt động chính xác nhất.

---

### Một mẹo nhỏ cho bạn:
Nếu bạn thấy các thư mục UUID trong `uploads` ngày càng nhiều và làm nặng máy, bạn có thể thêm một đoạn code nhỏ vào `server.py` để tự động xóa các thư mục cũ sau 24h, hoặc thỉnh thoảng xóa tay toàn bộ thư mục bên trong `uploads` (trừ chính thư mục `uploads`) là được nhé!