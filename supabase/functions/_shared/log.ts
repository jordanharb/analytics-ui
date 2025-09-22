const LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = typeof LEVELS[number];

const priority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLevel(value: string | undefined): LogLevel {
  const normalized = value?.toLowerCase();
  if (LEVELS.includes(normalized as LogLevel)) {
    return normalized as LogLevel;
  }
  return "info";
}

const rootLevel = parseLevel(Deno.env.get("LOG_LEVEL"));

export interface LogMeta {
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, meta?: LogMeta) {
  if (priority[level] < priority[rootLevel]) {
    return;
  }

  const payload = {
    level,
    message,
    ...meta,
    timestamp: new Date().toISOString(),
  };

  const json = JSON.stringify(payload);
  switch (level) {
    case "debug":
    case "info":
      console.log(json);
      break;
    case "warn":
      console.warn(json);
      break;
    case "error":
      console.error(json);
      break;
  }
}

export interface Logger {
  debug: (message: string, meta?: LogMeta) => void;
  info: (message: string, meta?: LogMeta) => void;
  warn: (message: string, meta?: LogMeta) => void;
  error: (message: string, meta?: LogMeta) => void;
  child: (meta: LogMeta) => Logger;
}

export function createLogger(baseMeta: LogMeta = {}): Logger {
  return {
    debug(message: string, meta?: LogMeta) {
      emit("debug", message, { ...baseMeta, ...meta });
    },
    info(message: string, meta?: LogMeta) {
      emit("info", message, { ...baseMeta, ...meta });
    },
    warn(message: string, meta?: LogMeta) {
      emit("warn", message, { ...baseMeta, ...meta });
    },
    error(message: string, meta?: LogMeta) {
      emit("error", message, { ...baseMeta, ...meta });
    },
    child(meta: LogMeta) {
      return createLogger({ ...baseMeta, ...meta });
    },
  };
}

export const logger = createLogger();
