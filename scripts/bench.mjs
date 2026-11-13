// Đánh giá tải: N thiết bị gửi sự kiện song song trong T giây → thông lượng, độ trễ p50/p95/p99, tỉ lệ lỗi.
// Dùng: npm run bench -- <session_id> [thiết bị=20] [giây=10]   (dùng phiên thi thử — sự kiện được ghi vào nhật ký phiên đó)
import { createClient } from '@supabase/supabase-js';

const [sid, n = 20, secs = 10] = process.argv.slice(2).map(Number);
const KEY = process.env.DEVICE_KEY || 'dev-key-123';
if (!sid) { console.error('Thiếu session_id'); process.exit(1); }
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const lat = [], end = Date.now() + secs * 1000;
let errors = 0, lastError = '';
await Promise.all(Array.from({ length: n }, async (_, i) => {
  while (Date.now() < end) {
    const t = performance.now();
    const { error } = await sb.rpc('device_event', { p_key: KEY, p_session: sid, p_source: 'iot', p_type: 'room_status', p_detail: { bench: i }, p_dts: Date.now() });
    if (error) { errors++; lastError = error.message; } else lat.push(performance.now() - t);
  }
}));
lat.sort((a, b) => a - b);
const p = (x) => lat[Math.floor((lat.length - 1) * x)]?.toFixed(1);
console.log(`${n} thiết bị × ${secs}s: ${lat.length} sự kiện OK, ${errors} lỗi${errors ? ` (${lastError})` : ''}, ${(lat.length / secs).toFixed(0)} sự kiện/s`);
console.log(`Độ trễ khứ hồi (ms): p50=${p(0.5)}  p95=${p(0.95)}  p99=${p(0.99)}  max=${lat.at(-1)?.toFixed(1)}`);
