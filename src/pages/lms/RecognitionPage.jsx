import { useQuery } from '@tanstack/react-query'
import { Award, Sparkles } from 'lucide-react'
import { fetchMyBadges } from '../../lib/lms.js'

export default function RecognitionPage({ role }) {
  const { data: badges = [], isLoading, error } = useQuery({ queryKey: ['my-badges'], queryFn: fetchMyBadges, enabled: role === 'learner' })

  return <>
    <div className="page-title-row"><div><p className="eyebrow">ACADEMY MILESTONES</p><h1>Recognition</h1><p>Celebrate the progress and contribution of the Tree Academy community.</p></div></div>
    {role !== 'learner' && <div className="settings-card"><span className="notice-icon gold"><Sparkles size={18} /></span><div><h2>Badges are awarded to learners</h2><p>Recognition badges are given to individual learners by the academy team as they hit milestones.</p></div></div>}
    {role === 'learner' && isLoading && <div className="empty-state"><Award size={26} /><strong>Loading your recognitions…</strong></div>}
    {role === 'learner' && error && <div className="empty-state"><Award size={26} /><strong>Could not load recognitions</strong><p>{error.message}</p></div>}
    {role === 'learner' && !isLoading && !error && badges.length === 0 && <div className="empty-state"><Sparkles size={26} /><strong>No recognitions yet</strong><p>Keep progressing through your modules — earned badges will show up here.</p></div>}
    {role === 'learner' && badges.length > 0 && <div className="badge-grid">
      {badges.map((award) => <article className="badge-card" key={award._id}>
        <span className="badge-icon" style={{ background: award.badgeId?.color ?? '#B39255' }}><Award size={18} /></span>
        <div><h3>{award.badgeId?.title ?? 'Recognition'}</h3><p>{award.badgeId?.description}</p><small>Awarded {new Date(award.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small></div>
      </article>)}
    </div>}
  </>
}
