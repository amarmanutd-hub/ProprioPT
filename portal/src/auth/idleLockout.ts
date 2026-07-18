/**
 * Clears Supabase client auth after IDLE_MS of no user interaction.
 * Clinical terminal lockout for unattended therapist workstations.
 */
const IDLE_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "click",
] as const;

export type IdleLockoutHandlers = {
  onLock: () => void | Promise<void>;
};

export function startIdleLockout(handlers: IdleLockoutHandlers): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let locked = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const arm = () => {
    clearTimer();
    if (locked) return;
    timer = setTimeout(() => {
      void (async () => {
        if (locked) return;
        locked = true;
        clearTimer();
        await handlers.onLock();
      })();
    }, IDLE_MS);
  };

  const onActivity = () => {
    if (locked) return;
    arm();
  };

  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, onActivity, { passive: true });
  }

  arm();

  return () => {
    locked = true;
    clearTimer();
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, onActivity);
    }
  };
}
