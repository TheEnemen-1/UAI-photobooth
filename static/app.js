import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const video = document.getElementById("video");
const canvasElement = document.getElementById("overlay");
const canvasCtx = canvasElement.getContext("2d");
const statusBadge = document.getElementById("statusBadge");
const cameraSelect = document.getElementById("cameraSelect");
const frameInput = document.getElementById("frameInput");
const btnFlip = document.getElementById("btnFlip");
const flashDiv = document.getElementById("flash");

// Âm thanh chụp ảnh
const shutterSound = new Audio("https://assets.mixkit.co/active_storage/sfx/2852/2852-preview.mp3");

let handLandmarker;
let isCapturing = false;
let gestureStart = null;
let isMirrored = true;

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

btnFlip.onclick = () => {
    isMirrored = !isMirrored;
    const val = isMirrored ? "scaleX(-1)" : "scaleX(1)";
    video.style.transform = val;
    canvasElement.style.transform = val;
};

async function setupCameraList() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    devices.filter(d => d.kind === 'videoinput').forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.text = d.label || `Camera ${cameraSelect.length + 1}`;
        cameraSelect.appendChild(opt);
    });
    cameraSelect.onchange = startCamera;
}

async function startCamera() {
    const constraints = { video: { deviceId: cameraSelect.value ? { exact: cameraSelect.value } : undefined, width: 1280, height: 720 } };
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
    const isThumbExt = Math.hypot(landmarks[4].x - wrist.x, landmarks[4].y - wrist.y) > Math.hypot(landmarks[2].x - wrist.x, landmarks[2].y - wrist.y);
    const isIndexExt = Math.hypot(landmarks[8].x - wrist.x, landmarks[8].y - wrist.y) > Math.hypot(landmarks[6].x - wrist.x, landmarks[6].y - wrist.y);
    const isOthersCurled = [12, 16, 20].every(i => Math.hypot(landmarks[i].x - wrist.x, landmarks[i].y - wrist.y) < Math.hypot(landmarks[i-2].x - wrist.x, landmarks[i-2].y - wrist.y));
    return isThumbExt && isIndexExt && isOthersCurled;
}

async function predict() {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (handLandmarker && !isCapturing) {
        const results = await handLandmarker.detectForVideo(video, performance.now());
        const handCount = results.landmarks ? results.landmarks.length : 0;

        if (handCount === 0) {
            statusBadge.innerText = "Giơ 2 tay hình chữ L (Son Heung Min) để chụp! ✋✋";
            gestureStart = null;
        } else if (handCount === 1) {
            statusBadge.innerText = "Đã thấy 1 tay. Giơ thêm tay kia nhé! ✨";
            gestureStart = null;
        } else {
            const handsL = results.landmarks.filter(isLSelection);
            if (handsL.length >= 2) {
                if (!gestureStart) gestureStart = Date.now();
                const elapsed = Date.now() - gestureStart;

                // THÊM LẠI KHUNG HIỆU ỨNG NHẬN DIỆN
                canvasCtx.strokeStyle = "#ff914d";
                canvasCtx.lineWidth = 12;
                canvasCtx.setLineDash([20, 10]);
                canvasCtx.strokeRect(40, 40, canvasElement.width - 80, canvasElement.height - 80);
                canvasCtx.setLineDash([]);

                if (elapsed > 1000) { startPhotoboothFlow(); return; }
                statusBadge.innerText = `ĐANG NHẬN DIỆN... ${(elapsed/1000).toFixed(1)}s`;
            } else {
                statusBadge.innerText = "Hãy giơ 2 tay đúng hình chữ L";
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
    
    // Reset các ô demo ảnh
    for(let j=1; j<=4; j++) document.getElementById(`thumb${j}`).innerHTML = "";

    for (let i = 0; i < 4; i++) {
        for (let c = 3; c > 0; c--) {
            statusBadge.innerText = `CHUẨN BỊ CHỤP TẤM ${i+1}/4`;
            countdownEl.innerText = c;
            countdownEl.classList.remove("hidden");
            await new Promise(r => setTimeout(r, 1000));
        }
        
        countdownEl.classList.add("hidden");
        
        // Hiệu ứng nháy sáng và tiếng kêu
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
        
        // Đưa ảnh vào lưới demo theo thứ tự 1-3 (trên), 2-4 (dưới)
        // i=0 -> thumb1, i=1 -> thumb2, i=2 -> thumb3, i=3 -> thumb4
        const thumbImg = document.createElement("img");
        thumbImg.src = capCanvas.toDataURL("image/png");
        document.getElementById(`thumb${i+1}`).appendChild(thumbImg);

        const blob = await new Promise(res => capCanvas.toBlob(res, 'image/png'));
        photos.push(blob);
        await new Promise(r => setTimeout(r, 600)); 
    }
    uploadPhotos(photos);
}

async function uploadPhotos(blobs) {
    statusBadge.innerText = "ĐANG TẠO DẢI ẢNH KỶ NIỆM...";
    const formData = new FormData();
    blobs.forEach((b, i) => formData.append(`photo_${i}`, b));
    if (frameInput.files[0]) formData.append('frame', frameInput.files[0]);

    const res = await fetch('/api/save', { method: 'POST', body: formData });
    const data = await res.json();
    
    document.getElementById("cameraStage").classList.add("hidden");
    document.getElementById("resultWrap").classList.remove("hidden");
    document.getElementById("resultImg").src = data.strip_url;
    document.getElementById("qrImg").src = data.qr_url;
    document.getElementById("downloadLink").href = `/download/${data.session_id}`;
}

init();