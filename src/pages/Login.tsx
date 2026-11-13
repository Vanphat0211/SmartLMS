import { useState, type FormEvent } from 'react';
import { LANG_SWITCH, t, toggleLang } from '../lib/i18n';
import { supabase } from '../lib/supabase';

const AUTH_ERRORS: Record<string, string> = {
  'Invalid login credentials': t('Sai email hoặc mật khẩu'),
  'Email not confirmed': t('Email chưa được xác nhận — mở hộp thư để xác nhận trước.'),
  'User is banned': t('Tài khoản đã bị khóa — liên hệ quản trị viên.'),
};

// Không có tự đăng ký: tài khoản do quản trị viên cấp (trang Tài khoản → Edge Function admin-users).
export default function Login() {
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: String(f.get('email')), password: String(f.get('password')) });
    setBusy(false);
    if (error) alert(AUTH_ERRORS[error.message]
      ?? (/fetch/i.test(error.message) ? t('Không kết nối được Supabase — kiểm tra VITE_SUPABASE_URL trong .env và kết nối mạng.') : error.message));
  };
  return (
    <div className="login">
      <div className="brand">
        <div className="logo"><span className="mark">S</span>SmartLMS</div>
        <div className="muted">{t('Hệ thống quản lý học tập · IoT + Edge AI + Cloud')}</div>
      </div>
      <div className="card"><h3>{t('Đăng nhập')}</h3>
        <form className="stack" onSubmit={submit}>
          <input name="email" type="email" placeholder="Email" autoComplete="username" required />
          <input name="password" type="password" placeholder={t('Mật khẩu')} autoComplete="current-password" required />
          <button disabled={busy}>{busy ? t('Đang xử lý…') : t('Đăng nhập')}</button>
          <span className="muted">{t('Tài khoản do quản trị viên cấp. Quên mật khẩu? Liên hệ quản trị viên để đặt lại.')}</span>
        </form>
      </div>
      <button className="ghost lang" onClick={toggleLang}>{LANG_SWITCH}</button>
    </div>
  );
}
