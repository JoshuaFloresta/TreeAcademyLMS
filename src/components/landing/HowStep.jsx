export default function HowStep({ number, icon: Icon, title, copy }) {
  return <article className="how-step"><span className="step-number">{number}</span><div className="step-icon"><Icon /></div><h3>{title}</h3><p>{copy}</p></article>
}
