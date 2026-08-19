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

# ==========================================================================
# CLOUDFLARE SETTING: Paste your link here
# Keep it empty "" if you want to use local Wi-Fi IP
PUBLIC_URL = "https://researchers-where-significant-kenny.trycloudflare.com"
# ==========================================================================

# Function to get the local IP address for the QR code link
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

# Function to combine 4 photos into a 600x1800 vertical photo strip
def create_strip(session_dir, photos_count, frame_file=None):
    strip_w, strip_h = 600, 1800 
    canvas = Image.new('RGBA', (strip_w, strip_h), (255, 255, 255, 255))
    
    # Adjusted to 16:9 ratio to match camera (540 / 304 ≈ 1.77)
    img_w, img_h = 540, 304 
    padding_x = 30
    start_y = 60 # Lowered slightly for better top margin
    gap = 60     # Increased gap for a more balanced look
    
    for i in range(photos_count):
        img_path = os.path.join(session_dir, f'photo_{i}.png')
        if os.path.exists(img_path):
            img = Image.open(img_path).convert("RGBA")
            # This ensures the resized image maintains the 16:9 look
            img = img.resize((img_w, img_h), Image.Resampling.LANCZOS)
            y_offset = start_y + i * (img_h + gap)
            canvas.paste(img, (padding_x, y_offset))

    # If a custom frame is uploaded, overlay it on top of the strip
    if frame_file:
        try:
            frame_img = Image.open(frame_file).convert("RGBA")
            frame_img = frame_img.resize((strip_w, strip_h), Image.Resampling.LANCZOS)
            canvas.alpha_composite(frame_img)
        except: pass

    final_path = os.path.join(session_dir, 'final_strip.png')
    canvas.convert("RGB").save(final_path)
    return 'final_strip.png'

# Route to serve the main photobooth page
@app.route('/')
def index():
    return render_template('index.html')

# API Route to save uploaded photos and generate the final strip + QR code
@app.route('/api/save', methods=['POST'])
def save_photos():
    session_id = str(uuid4())
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    os.makedirs(session_dir)

    frame_file = request.files.get('frame')
    for i in range(4):
        file = request.files.get(f'photo_{i}')
        if file:
            temp_path = os.path.join(session_dir, f'photo_{i}.png')
            file.save(temp_path)

    strip_filename = create_strip(session_dir, 4, frame_file)
    
    # --- LOGIC SELECTION FOR QR CODE LINK ---
    if PUBLIC_URL:
        # Use Cloudflare link if provided
        download_url = f"{PUBLIC_URL.rstrip('/')}/download/{session_id}"
    else:
        # Default to local LAN IP
        lan_ip = get_lan_ip()
        download_url = f"http://{lan_ip}:5000/download/{session_id}"
    
    qr = qrcode.make(download_url)
    qr.save(os.path.join(session_dir, 'qr.png'))

    return jsonify({
        "session_id": session_id,
        "strip_url": f"/get_upload/{session_id}/{strip_filename}",
        "qr_url": f"/get_upload/{session_id}/qr.png"
    })

# Route to serve specific uploaded files (photos/QR)
@app.route('/get_upload/<session_id>/<filename>')
def get_upload(session_id, filename):
    return send_from_directory(os.path.join(UPLOAD_FOLDER, session_id), filename)

# Route for the mobile-friendly download page
@app.route('/download/<session_id>')
def download_page(session_id):
    strip_url = f"/get_upload/{session_id}/final_strip.png"
    return render_template('download.html', strip_url=strip_url)

if __name__ == '__main__':
    print(f"ACCESS AT: http://{get_lan_ip()}:5000")
    if PUBLIC_URL:
        print(f"PUBLIC ACCESS AT: {PUBLIC_URL}")
    app.run(host='0.0.0.0', port=5000)