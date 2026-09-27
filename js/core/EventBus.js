// Minimal synchronous pub/sub. Gameplay emits; audio, particles, UI and logging listen.
export class EventBus {
  constructor() { this.handlers = new Map(); }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const set = this.handlers.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) fn(payload);
    const any = this.handlers.get('*');
    if (any) for (const fn of any) fn(type, payload);
  }
}
