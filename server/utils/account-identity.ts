export function resolveRefreshedAccountEmail(
  parsedEmail: string | null,
  knownEmail: string | null
) {
  return parsedEmail ?? knownEmail
}
