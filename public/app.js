// ==========================================================================
// AI Photobooth - app.js
// Dùng MediaPipe Tasks Vision (chạy client-side, không cần backend AI)
// ==========================================================================
import {
  FilesetResolver,
  FaceLandmarker,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// ---------- DOM ----------
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const captureCanvas = document.getElementById("captureCanvas");
const cameraSelect = document.getElementById("cameraSelect");
const filterInput = document.getElementById("filterInput");
const frameInput = document.getElementById("frameInput");
const statusBadge = document.getElementById("statusBadge");
const countdownEl = document.getElementById("countdown");
const cameraWrap = document.getElementById("cameraWrap");
const resultWrap = document.getElementById("resultWrap");
const resultImg = document.getElementById("resultImg");
const qrImg = document.getElementById("qrImg");
const downloadLink = document.getElementById("downloadLink");
const retakeBtn = document.getElementById("retakeBtn");

// ---------- State ----------
let faceLandmarker, handLandmarker;
let currentStream = null;
let filterImg = null;      // ảnh filter mặt (PNG nền trong suốt), do người dùng chọn
let frameImg = null;       // ảnh khung (frame) ghép cuối, do người dùng chọn
let lastFaceResult = null;
let lastHandResult = null;

let gestureHoldStartTs = null;   // thời điểm bắt đầu giữ đúng tư thế tay
let isCapturing = false;         // đang trong quá trình đếm ngược/chụp
const HOLD_MS = 1000;            // phải giữ tư thế tay 1s
const COUNTDOWN_S = 3;           // đếm ngược 3s trước khi chụp

let mediaRecorder = null;
let recordedChunks = [];

// ==========================================================================
// 1. Khởi tạo models MediaPipe
// ==========================================================================
async function initModels() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
  });

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

// ==========================================================================
// 2. Camera: liệt kê & khởi động (hỗ trợ cả webcam tích hợp lẫn camera USB,
//    vì cả hai đều xuất hiện như "videoinput" device chuẩn của trình duyệt)
// ==========================================================================
async function listCameras() {
  // Cần xin quyền camera 1 lần trước thì label thiết bị mới hiện đầy đủ
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === "videoinput");
  cameraSelect.innerHTML = "";
  cams.forEach((cam, i) => {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `Camera ${i + 1}`;
    cameraSelect.appendChild(opt);
  });
}

async function startCamera(deviceId) {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
  }
  const constraints = {
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: 1280, height: 960 }
      : { width: 1280, height: 960, facingMode: "user" },
    audio: false,
  };
  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = currentStream;
  await video.play();
  overlay.width = captureCanvas.width = video.videoWidth;
  overlay.height = captureCanvas.height = video.videoHeight;
}

cameraSelect.addEventListener("change", () => startCamera(cameraSelect.value));

// ==========================================================================
// 3. Nạp ảnh filter mặt / frame do người dùng chọn
// ==========================================================================
function loadImageFile(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = URL.createObjectURL(file);
  });
}
filterInput.addEventListener("change", async (e) => {
  if (e.target.files[0]) filterImg = await loadImageFile(e.target.files[0]);
});
frameInput.addEventListener("change", async (e) => {
  if (e.target.files[0]) frameImg = await loadImageFile(e.target.files[0]);
});

