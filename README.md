📸 UAI Photobooth | USTH
---

**UAI Photobooth** là một ứng dụng chụp ảnh thông minh được phát triển cho sinh viên USTH. Ứng dụng sử dụng Trí tuệ nhân tạo (AI) để nhận diện cử chỉ tay, tự động chụp series 4 ảnh và tạo ra dải ảnh kỷ niệm (Photo Strip) phong cách Hàn Quốc có thể tải về điện thoại ngay lập tức.

## ✨ Key Features
- **AI Gesture Trigger:** Start the photo session by posing with two hands in an "L-shape" (the iconic Son Heung-min pose).
- **Auto-Capture Sequence:** Automatically takes 4 consecutive photos with a 3-second countdown and a screen flash effect.
- **Dynamic Photo Strip:** Combines photos into a professional 600x1500px vertical strip (16:9 ratio).
- **Custom Frames:** Support for uploading custom PNG frames to overlay on the final strip.
- **Instant QR Download:** Generates a QR code for mobile devices to download the photo, supported by Cloudflare Tunnel for public access.
- **Modern UI:** Clean Blue-Orange theme with a 2x2 live preview grid.

## 🛠 Technologies
- **Backend:** Python Flask
- **AI/CV Logic:** MediaPipe (Hand Landmarker)
- **Image Processing:** OpenCV, Pillow (PIL)
- **Frontend:** HTML5, CSS3 (Modern Flex/Grid), JavaScript (ES6)
- **Remote Access:** Cloudflare Tunnel (`cloudflared`)

## 📋 Project Structure
```text
UAI-PHOTOBOOTH/
├── static/              # Assets (CSS, JS, Sounds)
│   ├── app.js           # Main AI & Capture logic
│   └── style.css        # Modern Blue-Orange styling
├── templates/           # HTML Pages
│   ├── index.html       # Main Booth interface
│   └── download.html    # Mobile download page
├── uploads/             # Captured photos storage (session-based)
├── server.py            # Flask backend server
├── cloudflared.exe      # Cloudflare Tunnel tool
├── requirements.txt     # List of Python dependencies
└── README.md            # You are here!
```

## 🚀 Quick Start

### 1. Requirements
- Ensure you have **Python 3.8+** installed.
- Webcam (or USB camera).
- WiFi/4G-5G connected.

### 2. Install Dependencies
Open your terminal in the project folder and run:
```bash
pip install -r requirements.txt
```

### 3. Setup Cloudflare Tunnel (For Mobile Download)
To allow phones to scan the QR code and download photos (even when not on the same Wi-Fi):
1. Open a terminal in the project folder and run:
   ```bash
   cloudflared.exe tunnel --url http://localhost:5000
   ```
2. Look for the link ending in `.trycloudflare.com` (e.g., `https://abc-xyz.trycloudflare.com`).
3. Open `server.py` and paste this link into the `PUBLIC_URL` variable:
   ```python
   PUBLIC_URL = "https://your-unique-link.trycloudflare.com"
   ```

### 4. Run the Application
```bash
python server.py
```
### 5. Access
Open your browser at `http://localhost:5000`.

## 💡 How to Use
1. **Prepare:** Adjust your camera and select the correct device from the dropdown.
2. **Pose:** Show **two hands in an L-shape** (forming a frame).
3. **Hold:** Keep the pose for **1 second** until the countdown begins.
4. **Capture:** Smile! The camera will take 4 photos. You can see the preview in the right panel.
5. **Download:** Once the process is finished, a QR code will appear. Scan it with your phone to save your memories!

## ⚠️ Important Notes
- **Lighting:** Use good front lighting (like a ring light) to improve AI detection and photo quality.
- **Frame:** Custom frames must be in **600x1800px PNG** format with transparent areas for the photos.
- **Session:** Each time you restart the Cloudflare Tunnel, you must update the `PUBLIC_URL` in `server.py`.

## 📍 A quick tip for you
If you notice the UUID folders in `uploads` stacking up and taking up too much disk space, you can add a short snippet to `server.py` to automatically delete old folders after 24 hours. Alternatively, you can occasionally manually clear everything inside the `uploads` directory (just make sure not to delete the uploads folder itself)!

---
*Created with ❤️ for USTH community.*