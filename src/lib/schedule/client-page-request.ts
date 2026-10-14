export function isCurrentSchedulePageRequest(
  requestSerial: number,
  currentSerial: number,
  requestKey: string,
  currentRequestKey: string,
): boolean {
  return requestSerial === currentSerial && requestKey === currentRequestKey;
}
