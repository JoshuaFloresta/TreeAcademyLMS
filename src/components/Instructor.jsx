import instructorProfile from '../assets/instructorProfile.jpg'
import { motion } from "framer-motion";

const instructor = {
  image: instructorProfile,
  name: 'William Floresta',
  title: 'RE Consultant | RE Appraiser | RE Broker ',
  bio: 'William L. Floresta is a licensed Real Estate Consultant, Real Estate Appraiser, and Real Estate Broker with more than three decades of experience in property valuation, brokerage, real estate consulting, market and feasibility studies, and professional education.',
  highlights: [
    'Leadership & Credentials: Past National President of the Philippine Association of Real Estate Boards (PAREB).',
    'Track Record: Evaluated residential, commercial, industrial, resort, development, and special-purpose properties.',
    'Founder & Educator: Established TREE Academy for Real Estate Excellence and created the Pass-First Review Program.',
  ],
  specialties: ['Appraiser ', 'Broker ', 'Educator','Consultant', 'Innovator'],
  stats: [{ label: 'Years experience', value: '35+' }, { label: 'Students mentored', value: '500+' }],
}


export default function Instructors() {
  return (
    <section id="instructors" className="py-24 md:py-32 bg-[#1B432E]/[0.03]">
      <div className="max-w-7xl mx-auto px-6 md:px-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <span className="text-[#B39255] font-sans text-sm tracking-[0.25em] uppercase font-medium">
            Your Guide
          </span>
          <h2 className="mt-4 font-serif text-[#1B432E] text-3xl md:text-display-sm font-bold">
            Learn from the Best
          </h2>
          <p className="mt-4 text-[#1B432E]/60 font-sans text-lg max-w-xl mx-auto leading-relaxed">
          "Real market experience. Real-time mentorship."          
          </p>
        </motion.div>

        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.6 }}
            className="group flex flex-col md:flex-row gap-10 md:gap-14 items-center"
          >
            {/* Photo */}
            <div className="relative w-72 flex-shrink-0">
              <div className="relative aspect-[3/4] rounded-[2rem] overflow-hidden bg-[#1B432E]/5 shadow-[0_10px_40px_-10px_rgba(27,67,46,0.2)]">
                <img
                  src={instructor.image}
                  alt={instructor.name}
                  className="w-full h-full object-cover transition-all duration-700 group-hover:scale-[1.03]"
                />
                <div className="absolute inset-0 bg-[#1B432E]/0 group-hover:bg-[#1B432E]/10 transition-all duration-500" />
              </div>
              {/* Gold accent border */}
              <div className="absolute -bottom-3 -right-3 w-full h-full rounded-[2rem] border-2 border-[#B39255]/30 -z-10" />
            </div>

            {/* Content */}
             <div className="flex-1 space-y-5">
              <div>
                <h3 className="font-serif text-[#1B432E] text-3xl md:text-4xl font-bold mb-2">
                  {instructor.name}
                </h3>
                <p className="text-[#B39255] font-sans text-sm font-medium tracking-widest uppercase">
                  {instructor.title}
                </p>
              </div>

              <p className="text-[#1B432E]/65 font-sans text-base leading-relaxed text-justify">
                {instructor.bio}
              </p>

              <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#1B432E]/65">
                {instructor.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>

              {/* Stats */}
              <div className="flex gap-8 py-4 border-t border-b border-[#1B432E]/[0.08]">
                {instructor.stats.map((stat) => (
                  <div key={stat.label}>
                    <p className="font-serif text-[#B39255] text-2xl font-bold">{stat.value}</p>
                    <p className="text-[#1B432E]/50 font-sans text-xs mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {instructor.specialties.map((s) => (
                  <span
                    key={s}
                    className="px-4 py-1.5 text-xs font-sans font-medium text-[#1B432E] bg-[#B39255]/10 border border-[#B39255]/20 rounded-full"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
