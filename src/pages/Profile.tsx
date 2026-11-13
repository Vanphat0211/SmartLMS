import { useMe } from '../auth';
import { Card } from '../components/ui';
import { ROLE } from '../lib/format';
import { onForm } from '../lib/hooks';
import { q, supabase } from '../lib/supabase';
import { t } from '../lib/i18n';

export default function Profile() {
  const { me, reloadMe } = useMe();
  const save = onForm(async (v) => {
    if (v.password) {
      if (v.password.length < 6) throw new Error(t('Mật khẩu mới tối thiểu 6 ký tự'));
      const { error } = await supabase.auth.signInWithPassword({ email: me.email, password: v.old }); // xác nhận mật khẩu cũ
      if (error) throw new Error(t('Mật khẩu hiện tại không đúng'));
      const { error: e2 } = await supabase.auth.updateUser({ password: v.password });
      if (e2) throw new Error(e2.message);
    }
    await q(supabase.from('profiles').update({ name: v.name.trim(), listed: v.listed === 'on' }).eq('id', me.id));
    alert(t('Đã lưu.'));
  }, reloadMe);
  return (
    <>
      <h1>{t('Thông tin cá nhân')}</h1>
      <Card title={t('Hồ sơ')}>
        <form key={me.name + me.listed} className="form" onSubmit={save}>
          <label>{t('Họ tên')} <input name="name" defaultValue={me.name} required /></label>
          <label>Email <input value={me.email} disabled /></label>
          <label>{t('Vai trò')} <input value={ROLE[me.role]} disabled /></label>
          <label className="chk"><input name="listed" type="checkbox" defaultChecked={me.listed} /> {t('Hiển thị tôi trong Danh bạ người dùng')}</label>
          <fieldset><legend>{t('Đổi mật khẩu (bỏ trống nếu không đổi)')}</legend>
            <input name="old" type="password" placeholder={t('Mật khẩu hiện tại')} autoComplete="current-password" />
            <input name="password" type="password" placeholder={t('Mật khẩu mới (≥ 6 ký tự)')} autoComplete="new-password" />
          </fieldset>
          <button>{t('Lưu')}</button>
        </form>
      </Card>
    </>
  );
}
