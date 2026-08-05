import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Ticket, ToggleLeft, ToggleRight, Trash2, Users } from 'lucide-react'
import StatusPill from '../../../components/StatusPill.jsx'
import { useConfirm } from '../../../lib/confirmContext.js'
import { useToast } from '../../../lib/toastContext.js'
import { createVoucher, deleteVoucher, fetchVoucherRedemptions, fetchVouchers, updateVoucher } from '../../../lib/admin.js'
import Loading from '../../../components/Loading.jsx'

// An expiry picked as a date means "usable through the end of that day, here" — so the date input's
// value is widened to local end-of-day before it becomes an instant, and read back from local date
// parts. Sending the bare "YYYY-MM-DD" instead would have been parsed as UTC midnight and expired
// the code partway through its last day for anyone in a positive-offset timezone (Manila is +8).
const toDateInput = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const endOfLocalDay = (value) => (value ? new Date(`${value}T23:59:59`).toISOString() : null)
const formatExpiry = (value) => (value ? new Date(value).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : 'No expiry')
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const peso = (value) => `₱${Number(value ?? 0).toLocaleString('en-PH')}`
const describeDiscount = (voucher) => (voucher.discountType === 'percent' ? `${voucher.discountValue}% off` : `₱${Number(voucher.discountValue).toLocaleString('en-PH')} off`)
const describeScope = (voucher) => (voucher.appliesTo === 'upfront' ? 'reservation fee only' : 'enrollment total')

function VoucherForm({ voucher, onDone, onCancel }) {
  const [values, setValues] = useState({
    code: voucher?.code ?? '',
    discountType: voucher?.discountType ?? 'percent',
    discountValue: voucher?.discountValue ?? '',
    appliesTo: voucher?.appliesTo ?? 'total',
    expiresAt: toDateInput(voucher?.expiresAt),
    maxUses: voucher?.maxUses ?? '',
    maxUsesPerApplicant: voucher?.maxUsesPerApplicant ?? '',
  })
  const [error, setError] = useState('')
  const toast = useToast()
  const payload = () => ({
    code: values.code.trim().toUpperCase(),
    discountType: values.discountType,
    discountValue: Number(values.discountValue),
    appliesTo: values.appliesTo,
    expiresAt: endOfLocalDay(values.expiresAt),
    // Blank means unlimited, which the server stores as 0 — an empty field is the common case, so
    // it must not be mistaken for "zero uses allowed".
    maxUses: values.maxUses === '' ? 0 : Number(values.maxUses),
    maxUsesPerApplicant: values.maxUsesPerApplicant === '' ? 0 : Number(values.maxUsesPerApplicant),
  })
  const mutation = useMutation({ mutationFn: () => (voucher ? updateVoucher(voucher.id, payload()) : createVoucher(payload())) })
  const submit = async (event) => {
    event.preventDefault()
    const code = values.code.trim()
    if (code.length < 3) return setError('Codes need at least 3 characters.')
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(code)) return setError('Codes use letters, numbers, and dashes only.')
    if (!(Number(values.discountValue) > 0)) return setError('Enter a discount greater than zero.')
    if (values.discountType === 'percent' && Number(values.discountValue) > 100) return setError('A percentage discount cannot exceed 100%.')
    setError('')
    try { await mutation.mutateAsync(); toast.success(voucher ? 'Voucher updated.' : 'Voucher created.'); onDone() } catch (e) { setError(e.message) }
  }
  return <form className="admin-voucher-form" onSubmit={submit}>
    <div className="builder-lesson-row">
      <label className="builder-field"><span>Code</span><input value={values.code} onChange={(e) => setValues((v) => ({ ...v, code: e.target.value.toUpperCase() }))} placeholder="EARLYBIRD25" maxLength={40} autoComplete="off" spellCheck="false" /></label>
      <label className="builder-field"><span>Discount type</span>
        <select value={values.discountType} onChange={(e) => setValues((v) => ({ ...v, discountType: e.target.value }))}>
          <option value="percent">Percentage (%)</option>
          <option value="fixed">Fixed amount (₱)</option>
        </select>
      </label>
      <label className="builder-field"><span>{values.discountType === 'percent' ? 'Percent off' : 'Pesos off'}</span><input type="number" min={1} max={values.discountType === 'percent' ? 100 : undefined} step={1} value={values.discountValue} onChange={(e) => setValues((v) => ({ ...v, discountValue: e.target.value }))} placeholder={values.discountType === 'percent' ? '25' : '2000'} /></label>
    </div>
    <div className="builder-lesson-row">
      <label className="builder-field"><span>Applies to</span>
        <select value={values.appliesTo} onChange={(e) => setValues((v) => ({ ...v, appliesTo: e.target.value }))}>
          <option value="total">Whole enrollment total</option>
          <option value="upfront">Upfront reservation fee only</option>
        </select>
      </label>
      <label className="builder-field"><span>Expires</span><input type="date" value={values.expiresAt} onChange={(e) => setValues((v) => ({ ...v, expiresAt: e.target.value }))} /></label>
      <label className="builder-field"><span>Maximum uses (total)</span><input type="number" min={0} step={1} value={values.maxUses} onChange={(e) => setValues((v) => ({ ...v, maxUses: e.target.value }))} placeholder="Unlimited" /></label>
      <label className="builder-field"><span>Max uses per person</span><input type="number" min={0} step={1} value={values.maxUsesPerApplicant} onChange={(e) => setValues((v) => ({ ...v, maxUsesPerApplicant: e.target.value }))} placeholder="No limit" /></label>
    </div>
    {/* The revenue consequence differs completely between the two, and it isn't obvious from the
        labels — an upfront code costs the academy nothing, a total code is a real giveaway. */}
    <p className="admin-voucher-scope-hint">{values.appliesTo === 'upfront'
      ? 'Lowers only the reservation fee due at checkout. The enrollment total is unchanged, so the saving is added to the balance you collect later — and the code does nothing for an applicant who pays in full.'
      : 'A real discount on what the applicant owes overall. Applies on both payment plans; on “upfront fee only” it comes off the remaining balance rather than the fee due today.'}</p>
    <div className="builder-lesson-actions">
      <button className="button button-primary button-compact" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : voucher ? 'Save changes' : 'Create voucher'}</button>
      <button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button>
    </div>
    {error && <span className="builder-error">{error}</span>}
    <p className="operations-note">Leave <strong>Expires</strong> empty for a code that never lapses, and either limit empty for no cap. <strong>Maximum uses</strong> is the total across everyone; <strong>Max uses per person</strong> caps one applicant (counted by email across all their enrollments) — set it to 1 for a one-per-customer promo. A use is only counted when a payment actually clears, so an abandoned checkout never burns one.</p>
  </form>
}

