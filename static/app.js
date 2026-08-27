import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// ── DOM refs ─────────────────────────────────────────────────────────────────
const video         = document.getElementById("video");
const canvasElement = document.getElementById("overlay");
const canvasCtx     = canvasElement.getContext("2d");
const statusBadge   = document.getElementById("statusBadge");
const cameraSelect  = document.getElementById("cameraSelect");
const btnFlip       = document.getElementById("btnFlip");
const flashDiv      = document.getElementById("flash");

// Frame picker
const btnSelectFrame      = document.getElementById("btnSelectFrame");
const framePickerModal    = document.getElementById("framePickerModal");
const framePickerGrid     = document.getElementById("framePickerGrid");
const btnCloseFramePicker = document.getElementById("btnCloseFramePicker");
const btnClearFrame       = document.getElementById("btnClearFrame");
const btnConfirmFrame     = document.getElementById("btnConfirmFrame");

// Live Strip Preview
const stripPreviewCanvas  = document.getElementById("stripPreviewCanvas");
const stripPreviewCtx     = stripPreviewCanvas ? stripPreviewCanvas.getContext("2d") : null;
let capturedStripCanvases = [];

// ── Frame / slot state ───────────────────────────────────────────────────────
let selectedFrameName = null;   // confirmed frame filename
let pendingFrameName  = null;   // selection inside open modal (not yet confirmed)
let frameMeta         = null;   // { frame_w, frame_h, slots:[{x,y,w,h},...] }
let frameImg          = null;   // HTMLImageElement (preloaded frame PNG)

// Slot guide animation
let slotGuideTarget    = null;  // final guide params for current slot
let slotGuideFrom      = null;  // starting params at animation start
let slotGuideAnimStart = null;  // performance.now() when animation began
let slotGuideCurrent   = null;  // last interpolated value (for chaining)
const GUIDE_ANIM_MS    = 420;   // animation duration (ms)

let currentSlotIndex = 0;       // which slot we're capturing during a session

// ── Debug mode ── append ?debug=1 to the URL to activate ─────────────────────
const debugMode = new URLSearchParams(location.search).has('debug');

// ── Audio ────────────────────────────────────────────────────────────────────
const shutterSound = new Audio("/static/iphone-cam-sound.mp3");
shutterSound.onerror = () => {
    // Fallback if local file not found
    shutterSound.src = "https://assets.mixkit.co/active_storage/sfx/2852/2852-preview.mp3";
};

// ── MediaPipe state ──────────────────────────────────────────────────────────
let handLandmarker;
let isCapturing  = false;
let gestureStart = null;
let isMirrored   = true;

// ── Initialisation ───────────────────────────────────────────────────────────
async function init() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2
    });

    setupCameraList();
    startCamera();
    renderStripPreview([]);

    if (debugMode) {
        statusBadge.style.background = '#9333ea';
        statusBadge.innerText = '🐞 Debug mode active — slot guides visible';
        setTimeout(() => { statusBadge.style.background = ''; }, 3000);
    }
}

// ── Camera controls ───────────────────────────────────────────────────────────
btnFlip.onclick = () => {
    isMirrored = !isMirrored;
    const val = isMirrored ? "scaleX(-1)" : "scaleX(1)";
    video.style.transform        = val;
};

async function setupCameraList() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    devices.filter(d => d.kind === 'videoinput').forEach(d => {
        const opt   = document.createElement("option");
        opt.value   = d.deviceId;
        opt.text    = d.label || `Camera ${cameraSelect.length + 1}`;
        cameraSelect.appendChild(opt);
    });
    cameraSelect.onchange = startCamera;
}

