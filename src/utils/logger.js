const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const current = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

function fmt(level, args) {
  const ts = new Date().toISOString();
  return [`[${ts}] [${level}]`, ...args];
}

module.exports = {
  debug: (...a) => { if (LEVELS.debug >= current) console.debug(...fmt('debug', a)); },
  info:  (...a) => { if (LEVELS.info  >= current) console.log(...fmt('info', a)); },
  warn:  (...a) => { if (LEVELS.warn  >= current) console.warn(...fmt('warn', a)); },
  error: (...a) => console.error(...fmt('error', a)),
};
