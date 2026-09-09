import { useEffect, useRef, useState } from 'react'

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const prevent = (event: Event) => event.preventDefault()
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('nativ-before-navigation', prevent)
    window.addEventListener('beforeunload', unload)
    return () => { window.removeEventListener('nativ-before-navigation', prevent); window.removeEventListener('beforeunload', unload) }
  }, [dirty])
}

export function useConfirmAction() {
  const [message, setMessage] = useState('')
  const resolver = useRef<((value: boolean) => void) | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (message) dialog.current?.showModal() }, [message])
  useEffect(() => () => { resolver.current?.(false) }, [])
  function finish(value: boolean) { dialog.current?.close(); setMessage(''); resolver.current?.(value); resolver.current = null }
  async function confirm(text: string): Promise<boolean> {
    if (resolver.current) return false
    setMessage(text)
    return new Promise((resolve) => { resolver.current = resolve })
  }
  const confirmation = <dialog ref={dialog} className="confirm-dialog" aria-label="אישור פעולה" onCancel={(event) => { event.preventDefault(); finish(false) }}>
    <h2>רגע לפני שממשיכים</h2><p>{message}</p><div className="workspace-actions"><button autoFocus className="secondary-action" onClick={() => finish(false)}>חזרה</button><button className="primary-action" onClick={() => finish(true)}>אישור והמשך</button></div>
  </dialog>
  return { confirm, confirmation }
}
