// Giả lập thiết bị phòng thi khi chưa có phần cứng: cảm biến IoT (nhiệt độ, tiếng ồn) + camera Edge AI.
// Dùng: npm run sim -- <session_id> [giây=30]
// Chỉ sự kiện bất thường rời khỏi "biên" — khung hình thô không bao giờ được gửi lên cloud.
import { createClient } from '@supabase/supabase-js';

const [sid, secs = 30] = process.argv.slice(2).map(Number);
const KEY = process.env.DEVICE_KEY || 'dev-key-123';
if (!sid) { console.error('Thiếu session_id (số phiên hiện trên màn hình thi)'); process.exit(1); }
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const post = (source, type, detail, dts) =>
  sb.rpc('device_event', { p_key: KEY, p_session: sid, p_source: source, p_type: type, p_detail: detail, p_dts: dts })
    .then(({ error }) => error && console.error('lỗi:', error.message));

// ponytail: mô hình giả (ngẫu nhiên). Thay bằng ONNX/MediaPipe đọc webcam thật; giữ nguyên hợp đồng trả về { type, conf } | null.
const detect = () => {
  const r = Math.random();
  return r < 0.04 ? { type: 'multi_person', conf: +(0.8 + Math.random() * 0.2).toFixed(2) } : r < 0.07 ? { type: 'no_face', conf: 0.9 } : null;
};

let frames = 0, sent = 0;
const iot = setInterval(() => {
  const noise = Math.round(35 + Math.random() * 45);
  post('iot', noise > 70 ? 'room_noise_high' : 'room_status', { temp: +(26 + Math.random() * 3).toFixed(1), noise_db: noise }, Date.now());
}, 2000);
const edge = setInterval(() => {
  frames++;
  const r = detect();
  if (r) { sent++; post('edge', r.type, { conf: r.conf }, Date.now()); }
}, 500);

setTimeout(() => {
  clearInterval(iot); clearInterval(edge);
  console.log(`Edge: ${frames} khung hình xử lý tại chỗ, chỉ gửi ${sent} sự kiện (${(100 - (sent / frames) * 100).toFixed(0)}% dữ liệu không rời thiết bị)`);
}, secs * 1000);
