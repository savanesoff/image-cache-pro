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
import { EventEmitter } from 'events';
export class Logger extends EventEmitter {
    level = 'none';
    name = 'Logger';
    styles = {
        log: 'color: white;',
        info: 'color: skyblue;',
        warn: 'color: orange;',
        error: 'color: red;',
    };
    levelGates = {
        verbose: 'verbose',
        info: 'info, verbose',
        warn: 'warn, info, verbose',
        error: 'error, warn, info, verbose',
    };
    /** Log methods */
    log = {
        /** Log a verbose message */
        info: (data, style) => this.#info(data, style),
        /** Log an info message */
        warn: (data, style) => this.#warn(data, style),
        /** Log a warning message */
        error: (data, style) => this.#error(data, style),
        /** Log an error message */
        verbose: (data, style) => this.#verbose(data, style),
    };
    /**
     * Creates a new Logger instance.
     */
    constructor({ logLevel, name, styles } = {}) {
        super();
        this.level = logLevel || this.level;
        this.name = name || this.name;
        this.styles = { ...this.styles, ...styles };
        this.setMaxListeners(1000);
    }
    setLogLevel(level) {
        this.level = level;
    }
    #console(type, styles = 'color: white;', data) {
        console[type]([
            `%c${this.name}:`,
            ...data.map(v => `\t${JSON.stringify(v, null, 4)}`),
        ].join('\n'), styles);
    }
    #verbose(data, style = this.styles.log) {
        this.levelGates.verbose.match(this.level) &&
            this.#console('log', style, data);
    }
    #info(data, style = this.styles.info) {
        this.levelGates.info.match(this.level) &&
            this.#console('info', style, data);
    }
    #warn(data, style = this.styles.warn) {
        this.levelGates.warn.match(this.level) &&
            this.#console('warn', style, data);
    }
    #error(data, style = this.styles.error) {
        this.levelGates.error.match(this.level) &&
            this.#console('error', style, data);
    }
}
