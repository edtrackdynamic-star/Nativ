export function initialLoginSchoolId(search: string): string {
  const id = new URLSearchParams(search).get('school')?.trim().toLowerCase() || ''
  return /^[a-z0-9][a-z0-9-]{2,48}$/.test(id) ? id : ''
}
