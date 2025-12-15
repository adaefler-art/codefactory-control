export function getAppVersion(): string {
  return process.env.APP_VERSION ?? process.env.IMAGE_TAG ?? process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown';
}
