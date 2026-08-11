import { FilesetResolver, HandLandmarker, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const video = document.getElementById("video");
const canvasElement = document.getElementById("overlay");
const canvasCtx = canvasElement.getContext("2d");
const countdownEl = document.getElementById("countdown");
const statusBadge = document.getElementById("statusBadge");

let handLandmarker;
let isCapturing = false;
let gestureStart = null;
const drawingUtils = new DrawingUtils(canvasCtx);

async function init() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2
    });
    startCamera();
}

async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
        canvasElement.width = video.videoWidth;
        canvasElement.height = video.videoHeight;
        predict();
    };
}

// Hàm tính khoảng cách giữa 2 điểm
function getDist(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Logic kiểm tra chữ L (Ngón cái và ngón trỏ duỗi, các ngón khác gập)
function isLSelection(landmarks) {
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];

    // Một ngón tay được coi là "duỗi" nếu đầu ngón xa cổ tay hơn khớp gốc
    const isThumbExt = getDist(thumbTip, wrist) > getDist(landmarks[2], wrist);
    const isIndexExt = getDist(indexTip, wrist) > getDist(landmarks[6], wrist);
    const isMiddleCurled = getDist(middleTip, wrist) < getDist(landmarks[10], wrist);
    const isRingCurled = getDist(ringTip, wrist) < getDist(landmarks[14], wrist);
    const isPinkyCurled = getDist(pinkyTip, wrist) < getDist(landmarks[18], wrist);

    return isThumbExt && isIndexExt && isMiddleCurled && isRingCurled && isPinkyCurled;
}

async function predict() {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (handLandmarker && !isCapturing) {
        const results = await handLandmarker.detectForVideo(video, performance.now());
        
        if (results.landmarks && results.landmarks.length > 0) {
            // Vẽ các điểm mốc tay để người dùng biết camera đã nhận diện
            for (const landmarks of results.landmarks) {
                drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 2 });
                drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
            }

            // Kiểm tra nếu có đủ 2 tay tạo hình chữ L
            const handsL = results.landmarks.filter(isLSelection);
            
            if (handsL.length >= 2) {
                if (!gestureStart) gestureStart = Date.now();
                const elapsed = Date.now() - gestureStart;
                
                if (elapsed > 1000) {
                    startPhotoboothFlow();
                } else {
                    statusBadge.innerText = `Đang giữ... ${(elapsed/1000).toFixed(1)}s`;
                    statusBadge.style.background = "#00FF00";
                }
            } else {
                gestureStart = null;
                statusBadge.innerText = `Hãy giơ 2 tay hình chữ L (Thấy ${results.landmarks.length} tay)`;
                statusBadge.style.background = "#ff914d";
            }
        } else {
            gestureStart = null;
            statusBadge.innerText = "Không thấy tay. Hãy đưa tay vào khung hình ✋";
        }
    }
    requestAnimationFrame(predict);
}

async function startPhotoboothFlow() {
    isCapturing = true;
    const photos = [];
    
    for (let i = 0; i < 4; i++) {
        statusBadge.innerText = `Chuẩn bị chụp tấm ${i + 1}/4...`;
        for (let c = 3; c > 0; c--) {
            countdownEl.innerText = c;
            countdownEl.classList.remove("hidden");
            await new Promise(r => setTimeout(r, 1000));
        }
        countdownEl.innerText = "📸";
        await new Promise(r => setTimeout(r, 200)); // Hiệu ứng chớp nhoáng
        
        countdownEl.classList.add("hidden");
        
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0);
        
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        photos.push(blob);
    }
    
    statusBadge.innerText = "Đang xử lý ảnh đẹp...";
    uploadPhotos(photos);
}

async function uploadPhotos(blobs) {
    const formData = new FormData();
    blobs.forEach((blob, i) => formData.append(`photo_${i}`, blob));

    try {
        const res = await fetch('/api/save', { method: 'POST', body: formData });
        const data = await res.json();
        
        document.getElementById("cameraWrap").classList.add("hidden");
        document.getElementById("resultWrap").classList.remove("hidden");
        document.getElementById("qrImg").src = data.qr_url;
        document.getElementById("downloadLink").href = `/download/${data.session_id}`;
    } catch (e) {
        alert("Lỗi lưu ảnh!");
        isCapturing = false;
    }
}

init();