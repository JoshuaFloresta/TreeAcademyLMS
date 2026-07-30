import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, GraduationCap, Pencil, Plus, Sparkles, Trash2, Users, Zap } from 'lucide-react'
import Modal from '../../components/Modal.jsx'
import StatusPill from '../../components/StatusPill.jsx'
import { useConfirm } from '../../lib/confirmContext.js'
import { useToast } from '../../lib/toastContext.js'
import {
  createBadge, createBadgeRule, deleteBadgeRule, fetchAssignments, fetchBadgeRules, fetchCourse, fetchCourses,
  fetchLearners, fetchMyBadges, fetchQuizzes, fetchStaffBadges, updateBadgeRule,
} from '../../lib/lms.js'
import Loading from '../../components/Loading.jsx'

const badgeColors = ['#B39255', '#4A8A5E', '#3E6FB0', '#B0574C', '#8A6FB3', '#4C5B50']
const triggerLabel = { course_completion: 'Course completion', module_milestone: 'Module milestone', score_threshold: 'Score threshold', attendance_count: 'Attendance streak' }
const initialsOf = (name) => (name || '?').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()

function describeTrigger(trigger) {
  if (trigger.type === 'course_completion') return 'Completes every module in the course'
  if (trigger.type === 'module_milestone') return `Completes “${trigger.moduleTitle ?? 'a module'}”`
  if (trigger.type === 'score_threshold') return `Scores ${trigger.minPercent}%+ on ${trigger.targetKind === 'quiz' ? 'the quiz' : 'the assignment'} “${trigger.targetTitle ?? '—'}”`
  if (trigger.type === 'attendance_count') return `Attends ${trigger.minAttendance}+ session${trigger.minAttendance === 1 ? '' : 's'}`
  return 'Unknown trigger'
}

// Quick-add: a rule needs a badge to reference, and there's no badge management anywhere else in
// the app, so creating one has to live here rather than assume one already exists.
function NewBadgeForm({ onCreated, onCancel }) {
  const toast = useToast()
  const [values, setValues] = useState({ title: '', description: '', color: badgeColors[0] })
  const [error, setError] = useState('')
  const mutation = useMutation({ mutationFn: () => createBadge({ title: values.title.trim(), description: values.description.trim() || undefined, color: values.color }) })
  const submit = async (event) => {
    event.preventDefault()
    if (values.title.trim().length < 2) { setError('Give the badge a name.'); return }
    setError('')
    try { await mutation.mutateAsync(); toast.success('Badge created.'); onCreated() } catch (e) { setError(e.message) }
  }
  return <form className="badge-new-form" onSubmit={submit}>
    <input value={values.title} onChange={(event) => setValues((v) => ({ ...v, title: event.target.value }))} placeholder="Badge name — e.g. Top Performer" maxLength={120} autoFocus />
    <input value={values.description} onChange={(event) => setValues((v) => ({ ...v, description: event.target.value }))} placeholder="Description (optional)" maxLength={400} />
    <div className="badge-color-row" role="group" aria-label="Badge color">
      {badgeColors.map((color) => <button key={color} type="button" className={values.color === color ? 'active' : undefined} style={{ background: color }} onClick={() => setValues((v) => ({ ...v, color }))} aria-label={`Color ${color}`} />)}
    </div>
    {error && <span className="builder-error">{error}</span>}
    <div className="confirm-actions"><button type="button" className="button button-ghost button-compact" onClick={onCancel}>Cancel</button><button className="button button-primary button-compact" disabled={mutation.isPending}>{mutation.isPending ? 'Creating…' : 'Create badge'}</button></div>
  </form>
}

function BadgeManager({ badges, isLoading, onChanged }) {
  const [creating, setCreating] = useState(false)
  return <section className="profile-card badge-manager">
    <header className="profile-card-head"><h2><Award size={16} /> Badges</h2>{!creating && <button type="button" className="profile-edit-button" onClick={() => setCreating(true)}><Plus size={13} /> New badge</button>}</header>
    {creating && <NewBadgeForm onCreated={() => { setCreating(false); onChanged() }} onCancel={() => setCreating(false)} />}
    {!creating && (isLoading ? <Loading label="Loading badges…" />
      : !badges.length ? <p className="operations-note">No badges yet — create one to start building automatic rules.</p>
      : <div className="badge-chip-row">{badges.map((badge) => <span className="badge-chip" key={badge._id} style={{ borderColor: badge.color, color: badge.color }}><Award size={12} /> {badge.title}</span>)}</div>)}
  </section>
}

