import pino from 'pino';
export const createLogger = (level = 'info', name = 'wms') =>
  pino({
    name,
    level,
    redact: ['req.headers.cookie', 'password', '*.password', 'refreshToken', 'accessToken'],
  });
export type Logger = ReturnType<typeof createLogger>;