// Who actually used a code. Only fetched once the admin opens it — these are applicant names and
// email addresses, so they aren't shipped with every row of the list.
function RedemptionsPanel({ voucherId }) {
  const { data: redemptions = [], isLoading, error } = useQuery({ queryKey: ['voucher-redemptions', voucherId], queryFn: () => fetchVoucherRedemptions(voucherId) })
  if (isLoading) return <Loading label="Loading redemptions…" />
  if (error) return <p className="form-alert" role="alert">{error.message}</p>
  if (!redemptions.length) return <p className="operations-note">Nobody has redeemed this code yet. A redemption is recorded only once a payment clears.</p>
  return <ul className="admin-voucher-redemptions">
    {redemptions.map((row) => <li key={row.id}>
      <span className="admin-voucher-redeemer">
        {/* Links to the learner's profile where an account exists — payment can succeed without
            one if provisioning failed, and the redemption still has to be listed. */}
        {row.userId ? <Link to={`/profile?member=${row.userId}`}><strong>{row.name}</strong></Link> : <strong>{row.name}</strong>}
        <small>{row.email}{row.pathway ? ` · ${row.pathway}` : ''}</small>
      </span>
      <span className="admin-voucher-redeemed-amounts">
        <b>−{peso(row.discountAmount)}</b>
        <small>{row.appliesTo === 'upfront' ? 'off reservation fee' : 'off total'} · paid {peso(row.amountCharged)}</small>
      </span>
      <time dateTime={row.redeemedAt}>{formatDateTime(row.redeemedAt)}</time>
    </li>)}
  </ul>
}

