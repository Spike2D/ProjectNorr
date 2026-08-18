class LogBus {
  constructor() {
    this.listeners = []
    this.derived = []
    this.delivering = false
  }

  subscribe(fn) {
    this.listeners.push(fn)
    return () => {
      const i = this.listeners.indexOf(fn)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  emit(ev, live) {
    for (const fn of this.listeners) fn(ev, live)
    if (this.delivering) return
    this.delivering = true
    try {
      this.drain()
    } finally {
      this.delivering = false
    }
  }

  drain() {
    let next
    while ((next = this.derived.shift()) !== undefined) {
      for (const fn of this.listeners) fn(next.ev, next.live)
    }
  }

  emitDerived(ev, live) {
    this.derived.push({ ev, live })
  }

  clear() {
    this.listeners = []
    this.derived = []
  }
}

module.exports = { LogBus }