async function startCamera() {
    const constraints = {
        video: {
            deviceId: cameraSelect.value ? { exact: cameraSelect.value } : undefined,
            width: 1280, height: 720
        }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.onloadedmetadata = () => {
        const container = document.querySelector(".camera-container");
        if (container && video.videoWidth && video.videoHeight) {
            container.style.setProperty("--cam-aspect", `${video.videoWidth} / ${video.videoHeight}`);
        }
        canvasElement.width  = video.videoWidth;
        canvasElement.height = video.videoHeight;
        predict();
    };
}

// ── Frame Picker ──────────────────────────────────────────────────────────────
async function openFramePicker() {
    // Lazy-load the grid on first open
    if (framePickerGrid.querySelector('.picker-loading') ||
        framePickerGrid.childElementCount === 0) {
        framePickerGrid.innerHTML = '<p class="picker-loading">Loading frames…</p>';

        const res  = await fetch('/api/frames');
        const list = await res.json();

        framePickerGrid.innerHTML = '';
        if (list.length === 0) {
            framePickerGrid.innerHTML =
                '<p class="picker-loading">No frames found in /frames folder.</p>';
        } else {
            list.forEach(name => {
                const card = document.createElement('div');
                card.className   = 'frame-card';
                card.dataset.name = name;

                const img = document.createElement('img');
                img.src     = `/frames/${encodeURIComponent(name)}`;
                img.alt     = name;
                img.loading = 'lazy';

                const label = document.createElement('span');
                label.className   = 'frame-label';
                label.textContent = name.replace(/\.[^.]+$/, '');

                card.appendChild(img);
                card.appendChild(label);
                card.addEventListener('click', () => selectCard(card));
                framePickerGrid.appendChild(card);
            });
        }
    }

    // Restore highlight for the currently confirmed frame
    pendingFrameName = selectedFrameName;
    framePickerGrid.querySelectorAll('.frame-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.name === pendingFrameName);
    });

    framePickerModal.classList.remove('hidden');
}

