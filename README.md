# SmartLMS — Hệ thống quản lý học tập tích hợp IoT, Edge AI và dịch vụ đám mây

Hỗ trợ tổ chức học tập, kiểm tra đánh giá, quản lý kết quả đào tạo; giám sát và truy xuất sự kiện để bảo đảm tính toàn vẹn của kỳ thi trực tuyến.

- **Frontend:** React 19 + TypeScript + Vite + React Router
- **Backend:** Supabase — Postgres, Auth, Row Level Security, hàm RPC (PL/pgSQL), một Edge Function quản trị tài khoản. Không có server riêng.
- **Vai trò:** Quản trị viên (cấp & quản lý tài khoản), Giảng viên (tạo bài học, bài tập, bài kiểm tra), Sinh viên (học, nộp bài, làm bài thi). Mỗi vai trò có trang chủ và thanh điều hướng riêng.
- **Thiết bị:** IoT / Edge AI gọi RPC `device_event` qua HTTPS bằng khóa thiết bị. Hiện dùng script giả lập vì chưa có phần cứng.

## Kiến trúc

```
 Trình duyệt (React)  ──supabase-js──►  Supabase
   Admin / GV / SV                       ├─ Auth (email + mật khẩu, tài khoản do admin cấp)
                                         ├─ Edge Function admin-users (service role: tạo user, khóa, đặt lại mật khẩu)
                                         ├─ PostgREST ─► Postgres
 Thiết bị IoT / Edge AI ──HTTPS RPC────►  │    ├─ RLS: ai được đọc/ghi gì (theo vai trò, theo khóa học)
   (camera, cảm biến phòng thi)           │    ├─ RPC: start_exam, submit_exam, device_event, review_session…
   chỉ gửi sự kiện, không gửi video       │    └─ trigger: nhật ký sự kiện nối chuỗi băm SHA-256
```

Mọi luật nghiệp vụ nằm trong [supabase/migrations](supabase/migrations). Frontend chỉ là client mỏng nên không thể vượt quyền bằng cách sửa JS trên trình duyệt.

## Cấu trúc thư mục

```
├─ src/
│  ├─ main.tsx, App.tsx        điểm vào, khai báo route
│  ├─ auth.tsx                 cổng đăng nhập + hồ sơ người dùng (useMe)
│  ├─ components/              Layout (header, menu, badge hạn), ui (Card, Tabs, Meter…)
│  ├─ pages/                   mỗi màn hình một file (Home, CourseDetail, ExamRoom, Monitor, Reports…)
│  ├─ lib/                     supabase client, định dạng, hook tải dữ liệu, CSV, kiểu dữ liệu
│  └─ styles.css
├─ supabase/
│  ├─ config.toml              cấu hình Supabase CLI
│  ├─ migrations/              schema + RLS + RPC (nguồn sự thật của backend), áp theo thứ tự tên file
│  └─ functions/admin-users/   Edge Function quản trị tài khoản (handler.ts tách riêng để kiểm thử)
├─ scripts/
│  ├─ device-sim.mjs           giả lập cảm biến IoT + camera Edge AI
│  └─ bench.mjs                đo thông lượng / độ trễ nhận sự kiện
└─ tests/                      db (PGlite, không cần Docker), admin-users (Edge Function), i18n (đủ bản dịch)
```

## Cài đặt

Yêu cầu: Node.js 22.18+ và một project Supabase (gói Free là đủ).

1. **Cài thư viện:** `npm install`
2. **Tạo project** tại https://supabase.com/dashboard.
3. **Áp schema**: chạy **lần lượt** các file trong `supabase/migrations/` theo thứ tự tên. Chọn một trong hai cách:
   - Mở **SQL Editor** trên dashboard, dán từng file rồi bấm Run. Nếu đã chạy file `…_init.sql` từ trước thì chỉ cần chạy các file mới hơn.
   - Dùng CLI: `npx supabase login` → `npx supabase link --project-ref <ref>` → `npx supabase db push`. Nếu file init đã được dán tay qua SQL Editor, chạy `npx supabase migration repair --status applied 20261112000000` trước để CLI không chạy lại nó.
4. **Triển khai Edge Function quản trị tài khoản** (không cần Docker):
   ```
   npx supabase login
   npx supabase functions deploy admin-users --project-ref <ref> --use-api --no-verify-jwt
   ```
   Function tự kiểm tra token và vai trò admin. Service role key nằm sẵn trên server của Supabase, không bao giờ xuống trình duyệt.
