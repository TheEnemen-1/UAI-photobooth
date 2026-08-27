import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const video = document.getElementById("video");
const canvasElement = document.getElementById("overlay");
const canvasCtx = canvasElement.getContext("2d");
const statusBadge = document.getElementById("statusBadge");
const cameraSelect = document.getElementById("cameraSelect");
const frameInput = document.getElementById("frameInput");
const btnFlip = document.getElementById("btnFlip");
const btnRefresh = document.getElementById("btnRefresh");
const flashDiv = document.getElementById("flash");

// Camera shutter sound effect
const shutterSound = new Audio("https://assets.mixkit.co/active_storage/sfx/2852/2852-preview.mp3");

let handLandmarker;
let isCapturing = false;
let gestureStart = null;
let isMirrored = true;
let currentStream = null;
let isPredicting = false;

// Initialize MediaPipe Hand Landmarker and start camera
async function init() {
    statusBadge.innerText = "Initializing AI Engine & Cameras...";
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO", numHands: 2
        });
    } catch (e) {
        console.error("MediaPipe initialization error:", e);
    }
    
    // First, request camera permission if not granted yet
    try {
        const initialStream = await navigator.mediaDevices.getUserMedia({ video: true });
        initialStream.getTracks().forEach(track => track.stop());
    } catch (err) {
        console.warn("Permission request error:", err);
    }

    await setupCameraList();
    await startCamera();

    if (btnRefresh) {
        btnRefresh.onclick = async () => {
            statusBadge.innerText = "Scanning camera devices...";
            await setupCameraList();
            await startCamera();
        };
    }

    // Re-populate list automatically when cameras are plugged/unplugged
    if (navigator.mediaDevices && navigator.mediaDevices.ondevicechange !== undefined) {
        navigator.mediaDevices.ondevicechange = async () => {
            await setupCameraList();
        };
    }
}

// Toggle mirror effect on video and overlay
btnFlip.onclick = () => {
    isMirrored = !isMirrored;
    const val = isMirrored ? "scaleX(-1)" : "scaleX(1)";
    video.style.transform = val;
    canvasElement.style.transform = val;
};

// Detect available cameras and populate the dropdown menu
async function setupCameraList() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        
        const previousVal = cameraSelect.value;
        cameraSelect.innerHTML = "";
        
        let targetEosDeviceId = null;
        let isNonProMatch = false;

        videoDevices.forEach((d, idx) => {
            const opt = document.createElement("option");
            opt.value = d.deviceId;
            const label = d.label || `Camera ${idx + 1}`;
            opt.text = label;
            cameraSelect.appendChild(opt);

            const labelLower = label.toLowerCase();
            const isPro = labelLower.includes("pro");

            // Explicitly prioritize Non-Pro "EOS Webcam Utility"
            if (labelLower.includes("eos webcam utility") && !isPro) {
                targetEosDeviceId = d.deviceId;
                isNonProMatch = true;
            } else if (!isNonProMatch && (labelLower.includes("eos") || labelLower.includes("canon")) && !isPro) {
                targetEosDeviceId = d.deviceId;
            } else if (!targetEosDeviceId && (labelLower.includes("eos") || labelLower.includes("canon"))) {
                targetEosDeviceId = d.deviceId;
            }
        });

        if (videoDevices.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.text = "No cameras detected";
            cameraSelect.appendChild(opt);
        } else {
            // Always auto-select Non-Pro "EOS Webcam Utility" if present
            if (targetEosDeviceId) {
                cameraSelect.value = targetEosDeviceId;
            } else if (previousVal && [...cameraSelect.options].some(o => o.value === previousVal)) {
                cameraSelect.value = previousVal;
            }
        }
        
        cameraSelect.onchange = () => startCamera();
    } catch (err) {
        console.error("Error setting up camera list:", err);
    }
}

