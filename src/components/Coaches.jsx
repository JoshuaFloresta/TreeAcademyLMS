import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, UserRound } from 'lucide-react'

// PLACEHOLDER ROSTER — replace each entry as coach details are confirmed. Adding a photo is the
// only structural change needed: give an entry an `image` and it renders instead of the initials
// tile. The carousel handles any number of coaches; the controls hide themselves when there's one.
const coaches = [
  {
    id: 'coach-1',
    initials: 'TBA',
    name: 'Coach name to be announced',
    title: 'Role · Credentials',
    bio: 'A short introduction to this coach — background, exam specialisation, and how they support reviewees week to week. Replace this text once their profile is confirmed.',
    specialties: ['Specialty', 'Specialty'],
    stats: [{ label: 'Years experience', value: '—' }, { label: 'Reviewees coached', value: '—' }],
  },
  {
    id: 'coach-2',
    initials: 'TBA',
    name: 'Coach name to be announced',
    title: 'Role · Credentials',
    bio: 'A short introduction to this coach — background, exam specialisation, and how they support reviewees week to week. Replace this text once their profile is confirmed.',
    specialties: ['Specialty', 'Specialty'],
    stats: [{ label: 'Years experience', value: '—' }, { label: 'Reviewees coached', value: '—' }],
  },
  {
    id: 'coach-3',
    initials: 'TBA',
    name: 'Coach name to be announced',
    title: 'Role · Credentials',
    bio: 'A short introduction to this coach — background, exam specialisation, and how they support reviewees week to week. Replace this text once their profile is confirmed.',
    specialties: ['Specialty', 'Specialty'],
    stats: [{ label: 'Years experience', value: '—' }, { label: 'Reviewees coached', value: '—' }],
  },
]

const AUTO_ADVANCE_MS = 6000