5. **Tạo `.env`** ở thư mục gốc. Lấy giá trị ở dashboard → **Connect** hoặc **Project Settings → API Keys**:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<publishable / anon key>
   DEVICE_KEY=<khóa thiết bị, chỉ cần cho npm run sim / bench>
   ```
   Không đưa secret / service_role key vào `.env` của web, vì biến có tiền tố `VITE_` sẽ lộ ra trình duyệt.
6. **Tắt tự đăng ký** (dashboard → Authentication → Sign In / Providers → **Allow new users to sign up**: tắt). Tài khoản chỉ do admin cấp. Admin vẫn tạo được tài khoản khi mục này tắt.
7. **Tạo admin đầu tiên** (chỉ làm một lần): dashboard → Authentication → Users → **Add user → Create new user**, tick *Auto Confirm User*. Sau đó vào SQL Editor:
   ```sql
   update profiles set role = 'admin' where email = 'admin@truong.edu.vn';
   ```
8. **Chạy web:** `npm run dev` (hoặc nhấn F5 trong VS Code) rồi mở http://localhost:5173

### Vai trò

| Vai trò | Màn hình | Làm được gì |
|---|---|---|
| **Quản trị viên** (`admin`) | Bảng điều khiển quản trị, Tài khoản, Môn học, Giám sát thi, Báo cáo, Thiết bị IoT/Edge | Cấp tài khoản (một hoặc nhiều người, dán từ Excel), đổi vai trò, đặt lại mật khẩu, khóa/mở khóa; **tạo/sửa/xóa môn học** theo học kỳ và nhóm (ca), ngành/chương trình, lịch, phòng; **phân công giảng viên**; **nhập đăng ký môn từ edu**; **chuyển sinh viên giữa các nhóm**; cấp khóa thiết bị; thông báo toàn trường; xem giám sát, báo cáo mọi kỳ thi |
| **Giảng viên** (`teacher`) | Trang chủ, Khóa học, Kỳ thi, Lịch, Giám sát thi, Báo cáo | Dạy các lớp được admin phân công: **bài học** (nội dung + link tài liệu/video), bài tập, thông báo lớp, chuẩn đầu ra, ngân hàng câu hỏi có đáp án, **bài kiểm tra** có giới hạn thời gian và thiết lập **cho xem điểm ngay / ẩn đến khi công bố**; trang **Kết quả** từng bài thi (cả lớp, kể cả chưa làm, thống kê, xuất CSV); chấm bài tập; theo dõi **tiến độ**; rà soát cảnh báo |
| **Sinh viên** (`student`) | Trang chủ, Khóa học, Kỳ thi, Lịch, Kết quả học tập | **Tự có các môn đã đăng ký bên edu** trong học kỳ hiện tại; nhận thông báo; học bài và đánh dấu đã học, nộp bài tập, làm bài kiểm tra, xem điểm (khi giảng viên cho xem), mức đạt chuẩn đầu ra và **tiến độ học tập** |

Quy trình mỗi học kỳ:

1. Admin cấp tài khoản giảng viên, sinh viên (trang **Tài khoản**).
2. Admin tạo các lớp học phần của kỳ (trang **Môn học**): mã môn, tên, ngành, học kỳ `năm-kỳ` (vd `2026-1`), nhóm/ca, lịch, phòng, giảng viên.
3. Admin xuất danh sách đăng ký môn từ edu và dán vào **Nhập đăng ký môn từ edu**, mỗi dòng `email, mã môn, nhóm` (dán thẳng từ Excel được; môn chỉ có một nhóm thì bỏ trống nhóm). Sinh viên đã có tài khoản được ghi danh ngay; sinh viên chưa có tài khoản sẽ **tự được ghi danh khi admin cấp tài khoản sau**. Nhập lại nhiều lần không bị trùng.
4. Giảng viên vào lớp được phân công, thêm bài học, bài tập, câu hỏi, bài thi.
5. Sinh viên đăng nhập là thấy các môn của kỳ hiện tại (kỳ cũ xem lại bằng bộ lọc học kỳ).

**Điểm bài thi:** câu hỏi có đáp án nên hệ thống chấm ngay khi nộp. Nếu giảng viên chọn ẩn điểm, điểm bị che ở mức DB: sinh viên không đọc được qua bất kỳ API nào (bảng, view, RPC, bảng điểm, kết quả CLO). Giảng viên công bố ở trang Kết quả của bài thi.

Người dùng tự đổi họ tên, mật khẩu và quyền riêng tư danh bạ ở trang **Thông tin cá nhân**. Họ không tự đổi được vai trò: vai trò chỉ đến từ admin, thông qua `app_metadata` khi tạo tài khoản hoặc RPC `admin_set_role`.

## Chức năng

| Nhóm | Nội dung |
|---|---|
| Ngôn ngữ | Nút **English / Tiếng Việt** trên header và màn hình đăng nhập. Bản dịch nằm trong `src/lib/en.ts`, với khóa là chính câu tiếng Việt trong code. Dữ liệu người dùng nhập (tên khóa học, thông báo…) giữ nguyên. |
| Cổng thông tin | Công cụ, Cảnh báo, Thông báo của tôi, Công việc, Khóa học của tôi, Báo cáo; số mục đến hạn trong 7 ngày cạnh tên người dùng |
| Công cụ | Thông báo (toàn trường / khóa học), Lịch (màu theo khóa, bật/tắt từng lịch), Công việc, Kết quả học tập, Gửi email theo khóa, Danh bạ (có quyền riêng tư), Sổ địa chỉ, Thông tin cá nhân |
| Quản trị tài khoản | Cấp tài khoản hàng loạt (email, họ tên mỗi dòng), đổi vai trò, đặt lại mật khẩu, khóa thay vì xóa để giữ lịch sử điểm và nhật ký thi |
| Môn học & học kỳ | Lớp học phần theo học kỳ + nhóm (ca), ngành/chương trình, lịch, phòng, giảng viên phụ trách; nhập đăng ký môn từ edu, tự ghi danh (kể cả tài khoản tạo sau); chuyển sinh viên giữa các nhóm |
| Khóa học | Bài học có thứ tự (nội dung, tài liệu đính kèm, đánh dấu đã học), bài tập có hạn nộp → nộp → chấm + nhận xét, thông báo lớp, thành viên, chuẩn đầu ra (CLO) |
| Tiến độ học tập | Mỗi sinh viên, mỗi khóa: bài học đã học, bài tập đã nộp, kỳ thi đã làm, % hoàn thành. Sinh viên xem của mình; giảng viên xem cả lớp |
| Thi trực tuyến | Ngân hàng câu hỏi gắn CLO, đáp án tách bảng riêng (sinh viên không đọc được), xáo thứ tự câu, cửa sổ mở/đóng, tự nộp khi hết giờ, làm tiếp khi tải lại trang (có gắn cờ), chấm ngay khi nộp, **cho xem điểm ngay / ẩn đến khi công bố**, trang kết quả từng bài thi |
| Toàn vẹn kỳ thi | Trình duyệt ghi chuyển tab/cửa sổ, sao chép/dán, thoát toàn màn hình; thiết bị Edge/IoT gửi sự kiện. Nhật ký mỗi phiên nối **chuỗi băm**: sửa/xóa bất kỳ dòng nào trong DB đều bị `verify_chain` phát hiện. Kết luận rà soát cũng nằm trong chuỗi. |
| Giám sát & đánh giá | Giám sát thi trực tiếp (cập nhật mỗi 3 giây), báo cáo (cảnh báo theo loại, độ trễ biên→cloud p50/p95, điểm TB, kiểm tra toàn vẹn), truy xuất sự kiện xuyên phiên + xuất CSV, mức đạt chuẩn đầu ra |

Hệ thống chỉ **gắn cờ** bất thường để giảng viên / quản trị viên rà soát, không tự kết luận gian lận.

## Thiết bị IoT / Edge AI

Quản trị viên cấp khóa ở trang **Thiết bị IoT / Edge**. Khóa chỉ hiện một lần; DB chỉ lưu SHA-256 của khóa. Thiết bị gọi:

```
POST {SUPABASE_URL}/rest/v1/rpc/device_event
apikey: <anon key>
{ "p_key": "<khóa thiết bị>", "p_session": 12, "p_source": "edge" | "iot",
  "p_type": "multi_person", "p_detail": { "conf": 0.93 }, "p_dts": <epoch ms tại thiết bị> }