// Start camera stream based on selected device ID
async function startCamera() {
    // Stop any existing stream tracks to release hardware
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }

    const targetDeviceId = cameraSelect.value;
    const selectedText = cameraSelect.options[cameraSelect.selectedIndex]?.text || "";

    // Array of fallback constraint strategies
    const constraintAttempts = [];

    if (targetDeviceId) {
        // Strategy 1: Ideal device ID with ideal resolution (DO NOT use 'exact' which breaks virtual DirectShow webcams)
        constraintAttempts.push({
            video: {
                deviceId: { ideal: targetDeviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });
        // Strategy 2: Exact device ID with no width/height requirement
        constraintAttempts.push({
            video: { deviceId: { exact: targetDeviceId } }
        });
        // Strategy 3: Loose device ID match
        constraintAttempts.push({
            video: { deviceId: targetDeviceId }
        });
    }

    // Strategy 4 & 5: Generic fallbacks
    constraintAttempts.push({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    constraintAttempts.push({ video: true });

    let activeStream = null;
    let lastError = null;

    for (const constraints of constraintAttempts) {
        try {
            activeStream = await navigator.mediaDevices.getUserMedia(constraints);
            if (activeStream) break;
        } catch (err) {
            lastError = err;
        }
    }

    if (!activeStream) {
        statusBadge.innerText = `⚠️ Camera Access Error: ${lastError ? lastError.message : "Device unavailable"}`;
        return;
    }

    currentStream = activeStream;
    video.srcObject = activeStream;
    try {
        await video.play();
    } catch (e) {
        console.warn("Video play error:", e);
    }

    video.onloadedmetadata = () => {
        canvasElement.width = video.videoWidth || 1280;
        canvasElement.height = video.videoHeight || 720;
        
        if (selectedText.toLowerCase().includes("eos") || selectedText.toLowerCase().includes("canon")) {
            statusBadge.innerText = "Connected to EOS Webcam Utility! (Ensure camera is in Movie Mode) 📸";
        } else {
            statusBadge.innerText = "Camera connected! Show two-hand L-shape to start ✨";
        }

        if (!isPredicting) {
            isPredicting = true;
            predict();
        }
    };
}

// Helper function to detect "L-shape" gesture using landmarks
function isLSelection(landmarks) {
    const wrist = landmarks[0];
    const isThumbExt = Math.hypot(landmarks[4].x - wrist.x, landmarks[4].y - wrist.y) > Math.hypot(landmarks[2].x - wrist.x, landmarks[2].y - wrist.y);
    const isIndexExt = Math.hypot(landmarks[8].x - wrist.x, landmarks[8].y - wrist.y) > Math.hypot(landmarks[6].x - wrist.x, landmarks[6].y - wrist.y);
    const isOthersCurled = [12, 16, 20].every(i => Math.hypot(landmarks[i].x - wrist.x, landmarks[i].y - wrist.y) < Math.hypot(landmarks[i-2].x - wrist.x, landmarks[i-2].y - wrist.y));
    return isThumbExt && isIndexExt && isOthersCurled;
}

// Continuous frame processing to detect hands and trigger capture
async function predict() {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Only process recognition if not currently in a capture sequence
    if (handLandmarker && !isCapturing) {
        const results = await handLandmarker.detectForVideo(video, performance.now());
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
                    // Recognition highlight frame - Only drawn during the 1-second holding period
                    canvasCtx.strokeStyle = "#ff914d";
                    canvasCtx.lineWidth = 12;
                    canvasCtx.setLineDash([20, 10]);
                    canvasCtx.strokeRect(40, 40, canvasElement.width - 80, canvasElement.height - 80);
                    canvasCtx.setLineDash([]);
                    statusBadge.innerText = `RECOGNIZING... ${(elapsed/1000).toFixed(1)}s`;
                }
            } else {
                statusBadge.innerText = "Please show both hands in L-shape (Son Heung-min) 👐";
                gestureStart = null;
            }
        }
    }
    // Always keep the loop running to ensure clear canvas when shooting
    requestAnimationFrame(predict);
}

// Manage the sequence of capturing 4 photos with countdowns
async function startPhotoboothFlow() {
    isCapturing = true;
    const photos = [];
    const countdownEl = document.getElementById("countdown");
    
    // NEW: Get the countdown duration from the select element
    const timerSelect = document.getElementById("timerSelect");
    const countdownDuration = parseInt(timerSelect.value) || 3;

    for(let j=1; j<=4; j++) document.getElementById(`thumb${j}`).innerHTML = "";

    for (let i = 0; i < 4; i++) {
        // Use the dynamic countdownDuration instead of hardcoded 3
        for (let c = countdownDuration; c > 0; c--) {
            statusBadge.innerText = `PREPARING PHOTO ${i+1}/4`;
            countdownEl.innerText = c;
            countdownEl.classList.remove("hidden");
            await new Promise(r => setTimeout(r, 1000));
        }
        
        countdownEl.classList.add("hidden");
        
        // Shutter sound and flash effect
        shutterSound.currentTime = 0;
        shutterSound.play().catch(e => console.log("Audio play failed", e));
        flashDiv.classList.add("do-flash");
        setTimeout(() => flashDiv.classList.remove("do-flash"), 400);
        
        const capCanvas = document.createElement("canvas");
        capCanvas.width = video.videoWidth;
        capCanvas.height = video.videoHeight;
        const ctx = capCanvas.getContext("2d");
        if (isMirrored) { ctx.translate(capCanvas.width, 0); ctx.scale(-1, 1); }
        ctx.drawImage(video, 0, 0);
        
        // Display thumbnail in the 2x2 grid
        const thumbImg = document.createElement("img");
        thumbImg.src = capCanvas.toDataURL("image/png");
        document.getElementById(`thumb${i+1}`).appendChild(thumbImg);

        const blob = await new Promise(res => capCanvas.toBlob(res, 'image/png'));
        photos.push(blob);
        await new Promise(r => setTimeout(r, 600)); 
    }
    uploadPhotos(photos);
}

// Send blobs to server, hide camera interface, and show result screen
async function uploadPhotos(blobs) {
    statusBadge.innerText = "CREATING YOUR MEMORIES...";
    const formData = new FormData();
    blobs.forEach((b, i) => formData.append(`photo_${i}`, b));
    if (frameInput.files[0]) formData.append('frame', frameInput.files[0]);

    const res = await fetch('/api/save', { method: 'POST', body: formData });
    const data = await res.json();
    
    // Hide controls and camera stage, show result wrap
    document.querySelector(".topbar").classList.add("hidden");
    document.getElementById("cameraStage").classList.add("hidden");
    document.getElementById("resultWrap").classList.remove("hidden");
    document.getElementById("resultImg").src = data.strip_url;
    document.getElementById("qrImg").src = data.qr_url;
    document.getElementById("downloadLink").href = `/download/${data.session_id}`;
}

init();