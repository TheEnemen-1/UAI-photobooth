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

    Returns:
        {
          "frame_w": int,
          "frame_h": int,
          "slots":   [{"x": int, "y": int, "w": int, "h": int}, ...]
        }
        Slots are sorted top-to-bottom.
    """
    path = os.path.abspath(path)
    mtime = os.path.getmtime(path)
    cache_key = (path, mtime)
    if cache_key in _frame_meta_cache:
        return _frame_meta_cache[cache_key]

    img = Image.open(path).convert("RGBA")
    frame_w, frame_h = img.size
    alpha = np.array(img)[:, :, 3]

    THRESH     = 30    # pixel is "transparent" if alpha < THRESH
    ROW_RATIO  = 0.60  # fraction of transparent pixels to classify a row as cutout
    COL_RATIO  = 0.60  # same for columns within each band
    BAND_GAP   = 5     # max gap (rows) allowed within a single band

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
            band_alpha = alpha[y0:y1 + 1, :]
            transparent_cols = np.where((band_alpha < THRESH).mean(axis=0) > COL_RATIO)[0]
            if len(transparent_cols):
                x0 = int(transparent_cols[0])
                x1 = int(transparent_cols[-1])
                slots.append({"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0})

    result = {"frame_w": frame_w, "frame_h": frame_h, "slots": slots}
    _frame_meta_cache[cache_key] = result
    return result


def center_crop_to_slot(img, slot_w, slot_h):
    """
    Center-crop *img* to match the slot's aspect ratio, then resize to
    (slot_w × slot_h).  Mirrors the identical algorithm in app.js so the
    server composite matches what the client captured.
    """
    src_w, src_h  = img.size
    slot_aspect   = slot_w / slot_h
    src_aspect    = src_w  / src_h

    if src_aspect > slot_aspect:
        # Source is wider → trim the sides
        crop_h = src_h
        crop_w = round(src_h * slot_aspect)
        crop_x = (src_w - crop_w) // 2
        crop_y = 0
    else:
        # Source is taller → trim top/bottom
        crop_w = src_w
        crop_h = round(src_w / slot_aspect)
        crop_x = 0
        crop_y = (src_h - crop_h) // 2

    cropped = img.crop((crop_x, crop_y, crop_x + crop_w, crop_y + crop_h))
    return cropped.resize((slot_w, slot_h), Image.Resampling.LANCZOS)


def create_strip(session_dir, photos_count, frame_path=None):
    """
    Composite captured photos into the frame's transparent cutout slots.

    If *frame_path* is provided the canvas size matches the frame's native
    dimensions and each photo is center-cropped into its detected slot.
    Falls back to the original fixed 600×1800 layout when no frame is given.
    """
    if frame_path and os.path.isfile(frame_path):
        meta     = analyze_frame(frame_path)
        strip_w  = meta['frame_w']
        strip_h  = meta['frame_h']
        slots    = meta['slots']

        canvas = Image.new('RGBA', (strip_w, strip_h), (255, 255, 255, 255))

        for i, slot in enumerate(slots[:photos_count]):
            img_file = os.path.join(session_dir, f'photo_{i}.png')
            if os.path.exists(img_file):
                photo = Image.open(img_file).convert("RGBA")
                photo = center_crop_to_slot(photo, slot['w'], slot['h'])
                canvas.paste(photo, (slot['x'], slot['y']))

        # Composite the decorative frame layer on top (transparent cutouts let
        # the photos show through)
        frame_img = Image.open(frame_path).convert("RGBA")
        canvas.alpha_composite(frame_img)

    else:
        # No frame selected — original fixed-position layout
        strip_w, strip_h = 600, 1800
        canvas = Image.new('RGBA', (strip_w, strip_h), (255, 255, 255, 255))
        img_w, img_h = 540, 304
        padding_x = 30
        start_y   = 60
        gap       = 60
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
    """
    Return the detected slot bounding boxes for a frame image.

    Response shape:
        {
          "frame_w": int,
          "frame_h": int,
          "slots": [{"x": int, "y": int, "w": int, "h": int}, ...]
        }
    """
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

    Form fields:
        photo_0 … photo_3  — PNG blobs
        frame              — uploaded frame file (optional)
        frame_name         — filename from frames/ folder (fallback)
    """
    session_id  = str(uuid4())
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    os.makedirs(session_dir)

    # Resolve frame path: an uploaded file takes priority over a name reference
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
    if PUBLIC_URL:
        download_url = f"{PUBLIC_URL.rstrip('/')}/download/{session_id}"
    else:
        download_url = f"http://{get_lan_ip()}:5000/download/{session_id}"

    qr = qrcode.make(download_url)
    qr.save(os.path.join(session_dir, 'qr.png'))

    return jsonify({
        "session_id": session_id,
        "strip_url":  f"/get_upload/{session_id}/{strip_filename}",
        "qr_url":     f"/get_upload/{session_id}/qr.png"
    })


@app.route('/get_upload/<session_id>/<filename>')
def get_upload(session_id, filename):
    return send_from_directory(os.path.join(UPLOAD_FOLDER, session_id), filename)


@app.route('/download/<session_id>')
def download_page(session_id):
    strip_url = f"/get_upload/{session_id}/final_strip.png"
    return render_template('download.html', strip_url=strip_url)


if __name__ == '__main__':
    print(f"ACCESS AT: http://{get_lan_ip()}:5000")
    if PUBLIC_URL:
        print(f"PUBLIC ACCESS AT: {PUBLIC_URL}")
    app.run(host='0.0.0.0', port=5000)