POST {SUPABASE_URL}/rest/v1/rpc/device_ping   { "p_key": "<khóa>" }    ← heartbeat
```

Khi chưa có phần cứng: quản trị viên cấp một khóa, dán vào `DEVICE_KEY` trong `.env`; sinh viên vào thi, xem số phiên trên màn hình, rồi chạy `npm run sim -- <số phiên>`. Độ trễ biên→cloud tính bằng `ts − dts`, nên đồng hồ thiết bị cần đồng bộ NTP.

## Kiểm thử & đánh giá

- `npm test` — chạy migration thật trên **PGlite** (Postgres 17 chạy trong Node) với lớp `auth` giả lập của Supabase. Kiểm tra RLS, RPC, phân quyền theo vai trò và khóa học, quản trị tài khoản, bài học và tiến độ, chấm thi, chuẩn đầu ra, khóa thiết bị, và chuỗi băm gãy khi sửa DB.
- `npm test` chạy luôn Edge Function `admin-users` với client giả: chặn người không phải admin, cấp tài khoản hàng loạt, không cho tự khóa mình.
- `npm test` cũng kiểm tra mọi chuỗi `t('…')` trong giao diện, lỗi DB và lỗi của Edge Function đều đã có bản tiếng Anh.
- `npm run typecheck`, `npm run build` — kiểm tra kiểu và đóng gói frontend.
- `npm run bench -- <số phiên> [thiết bị=20] [giây=10]` — đo thông lượng, độ trễ p50/p95/p99 và tỉ lệ lỗi khi nhiều thiết bị gửi đồng thời lên Supabase.

## Triển khai lên cloud

`npm run build` → thư mục `dist/` là web tĩnh, đưa lên Vercel / Netlify / Cloudflare Pages với biến môi trường `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY`. Vì dùng BrowserRouter, cần cấu hình rewrite mọi đường dẫn về `index.html`. Thêm domain triển khai vào Supabase → Authentication → URL Configuration.
