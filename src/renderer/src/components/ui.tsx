import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Button({
  children,
  onClick,
  kind = 'default',
  disabled,
  title
}: {
  children: ReactNode
  onClick?: () => void
  kind?: 'default' | 'primary' | 'ghost'
  disabled?: boolean
  title?: string
}) {
  const base = 'px-3 py-1.5 rounded-md text-[13px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed'
  const styles = {
    default: 'bg-panel2 border border-line hover:border-accent/60',
    primary: 'bg-accent text-white hover:brightness-110',
    ghost: 'border border-line text-mute hover:border-accent/60 hover:text-ink'
  }[kind]
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={`${base} ${styles}`}>
      {children}
    </button>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-2 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-block h-5 w-9 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label && <span>{label}</span>}
    </label>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-[13px] font-medium">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-mute">{hint}</div>}
    </div>
  )
}

const inputCls = 'w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent'

export function TextInput({ value, onChange, placeholder, type = 'text', mono }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; mono?: boolean }) {
  return <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${inputCls} ${mono ? 'font-mono' : ''}`} spellCheck={false} />
}

/** Number box. With allowEmpty, a blank box means null. */
export function NumInput({
  value,
  onChange,
  allowEmpty,
  width = 'w-24'
}: {
  value: number | null | undefined
  onChange: (v: any) => void
  allowEmpty?: boolean
  width?: string
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      onChange={(e) => {
        const t = e.target.value
        if (t === '') return onChange(allowEmpty ? null : 0)
        const n = Number(t)
        if (Number.isFinite(n)) onChange(n)
      }}
      className={`${inputCls} ${width}`}
    />
  )
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'mute'; children: ReactNode }) {
  const c = { ok: 'bg-ok/15 text-ok', warn: 'bg-warn/15 text-warn', bad: 'bg-bad/15 text-bad', mute: 'bg-line text-mute' }[tone]
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${c}`}>{children}</span>
}

export function Select({ value, onChange, children, className = '' }: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} ${className}`}>
      {children}
    </select>
  )
}

/** A small "?" button that opens an explanation bubble (click to open/close, Esc or clicking elsewhere closes it). */
export function HelpTip({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <span ref={box} className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={`What is ${title}?`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold leading-none ${open ? 'border-accent bg-accent text-white' : 'border-mute text-mute hover:border-accent hover:text-accent'}`}
      >
        ?
      </button>
      {open && (
        <span role="dialog" className="absolute left-0 top-7 z-50 w-[340px] max-w-[80vw] rounded-lg border border-line bg-panel2 p-3 text-left text-xs font-normal leading-relaxed text-ink shadow-xl">
          <span className="mb-1 block text-[13px] font-semibold">{title}</span>
          {children}
        </span>
      )}
    </span>
  )
}
