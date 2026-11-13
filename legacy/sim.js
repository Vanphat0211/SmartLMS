// Giả lập thiết bị: IoT (cảm biến phòng thi) + Edge AI (phát hiện bất thường tại biên).
// Dùng: node sim.js <session_id> [seconds=30]
// Chỉ sự kiện bất thường rời khỏi "biên" — frame thô không bao giờ được gửi.
const [sid, secs = 30] = process.argv.slice(2).map(Number);
const URL = process.env.URL || 'http://localhost:3000';
const KEY = process.env.DEVICE_KEY || 'dev-key-123';
if (!sid) { console.error('Thiếu session_id'); process.exit(1); }

const post = (source, type, detail, dts) =>
  fetch(URL + '/api/events', { method: 'POST', headers: { 'x-device-key': KEY }, body: JSON.stringify({ session_id: sid, source, type, detail, dts }) }).then(r => r.ok || console.error('lỗi', r.status));

// ponytail: mô hình giả (ngẫu nhiên). Thay bằng ONNX/MediaPipe đọc webcam thật; giữ nguyên hợp đồng trả về { type, conf } | null.
const detect = () => { const r = Math.random(); return r < 0.04 ? { type: 'multi_person', conf: +(0.8 + Math.random() * 0.2).toFixed(2) } : r < 0.07 ? { type: 'no_face', conf: 0.9 } : null; };

let frames = 0, sent = 0;
const iot = setInterval(() => {
  const noise = Math.round(35 + Math.random() * 45), t = Date.now();
  post('iot', noise > 70 ? 'room_noise_high' : 'room_status', { temp: +(26 + Math.random() * 3).toFixed(1), noise_db: noise }, t);
}, 2000);
const edge = setInterval(() => {
  const t = Date.now(); frames++;
  const r = detect();
  if (r) { sent++; post('edge', r.type, { conf: r.conf }, t); }
}, 500);

setTimeout(() => {
  clearInterval(iot); clearInterval(edge);
  console.log(`Edge: ${frames} frame xử lý tại chỗ, chỉ gửi ${sent} sự kiện (${(100 - sent / frames * 100).toFixed(0)}% dữ liệu không rời thiết bị)`);
}, secs * 1000);
