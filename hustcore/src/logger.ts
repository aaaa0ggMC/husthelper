export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type LoggerInput = Partial<Logger> | ((message: string) => void);

const noop = (): void => {};

export const defaultLogger: Logger = {
  debug: (message) => console.log(message),
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

export function resolveLogger(input?: LoggerInput): Logger {
  if (!input) return defaultLogger;
  if (typeof input === "function") {
    return { debug: noop, info: input, warn: input, error: input };
  }
  return {
    debug: input.debug ?? noop,
    info: input.info ?? noop,
    warn: input.warn ?? noop,
    error: input.error ?? noop,
  };
}
