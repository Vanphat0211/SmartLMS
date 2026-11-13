import { useState } from 'react';
import { useMe } from '../auth';
import { Card, Dot, Empty, Loading, ModalButton, PageHead } from '../components/ui';
import { fmt } from '../lib/format';
import { act, onForm, useLoad } from '../lib/hooks';
import { q, rpc, supabase } from '../lib/supabase';
import { isOnline } from './Monitor';
import { t } from '../lib/i18n';

/** Thiết bị IoT/Edge được cấp quyền gửi sự kiện (tương đương "Application Authorization"). */
export default function Devices() {
  const { me } = useMe();
  const admin = me.role === 'admin';
  const [key, setKey] = useState('');
  const { data, error, reload } = useLoad(() => q(supabase.from('devices').select('id, name, room, last_seen').order('room')));
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHead title={t('Thiết bị IoT / Edge')}>
        {admin && <ModalButton label={'+ ' + t('Đăng ký thiết bị')} title={t('Đăng ký thiết bị')}>{() => (
          <>
            <form className="form2" onSubmit={onForm(async (v) => setKey(await rpc<string>('register_device', { p_name: v.name, p_room: v.room })), reload)}>
              <input name="name" placeholder={t('Tên (vd Camera Edge A1.102)')} required />
              <input name="room" placeholder={t('Phòng')} required />
              <button>{t('Cấp khóa')}</button>
            </form>
            {key && <div className="results"><b>{t('Khóa thiết bị (chỉ hiện một lần — hãy lưu lại):')}</b>
              <input readOnly value={key} onFocus={(e) => e.target.select()} /></div>}
          </>
        )}</ModalButton>}
      </PageHead>
      <Card title={t('Thiết bị được cấp quyền')}>
        {data.length ? (
          <table><thead><tr><th>{t('Trạng thái')}</th><th>{t('Thiết bị')}</th><th>{t('Phòng')}</th><th>{t('Liên lạc cuối')}</th><th /></tr></thead>
            <tbody>{data.map((d) => (
              <tr key={d.id}><td><Dot on={isOnline(d.last_seen)} /></td><td>{d.name}</td><td>{d.room}</td><td>{fmt(d.last_seen) || '—'}</td>
                <td>{admin && <button className="ghost" onClick={() => confirm(t('Thu hồi quyền của thiết bị này?')) && act(() => q(supabase.from('devices').delete().eq('id', d.id)), reload)}>{t('Thu hồi')}</button>}</td></tr>
            ))}</tbody></table>
        ) : <Empty>{t('Chưa có thiết bị.')}</Empty>}
      </Card>
      <Card title={t('Giao thức cho thiết bị (Supabase RPC qua HTTPS)')}><div>
        <pre>{t("POST {SUPABASE_URL}/rest/v1/rpc/device_event\napikey: <anon / publishable key>\n{ \"p_key\": \"<khóa thiết bị>\", \"p_session\": 12, \"p_source\": \"edge\" | \"iot\",\n  \"p_type\": \"multi_person\", \"p_detail\": { \"conf\": 0.93 }, \"p_dts\": <epoch ms tại thiết bị> }\n\nPOST {SUPABASE_URL}/rest/v1/rpc/device_ping      { \"p_key\": \"<khóa>\" }   (heartbeat)")}</pre>
        <p className="muted">{t('Edge AI xử lý video ngay tại thiết bị, chỉ gửi sự kiện bất thường — không gửi khung hình thô lên cloud. Khóa chỉ hiện một lần và được lưu dạng hash; mất khóa thì thu hồi và cấp lại.')}</p>
      </div></Card>
    </>
  );
}