// One form for creating and editing a rule — the fields are identical, only the submit target
// differs, which is what keeps "edit" from silently missing a field "create" later gains.
function RuleForm({ open, initial, courses, badges, defaultCourseId, onClose, onSaved }) {
  const toast = useToast()
  const isEdit = Boolean(initial)
  const [values, setValues] = useState(() => (initial ? {
    badgeId: initial.badgeId, courseId: initial.courseId, triggerType: initial.trigger.type,
    moduleId: initial.trigger.moduleId ?? '', targetKind: initial.trigger.targetKind ?? 'assignment', targetId: initial.trigger.targetId ?? '',
    minPercent: initial.trigger.minPercent ?? 80, minAttendance: initial.trigger.minAttendance ?? 5,
    targetScope: initial.targetScope, learnerIds: initial.learnerIds ?? [],
  } : {
    badgeId: badges[0]?._id ?? '', courseId: defaultCourseId ?? courses[0]?._id ?? '', triggerType: 'course_completion',
    moduleId: '', targetKind: 'assignment', targetId: '', minPercent: 80, minAttendance: 5,
    targetScope: 'course', learnerIds: [],
  }))
  const [error, setError] = useState('')
  const set = (field) => (event) => setValues((prev) => ({ ...prev, [field]: event.target.value }))

  const { data: course } = useQuery({ queryKey: ['course', values.courseId], queryFn: () => fetchCourse(values.courseId), enabled: open && Boolean(values.courseId) && values.triggerType === 'module_milestone' })
  const { data: assignments = [] } = useQuery({ queryKey: ['assignments'], queryFn: fetchAssignments, enabled: open && values.triggerType === 'score_threshold' })
  const { data: quizzes = [] } = useQuery({ queryKey: ['quizzes'], queryFn: fetchQuizzes, enabled: open && values.triggerType === 'score_threshold' })
  const { data: learners = [] } = useQuery({ queryKey: ['staff-learners', values.courseId], queryFn: () => fetchLearners({ courseId: values.courseId }), enabled: open && values.targetScope === 'selected' && Boolean(values.courseId) })
  const courseAssignments = assignments.filter((item) => String(item.courseId) === values.courseId)
  const courseQuizzes = quizzes.filter((item) => String(item.courseId) === values.courseId)

  const mutation = useMutation({
    mutationFn: () => {
      const trigger = { type: values.triggerType }
      if (values.triggerType === 'module_milestone') trigger.moduleId = values.moduleId
      if (values.triggerType === 'score_threshold') { trigger.targetKind = values.targetKind; trigger.targetId = values.targetId; trigger.minPercent = Number(values.minPercent) }
      if (values.triggerType === 'attendance_count') trigger.minAttendance = Number(values.minAttendance)
      const payload = { badgeId: values.badgeId, courseId: values.courseId, trigger, targetScope: values.targetScope, learnerIds: values.targetScope === 'selected' ? values.learnerIds : [] }
      return isEdit ? updateBadgeRule(initial.id, payload) : createBadgeRule(payload)
    },
  })

  const submit = async (event) => {
    event.preventDefault()
    if (!values.badgeId || !values.courseId) { setError('Choose a badge and a course.'); return }
    if (values.triggerType === 'module_milestone' && !values.moduleId) { setError('Choose which module completes this rule.'); return }
    if (values.triggerType === 'score_threshold' && !values.targetId) { setError('Choose an assignment or quiz.'); return }
    if (values.targetScope === 'selected' && !values.learnerIds.length) { setError('Pick at least one learner.'); return }
    setError('')
    try { await mutation.mutateAsync(); toast.success(isEdit ? 'Rule updated.' : 'Rule created — it will award automatically from now on.'); onSaved() } catch (e) { setError(e.message) }
  }

  const toggleLearner = (id) => setValues((prev) => ({ ...prev, learnerIds: prev.learnerIds.includes(id) ? prev.learnerIds.filter((entry) => entry !== id) : [...prev.learnerIds, id] }))

  return <Modal open={open} onClose={onClose} labelledBy="badge-rule-title" className="badge-rule-modal">
    <p className="eyebrow">AUTOMATIC BADGE</p>
    <h2 id="badge-rule-title">{isEdit ? 'Edit rule' : 'New rule'}</h2>
    <form className="badge-rule-form" onSubmit={submit}>
      <div className="builder-lesson-row">
        <label className="builder-field"><span>Badge</span><select value={values.badgeId} onChange={set('badgeId')}>{badges.map((badge) => <option key={badge._id} value={badge._id}>{badge.title}</option>)}</select></label>
        <label className="builder-field"><span>Course</span><select value={values.courseId} onChange={set('courseId')}>{courses.map((c) => <option key={c._id} value={c._id}>{c.title}</option>)}</select></label>
      </div>

      <label className="builder-field"><span><Zap size={12} /> When should it be sent?</span>
        <select value={values.triggerType} onChange={set('triggerType')}>
          {Object.entries(triggerLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>

      {values.triggerType === 'module_milestone' && <label className="builder-field"><span>Module</span>
        <select value={values.moduleId} onChange={set('moduleId')}>
          <option value="">Select a module…</option>
          {(course?.modules ?? []).map((module) => <option key={module._id} value={module._id}>{module.title}</option>)}
        </select>
      </label>}

      {values.triggerType === 'score_threshold' && <>
        <div className="builder-lesson-row">
          <label className="builder-field"><span>On a</span><select value={values.targetKind} onChange={(event) => setValues((prev) => ({ ...prev, targetKind: event.target.value, targetId: '' }))}><option value="assignment">Assignment</option><option value="quiz">Quiz</option></select></label>
          <label className="builder-field"><span>{values.targetKind === 'quiz' ? 'Quiz' : 'Assignment'}</span>
            <select value={values.targetId} onChange={set('targetId')}>
              <option value="">Select one…</option>
              {(values.targetKind === 'quiz' ? courseQuizzes : courseAssignments).map((item) => <option key={item._id} value={item._id}>{item.title}</option>)}
            </select>
          </label>
        </div>
        <label className="builder-field"><span>Minimum score</span><input type="number" min={0} max={100} value={values.minPercent} onChange={set('minPercent')} /><small>Percent, out of 100.</small></label>
      </>}

      {values.triggerType === 'attendance_count' && <label className="builder-field"><span>Sessions attended</span><input type="number" min={1} max={500} value={values.minAttendance} onChange={set('minAttendance')} /><small>Counts live reviews and office hours marked present or late.</small></label>}

      <label className="builder-field"><span><Users size={12} /> Who is targeted?</span>
        <select value={values.targetScope} onChange={set('targetScope')}>
          <option value="course">Everyone enrolled in this course</option>
          <option value="selected">Specific learners</option>
        </select>
      </label>

      {values.targetScope === 'selected' && <div className="badge-learner-picker">
        {!learners.length ? <p className="operations-note">No learners enrolled in this course yet.</p>
          : learners.map((learner) => <label key={learner.id} className={`badge-learner-option ${values.learnerIds.includes(learner.id) ? 'checked' : ''}`}>
            <input type="checkbox" checked={values.learnerIds.includes(learner.id)} onChange={() => toggleLearner(learner.id)} />
            <span className="workspace-avatar">{initialsOf(learner.name)}</span>{learner.name}
          </label>)}
      </div>}

      {error && <span className="builder-error">{error}</span>}
      <div className="confirm-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create rule'}</button></div>
    </form>
  </Modal>
}

function RuleRow({ rule, badge, onEdit, onDeleted, onToggled }) {
  const toast = useToast()
  const confirm = useConfirm()
  const toggleMutation = useMutation({ mutationFn: () => updateBadgeRule(rule.id, { isActive: !rule.isActive }) })
  const deleteMutation = useMutation({ mutationFn: () => deleteBadgeRule(rule.id) })
  const toggle = async () => { try { await toggleMutation.mutateAsync(); onToggled() } catch (e) { toast.error(e.message) } }
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this rule?', message: 'Learners who already earned the badge keep it — this only stops future automatic awards.', confirmLabel: 'Delete rule' }))) return
    try { await deleteMutation.mutateAsync(); toast.success('Rule deleted.'); onDeleted() } catch (e) { toast.error(e.message) }
  }
  return <div className={`badge-rule-row ${rule.isActive ? '' : 'inactive'}`}>
    <span className="badge-rule-badge" style={{ color: badge?.color ?? '#B39255' }}><Award size={16} /> {badge?.title ?? 'Badge'}</span>
    <span className="badge-rule-condition">{describeTrigger(rule.trigger)}</span>
    <span className="badge-rule-target">{rule.targetScope === 'selected' ? `${rule.learnerIds.length} selected learner${rule.learnerIds.length === 1 ? '' : 's'}` : 'Everyone enrolled'}</span>
    <StatusPill kind={rule.isActive ? 'green' : 'red'}>{rule.isActive ? 'Active' : 'Paused'}</StatusPill>
    <span className="admin-row-actions">
      <button type="button" className="button button-ghost button-compact" onClick={toggle} disabled={toggleMutation.isPending}>{rule.isActive ? 'Pause' : 'Resume'}</button>
      <button type="button" className="button button-ghost button-compact" onClick={() => onEdit(rule)}><Pencil size={13} /></button>
      <button type="button" className="button button-ghost button-compact button-danger" onClick={remove} disabled={deleteMutation.isPending}><Trash2 size={13} /></button>
    </span>
  </div>
}

function AutoBadgeRules({ courses, badges }) {
  const queryClient = useQueryClient()
  const [courseId, setCourseId] = useState('')
  const [modal, setModal] = useState(null) // 'new' | rule object | null
  const activeCourseId = courseId || courses[0]?._id || ''
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['badge-rules', activeCourseId], queryFn: () => fetchBadgeRules(activeCourseId), enabled: Boolean(activeCourseId) })
  const badgeById = new Map(badges.map((badge) => [badge._id, badge]))
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['badge-rules', activeCourseId] })

  return <section className="profile-card badge-rules-panel">
    <header className="profile-card-head">
      <h2><Zap size={16} /> Automatic badges</h2>
      <div className="admin-row-actions">
        <label className="gradebook-course-select"><GraduationCap size={15} /><select value={activeCourseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Course">{courses.map((c) => <option key={c._id} value={c._id}>{c.title}</option>)}</select></label>
        {badges.length > 0 && <button type="button" className="profile-edit-button" onClick={() => setModal('new')}><Plus size={13} /> New rule</button>}
      </div>
    </header>
    <p className="operations-note">Automatically award a badge the moment a learner meets a condition you set — no manual step. Pause a rule to stop it without losing its configuration.</p>
    {!badges.length && <p className="operations-note"><Sparkles size={15} /> Create a badge above before setting up a rule.</p>}
    {isLoading ? <Loading label="Loading rules…" />
      : !rules.length ? null
      : <div className="badge-rule-list">
        <div className="badge-rule-row badge-rule-head"><span>BADGE</span><span>CONDITION</span><span>TARGET</span><span>STATUS</span><span /></div>
        {rules.map((rule) => <RuleRow key={rule.id} rule={rule} badge={badgeById.get(rule.badgeId)} onEdit={setModal} onDeleted={refresh} onToggled={refresh} />)}
      </div>}
    {!isLoading && !rules.length && badges.length > 0 && <p className="operations-note">No rules for this course yet.</p>}

    <RuleForm
      open={Boolean(modal)}
      initial={modal && modal !== 'new' ? modal : null}
      courses={courses} badges={badges} defaultCourseId={activeCourseId}
      onClose={() => setModal(null)}
      onSaved={() => { setModal(null); refresh() }}
    />
  </section>
}

