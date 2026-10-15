/** Agendador simples de sincronização (intervalo fixo, sem sobreposição).
 * Desligado por padrão; `server.ts` liga com SYNC_ENABLED=1.
 * O timer usa `unref()` para não segurar o processo sozinho.
 */
export interface SchedulerHandle {
  stop(): void;
}

export function startScheduler(
  task: () => Promise<unknown>,
  intervalMs: number,
  onError: (e: unknown) => void = () => {},
): SchedulerHandle {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return; // pula se a rodada anterior ainda roda
    running = true;
    try {
      await task();
    } catch (e) {
      onError(e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  void tick(); // primeira rodada imediata
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
