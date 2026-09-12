import pino, { type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from '../../config/env';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
  'password',
  '*.password',
  'token',
  '*.token',
  'sessionToken',
  '*.sessionToken',
  'resetToken',
  '*.resetToken',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
];

export function createLogger(config: AppConfig, destination?: DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    level: config.nodeEnv === 'development' ? 'debug' : 'info',
    redact: {
      paths: REDACTED_PATHS,
      censor: '[Redacted]',
    },
  };

  return destination ? pino(options, destination) : pino(options);
}
