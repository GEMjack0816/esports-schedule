export function safeAdminReturnPath(value: string | null | undefined): string {
  if (!value || !/^\/admin(?:[/?#]|$)/.test(value) || value.startsWith("//")) {
    return "/admin";
  }
  return value;
}