export default function RecognitionPage({ role }) {
  const isStaff = role !== 'learner'
  const queryClient = useQueryClient()
  const { data: badges = [], isLoading } = useQuery({ queryKey: ['my-badges'], queryFn: fetchMyBadges, enabled: role === 'learner' })
  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, enabled: isStaff })
  const { data: staffBadges = [], isLoading: badgesLoading } = useQuery({ queryKey: ['staff-badges'], queryFn: fetchStaffBadges, enabled: isStaff })
  const refreshBadges = () => queryClient.invalidateQueries({ queryKey: ['staff-badges'] })

  return <>
    <div className="page-title-row"><div><p className="eyebrow">ACADEMY MILESTONES</p><h1>Recognition</h1><p>{isStaff ? 'Define badges and the conditions that award them automatically.' : 'Celebrate the progress and contribution of the Tree Academy community.'}</p></div></div>

    {isStaff && <>
      <BadgeManager badges={staffBadges} isLoading={badgesLoading} onChanged={refreshBadges} />
      {courses.length > 0
        ? <AutoBadgeRules courses={courses} badges={staffBadges} />
        : <p className="operations-note">Create a course before setting up automatic badges.</p>}
    </>}

    {role === 'learner' && isLoading && <Loading block label="Loading your recognitions…" />}
    {role === 'learner' && !isLoading && badges.length === 0 && <div className="empty-state"><Sparkles size={26} /><strong>No recognitions yet</strong><p>Keep progressing through your modules — earned badges will show up here.</p></div>}
    {role === 'learner' && badges.length > 0 && <div className="badge-grid">
      {badges.map((award) => <article className="badge-card" key={award._id}>
        <span className="badge-icon" style={{ background: award.badgeId?.color ?? '#B39255' }}><Award size={18} /></span>
        <div><h3>{award.badgeId?.title ?? 'Recognition'}</h3><p>{award.badgeId?.description}</p><small>Awarded {new Date(award.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small></div>
      </article>)}
    </div>}
  </>
}
