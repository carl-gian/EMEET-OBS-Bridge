import type { ReactNode } from 'react'

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
    ghost: 'hover:bg-panel2 text-mute hover:text-ink'
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
