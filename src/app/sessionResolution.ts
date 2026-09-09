export interface Identity { uid: string; providerData: { providerId: string }[] }
export interface SchoolOption { id: string; name: string; role: string }

export async function resolveSession<TUser extends Identity, TAccess>(user: TUser, dependencies: {
  getAccess: () => Promise<TAccess>
  listSchools: () => Promise<SchoolOption[]>
  exchange: (id: string) => Promise<string>
  signIn: (token: string) => Promise<{ user: TUser }>
  isCurrent: () => boolean
  allowExchange: boolean
}): Promise<{ user: TUser; access: TAccess } | { schools: SchoolOption[] }> {
  try { return { user, access: await dependencies.getAccess() } }
  catch (error) {
    if (!dependencies.allowExchange || !(error instanceof Error) || !error.message.includes('לא נמצא שיוך ארגוני פעיל') || !user.providerData.some((provider) => provider.providerId === 'google.com')) throw error
    const schools = await dependencies.listSchools()
    if (!schools.length) throw new Error('לחשבון הזה אין שיוך פעיל לבית ספר. יש לפנות למנהל הגישה.')
    if (schools.length > 1) return { schools }
    const token = await dependencies.exchange(schools[0].id)
    if (!dependencies.isCurrent()) throw new Error('הכניסה התחלפה. יש לנסות שוב.')
    const credential = await dependencies.signIn(token)
    if (!dependencies.isCurrent()) throw new Error('הכניסה התחלפה. יש לנסות שוב.')
    // A custom-token sign-in may retain the UID: do not wait for another Auth event.
    return { user: credential.user, access: await dependencies.getAccess() }
  }
}

export async function withSessionTimeout<T>(operation: Promise<T>, milliseconds = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('טעינת החשבון התעכבה. אפשר לנסות שוב בלי להתחבר מחדש.')), milliseconds)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
