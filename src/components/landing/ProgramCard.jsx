import { ArrowRight, Users } from 'lucide-react'

const seasonNote = (stats) => {
  if (!stats) return null
  if (stats.closed) return 'Enrollment closed'
  if (stats.opensLater) return `Opens ${new Date(stats.availableFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  if (stats.availableUntil) return `Closes ${new Date(stats.availableUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  return null
}

export default function ProgramCard({ pathway, stats, onSelect }) {
  const Icon = pathway.icon
  const note = seasonNote(stats)
  return <article className={`program-card ${pathway.tone}`}>
    <div className="program-card-top"><span className="program-icon"><Icon size={21} /></span><span className="card-count">{pathway.examTag}</span></div>
    <div>
      <p className="eyebrow">{pathway.kicker}</p>
      <h3>{pathway.title}</h3>
      <p>{pathway.copy}</p>
      {(stats?.enrolledCount != null || note) && <div className="program-card-live">
        {stats?.enrolledCount != null && <span><Users size={12} /> {stats.enrolledCount.toLocaleString('en-US')} enrolled</span>}
        {note && <span className={stats.closed ? 'muted' : ''}>{note}</span>}
      </div>}
    </div>
    <button type="button" className="circle-link" onClick={() => onSelect(pathway.id)} aria-label={`View ${pathway.title} details`}><ArrowRight size={19} /></button>
  </article>
}
