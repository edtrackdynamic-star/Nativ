import { useState } from 'react'

type Props = { name: string; src?: string; className: string; imageClassName?: string }
function LoadedSchoolBrand({ name, src, className, imageClassName }: Props) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  return <span className={className}>
    {src && !failed && <img className={imageClassName} src={src} alt={name} style={{ display: ready ? 'block' : 'none' }} onLoad={() => setReady(true)} onError={() => { setFailed(true); setReady(false) }} />}
    {!ready && <strong>{name}</strong>}
  </span>
}
export function SchoolBrand(props: Props) {
  return <LoadedSchoolBrand key={props.src ?? ''} {...props} />
}
