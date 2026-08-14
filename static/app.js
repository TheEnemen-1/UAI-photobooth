import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const video = document.getElementById("video");
const canvasElement = document.getElementById("overlay");
const canvasCtx = canvasElement.getContext("2d");
const statusBadge = document.getElementById("statusBadge");
const cameraSelect = document.getElementById("cameraSelect");
const frameInput = document.getElementById("frameInput");
const btnFlip = document.getElementById("btnFlip");

let handLandmarker;
let isCapturing = false;
let gestureStart = null;
let isMirrored = true; // Mặc định là gương

async function init() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO", numHands: 2
    });
    
    setupCameraList();
    startCamera();
}

// Chức năng Flip Camera
btnFlip.onclick = () => {
    isMirrored = !isMirrored;
    if (isMirrored) {
        video.style.transform = "scaleX(-1)";
        canvasElement.style.transform = "scaleX(-1)";
    } else {
        video.style.transform = "scaleX(1)";
        canvasElement.style.transform = "scaleX(1)";
    }
};

async function setupCameraList() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    videoDevices.forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.text = d.label || `Camera ${cameraSelect.length + 1}`;
        cameraSelect.appendChild(opt);
    });
    cameraSelect.onchange = startCamera;
}

async function startCamera() {
    const constraints = { 
        video: { deviceId: cameraSelect.value ? { exact: cameraSelect.value } : undefined, width: 1280, height: 720 } 
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.onloadedmetadata = () => {
        canvasElement.width = video.videoWidth;
        canvasElement.height = video.videoHeight;
        predict();
    };
}

function isLSelection(landmarks) {
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const isThumbExt = Math.hypot(thumbTip.x - wrist.x, thumbTip.y - wrist.y) > Math.hypot(landmarks[2].x - wrist.x, landmarks[2].y - wrist.y);
    const isIndexExt = Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y) > Math.hypot(landmarks[6].x - wrist.x, landmarks[6].y - wrist.y);
    const isOthersCurled = [12, 16, 20].every(i => Math.hypot(landmarks[i].x - wrist.x, landmarks[i].y - wrist.y) < Math.hypot(landmarks[i-2].x - wrist.x, landmarks[i-2].y - wrist.y));
    return isThumbExt && isIndexExt && isOthersCurled;
}

async function predict() {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (handLandmarker && !isCapturing) {
        const results = await handLandmarker.detectForVideo(video, performance.now());
        const handCount = results.landmarks ? results.landmarks.length : 0;

        if (handCount === 0) {
            statusBadge.innerText = "ĐANG CHỜ NHẬN DIỆN 2 TAY... ✋✋";
            gestureStart = null;
        } else if (handCount === 1) {
            statusBadge.innerText = "ĐÃ THẤY 1 TAY. GIƠ THÊM TAY KIA NỮA NHÉ! ✨";
            gestureStart = null;
        } else {
            const handsL = results.landmarks.filter(isLSelection);
            if (handsL.length >= 2) {
                if (!gestureStart) gestureStart = Date.now();
                const elapsed = Date.now() - gestureStart;
                
                // Vẽ khung hiệu ứng
                canvasCtx.strokeStyle = "#00d2ff";
                canvasCtx.lineWidth = 10;
                canvasCtx.strokeRect(50, 50, canvasElement.width-100, canvasElement.height-100);

                if (elapsed > 1000) {
                    startPhotoboothFlow();
                    return;
                }
                statusBadge.innerText = `GIỮ NGUYÊN... ${(elapsed/1000).toFixed(1)}s`;
            } else {
                statusBadge.innerText = "HÃY TẠO HÌNH 2 CHỮ L ĐỂ CHỤP";
                gestureStart = null;
            }
        }
    }
    if(!isCapturing) requestAnimationFrame(predict);
}

async function startPhotoboothFlow() {
    isCapturing = true;
    const photos = [];
    const countdownEl = document.getElementById("countdown");

    for (let i = 0; i < 4; i++) {
        for (let c = 3; c > 0; c--) {
            statusBadge.innerText = `CHUẨN BỊ CHỤP TẤM ${i+1}/4`;
            countdownEl.innerText = c;
            countdownEl.classList.remove("hidden");
            await new Promise(r => setTimeout(r, 1000));
        }
        countdownEl.innerText = "📸";
        await new Promise(r => setTimeout(r, 300));
        countdownEl.classList.add("hidden");
        
        const capCanvas = document.createElement("canvas");
        capCanvas.width = video.videoWidth;
        capCanvas.height = video.videoHeight;
        const ctx = capCanvas.getContext("2d");
        
        if (isMirrored) {
            ctx.translate(capCanvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0);
        const blob = await new Promise(res => capCanvas.toBlob(res, 'image/png'));
        photos.push(blob);
    }
    uploadPhotos(photos);
}

async function uploadPhotos(blobs) {
    statusBadge.innerText = "ĐANG XỬ LÝ ẢNH...";
    const formData = new FormData();
    blobs.forEach((b, i) => formData.append(`photo_${i}`, b));
    if (frameInput.files[0]) formData.append('frame', frameInput.files[0]);

    const res = await fetch('/api/save', { method: 'POST', body: formData });
    const data = await res.json();
    
    document.getElementById("cameraWrap").classList.add("hidden");
    document.getElementById("resultWrap").classList.remove("hidden");
    document.getElementById("resultImg").src = data.strip_url;
    document.getElementById("qrImg").src = data.qr_url;
    document.getElementById("downloadLink").href = `/download/${data.session_id}`;
}

init();