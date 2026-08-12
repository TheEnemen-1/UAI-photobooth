import os
import cv2
import numpy as np
import socket
import qrcode
from flask import Flask, render_template, request, jsonify, send_from_directory
from uuid import uuid4
from PIL import Image

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

def apply_beauty_filter(cv_img):
    smooth = cv2.bilateralFilter(cv_img, 15, 75, 75)
    adjusted = cv2.convertScaleAbs(smooth, alpha=1.1, beta=15)
    lab = cv2.cvtColor(adjusted, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    a = cv2.add(a, 8) 
    lab = cv2.merge((l, a, b))
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

def create_strip(session_dir, photos_count, frame_file=None):
    # Kích thước dải tiêu chuẩn 1:3
    strip_w, strip_h = 600, 1800
    canvas = Image.new('RGBA', (strip_w, strip_h), (255, 255, 255, 255))
    
    img_w, img_h = 540, 400
    padding_x = 30
    start_y = 40
    gap = 25
    
    for i in range(photos_count):
        img_path = os.path.join(session_dir, f'photo_{i}.png')
        img = Image.open(img_path).convert("RGBA")
        img = img.resize((img_w, img_h), Image.Resampling.LANCZOS)
        y_offset = start_y + i * (img_h + gap)
        canvas.paste(img, (padding_x, y_offset))
    
    # Nếu có upload frame
    if frame_file:
        try:
            frame_img = Image.open(frame_file).convert("RGBA")
            frame_img = frame_img.resize((strip_w, strip_h), Image.Resampling.LANCZOS)
            canvas.alpha_composite(frame_img)
        except:
            print("Lỗi frame")

    final_path = os.path.join(session_dir, 'final_strip.png')
    canvas.convert("RGB").save(final_path)
    return 'final_strip.png'

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/save', methods=['POST'])
def save_photos():
    session_id = str(uuid4())
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    os.makedirs(session_dir)

    # Nhận ảnh frame (nếu có)
    frame_file = request.files.get('frame')
    
    for i in range(4):
        file = request.files.get(f'photo_{i}')
        if file:
            temp_path = os.path.join(session_dir, f'photo_{i}.png')
            file.save(temp_path)
            img = cv2.imread(temp_path)
            img_beauty = apply_beauty_filter(img)
            cv2.imwrite(temp_path, img_beauty)

    strip_filename = create_strip(session_dir, 4, frame_file)

    lan_ip = get_lan_ip()
    # Gợi ý: Nếu dùng Ngrok, hãy đổi link này thành link Ngrok
    download_url = f"http://{lan_ip}:5000/download/{session_id}"
    qr = qrcode.make(download_url)
    qr.save(os.path.join(session_dir, 'qr.png'))

    return jsonify({
        "session_id": session_id,
        "strip_url": f"/get_upload/{session_id}/{strip_filename}",
        "qr_url": f"/get_upload/{session_id}/qr.png"
    })

@app.route('/get_upload/<session_id>/<filename>')
def get_upload(session_id, filename):
    return send_from_directory(os.path.join(UPLOAD_FOLDER, session_id), filename)

@app.route('/download/<session_id>')
def download_page(session_id):
    strip_url = f"/get_upload/{session_id}/final_strip.png"
    return render_template('download.html', strip_url=strip_url)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)