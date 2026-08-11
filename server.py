import os
import cv2
import numpy as np
import socket
import qrcode
from flask import Flask, render_template, request, jsonify, send_from_directory
from uuid import uuid4

app = Flask(__name__)

UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

def get_lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def apply_beauty_filter(img_path):
    img = cv2.imread(img_path)
    
    # 1. Làm mịn da (Bilateral Filter)
    # Giữ chi tiết mắt/mũi nhưng làm mờ các vết thâm trên da
    smooth = cv2.bilateralFilter(img, 15, 80, 80)
    
    # 2. Tăng độ sáng và tương phản (Brightness/Contrast)
    # Tăng nhẹ vùng sáng để da trắng hơn
    alpha = 1.1 # Contrast
    beta = 15   # Brightness
    adjusted = cv2.convertScaleAbs(smooth, alpha=alpha, beta=beta)
    
    # 3. Chỉnh tông màu trắng hồng (Pinkish Glow)
    # Chuyển sang LAB để chỉnh kênh màu a (xanh lá - đỏ)
    lab = cv2.cvtColor(adjusted, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    a = cv2.add(a, 5) # Thêm sắc đỏ hồng cho da
    l = cv2.add(l, 10) # Tăng thêm chút sáng cho kênh L
    lab = cv2.merge((l, a, b))
    final = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    
    cv2.imwrite(img_path, final)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/save', methods=['POST'])
def save_photos():
    session_id = str(uuid4())
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    os.makedirs(session_dir)

    for i in range(4):
        file = request.files.get(f'photo_{i}')
        if file:
            path = os.path.join(session_dir, f'photo_{i}.png')
            file.save(path)
            apply_beauty_filter(path)

    lan_ip = get_lan_ip()
    download_url = f"http://{lan_ip}:5000/download/{session_id}"
    qr = qrcode.make(download_url)
    qr_path = os.path.join(session_dir, 'qr.png')
    qr.save(qr_path)

    return jsonify({
        "session_id": session_id,
        "qr_url": f"/get_upload/{session_id}/qr.png"
    })

@app.route('/get_upload/<session_id>/<filename>')
def get_upload(session_id, filename):
    return send_from_directory(os.path.join(UPLOAD_FOLDER, session_id), filename)

@app.route('/download/<session_id>')
def download_page(session_id):
    photos = [f"/get_upload/{session_id}/photo_{i}.png" for i in range(4)]
    return render_template('download.html', photos=photos)

if __name__ == '__main__':
    # Chạy host 0.0.0.0 để điện thoại trong mạng LAN có thể truy cập
    print(f"TRUY CẬP TẠI: http://{get_lan_ip()}:5000")
    app.run(host='0.0.0.0', port=5000)