function selectCard(card) {
    framePickerGrid.querySelectorAll('.frame-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    pendingFrameName = card.dataset.name;
}

function closeFramePicker() {
    framePickerModal.classList.add('hidden');
}

btnSelectFrame.onclick      = openFramePicker;
btnCloseFramePicker.onclick  = closeFramePicker;
framePickerModal.addEventListener('click', e => {
    if (e.target === framePickerModal) closeFramePicker();
});

btnClearFrame.onclick = () => {
    pendingFrameName  = null;
    selectedFrameName = null;
    frameMeta         = null;
    frameImg          = null;
    slotGuideTarget   = null;
    slotGuideCurrent  = null;
    currentSlotIndex  = 0;
    capturedStripCanvases = [];
    btnSelectFrame.textContent = '🖼️ Select Frame';

    const container = document.querySelector(".camera-container");
    if (container) {
        if (video.videoWidth && video.videoHeight) {
            container.style.setProperty("--cam-aspect", `${video.videoWidth} / ${video.videoHeight}`);
        } else {
            container.style.setProperty("--cam-aspect", "16 / 9");
        }
    }
    renderStripPreview([]);
    closeFramePicker();
};

btnConfirmFrame.onclick = async () => {
    selectedFrameName = pendingFrameName;
    // Reset guide state before fetching new metadata
    frameMeta        = null;
    frameImg         = null;
    slotGuideTarget  = null;
    slotGuideCurrent = null;
    currentSlotIndex = 0;
    capturedStripCanvases = [];

    if (selectedFrameName) {
        const short = selectedFrameName.replace(/\.[^.]+$/, '');
        btnSelectFrame.textContent = `✔ ${short}`;

        // Fetch slot metadata for this frame
        try {
            const res = await fetch(`/api/frame-meta/${encodeURIComponent(selectedFrameName)}`);
            frameMeta = await res.json();
        } catch (e) {
            console.error('Failed to fetch frame metadata:', e);
        }

        // Preload the frame image so drawFrameOverlay() can draw it immediately
        frameImg     = new Image();
        frameImg.onload = () => {
            renderStripPreview([]);
        };
        frameImg.src = `/frames/${encodeURIComponent(selectedFrameName)}`;

        // Animate the first slot guide into position
        if (frameMeta?.slots?.length) {
            setSlotGuide(0, false); // appear without animation from a previous guide
        }
        renderStripPreview([]);
    } else {
        btnSelectFrame.textContent = '🖼️ Select Frame';
        const container = document.querySelector(".camera-container");
        if (container) {
            if (video.videoWidth && video.videoHeight) {
                container.style.setProperty("--cam-aspect", `${video.videoWidth} / ${video.videoHeight}`);
            } else {
                container.style.setProperty("--cam-aspect", "16 / 9");
            }
        }
        renderStripPreview([]);
    }

    closeFramePicker();
};

// ── Slot guide computation ───────────────────────────────────────────────────
/**
 * Compute all values needed to:
 *   (a) draw the frame image on the canvas so that it 100% fills the container,
 *   (b) set the container aspect ratio to match the frame slice, AND
 *   (c) describe the cutout crop region for video capture and debug overlay.
 *
 * Returns { drawX, drawY, drawW, drawH, cropX, cropY, cropW, cropH }
 *         or null if metadata or slot is unavailable.
 */
function computeSlotGuide(slotIndex) {
    if (!frameMeta?.slots?.[slotIndex]) return null;

    const slots = frameMeta.slots;
    const n     = slots.length;
    const slot  = slots[slotIndex];

    // Compute natural slice Y boundaries for this slot in frame coordinates
    const top_b = slotIndex === 0 ? 0 : Math.floor((slots[slotIndex - 1].y + slots[slotIndex - 1].h + slot.y) / 2);
    const bot_b = slotIndex === n - 1 ? frameMeta.frame_h : Math.floor((slot.y + slot.h + slots[slotIndex + 1].y) / 2);

    const sliceX0 = 0;
    const sliceY0 = top_b;
    const sliceW  = frameMeta.frame_w;
    const sliceH  = bot_b - top_b;

    // Set outer camera container aspect ratio to match the frame slice 100%!
    const container = document.querySelector(".camera-container");
    if (container) {
        container.style.setProperty("--cam-aspect", `${sliceW} / ${sliceH}`);
    }

    const cW = video.videoWidth || 1280;
    const cH = Math.round(cW * (sliceH / sliceW));
    canvasElement.width  = cW;
    canvasElement.height = cH;

    const scale = cW / sliceW;

    const drawW = cW;
    const drawH = cH;
    const drawX = 0;
    const drawY = 0;

    const slotRelX = slot.x - sliceX0;
    const slotRelY = slot.y - sliceY0;

    const cropX = slotRelX * scale;
    const cropY = slotRelY * scale;
    const cropW = slot.w * scale;
    const cropH = slot.h * scale;

    return {
        drawX, drawY, drawW, drawH,
        sliceX0, sliceY0, sliceW, sliceH,
        cropX, cropY, cropW, cropH
    };
}

/**
 * Transition the visible slot guide to a new slot.
 * animate=true produces a smooth drift (cubic ease-out).
 */
function setSlotGuide(slotIndex, animate = true) {
    const guide = computeSlotGuide(slotIndex);
    if (!guide) { slotGuideTarget = null; return; }

    slotGuideFrom      = animate && slotGuideCurrent
        ? { ...slotGuideCurrent }
        : guide;
    slotGuideTarget    = guide;
    slotGuideAnimStart = performance.now();
}

/**
 * Called every animation frame from predict().
 * Draws the frame slice on the canvas, scaled so the current slot's
 * transparent cutout area aligns with the live camera crop region.
 */
function drawFrameOverlay() {
    if (!frameMeta || !frameImg?.complete || !slotGuideTarget) return;

    // ── Animation interpolation ──────────────────────────────────────────────
    const elapsed = performance.now() - (slotGuideAnimStart ?? 0);
    const t       = Math.min(elapsed / GUIDE_ANIM_MS, 1);
    const ease    = 1 - Math.pow(1 - t, 3);  // cubic ease-out

    const from   = slotGuideFrom || slotGuideTarget;
    const target = slotGuideTarget;

    const lerp = (a, b) => a + (b - a) * ease;
    const cur = {
        drawX: lerp(from.drawX, target.drawX),
        drawY: lerp(from.drawY, target.drawY),
        drawW: lerp(from.drawW, target.drawW),
        drawH: lerp(from.drawH, target.drawH),
        sliceX0: target.sliceX0,
        sliceY0: target.sliceY0,
        sliceW:  target.sliceW,
        sliceH:  target.sliceH,
        cropX: target.cropX,
        cropY: target.cropY,
        cropW: target.cropW,
        cropH: target.cropH,
    };
    slotGuideCurrent = cur;   // persist for next frame's animation start

    // ── Draw frame image slice ──────────────────────────────────────────────
    const fadeAlpha = t < 1 ? 0.3 + ease * 0.7 : 1.0;

    canvasCtx.save();
    canvasCtx.globalAlpha = fadeAlpha;
    canvasCtx.drawImage(
        frameImg,
        cur.sliceX0, cur.sliceY0, cur.sliceW, cur.sliceH,
        cur.drawX, cur.drawY, cur.drawW, cur.drawH
    );
    canvasCtx.restore();

    // ── Debug overlays ───────────────────────────────────────────────────────
    if (!debugMode) return;

    const scaleX = cur.drawW / frameMeta.frame_w;
    const scaleY = cur.drawH / frameMeta.frame_h;

    canvasCtx.save();

    // 1. Current crop guide rectangle (camera-space bounding box)
    canvasCtx.strokeStyle = '#ff914d';
    canvasCtx.lineWidth   = 3;
    canvasCtx.setLineDash([16, 8]);
    canvasCtx.strokeRect(cur.cropX, cur.cropY, cur.cropW, cur.cropH);
    canvasCtx.setLineDash([]);

    canvasCtx.fillStyle = 'rgba(255, 145, 77, 0.9)';
    canvasCtx.font      = 'bold 16px "Share Tech", sans-serif';
    canvasCtx.fillText(
        `Slot ${currentSlotIndex + 1}/${frameMeta.slots.length}  |  crop guide`,
        cur.cropX + 10,
        cur.cropY + 24
    );

    // 2. All slot outlines mapped through the current (animated) frame position
    frameMeta.slots.forEach((slot, i) => {
        const sx = cur.drawX + slot.x * scaleX;
        const sy = cur.drawY + slot.y * scaleY;
        const sw = slot.w * scaleX;
        const sh = slot.h * scaleY;

        const isActive = i === currentSlotIndex;
        canvasCtx.strokeStyle = isActive ? '#ff914d' : '#0088cc';
        canvasCtx.lineWidth   = isActive ? 2 : 1.5;
        canvasCtx.setLineDash([8, 4]);
        canvasCtx.strokeRect(sx, sy, sw, sh);
        canvasCtx.setLineDash([]);

        canvasCtx.fillStyle = isActive ? '#ff914d' : '#0088cc';
        canvasCtx.font      = `bold ${isActive ? 14 : 12}px "Share Tech", sans-serif`;
        canvasCtx.fillText(`${i + 1}`, sx + 5, sy + 17);
    });

    canvasCtx.restore();
}

// ── Live Strip Preview (Right Panel) ─────────────────────────────────────────
function renderStripPreview(capturedList = capturedStripCanvases) {
    if (!stripPreviewCanvas || !stripPreviewCtx) return;

    if (frameImg && frameImg.complete && frameMeta?.slots?.length) {
        const stripW = frameMeta.frame_w || 600;
        const stripH = frameMeta.frame_h || 1800;
        stripPreviewCanvas.width  = stripW;
        stripPreviewCanvas.height = stripH;

        // Solid clean white canvas base
        stripPreviewCtx.fillStyle = "#ffffff";
        stripPreviewCtx.fillRect(0, 0, stripW, stripH);

        // Render slots
        const slots = frameMeta.slots;
        slots.slice(0, 4).forEach((slot, i) => {
            if (capturedList[i]) {
                // Draw captured photo in slot
                stripPreviewCtx.drawImage(capturedList[i], slot.x, slot.y, slot.w, slot.h);
            } else {
                // Empty placeholder slot
                stripPreviewCtx.fillStyle = "#f1f5f9";
                stripPreviewCtx.fillRect(slot.x, slot.y, slot.w, slot.h);

                // Subtle outline & slot label
                stripPreviewCtx.strokeStyle = "#cbd5e1";
                stripPreviewCtx.lineWidth = 4;
                stripPreviewCtx.setLineDash([12, 8]);
                stripPreviewCtx.strokeRect(slot.x + 4, slot.y + 4, slot.w - 8, slot.h - 8);
                stripPreviewCtx.setLineDash([]);

                stripPreviewCtx.fillStyle = "#94a3b8";
                stripPreviewCtx.font = 'bold 38px "Changa One", sans-serif';
                stripPreviewCtx.textAlign = 'center';
                stripPreviewCtx.textBaseline = 'middle';
                stripPreviewCtx.fillText(`Photo ${i + 1}`, slot.x + slot.w / 2, slot.y + slot.h / 2);
            }
        });

        // Overlay frame design on top
        stripPreviewCtx.drawImage(frameImg, 0, 0, stripW, stripH);

    } else {
        // Default strip layout (no frame selected)
        const stripW = 600;
        const stripH = 1800;
        stripPreviewCanvas.width  = stripW;
        stripPreviewCanvas.height = stripH;

        stripPreviewCtx.fillStyle = "#ffffff";
        stripPreviewCtx.fillRect(0, 0, stripW, stripH);

        const img_w = 540;
        const img_h = 304;
        const padding_x = 30;
        const start_y   = 60;
        const gap       = 60;

        for (let i = 0; i < 4; i++) {
            const slotX = padding_x;
            const slotY = start_y + i * (img_h + gap);

            if (capturedList[i]) {
                stripPreviewCtx.drawImage(capturedList[i], slotX, slotY, img_w, img_h);
            } else {
                stripPreviewCtx.fillStyle = "#f1f5f9";
                stripPreviewCtx.fillRect(slotX, slotY, img_w, img_h);

                stripPreviewCtx.strokeStyle = "#cbd5e1";
                stripPreviewCtx.lineWidth = 4;
                stripPreviewCtx.setLineDash([12, 8]);
                stripPreviewCtx.strokeRect(slotX, slotY, img_w, img_h);
                stripPreviewCtx.setLineDash([]);

                stripPreviewCtx.fillStyle = "#94a3b8";
                stripPreviewCtx.font = 'bold 38px "Changa One", sans-serif';
                stripPreviewCtx.textAlign = 'center';
                stripPreviewCtx.textBaseline = 'middle';
                stripPreviewCtx.fillText(`Photo ${i + 1}`, slotX + img_w / 2, slotY + img_h / 2);
            }
        }

        // Bottom label
        stripPreviewCtx.fillStyle = "#0088cc";
        stripPreviewCtx.font = 'bold 32px "Changa One", sans-serif';
        stripPreviewCtx.textAlign = 'center';
        stripPreviewCtx.textBaseline = 'alphabetic';
        stripPreviewCtx.fillText("UAI PHOTOBOOTH", stripW / 2, stripH - 30);
    }
}

// ── Gesture detection ─────────────────────────────────────────────────────────
function isLSelection(landmarks) {
    const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const wrist = landmarks[0];

    // 1. Index finger is extended
    // Tip (8) further from wrist (0) than PIP (6)
    const isIndexExt = dist(landmarks[8], wrist) > dist(landmarks[6], wrist);

    // 2. Thumb is extended
    // Tip (4) further from wrist (0) than MCP (2)
    const isThumbExt = dist(landmarks[4], wrist) > dist(landmarks[2], wrist);

    // 3. Middle, Ring, Pinky are curled
    // A robust check: Tip is closer to wrist than the PIP joint (with slight tolerance), 
    // OR tip is close to its MCP joint (meaning it's curled inwards).
    const checkCurled = (tip, pip, mcp) => {
        return dist(landmarks[tip], wrist) < dist(landmarks[pip], wrist) + 0.02 || 
               dist(landmarks[tip], landmarks[mcp]) < dist(landmarks[pip], landmarks[mcp]) * 1.3;
    };
    
    const isOthersCurled = checkCurled(12, 10, 9) && checkCurled(16, 14, 13) && checkCurled(20, 18, 17);

    // 4. L-Shape Angle
    // The angle between the thumb and index finger should be roughly 90 degrees.
    const vecThumb = { x: landmarks[4].x - landmarks[2].x, y: landmarks[4].y - landmarks[2].y };
    const vecIndex = { x: landmarks[8].x - landmarks[5].x, y: landmarks[8].y - landmarks[5].y };
    
    const dot = vecThumb.x * vecIndex.x + vecThumb.y * vecIndex.y;
    const magT = Math.hypot(vecThumb.x, vecThumb.y);
    const magI = Math.hypot(vecIndex.x, vecIndex.y);
    
    let isLAngle = false;
    if (magT > 0 && magI > 0) {
        const cosTheta = dot / (magT * magI);
        // Require the angle to be between ~45 deg and ~135 deg (|cos| < 0.75)
        isLAngle = Math.abs(cosTheta) < 0.75;
    }

    return isIndexExt && isThumbExt && isOthersCurled && isLAngle;
}

// ── Main prediction loop ──────────────────────────────────────────────────────
async function predict() {
    // Clear canvas, then draw frame overlay first (below gesture strokes)
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    drawFrameOverlay();

    if (handLandmarker && !isCapturing) {
        const results   = await handLandmarker.detectForVideo(video, performance.now());
        const handCount = results.landmarks ? results.landmarks.length : 0;

        if (handCount === 0) {
            statusBadge.innerText = "Two-hand camera pose to start! 👇👆";
            gestureStart = null;
        } else if (handCount === 1) {
            statusBadge.innerText = "One hand detected. Show the other! ✋";
            gestureStart = null;
        } else {
            const handsL = results.landmarks.filter(isLSelection);
            if (handsL.length >= 2) {
                if (!gestureStart) gestureStart = Date.now();
                const elapsed = Date.now() - gestureStart;

                if (elapsed > 1000) {
                    gestureStart = null;
                    startPhotoboothFlow();
                } else {
                    // Recognition highlight drawn on top of the frame overlay
                    canvasCtx.strokeStyle = "#ff914d";
                    canvasCtx.lineWidth   = 12;
                    canvasCtx.setLineDash([20, 10]);
                    canvasCtx.strokeRect(40, 40, canvasElement.width - 80, canvasElement.height - 80);
                    canvasCtx.setLineDash([]);
                    statusBadge.innerText = `RECOGNIZING... ${(elapsed / 1000).toFixed(1)}s`;
                }
            } else {
                statusBadge.innerText = "Please show both hands in L-shape (Son Heung-min) 👐";
                gestureStart = null;
            }
        }
    }

    requestAnimationFrame(predict);
}

// ── Center-crop capture (mirrors server-side Python exactly) ──────────────────
/**
 * Capture a frame from the live video, center-cropped to match slot's
 * aspect ratio.  Returns an offscreen <canvas> ready for toBlob().
 */
function captureSlot(slot) {
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    const slotAR = slot.w / slot.h;
    const camAR  = vW / vH;

    let srcX, srcY, srcW, srcH;
    if (camAR > slotAR) {
        srcH = vH;
        srcW = Math.round(vH * slotAR);
        srcX = Math.round((vW - srcW) / 2);
        srcY = 0;
    } else {
        srcW = vW;
        srcH = Math.round(vW / slotAR);
        srcX = 0;
        srcY = Math.round((vH - srcH) / 2);
    }

    const cap = document.createElement("canvas");
    cap.width  = srcW;
    cap.height = srcH;
    const ctx  = cap.getContext("2d");
    if (isMirrored) { ctx.translate(srcW, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
    return cap;
}

/**
 * Capture a full-resolution frame (no frame/slot context).
 */
function captureFullFrame() {
    const cap = document.createElement("canvas");
    cap.width  = video.videoWidth;
    cap.height = video.videoHeight;
    const ctx  = cap.getContext("2d");
    if (isMirrored) { ctx.translate(cap.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);
    return cap;
}

// ── Photobooth capture flow ────────────────────────────────────────────────────
async function startPhotoboothFlow() {
    isCapturing = true;
    const photos      = [];
    const countdownEl = document.getElementById("countdown");
    const slots       = frameMeta?.slots ?? [];

    capturedStripCanvases = [];
    renderStripPreview([]);

    for (let i = 0; i < 4; i++) {
        currentSlotIndex = i;

        // Animate slot guide to the current position before the countdown
        // (no animation for shot 0 — the guide is already in place from selection)
        if (slots[i]) setSlotGuide(i, i > 0);

        let timerSeconds = parseInt(document.getElementById("timerSelect").value) || 3;
        for (let c = timerSeconds; c > 0; c--) {
            statusBadge.innerText = `PREPARING PHOTO ${i + 1}/4... 🌟`;
            countdownEl.innerText = c;
            countdownEl.classList.remove("hidden");
            await new Promise(r => setTimeout(r, 1000));
        }
        countdownEl.classList.add("hidden");

        // Shutter sound + flash
        const isSoundOn = document.getElementById("soundSelect") ? document.getElementById("soundSelect").value === "on" : true;
        if (isSoundOn) {
            shutterSound.currentTime = 0;
            shutterSound.play().catch(() => {});
        }
        flashDiv.classList.add("do-flash");
        setTimeout(() => flashDiv.classList.remove("do-flash"), 400);

        // Capture: center-crop to slot dimensions if a frame is active
        const capCanvas = slots[i] ? captureSlot(slots[i]) : captureFullFrame();

        // Update live strip preview with newly captured photo
        capturedStripCanvases.push(capCanvas);
        renderStripPreview(capturedStripCanvases);

        const blob = await new Promise(res => capCanvas.toBlob(res, 'image/png'));
        photos.push(blob);
        await new Promise(r => setTimeout(r, 600));
    }

    // Reset slot guide back to slot 0 after capture sequence completes
    currentSlotIndex = 0;
    if (slots.length) setSlotGuide(0, false);

    uploadPhotos(photos);
}

// ── Upload & result display ───────────────────────────────────────────────────
async function uploadPhotos(blobs) {
    statusBadge.innerText = "CREATING YOUR MEMORIES...";
    const formData = new FormData();
    blobs.forEach((b, i) => formData.append(`photo_${i}`, b));
    if (selectedFrameName) formData.append('frame_name', selectedFrameName);

    const res  = await fetch('/api/save', { method: 'POST', body: formData });
    const data = await res.json();

    document.querySelector(".topbar").classList.add("hidden");
    document.getElementById("cameraStage").classList.add("hidden");
    document.getElementById("resultWrap").classList.remove("hidden");
    document.getElementById("resultImg").src    = data.strip_url;
    document.getElementById("qrImg").src        = data.qr_url;
    document.getElementById("downloadLink").href = `/download/${data.session_id}`;
}

init();