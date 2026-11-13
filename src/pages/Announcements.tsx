import { useState } from 'react';
import { useMe } from '../auth';
import { Card, Empty, Loading, ModalButton, PageHead, Tabs } from '../components/ui';
import { fmt } from '../lib/format';
import { onForm, useLoad } from '../lib/hooks';
import { q, supabase } from '../lib/supabase';
import { t } from '../lib/i18n';

type Tab = 'inst' | 'course' | 'all';

export default function Announcements() {
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>('all');
  const { data, error, reload } = useLoad(() => Promise.all([
    q(supabase.from('announcements').select('*, author:profiles(name), courses(code, title)').order('created_at', { ascending: false })),
    me.role === 'teacher' ? q(supabase.from('courses').select('id, code, title').eq('teacher_id', me.id).order('code')) : Promise.resolve([]),
  ]));
  if (!data) return <Loading error={error} />;
  const [all, courses] = data;
  const list = all.filter((a) => tab === 'all' || (tab === 'inst') === (a.course_id == null));
  return (
    <>
      <PageHead title={t('Thông báo')}>
        {me.role !== 'student' && <ModalButton label={'+ ' + (me.role === 'admin' ? t('Đăng thông báo toàn trường') : t('Đăng thông báo khóa học'))}
          title={me.role === 'admin' ? t('Đăng thông báo toàn trường') : t('Đăng thông báo khóa học')}>{(close) => (
          <form className="form2" onSubmit={onForm((v) => q(supabase.from('announcements').insert({ course_id: v.course ? Number(v.course) : null, title: v.title, body: v.body })), () => { reload(); close(); })}>
            {courses.length > 0 && <select name="course">{courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select>}
            <input name="title" placeholder={t('Tiêu đề')} required /><textarea name="body" placeholder={t('Nội dung')} /><button>{t('Đăng')}</button>
          </form>
        )}</ModalButton>}
      </PageHead>
      <Tabs value={tab} onChange={setTab} items={[['inst', t('Toàn trường')], ['course', t('Khóa học')], ['all', t('Xem tất cả')]]} />
      <Card>
        {list.length ? list.map((a) => (
          <div className="ann" key={a.id}>
            <div><h4>{a.title}</h4><div className="muted">{t('Đăng lúc:')} {fmt(a.created_at)}</div><p className="pre">{a.body}</p></div>
            <div className="muted">{t('Đăng bởi:')} {a.author?.name}<br />{t('Gửi tới:')} {a.courses ? `${a.courses.code} — ${a.courses.title}` : t('Toàn trường')}</div>
          </div>
        )) : <Empty>{t('Không có thông báo.')}</Empty>}
      </Card>
    </>
  );
}
