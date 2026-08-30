import os
import socket
from uuid import uuid4
import numpy as np
from PIL import Image
import qrcode
from flask import Flask, render_template, request, jsonify, send_from_directory

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# ==========================================================================
# CLOUDFLARE / PUBLIC URL SETTING:
# - Leave empty "" to auto-detect public tunnel or use local Wi-Fi IP
# - Or set your custom domain / trycloudflare link here or via PUBLIC_URL env var
PUBLIC_URL = os.environ.get("PUBLIC_URL", "https://fired-insider-became-cool.trycloudflare.com")
# ==========================================================================

# In-process cache for frame analysis results, keyed by (absolute_path, mtime)
_frame_meta_cache = {}


# ── Helpers ─────────────────────────────────────────────────────────────────

def get_lan_ip():
    """Return the LAN IP address of this machine."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip


def get_base_url(client_origin=None):
    """
    Intelligently determine the base URL for QR code generation:
    1. Explicit PUBLIC_URL (if configured)
    2. Client origin passed from frontend (if not localhost)
    3. Host header (if not localhost)
    4. LAN IP address on port 5000 (for same Wi-Fi mobile scanning)
    """
    configured = os.environ.get("PUBLIC_URL", PUBLIC_URL).strip()
    if configured and not ("localhost" in configured or "127.0.0.1" in configured):
        return configured.rstrip('/')

    if client_origin:
        client_origin = client_origin.strip().rstrip('/')
        if not ("localhost" in client_origin or "127.0.0.1" in client_origin):
            return client_origin

    if request and request.host:
        host = request.host
        if not ("localhost" in host or "127.0.0.1" in host):
            scheme = request.headers.get('X-Forwarded-Proto', request.scheme or 'http')
            return f"{scheme}://{host}"

    return f"http://{get_lan_ip()}:5000"


def analyze_frame(path):
    """
    Scan the alpha channel of a PNG frame to detect transparent cutout slots.

    Algorithm:
      1. For every row, compute the fraction of pixels with alpha < THRESH.
         Rows where that fraction > ROW_RATIO are "transparent rows".
      2. Group contiguous transparent rows into bands (gap tolerance: BAND_GAP px).
      3. For each band, repeat column-wise to find the horizontal extent.
      4. Return each band as one slot: {x, y, w, h}.

    Result is cached by (path, mtime) so re-opening the same file is free.
    """
    path = os.path.abspath(path)
    mtime = os.path.getmtime(path)
    cache_key = (path, mtime)
    if cache_key in _frame_meta_cache:
        return _frame_meta_cache[cache_key]

    img = Image.open(path).convert("RGBA")
    frame_w, frame_h = img.size
    alpha = np.array(img)[:, :, 3]

    THRESH     = 50    # pixel is "transparent" if alpha < THRESH
    ROW_RATIO  = 0.08  # fraction of transparent pixels to classify a row as cutout
    COL_RATIO  = 0.15  # same for columns within each band
    BAND_GAP   = 15    # max gap (rows) allowed within a single band

    transparent_rows = np.where((alpha < THRESH).mean(axis=1) > ROW_RATIO)[0]

    slots = []
    if len(transparent_rows):
        # Segment into contiguous bands
        bands = []
        start = int(transparent_rows[0])
        prev  = int(transparent_rows[0])
        for r in transparent_rows[1:]:
            r = int(r)
            if r - prev > BAND_GAP:
                bands.append((start, prev))
                start = r
            prev = r
        bands.append((start, prev))

        for y0, y1 in bands:
            if (y1 - y0) < 50:
                continue

            band_alpha = alpha[y0:y1 + 1, :]
            transparent_cols = np.where((band_alpha < THRESH).mean(axis=0) > COL_RATIO)[0]
            if len(transparent_cols):
                x0 = int(transparent_cols[0])
                x1 = int(transparent_cols[-1])
                if (x1 - x0) > 50:
                    slots.append({"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0})

    if not slots:
        # Fallback: create 4 equal vertical slots
        margin_x = int(frame_w * 0.05)
        margin_y = int(frame_h * 0.03)
        slot_w = frame_w - 2 * margin_x
        available_h = frame_h - 2 * margin_y
        gap = int(available_h * 0.03)
        slot_h = (available_h - 3 * gap) // 4
        for i in range(4):
            sy = margin_y + i * (slot_h + gap)
            slots.append({"x": margin_x, "y": sy, "w": slot_w, "h": slot_h})

    result = {"frame_w": frame_w, "frame_h": frame_h, "slots": slots}
    _frame_meta_cache[cache_key] = result
    return result


def center_crop_to_slot(img, slot_w, slot_h):
    """
    Center-crop *img* to match the slot's aspect ratio, then resize to (slot_w x slot_h).
    """
    src_w, src_h  = img.size
    slot_aspect   = slot_w / slot_h
    src_aspect    = src_w  / src_h

    if src_aspect > slot_aspect:
        crop_h = src_h
        crop_w = round(src_h * slot_aspect)
        crop_x = (src_w - crop_w) // 2
        crop_y = 0
    else:
        crop_w = src_w
        crop_h = round(src_w / slot_aspect)
        crop_x = 0
        crop_y = (src_h - crop_h) // 2

    cropped = img.crop((crop_x, crop_y, crop_x + crop_w, crop_y + crop_h))
    return cropped.resize((slot_w, slot_h), Image.Resampling.LANCZOS)


def create_strip(session_dir, photos_count, frame_path=None):
    """
    Composite captured photos into the frame's transparent cutout slots.
    """
    scale_factor = 3  # Upscale resolution by 3x for higher quality

    if frame_path and os.path.isfile(frame_path):
        meta     = analyze_frame(frame_path)
        strip_w  = meta['frame_w'] * scale_factor
        strip_h  = meta['frame_h'] * scale_factor
        slots    = meta['slots']

        canvas = Image.new('RGBA', (strip_w, strip_h), (255, 255, 255, 255))

        for i, slot in enumerate(slots[:photos_count]):
            img_file = os.path.join(session_dir, f'photo_{i}.png')
            if os.path.exists(img_file):
                photo = Image.open(img_file).convert("RGBA")
                scaled_w = slot['w'] * scale_factor
                scaled_h = slot['h'] * scale_factor
                scaled_x = slot['x'] * scale_factor
                scaled_y = slot['y'] * scale_factor
                photo = center_crop_to_slot(photo, scaled_w, scaled_h)
                canvas.paste(photo, (scaled_x, scaled_y))

        frame_img = Image.open(frame_path).convert("RGBA")
        frame_img = frame_img.resize((strip_w, strip_h), Image.Resampling.LANCZOS)
        canvas.alpha_composite(frame_img)

    else:
        strip_w, strip_h = 600 * scale_factor, 1800 * scale_factor
        canvas = Image.new('RGBA', (strip_w, strip_h), (255, 255, 255, 255))
        img_w, img_h = 540 * scale_factor, 304 * scale_factor
        padding_x = 30 * scale_factor
        start_y   = 60 * scale_factor
        gap       = 60 * scale_factor
        for i in range(photos_count):
            img_file = os.path.join(session_dir, f'photo_{i}.png')
            if os.path.exists(img_file):
                photo = Image.open(img_file).convert("RGBA")
                photo = photo.resize((img_w, img_h), Image.Resampling.LANCZOS)
                canvas.paste(photo, (padding_x, start_y + i * (img_h + gap)))

    final_path = os.path.join(session_dir, 'final_strip.png')
    canvas.convert("RGB").save(final_path)
    return 'final_strip.png'


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/frames')
def list_frames():
    """Return a JSON list of image filenames available in the frames/ folder."""
    frames_dir = os.path.join(os.path.dirname(__file__), 'frames')
    allowed_ext = {'.png', '.jpg', '.jpeg', '.webp'}
    try:
        files = [
            f for f in os.listdir(frames_dir)
            if os.path.splitext(f)[1].lower() in allowed_ext
        ]
    except FileNotFoundError:
        files = []
    return jsonify(files)


@app.route('/api/frame-meta/<path:filename>')
def frame_meta(filename):
    """Return the detected slot bounding boxes for a frame image."""
    frames_dir = os.path.join(os.path.dirname(__file__), 'frames')
    frame_path = os.path.join(frames_dir, os.path.basename(filename))
    if not os.path.isfile(frame_path):
        return jsonify({"error": "Frame not found"}), 404
    return jsonify(analyze_frame(frame_path))


@app.route('/frames/<path:filename>')
def serve_frame(filename):
    """Serve an individual frame image from the frames/ directory."""
    frames_dir = os.path.join(os.path.dirname(__file__), 'frames')
    return send_from_directory(frames_dir, filename)


@app.route('/api/save', methods=['POST'])
def save_photos():
    """
    Accept 4 captured photo blobs plus an optional frame reference,
    composite them into the final photo strip, generate a QR code, and
    return URLs for both.
    """
    session_id  = str(uuid4())
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    os.makedirs(session_dir)

    # Resolve frame path
    frame_path     = None
    uploaded_frame = request.files.get('frame')
    if uploaded_frame:
        frame_path = os.path.join(session_dir, '_frame_upload.png')
        uploaded_frame.save(frame_path)
    else:
        frame_name = request.form.get('frame_name')
        if frame_name:
            candidate = os.path.join(
                os.path.dirname(__file__), 'frames', os.path.basename(frame_name)
            )
            if os.path.isfile(candidate):
                frame_path = candidate

    # Save captured photos
    for i in range(4):
        photo = request.files.get(f'photo_{i}')
        if photo:
            photo.save(os.path.join(session_dir, f'photo_{i}.png'))

    strip_filename = create_strip(session_dir, 4, frame_path)

    # Build the download URL for the QR code
    client_origin = request.form.get('client_base_url')
    base_url = get_base_url(client_origin)
    download_url = f"{base_url}/download/{session_id}"

    # Generate QR Code pointing directly to mobile download page
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(download_url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="#0088cc", back_color="white")
    qr_img.save(os.path.join(session_dir, 'qr.png'))

    return jsonify({
        "session_id":   session_id,
        "strip_url":    f"/get_upload/{session_id}/{strip_filename}",
        "qr_url":       f"/get_upload/{session_id}/qr.png",
        "download_url": download_url
    })


@app.route('/get_upload/<session_id>/<filename>')
def get_upload(session_id, filename):
    return send_from_directory(os.path.join(UPLOAD_FOLDER, session_id), filename)


@app.route('/download/<session_id>')
def download_page(session_id):
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    if not os.path.isdir(session_dir):
        return render_template('download.html', error="Session not found or expired."), 404

    strip_url = f"/get_upload/{session_id}/final_strip.png"

    # Collect individual photo URLs if present
    photos = []
    for i in range(4):
        photo_name = f"photo_{i}.png"
        if os.path.exists(os.path.join(session_dir, photo_name)):
            photos.append({
                "index": i + 1,
                "view_url": f"/get_upload/{session_id}/{photo_name}",
                "download_url": f"/download_photo/{session_id}/{i}"
            })

    return render_template(
        'download.html',
        session_id=session_id,
        strip_url=strip_url,
        photos=photos,
        direct_download_url=f"/download_photo/{session_id}"
    )


@app.route('/download_photo/<session_id>')
def download_photo(session_id):
    """Serve the final photo strip as a direct attachment file download."""
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    file_path = os.path.join(session_dir, 'final_strip.png')
    if not os.path.isfile(file_path):
        return "Photo strip not found", 404
    return send_from_directory(
        session_dir,
        'final_strip.png',
        as_attachment=True,
        download_name=f"UAI_photostrip_{session_id[:8]}.png"
    )


@app.route('/download_photo/<session_id>/<int:photo_idx>')
def download_individual_photo(session_id, photo_idx):
    """Serve an individual captured photo as a direct attachment file download."""
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    filename = f"photo_{photo_idx}.png"
    file_path = os.path.join(session_dir, filename)
    if not os.path.isfile(file_path):
        return "Photo not found", 404
    return send_from_directory(
        session_dir,
        filename,
        as_attachment=True,
        download_name=f"UAI_photo_{photo_idx + 1}_{session_id[:8]}.png"
    )


if __name__ == '__main__':
    lan_ip = get_lan_ip()
    print("=" * 60)
    print(" 📸 UAI PHOTOBOOTH SERVER RUNNING")
    print(f" 🏠 Local booth access:  http://localhost:5000")
    print(f" 📶 Same Wi-Fi access:   http://{lan_ip}:5000")
    if PUBLIC_URL:
        print(f" 🌐 Public Tunnel URL:   {PUBLIC_URL}")
    else:
        print(" 💡 For 4G/remote scanning: run cloudflared.exe tunnel --url http://localhost:5000")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000)
