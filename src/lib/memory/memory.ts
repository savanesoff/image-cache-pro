/**
 * Represents a memory/size object in bytes.
 * Its and abstraction that represents memory usage.
 * Emits events when size is overflowed, available or cleared.
 */
import { Logger, LogLevel } from '@lib/logger';
import { UNITS, UnitsType } from '@utils';

/** Memory event types */
export type MemoryEventTypes =
  | 'overflow'
  | 'clear'
  | 'bytes-added'
  | 'bytes-removed'
  | 'cleared'
  | 'update';

/** Event data for memory events */
export type MemoryEvent<T extends MemoryEventTypes> = {
  /** The type of the event */
  type: T;
  /** The memory object that emitted the event */
  target: Memory;
} & (T extends 'overflow' ? { bytes: number } : unknown) &
  (T extends 'bytes-added'
    ? { bytes: number; remainingBytes: number }
    : unknown) &
  (T extends 'bytes-removed' ? { bytes: number } : unknown) &
  (T extends 'update' ? { overflow: boolean } : unknown);

/** Event handler for memory events */
export type MemoryEventHandler<T extends MemoryEventTypes> = (
  event: MemoryEvent<T>,
) => void;

/** Memory properties */
export type MemoryProps = {
  /** Size of memory in <units> */
  size?: number;
  /** Units of memory used with size */
  units?: UnitsType;
  /** Log level for memory */
  logLevel?: LogLevel;
  /** Name of memory object */
  name?: string;
};

export type MemoryStatus = {
  bytes: number;
  units: number;
  prs: number;
};

export type MemoryState = {
  count: number;
  size: number;
  units: UnitsType;
  sizeBytes: number;
};
export type MemoryStats = {
  state: MemoryState;
  free: MemoryStatus;
  used: MemoryStatus;
};

/**
 * Represents a memory object.
 * Emits events when size is overflowed, available or cleared.
 * @extends Logger
 * @event overflow - Emitted when the memory object is overflowed.
 * @event clear - Emitted when the memory object is cleared.
 * @event bytes-added - Emitted when bytes are added to the memory object.
 * @event bytes-removed - Emitted when bytes are removed from the memory object.
 * @event cleared - Emitted when the memory object is cleared.
 * @example
 * ```ts
 * const memory = new Memory({ size: 1, units: "GB" });
 * memory.on("overflow", ({ target }) => console.log("Memory overflowed", target));
 * memory.on("clear", ({ target }) => console.log("Memory cleared", target));
 * memory.on("bytes-added", ({ target }) => console.log("Bytes added", target));
 * memory.on("bytes-removed", ({ target }) => console.log("Bytes removed", target));
 * memory.on("cleared", ({ target }) => console.log("Memory cleared", target));
 * memory.addBytes(1e9);
 * memory.removeBytes(1e9);
 * memory.clear();
 * ```
 */
export class Memory extends Logger {
  /** The number of bytes in the memory object */
  private bytes = 0;
  /** The units of the memory object, e.g. "GB" */
  readonly units: UnitsType;
  /** The size of the memory object */
  readonly size: number;
  /** The count of the memory requests to calculate average */
  private count = 0;

  /**
   * Creates a new Memory object.
   * @param size - The size of the memory object.
   * @param units - The units of the memory object size.
   * @param logLevel - The log level for the memory object.
   * @param name - The name of the memory object.
   */
  constructor({
    size = 1,
    units = 'GB',
    logLevel = 'error',
    name = 'Memory',
  }: MemoryProps) {
    super({
      name,
      logLevel,
    });
    this.units = units;
    this.size = size;
    this.log.info(['Created memory', 'Size:', size, 'Units:', units]);
  }

  /**
   * Compiles a string with the status of the memory object that can be logged.
   * @returns A string with the status of the memory object.
   */
  getStats(): MemoryStats {
    return {
      state: this.getState(),
      free: this.getFreeSpace(),
      used: this.getUsedSpace(),
    };
  }

  /**
   * Gets the free space in the memory object.
   * @returns An object with the free space in bytes, units, and percentage.
   */
  getFreeSpace(): MemoryStatus {
    const unitUsed = this.#toUnits(this.bytes);
    const prsUsed = (unitUsed / this.size) * 100;
    return {
      bytes: this.getBytesSpace(),
      units: this.size - unitUsed,
      prs: 100 - prsUsed,
    };
  }

  /**
   * Gets the used space in the memory object.
   * @returns An object with the used space in bytes, units, and percentage.
   */
  getUsedSpace(): MemoryStatus {
    const unitUsed = this.#toUnits(this.bytes);
    const prsUsed = (unitUsed / this.size) * 100;
    return {
      bytes: this.bytes,
      units: unitUsed,
      prs: prsUsed,
    };
  }

