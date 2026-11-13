import { useCallback, useEffect, useState, type DependencyList, type FormEvent } from 'react';

/** Tải dữ liệu khi mount / khi deps đổi. reload() để tải lại sau thao tác ghi. */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList = []) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const reload = useCallback(() => fn().then((data) => setState({ data }), (e: Error) => setState({ error: e.message })), deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

/** Chạy một thao tác ghi; lỗi hiện bằng alert. */
export async function act(fn: () => Promise<unknown>, after?: () => unknown) {
  try {
    await fn();
    await after?.();
  } catch (e) {
    alert((e as Error).message);
  }
}

/** onSubmit cho form không kiểm soát: đọc FormData → fn(values) → reset form. */
export const onForm = (fn: (v: Record<string, string>) => Promise<unknown>, after?: () => unknown) =>
  (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    act(() => fn(Object.fromEntries(new FormData(form)) as Record<string, string>), () => { form.reset(); return after?.(); });
  };
