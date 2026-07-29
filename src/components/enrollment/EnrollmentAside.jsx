import { Check, CircleHelp } from 'lucide-react'

export default function EnrollmentAside({ pathway }) {
  const PathwayIcon = pathway.icon
  return <aside className="enrollment-aside"><div className="aside-path-icon"><PathwayIcon size={22} /></div><p className="eyebrow">YOUR STARTING PATH</p><h3>{pathway.title}</h3><p>{pathway.copy}</p><div className="aside-rule" /><div className="aside-includes"><strong>All-access includes</strong><span><Check /> All three review pathways</span><span><Check /> Practice work and progress tools</span><span><Check /> Instructor-led events</span></div><div className="aside-support"><CircleHelp size={18} /><p>Need a hand?<br /><a href="mailto:hello@treeacademy.ph">Talk to the academy</a></p></div></aside>
}