  /**
   * Gets the average space in the memory object.
   * @returns An object with the average space in bytes, units, and percentage.
   */
  getAverage(): MemoryStatus {
    const unitUsed = this.#toUnits(this.bytes);
    const prsUsed = (unitUsed / this.size) * 100;
    const isZero = unitUsed === 0 || this.count === 0;
    return {
      bytes: !isZero ? this.bytes / this.count : 0,
      units: !isZero ? unitUsed / this.count : 0,
      prs: !isZero ? prsUsed / this.count : 0,
    };
  }

  /**
   * Gets the state of the memory object.
   * @returns An object with the count, size, units, and size in bytes of the memory object.
   */
  getState(): MemoryState {
    return {
      count: this.count,
      size: this.size,
      units: this.units,
      sizeBytes: this.size * UNITS[this.units],
    };
  }

  /**
   * Adds bytes to the memory object and logs the status.
   * If adding bytes will overflow the memory object, emits an "overflow" event.
   * @param bytes - The number of bytes to add to the memory object.
   * @returns The remaining bytes. If negative, the memory object is overflowed.
   */
  addBytes(bytes = 0): number {
    const remainingBytes = this.getBytesSpace(bytes);
    if (remainingBytes < 0) {
      this.log.warn(['Overflow!', this.getStats()], this.styles.error);
      this.emit('overflow', { bytes: remainingBytes });
    }

    this.count++;
    this.bytes += bytes;
    this.emit('bytes-added', { bytes, remainingBytes });
    this.emit('update', { overflow: remainingBytes < 0 });
    this.log.info(
      [`Added: ${this.#toUnits(bytes)} ${this.units}`, this.getStats()],
      this.styles.info,
    );
    return remainingBytes;
  }

  /**
   * Adds units to the memory object.
   * @param units - The number of units to add to the memory object.
   * @returns The remaining units. If negative, the memory object is overflowed.
   */
  addUnits(units: number): number {
    const remainingBytes = this.addBytes(units * UNITS[this.units]);
    return remainingBytes != 0 ? remainingBytes / UNITS[this.units] : 0;
  }

  /**
   * Calculates the remaining space in the memory object.
   * @param withBytes - The number of bytes to add to the memory object.
   * @returns The remaining bytes. If negative, the memory object is overflowed.
   */
  getBytesSpace(withBytes = 0): number {
    const remaining = this.size * UNITS[this.units] - (this.bytes + withBytes);
    return remaining;
  }

  /**
   * Removes bytes from the memory object and logs the status.
   * Emits an "available" event if the memory object is not overflowed.
   * @param bytes - The number of bytes to remove from the memory object.
   * @returns The remaining bytes.
   */
  removeBytes(bytes: number): number {
    this.count--;
    this.bytes -= bytes;
    this.emit('bytes-removed', { bytes });
    this.emit('update', {
      overflow: this.bytes > this.size * UNITS[this.units],
    });
    this.log.info(
      [`Removed: ${this.#toUnits(bytes)} ${this.units}`, this.getStats()],
      this.styles.info,
    );

    return this.getBytesSpace();
  }

  /**
   * Clears the memory object and logs the status.
   * Emits a "clear" event.
   */
  clear() {
    this.bytes = 0;
    this.count = 0;
    this.emit('cleared');
    this.log.info(['Cleared'], this.styles.info);
    this.emit('clear');
  }

  /**
   * Logs the status of the memory object.
   */
  print() {
    this.log.info([this.getStats()], this.styles.info);
  }

  //--------------------------------  PRIVATE   --------------------------------
  /**
   * Converts bytes to the units of the memory object.
   * @param bytes - The number of bytes to convert.
   * @returns The number of units.
   */
  #toUnits(bytes: number): number {
    return bytes / UNITS[this.units];
  }

  //--------------------------------  EVENT HANDLING   -------------------------

  /**
   * Overrides the `on` method to add event listeners to the memory object.
   * @param event - The event to listen for.
   * @param listener - The listener function to be called when the event is emitted.
   * @returns The memory object itself.
   */
  on<T extends MemoryEventTypes>(
    event: T,
    listener: MemoryEventHandler<T>,
  ): this {
    return super.on(event, listener);
  }

  /**
   * Removes an event listener for the specified event type.
   * @param event - The type of the event.
   * @param listener - The event handler function.
   * @returns
   */
  off<T extends MemoryEventTypes>(
    event: T,
    listener: MemoryEventHandler<T>,
  ): this {
    return super.off(event, listener);
  }

  /**
   * Overrides the `emit` method to emit events from the memory object.
   * @param event - The event to emit.
   * @param data - The value to pass to the event listeners.
   * @returns A boolean indicating whether the event was emitted successfully.
   */
  emit<T extends MemoryEventTypes>(
    event: T,
    data?: Omit<MemoryEvent<T>, 'target' | 'type'>,
  ): boolean {
    return super.emit(event, {
      ...data,
      type: event,
      target: this,
    });
  }
}
