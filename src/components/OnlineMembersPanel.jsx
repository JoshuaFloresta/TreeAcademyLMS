import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { avatarSrc } from '../lib/api.js'

const tones = ['sage', 'sky', 'rose', 'gold']
const toneFor = (id) => tones[[...String(id)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length]
const initialsOf = (name) => (name ?? '').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?'
const roleLabel = (role) => (role === 'learner' ? 'Student' : role === 'instructor' ? 'Instructor' : role === 'admin' ? 'Admin' : 'Member')

function normalizeMember(member) {
  const id = member._id ?? member.id
  return { id, name: member.name ?? 'Member', role: member.role ?? 'learner', avatarUrl: member.avatarUrl }
}

export default function OnlineMembersPanel({ open, onOpenChange, members = [], currentUserId }) {
  const navigate = useNavigate()
  const normalized = members.map(normalizeMember).filter((member) => member.id && member.id !== currentUserId)
  const groups = {
    Instructors: normalized.filter((member) => member.role === 'instructor' || member.role === 'admin'),
    Students: normalized.filter((member) => member.role === 'learner'),
  }

  useEffect(() => {
    if (!open) return undefined

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onOpenChange(false)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onOpenChange, open])

  const handleMemberClick = (member) => {
    onOpenChange(false)
    navigate(`/profile?member=${member.id}`)
  }

  return (
    <div className={`online-members-sheet ${open ? 'open' : ''}`} aria-hidden={!open}>
      <button className="online-members-backdrop" onClick={() => onOpenChange(false)} tabIndex={open ? 0 : -1} aria-label="Close online members" />
      <aside className="online-members-panel" role="dialog" aria-modal="true" aria-labelledby="online-members-title">
        <header className="online-members-panel-header">
          <div className="online-members-heading">
            <h2 id="online-members-title">Online Members</h2>
            <p>{normalized.length} member{normalized.length === 1 ? '' : 's'} currently active · click to view profile</p>
          </div>
          <button onClick={() => onOpenChange(false)} className="online-members-close" tabIndex={open ? 0 : -1} aria-label="Close online members">
            <X size={17} />
          </button>
        </header>

        <div className="online-members-content scrollbar-dark">
          {normalized.length === 0 && <p className="online-members-empty">No one else is online right now.</p>}
          {Object.entries(groups).filter(([, users]) => users.length).map(([group, users]) => (
            <section className="online-members-group" key={group}>
              <h3>{group} <span>({users.length})</span></h3>
              <div className="online-members-list">
                {users.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => handleMemberClick(member)}
                    className="online-member-row"
                    tabIndex={open ? 0 : -1}
                  >
                    <span className={`online-member-avatar ${toneFor(member.id)}`} style={member.avatarUrl ? { backgroundImage: `url(${avatarSrc(member.avatarUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} aria-hidden="true">
                      {!member.avatarUrl && initialsOf(member.name)}
                      <i />
                    </span>
                    <span className="online-member-details">
                      <strong>{member.name}</strong>
                      <small>{roleLabel(member.role)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>
    </div>
  )
}