export default function Coaches() {
  const [[index, direction], setSlide] = useState([0, 0])
  const [paused, setPaused] = useState(false)
  // Honours the OS "reduce motion" setting: no sliding, and no unattended auto-advance, since
  // motion the visitor can't stop is exactly what that setting exists to prevent.
  const reduceMotion = useReducedMotion()
  const count = coaches.length

  const goTo = useCallback((next, dir) => setSlide(([current]) => [(next + count) % count, dir ?? (next > current ? 1 : -1)]), [count])

  useEffect(() => {
    if (paused || reduceMotion || count < 2) return
    const timer = setTimeout(() => goTo(index + 1, 1), AUTO_ADVANCE_MS)
    return () => clearTimeout(timer)
  }, [index, paused, reduceMotion, count, goTo])

  const coach = coaches[index]
  const offset = reduceMotion ? 0 : 40
  // Variants (rather than inline initial/exit props) so AnimatePresence's `custom` reaches the
  // *exiting* card. An exiting child otherwise keeps the props it last rendered with — i.e. the
  // previous direction — so reversing course mid-carousel would slide both cards the same way.
  const slide = {
    enter: (dir) => ({ opacity: 0, x: dir >= 0 ? offset : -offset }),
    center: { opacity: 1, x: 0 },
    exit: (dir) => ({ opacity: 0, x: dir >= 0 ? -offset : offset }),
  }

  return (
    <section id="coaches" className="py-24 md:py-32">
      <div className="max-w-7xl mx-auto px-6 md:px-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-[#B39255] font-sans text-sm tracking-[0.25em] uppercase font-medium">
            Your Coaches
          </span>
          <h2 className="mt-4 font-serif text-[#1B432E] text-3xl md:text-display-sm font-bold">
            Guided by Practitioners
          </h2>
          <p className="mt-4 text-[#1B432E]/60 font-sans text-lg max-w-xl mx-auto leading-relaxed">
            The mentors who run your weekly coaching, drills, and mock exams.
          </p>
        </motion.div>

        {/* Pausing on hover/focus keeps the carousel from advancing out from under someone who is
            reading a bio or tabbing through the controls. */}
        <div
          className="max-w-5xl mx-auto"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="relative overflow-hidden">
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div
                key={coach.id}
                custom={direction}
                variants={slide}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: reduceMotion ? 0.2 : 0.45, ease: 'easeOut' }}
                className="group flex flex-col md:flex-row gap-10 md:gap-14 items-center"
              >
                {/* Photo — falls back to an initials tile until a real image is supplied. */}
                <div className="relative w-72 flex-shrink-0">
                  <div className="relative aspect-[3/4] rounded-[2rem] overflow-hidden bg-[#1B432E]/5 shadow-[0_10px_40px_-10px_rgba(27,67,46,0.2)]">
                    {coach.image ? (
                      <img
                        src={coach.image}
                        alt={coach.name}
                        className="w-full h-full object-cover transition-all duration-700 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#1B432E]/[0.07] to-[#B39255]/[0.14]">
                        <UserRound className="w-14 h-14 text-[#1B432E]/25" strokeWidth={1.25} />
                        <span className="font-serif text-[#1B432E]/40 text-2xl font-bold tracking-widest">
                          {coach.initials}
                        </span>
                        <span className="text-[#1B432E]/35 font-sans text-[11px] tracking-widest uppercase">
                          Photo coming soon
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="absolute -bottom-3 -right-3 w-full h-full rounded-[2rem] border-2 border-[#B39255]/30 -z-10" />
                </div>

                {/* Content */}
                <div className="flex-1 space-y-5">
                  <div>
                    <h3 className="font-serif text-[#1B432E] text-3xl md:text-4xl font-bold mb-2">
                      {coach.name}
                    </h3>
                    <p className="text-[#B39255] font-sans text-sm font-medium tracking-widest uppercase">
                      {coach.title}
                    </p>
                  </div>

                  <p className="text-[#1B432E]/65 font-sans text-base leading-relaxed text-justify">
                    {coach.bio}
                  </p>

                  <div className="flex gap-8 py-4 border-t border-b border-[#1B432E]/[0.08]">
                    {coach.stats.map((stat) => (
                      <div key={stat.label}>
                        <p className="font-serif text-[#B39255] text-2xl font-bold">{stat.value}</p>
                        <p className="text-[#1B432E]/50 font-sans text-xs mt-0.5">{stat.label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {coach.specialties.map((specialty, specialtyIndex) => (
                      <span
                        key={`${coach.id}-${specialtyIndex}`}
                        className="px-4 py-1.5 text-xs font-sans font-medium text-[#1B432E] bg-[#B39255]/10 border border-[#B39255]/20 rounded-full"
                      >
                        {specialty}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {count > 1 && (
            <div className="mt-12 flex items-center justify-center gap-6">
              <button
                type="button"
                onClick={() => goTo(index - 1, -1)}
                aria-label="Previous coach"
                className="w-11 h-11 grid place-items-center rounded-full border border-[#1B432E]/15 text-[#1B432E] transition-all duration-300 hover:border-[#B39255] hover:text-[#B39255]"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2.5">
                {coaches.map((item, dotIndex) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => goTo(dotIndex)}
                    aria-label={`Show coach ${dotIndex + 1} of ${count}`}
                    aria-current={dotIndex === index}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      dotIndex === index ? 'w-8 bg-[#B39255]' : 'w-2 bg-[#1B432E]/20 hover:bg-[#1B432E]/35'
                    }`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() => goTo(index + 1, 1)}
                aria-label="Next coach"
                className="w-11 h-11 grid place-items-center rounded-full border border-[#1B432E]/15 text-[#1B432E] transition-all duration-300 hover:border-[#B39255] hover:text-[#B39255]"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* Screen readers get the change announced without relying on the visual transition. */}
          <p className="sr-only" aria-live="polite">
            Showing coach {index + 1} of {count}: {coach.name}
          </p>
        </div>
      </div>
    </section>
  )
}
