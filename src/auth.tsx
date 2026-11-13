import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { q, supabase } from './lib/supabase';
import type { Profile } from './lib/types';
import Login from './pages/Login';
import { t } from './lib/i18n';

const Ctx = createContext<{ me: Profile; reloadMe: () => Promise<void> } | null>(null);

export function useMe() {
  const c = useContext(Ctx);
  if (!c) throw new Error(t('useMe() phải nằm trong <AuthGate>'));
  return c;
}

/** Chặn mọi trang phía sau đăng nhập Supabase Auth, nạp hồ sơ (vai trò) của người dùng. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>();
  const [me, setMe] = useState<Profile | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  const reloadMe = useCallback(async () => {
    setError(undefined);
    try {
      setMe(uid ? await q(supabase.from('profiles').select('*').eq('id', uid).single<Profile>()) : null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [uid]);
  useEffect(() => { reloadMe(); }, [reloadMe]);

  if (session === undefined) return <p className="empty">{t('Đang tải…')}</p>;
  if (!session) return <Login />;
  if (error) return (
    <div className="login"><div className="card"><h3>{t('Không tải được hồ sơ')}</h3><div>
      <p className="bad">{error}</p><p className="muted">{t('Kiểm tra đã chạy migration trong supabase/migrations chưa.')}</p>
      <button onClick={() => supabase.auth.signOut()}>{t('Đăng xuất')}</button>
    </div></div></div>
  );
  if (!me || me.id !== uid) return <p className="empty">{t('Đang tải hồ sơ…')}</p>;
  return <Ctx.Provider value={{ me, reloadMe }}>{children}</Ctx.Provider>;
}
