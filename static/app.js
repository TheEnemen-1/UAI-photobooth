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
const shutterSound = new Audio("https://assets.mixkit.co/active_storage/sfx/2852/2852-preview.mp3");

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
    canvasElement.style.transform = val;
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
    btnSelectFrame.textContent = '🖼️ Select Frame';

    const container = document.querySelector(".camera-container");
    if (container) {
        if (video.videoWidth && video.videoHeight) {
            container.style.setProperty("--cam-aspect", `${video.videoWidth} / ${video.videoHeight}`);
        } else {
            container.style.setProperty("--cam-aspect", "16 / 9");
        }
    }
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
        frameImg.src = `/frames/${encodeURIComponent(selectedFrameName)}`;

        // Animate the first slot guide into position
        if (frameMeta?.slots?.length) {
            setSlotGuide(0, false); // appear without animation from a previous guide
        }
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
    canvasCtx.font      = 'bold 16px Montserrat, sans-serif';
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
        canvasCtx.font      = `bold ${isActive ? 14 : 12}px Montserrat, sans-serif`;
        canvasCtx.fillText(`${i + 1}`, sx + 5, sy + 17);
    });

    canvasCtx.restore();
}

// ── Gesture detection ─────────────────────────────────────────────────────────
function isLSelection(landmarks) {
    const wrist = landmarks[0];
    const isThumbExt     = Math.hypot(landmarks[4].x - wrist.x, landmarks[4].y - wrist.y) >
                           Math.hypot(landmarks[2].x - wrist.x, landmarks[2].y - wrist.y);
    const isIndexExt     = Math.hypot(landmarks[8].x - wrist.x, landmarks[8].y - wrist.y) >
                           Math.hypot(landmarks[6].x - wrist.x, landmarks[6].y - wrist.y);
    const isOthersCurled = [12, 16, 20].every(i =>
        Math.hypot(landmarks[i].x - wrist.x, landmarks[i].y - wrist.y) <
        Math.hypot(landmarks[i - 2].x - wrist.x, landmarks[i - 2].y - wrist.y)
    );
    return isThumbExt && isIndexExt && isOthersCurled;
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

    // Always take exactly 4 photos; extra slots beyond 4 are ignored,
    // and shots without a matching slot fall back to full-frame capture.
    for (let j = 1; j <= 4; j++) document.getElementById(`thumb${j}`).innerHTML = "";

    for (let i = 0; i < 4; i++) {
        currentSlotIndex = i;

        // Animate slot guide to the current position before the countdown
        // (no animation for shot 0 — the guide is already in place from selection)
        if (slots[i]) setSlotGuide(i, i > 0);

        for (let c = 3; c > 0; c--) {
            statusBadge.innerText = `PREPARING PHOTO ${i + 1}/4... 🌟`;
            countdownEl.innerText = c;
            countdownEl.classList.remove("hidden");
            await new Promise(r => setTimeout(r, 1000));
        }
        countdownEl.classList.add("hidden");

        // Shutter sound + flash
        shutterSound.currentTime = 0;
        shutterSound.play().catch(() => {});
        flashDiv.classList.add("do-flash");
        setTimeout(() => flashDiv.classList.remove("do-flash"), 400);

        // Capture: center-crop to slot dimensions if a frame is active
        const capCanvas = slots[i] ? captureSlot(slots[i]) : captureFullFrame();

        // Show thumbnail
        const thumbImg = document.createElement("img");
        thumbImg.src   = capCanvas.toDataURL("image/png");
        document.getElementById(`thumb${i + 1}`).appendChild(thumbImg);

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