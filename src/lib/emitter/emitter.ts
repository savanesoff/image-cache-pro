/**
 * Strictly-typed synchronous event emitter (inspired by onyx-core's
 * `StrictEventEmitter`, without the eventemitter3 dependency).
 *
 * Extend with an event map — event type → event payload — and `on` / `off` /
 * `emit` are fully typed end to end:
 *
 * ```ts
 * type MyEvents = {
 *   loaded: { type: 'loaded'; target: MyClass; bytes: number }
 * }
 * class MyClass extends Emitter<MyEvents> {}
 * ```
 *
 * - Handlers are invoked synchronously in registration order; handlers
 *   added/removed during an emit do not affect that emit (snapshot semantics).
 * - Node-EventEmitter semantics are preserved: `this` inside a plain-function
 *   handler is the emitter instance (unbound class methods rely on it).
 * - An error thrown by one handler never breaks the emission loop for the
 *   others (a bad consumer callback must not kill the scheduler); errors are
 *   reported via `console.error`.
 *
 * Subclasses that inject fields into the payload (this library's classes add
 * `type` and `target`) override `emit` with an `Omit<...>` data param and
 * forward through the protected `dispatch` — the loose escape hatch stays
 * `protected`; the public surface is strict.
 */

/** Event map contract: event type → event payload delivered to handlers */
export type EventMap = Record<string, unknown>

/** Handler signature for one event of a map */
export type EmitterHandler<Events extends EventMap, K extends keyof Events> = (
  event: Events[K],
) => unknown

type AnyHandler = (event: never) => unknown

export class Emitter<Events extends EventMap = EventMap> {
  #listeners = new Map<PropertyKey, Set<AnyHandler>>()

  /** Adds a handler for the event type. */
  on<K extends keyof Events>(
    type: K,
    handler: EmitterHandler<Events, K>,
  ): this {
    const set = this.#listeners.get(type) ?? new Set()
    set.add(handler)
    this.#listeners.set(type, set)
    return this
  }

  /** Removes a handler for the event type. */
  off<K extends keyof Events>(
    type: K,
    handler: EmitterHandler<Events, K>,
  ): this {
    this.#listeners.get(type)?.delete(handler)
    return this
  }

  /**
   * Emits an event to all handlers registered for the type.
   * @returns true if the event had listeners, false otherwise.
   */
  emit<K extends keyof Events>(type: K, event: Events[K]): boolean {
    return this.dispatch(type, event)
  }

  /**
   * Untyped emission core for subclasses that construct the payload
   * themselves (e.g. injecting `type`/`target`). Never expose publicly.
   */
  protected dispatch(type: PropertyKey, event: unknown): boolean {
    const set = this.#listeners.get(type)
    if (!set || set.size === 0) {
      return false
    }

    for (const handler of Array.from(set)) {
      try {
        ;(handler as (event: unknown) => unknown).call(this, event)
      } catch (error) {
        // one broken consumer handler must not break the others
        // eslint-disable-next-line no-console
        console.error(
          `[image-cache-pro] error in "${String(type)}" event handler`,
          error,
        )
      }
    }

    return true
  }

  /** Number of handlers registered for the event type. */
  listenerCount(type: keyof Events): number {
    return this.#listeners.get(type)?.size ?? 0
  }

  /** Removes all handlers, or all handlers of one event type. */
  removeAllListeners(type?: keyof Events): this {
    if (type !== undefined) {
      this.#listeners.delete(type)
    } else {
      this.#listeners.clear()
    }

    return this
  }
}