// ==========================================================================
// 4. Vẽ filter mặt theo landmark khuôn mặt (tự scale/xoay -> hợp mọi khuôn
//    mặt nam/nữ, không cần chỉnh tay)
// ==========================================================================
function drawFaceFilter(ctx, landmarks, vw, vh) {
  if (!filterImg || !landmarks) return;

  // Điểm mốc: tâm 2 mắt để tính vị trí, khoảng cách 2 mắt để tính scale,
  // góc nghiêng đầu để xoay filter theo.
  const leftEye = landmarks[33];   // khoé mắt trái (theo hệ toạ độ MediaPipe)
  const rightEye = landmarks[263]; // khoé mắt phải
  const noseTip = landmarks[1];

  const lx = leftEye.x * vw, ly = leftEye.y * vh;
  const rx = rightEye.x * vw, ry = rightEye.y * vh;
  const nx = noseTip.x * vw, ny = noseTip.y * vh;

  const eyeDist = Math.hypot(rx - lx, ry - ly);
  const angle = Math.atan2(ry - ly, rx - lx);

  // Anchor mặc định: tâm giữa 2 mắt, cách chuẩn ra theo tỉ lệ mắt.
  const cx = (lx + rx) / 2;
  const cy = (ly + ry) / 2;

  // Kích thước filter tỉ lệ theo khoảng cách 2 mắt (điều chỉnh hệ số
  // FILTER_SCALE tuỳ ảnh filter thật tế của bạn).
  const FILTER_SCALE = 3.0; // chỉnh nếu ảnh filter to/nhỏ hơn mong muốn
  const drawW = eyeDist * FILTER_SCALE;
  const drawH = drawW * (filterImg.height / filterImg.width);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.drawImage(filterImg, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
  void nx; void ny; // (giữ lại nếu bạn cần định vị theo mũi cho filter khác)
}

// ==========================================================================
// 5. Nhận diện cử chỉ tay hình chữ nhật (kiểu "khung ảnh" - Son Heung Min)
//    - Không cần 2 tay chạm nhau, chỉ cần MỖI TAY tạo góc L (ngón cái +
//      ngón trỏ vuông góc), và 2 tay đối xứng 2 bên khung hình.
// ==========================================================================
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleBetween(o, p1, p2) {
  // góc tại điểm o giữa 2 vector o->p1 và o->p2 (độ)
  const v1 = { x: p1.x - o.x, y: p1.y - o.y };
  const v2 = { x: p2.x - o.x, y: p2.y - o.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 === 0 || mag2 === 0) return 0;
  const cos = Math.min(1, Math.max(-1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

// index của các landmark bàn tay MediaPipe
const WRIST = 0, THUMB_MCP = 2, THUMB_TIP = 4;
const INDEX_MCP = 5, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_TIP = 12;
const RING_MCP = 13, RING_TIP = 16;
const PINKY_MCP = 17, PINKY_TIP = 20;

function isFingerCurled(lm, mcp, tip) {
  // ngón "gập" nếu đầu ngón gần lòng bàn tay (wrist) hơn khớp gốc
  return dist(lm[tip], lm[WRIST]) < dist(lm[mcp], lm[WRIST]) * 1.05;
}

function isSingleHandFrameShape(lm) {
  // Ngón cái & ngón trỏ phải DUỖI THẲNG (tạo góc L), 3 ngón còn lại gập lại
  const middleCurled = isFingerCurled(lm, MIDDLE_MCP, MIDDLE_TIP);
  const ringCurled = isFingerCurled(lm, RING_MCP, RING_TIP);
  const pinkyCurled = isFingerCurled(lm, PINKY_MCP, PINKY_TIP);

  const thumbExtended = dist(lm[THUMB_TIP], lm[WRIST]) > dist(lm[THUMB_MCP], lm[WRIST]) * 1.2;
  const indexExtended = dist(lm[INDEX_TIP], lm[WRIST]) > dist(lm[INDEX_MCP], lm[WRIST]) * 1.2;

  // Góc giữa ngón cái & ngón trỏ tại cổ tay ~ 60-120 độ => dáng "chữ L"
  const angle = angleBetween(lm[WRIST], lm[THUMB_TIP], lm[INDEX_TIP]);
  const isLShape = angle > 55 && angle < 130;

  return middleCurled && ringCurled && pinkyCurled && thumbExtended && indexExtended && isLShape;
}

function detectFrameGesture(handsResult) {
  if (!handsResult || !handsResult.landmarks || handsResult.landmarks.length < 2) {
    return false;
  }
  // Cả 2 tay (dù tách xa nhau bao nhiêu) đều phải ở dáng chữ L
  return handsResult.landmarks.every((lm) => isSingleHandFrameShape(lm));
}

// ==========================================================================
// 6. Vòng lặp detect chính (mỗi frame)
// ==========================================================================
function detectLoop() {
  requestAnimationFrame(detectLoop);
  if (video.readyState < 2 || !faceLandmarker || !handLandmarker) return;

  const ts = performance.now();
  lastFaceResult = faceLandmarker.detectForVideo(video, ts);
  lastHandResult = handLandmarker.detectForVideo(video, ts);

  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  // vẽ filter mặt lên overlay preview
  if (lastFaceResult?.faceLandmarks?.[0]) {
    drawFaceFilter(overlayCtx, lastFaceResult.faceLandmarks[0], overlay.width, overlay.height);
  }

  if (!isCapturing) {
    const gestureOk = detectFrameGesture(lastHandResult);
    handleGestureState(gestureOk);
  }
}

function handleGestureState(gestureOk) {
  const now = performance.now();
  if (gestureOk) {
    if (gestureHoldStartTs === null) gestureHoldStartTs = now;
    const held = now - gestureHoldStartTs;
    if (held >= HOLD_MS) {
      statusBadge.textContent = "✅ Đã nhận diện! Chuẩn bị chụp...";
      triggerCountdownCapture();
    } else {
      statusBadge.textContent = `✋ Giữ nguyên tư thế... (${(held / 1000).toFixed(1)}s / 1.0s)`;
    }
  } else {
    gestureHoldStartTs = null;
    statusBadge.textContent = "Đưa 2 tay lên tạo khung hình chữ nhật để chụp ✋🖼✋";
  }
}

// ==========================================================================
// 7. Đếm ngược 3s + quay video 3s (đúng khoảng đếm ngược) + chụp ảnh cuối
// ==========================================================================
async function triggerCountdownCapture() {
  isCapturing = true;
  gestureHoldStartTs = null;
  countdownEl.classList.remove("hidden");

  startRecording(); // bắt đầu quay video ngay khi bắt đầu đếm ngược 3s

  for (let s = COUNTDOWN_S; s >= 1; s--) {
    countdownEl.textContent = s;
    await sleep(1000);
  }
  countdownEl.classList.add("hidden");

  await capturePhoto();
  await stopRecordingAndGetBlob(); // video 3s trước khi chụp
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Quay lại đúng những gì overlay đang hiển thị (video + filter mặt) bằng
// cách capture stream từ 1 canvas "trộn" video+overlay theo thời gian thực.
let recordCanvas, recordCtx, recordRafId;
function startRecording() {
  recordCanvas = document.createElement("canvas");
  recordCanvas.width = video.videoWidth;
  recordCanvas.height = video.videoHeight;
  recordCtx = recordCanvas.getContext("2d");

  const drawFrame = () => {
    recordCtx.save();
    recordCtx.translate(recordCanvas.width, 0);
    recordCtx.scale(-1, 1); // mirror giống hiển thị
    recordCtx.drawImage(video, 0, 0, recordCanvas.width, recordCanvas.height);
    if (lastFaceResult?.faceLandmarks?.[0]) {
      drawFaceFilter(recordCtx, lastFaceResult.faceLandmarks[0], recordCanvas.width, recordCanvas.height);
    }
    recordCtx.restore();
    recordRafId = requestAnimationFrame(drawFrame);
  };
  drawFrame();

  const stream = recordCanvas.captureStream(30);
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.start();
}

function stopRecordingAndGetBlob() {
  return new Promise((resolve) => {
    if (!mediaRecorder) return resolve(null);
    mediaRecorder.onstop = () => {
      cancelAnimationFrame(recordRafId);
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      resolve(blob);
      window.__lastVideoBlob = blob; // lưu tạm để dùng ở bước upload
    };
    mediaRecorder.stop();
  });
}

// ==========================================================================
// 8. Chụp ảnh cuối cùng (video hiện tại + filter mặt), rồi cho phép ghép
//    thêm khung frame (nếu người dùng đã chọn) trước khi upload.
// ==========================================================================
async function capturePhoto() {
  const ctx = captureCanvas.getContext("2d");
  captureCanvas.width = video.videoWidth;
  captureCanvas.height = video.videoHeight;

  ctx.save();
  ctx.translate(captureCanvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
  if (lastFaceResult?.faceLandmarks?.[0]) {
    drawFaceFilter(ctx, lastFaceResult.faceLandmarks[0], captureCanvas.width, captureCanvas.height);
  }
  ctx.restore();

  // Ghép frame trang trí (ảnh do người dùng cung cấp sau) phủ toàn canvas
  if (frameImg) {
    ctx.drawImage(frameImg, 0, 0, captureCanvas.width, captureCanvas.height);
  }

  const photoBlob = await new Promise((res) => captureCanvas.toBlob(res, "image/png"));
  await finishCaptureFlow(photoBlob);
}

// ==========================================================================
// 9. Upload lên server -> nhận link + QR -> hiển thị kết quả
// ==========================================================================
async function finishCaptureFlow(photoBlob) {
  resultImg.src = URL.createObjectURL(photoBlob);
  cameraWrap.classList.add("hidden");
  resultWrap.classList.remove("hidden");

  // đợi video ghi xong (đã resolve ở stopRecordingAndGetBlob, lưu ở window.__lastVideoBlob)
  await sleep(100);
  const videoBlob = window.__lastVideoBlob;

  const form = new FormData();
  form.append("photo", photoBlob, "photo.png");
  if (videoBlob) form.append("video", videoBlob, "video.webm");

  try {
    const res = await fetch("/api/save", { method: "POST", body: form });
    const data = await res.json();
    qrImg.src = data.qrDataUrl;
    downloadLink.href = data.downloadUrl;
    downloadLink.textContent = data.downloadUrl;
  } catch (err) {
    console.error("Upload lỗi:", err);
  }

  isCapturing = false;
}

retakeBtn.addEventListener("click", () => {
  resultWrap.classList.add("hidden");
  cameraWrap.classList.remove("hidden");
  statusBadge.textContent = "Đưa 2 tay lên tạo khung hình chữ nhật để chụp ✋🖼✋";
});

// ==========================================================================
// 10. Bootstrap
// ==========================================================================
(async function main() {
  try {
    // xin quyền + start camera mặc định trước để lấy được label thiết bị
    await startCamera(null);
    await listCameras();
    await initModels();
    detectLoop();
  } catch (err) {
    console.error(err);
    statusBadge.textContent = "❌ Không truy cập được camera. Hãy cấp quyền camera cho trình duyệt.";
  }
})();
