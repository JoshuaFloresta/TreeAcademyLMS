export default function StatCard({ icon: Icon, label, value, detail, trend, gold }) {
  return <article className="stat-card"><span className={`stat-icon ${gold ? 'gold' : ''}`}><Icon size={20} /></span><div><p>{label}</p><h2>{value}</h2><small>{detail}</small></div><span className={`stat-trend ${gold ? 'gold' : ''}`}>{trend}</span></article>
}
