/**
 * The `Logger` class provides a simple logging interface with different levels of logging: verbose, info, warn, and error.
 * It extends the EventEmitter class, allowing it to emit events when a log is made.
 *
 * Each log level corresponds to a method on the `Logger` instance (`verbose`, `info`, `warn`, `error`).
 * These methods accept an array of data to log and an optional style string for console styling.
 *
 * The `Logger` class also supports setting a log level (`level` property), which controls the minimum level of logs that will be output.
 *
 * Usage:
 *
 * const logger = new Logger();
 * logger.level = "info"; // Set the log level
 * logger.log.info(["This is an info log"]); // Log at the info level
 * logger.log.error(["This is an error log"]); // Log at the error level
 */

import { Emitter, type EventMap } from '@lib/emitter'

export type LogLevel = 'none' | 'verbose' | 'info' | 'warn' | 'error'

/** Numeric severity: a message logs when its level <= the logger's level */
const LOG_PRIORITY: Record<LogLevel, number> = {
  none: 0,
  error: 1,
  warn: 2,
  info: 3,
  verbose: 4,
}
type DataType = unknown
type ConsoleType = 'log' | 'info' | 'error' | 'warn'
type Styles = {
  log?: string
  info?: string
  warn?: string
  error?: string
}
/** Logger properties */
export type LoggerProps = {
  /** The log level for the logger */
  logLevel?: LogLevel
  /** The name of the logger */
  name?: string
  /** The styles for the logger */
  styles?: Styles
}

export class Logger<
  Events extends EventMap = EventMap,
> extends Emitter<Events> {
  level: LogLevel = 'none'
  name = 'Logger'
  readonly styles: Styles = {
    log: 'color: white;',
    info: 'color: skyblue;',
    warn: 'color: orange;',
    error: 'color: red;',
  }
  /** Log methods */
  readonly log = {
    /** Log a verbose message */
    info: (data: DataType[], style?: string) => this.#info(data, style),
    /** Log an info message */
    warn: (data: DataType[], style?: string) => this.#warn(data, style),
    /** Log a warning message */
    error: (data: DataType[], style?: string) => this.#error(data, style),
    /** Log an error message */
    verbose: (data: DataType[], style?: string) => this.#verbose(data, style),
  }

  /**
   * Creates a new Logger instance.
   */
  constructor({ logLevel, name, styles }: LoggerProps = {}) {
    super()
    this.level = logLevel || this.level
    this.name = name || this.name
    this.styles = { ...this.styles, ...styles }
  }

  setLogLevel(level: LogLevel) {
    this.level = level
  }

  #console(type: ConsoleType, styles = 'color: white;', data: DataType[]) {
    // The Logger is the one sanctioned console consumer in this lib.
    // eslint-disable-next-line no-console
    console[type](
      [
        `%c${this.name}:`,
        ...data.map(v => `\t${JSON.stringify(v, null, 4)}`),
      ].join('\n'),
      styles,
    )
  }

  /** True when a message of the given level would be logged */
  logsFor(level: Exclude<LogLevel, 'none'>): boolean {
    return LOG_PRIORITY[level] <= LOG_PRIORITY[this.level]
  }

  #verbose(data: DataType[], style = this.styles.log) {
    if (this.logsFor('verbose')) {
      this.#console('log', style, data)
    }
  }

  #info(data: DataType[], style = this.styles.info) {
    if (this.logsFor('info')) {
      this.#console('info', style, data)
    }
  }

  #warn(data: DataType[], style = this.styles.warn) {
    if (this.logsFor('warn')) {
      this.#console('warn', style, data)
    }
  }

  #error(data: DataType[], style = this.styles.error) {
    if (this.logsFor('error')) {
      this.#console('error', style, data)
    }
  }
}
