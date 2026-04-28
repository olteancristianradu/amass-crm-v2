import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Sticky banner that appears when the browser goes offline. Anything the
 * user does while offline that hits a non-cached endpoint will fail; the
 * SW serves stale GETs for /companies and /contacts so reads keep
 * working. Mutations are blocked until reconnect.
 */
export function OfflineBanner(): JSX.Element | null {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const onOnline = (): void => setOnline(true);
    const onOffline = (): void => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-amber-950 backdrop-blur"
    >
      <WifiOff size={12} />
      Offline — afișăm date din ultima sincronizare. Modificările se vor reactiva la reconectare.
    </div>
  );
}
