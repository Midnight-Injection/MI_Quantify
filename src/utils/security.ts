export function normalizeSecurityCode(code: string) {
  const raw = `${code || ''}`.trim().toLowerCase()
  const matched = raw.match(/(?:sh|sz|bj|hk|us)?(\d{5,6})/)
  if (matched?.[1]) return matched[1]
  return raw.toUpperCase()
}