export default function AdminVouchersPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [viewingId, setViewingId] = useState('')
  const { data: vouchers = [], isLoading, error } = useQuery({ queryKey: ['admin-vouchers'], queryFn: fetchVouchers })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-vouchers'] })
  const toggleMutation = useMutation({ mutationFn: ({ id, isActive }) => updateVoucher(id, { isActive }) })
  const deleteMutation = useMutation({ mutationFn: (id) => deleteVoucher(id) })
  const act = async (fn, message) => { try { await fn(); if (message) toast.success(message); invalidate() } catch (e) { toast.error(e.message) } }
  const remove = async (voucher) => {
    if (!(await confirm({ title: 'Delete this voucher?', message: `“${voucher.code}” will stop working immediately and disappear from this list.`, confirmLabel: 'Delete voucher' }))) return
    act(() => deleteMutation.mutateAsync(voucher.id), 'Voucher deleted.')
  }

  // `rejection` is the server's own reason a code would be refused at checkout, so this badge can
  // never claim a voucher is usable when the enrollment flow would turn it away.
  const stateOf = (voucher) => {
    if (!voucher.isActive) return { kind: 'red', label: 'Inactive' }
    if (!voucher.rejection) return { kind: 'green', label: 'Active' }
    return { kind: 'gold', label: voucher.rejection.includes('expired') ? 'Expired' : 'Limit reached' }
  }

  return <>
    <div className="page-title-row">
      <div><p className="eyebrow">PLATFORM ADMIN</p><h1>Vouchers &amp; Discounts</h1><p>Discount codes applicants can enter at checkout. The discount comes off the enrollment total; on the “upfront fee only” plan it reduces the balance, not the reservation fee.</p></div>
      {!adding && <button className="button button-primary" onClick={() => { setAdding(true); setEditingId('') }}><Plus size={16} /> New voucher</button>}
    </div>
    {error && <p className="form-alert" role="alert">{error.message}</p>}
    {adding && <VoucherForm onCancel={() => setAdding(false)} onDone={() => { setAdding(false); invalidate() }} />}

    <div className="admin-webinar-list">
      {isLoading ? <Loading label="Loading vouchers…" />
        : !vouchers.length && !adding ? <p className="operations-note"><Ticket size={17} /> No voucher codes yet.</p>
        : vouchers.map((voucher) => {
          const state = stateOf(voucher)
          return <article className="admin-webinar-card" key={voucher.id}>
            {editingId === voucher.id
              ? <VoucherForm voucher={voucher} onCancel={() => setEditingId('')} onDone={() => { setEditingId(''); invalidate() }} />
              : <>
                <div className="admin-webinar-head">
                  <div><strong className="admin-voucher-code">{voucher.code}</strong><small>{describeDiscount(voucher)} · {describeScope(voucher)} · {formatExpiry(voucher.expiresAt)}</small></div>
                  <div className="admin-status-cell">
                    <StatusPill kind={state.kind}>{state.label}</StatusPill>
                    {voucher.appliesTo === 'upfront' && <StatusPill kind="gold">Reservation fee</StatusPill>}
                    <StatusPill kind="gold">{voucher.maxUses > 0 ? `${voucher.usedCount} / ${voucher.maxUses} used` : `${voucher.usedCount} used`}</StatusPill>
                    {voucher.maxUsesPerApplicant > 0 && <StatusPill kind="gold">Max {voucher.maxUsesPerApplicant} per person</StatusPill>}
                  </div>
                </div>
                <div className="admin-row-actions">
                  <button className="button button-ghost button-compact" onClick={() => setViewingId(viewingId === voucher.id ? '' : voucher.id)}><Users size={14} /> {viewingId === voucher.id ? 'Hide redemptions' : `Redemptions${voucher.usedCount ? ` (${voucher.usedCount})` : ''}`}</button>
                  <button className="button button-ghost button-compact" onClick={() => act(() => toggleMutation.mutateAsync({ id: voucher.id, isActive: !voucher.isActive }), voucher.isActive ? 'Voucher deactivated.' : 'Voucher activated.')}>
                    {voucher.isActive ? <><ToggleRight size={14} /> Deactivate</> : <><ToggleLeft size={14} /> Activate</>}
                  </button>
                  <button className="button button-ghost button-compact" onClick={() => { setEditingId(voucher.id); setAdding(false) }}>Edit</button>
                  <button className="button button-ghost button-compact button-danger" onClick={() => remove(voucher)}><Trash2 size={14} /> Delete</button>
                </div>
                {viewingId === voucher.id && <RedemptionsPanel voucherId={voucher.id} />}
              </>}
          </article>
        })}
    </div>
    <p className="operations-note"><Ticket size={17} /> A redeemed voucher can’t be deleted — it’s the record of why those enrollments were charged less than list price. Deactivate it instead; that stops it being accepted just as completely.</p>
  </>
}
