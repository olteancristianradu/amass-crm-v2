export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['LOG_LEVEL']?.trim();
  if (configured) return configured;
  return env['NODE_ENV'] === 'production' ? 'info' : 'debug';
}
