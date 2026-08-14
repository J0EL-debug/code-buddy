import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  variant: 'success' | 'error' | 'info';
}

interface ToastContextValue {
  showToast: (message: string, variant?: Toast['variant']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Lightweight in-app toast system, used to notify when a review/zip batch
 * finishes processing in the background - so switching tabs while it runs
 * doesn't mean losing track of when it's done. Falls back to this even if
 * the browser Notification permission is denied, since that only helps
 * when the tab isn't focused at all.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, variant: Toast['variant'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);

    // Also fire a browser notification if the tab isn't focused and
    // permission was already granted - covers the "I tabbed away" case.
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Code Buddy', { body: message });
      } catch {
        /* Notification constructor can throw in some contexts - ignore */
      }
    }
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg border px-4 py-3 text-sm shadow-lg ${
              t.variant === 'error'
                ? 'border-[#FF6B6B]/40 bg-[#FF6B6B]/10 text-[#FF6B6B]'
                : t.variant === 'success'
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-card text-foreground'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/** Requests browser notification permission - call from a button click
 * (browsers require a user gesture, so this can't happen automatically). */
export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
