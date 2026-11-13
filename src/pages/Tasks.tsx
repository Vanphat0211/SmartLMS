import { useState } from 'react';
import { useShell } from '../components/Layout';
import { Card, Empty, Loading } from '../components/ui';
import { act, onForm, useLoad } from '../lib/hooks';
import { q, supabase } from '../lib/supabase';
import { t } from '../lib/i18n';

type Task = { id: number; title: string; due: string | null; done: boolean };

export default function Tasks() {
  const { reloadAgenda } = useShell();
  const [filter, setFilter] = useState('all');
  const { data, error, reload } = useLoad(() => q(supabase.from('tasks').select('*').order('done').order('due', { nullsFirst: false })) as Promise<Task[]>);
  if (!data) return <Loading error={error} />;
  const refresh = () => { reload(); reloadAgenda(); };
  const list = data.filter((x) => filter === 'all' || (filter === 'done') === x.done);
  return (
    <>
      <h1>{t('Công việc')}</h1>
      <form className="bar" onSubmit={onForm((v) => q(supabase.from('tasks').insert({ title: v.title, due: v.due || null })), refresh)}>
        <b>{t('Tạo công việc cá nhân')}</b><input name="title" placeholder={t('Tên công việc')} className="grow" required /><input name="due" type="date" /><button>{t('Tạo')}</button>
      </form>
      <div className="row">{t('Hiển thị')}
        <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">{t('Tất cả')}</option><option value="open">{t('Chưa xong')}</option><option value="done">{t('Đã xong')}</option></select>
      </div>
      <Card>
        {list.length ? list.map((x) => (
          <label className="item row" key={x.id}>
            <input type="checkbox" checked={x.done} onChange={() => act(() => q(supabase.from('tasks').update({ done: !x.done }).eq('id', x.id)), refresh)} />
            <span className={x.done ? 'done' : ''}>{x.title}</span><span className="muted">{x.due ?? ''}</span>
          </label>
        )) : <Empty>{t('Không có mục nào.')}</Empty>}
      </Card>
    </>
  );
}
