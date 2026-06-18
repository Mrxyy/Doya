const listeners = new Set<() => void>();

export function subscribeControlSessionChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyControlSessionsChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}
