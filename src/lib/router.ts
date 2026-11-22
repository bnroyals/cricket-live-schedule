import { useCallback, useEffect, useState } from 'react';

export function navigate(path: string, replace = false): void {
  const target = path.startsWith('/') ? path : `/${path}`;
  if (window.location.pathname === target) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (replace) {
    window.history.replaceState({}, '', target);
  } else {
    window.history.pushState({}, '', target);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function usePathname(): string {
  const [pathname, setPathname] = useState<string>(() => window.location.pathname || '/');

  useEffect(() => {
    const handlePop = () => {
      setPathname(window.location.pathname || '/');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  return pathname;
}

export function useNavigate() {
  return useCallback((path: string, replace = false) => {
    navigate(path, replace);
  }, []);
}
