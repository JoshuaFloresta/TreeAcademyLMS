import { motion } from "framer-motion";
import { Quote } from "lucide-react";

const testimonials = [
  {
    quote: "Preparing for the REALEX was far from easy. It took intense discipline, sacrifice, and courage to push through every tough concept, mock exam, and coaching session. But thanks to the incredible guidance of Coach William Floresta, Coach Atty. Rhandell, Coach Mike, Coach Conrad, Coach Robert, Coach Justin Victor, and the entire Pass-First family, my confusion turned into confidence. They didn't just help me pass they prepared me to be a true professional.",
    name: "Maricel G. Gacutan",
    title: "REALEX Alumni, Class of 2026",
  },
  {
    quote: "I am deeply grateful to Sir William Floresta, all the coaches, mentors, and the entire Pass-First Family for your tireless teaching, guidance, and unwavering belief in me. It is a true honor to be part of the Pass-First Pioneer family. Thank you also to everyone who supported and prayed for me along the way—I couldn't have achieved this milestone without you. I wholeheartedly recommend the Pass-First Review Program to anyone dreaming of passing the board and earning their PRC license!",
    name: "Margie S. Anacio",
    title: "REALEX Alumni, Class of 2026",
  },
  {
    quote: "What truly sets this review center apart is that it doesn’t just teach lessons it teaches you how to think like a real estate appraiser. Their practical, situational approach is what gave me genuine confidence during the actual exam. But what makes this program an absolute winner is the `Study Now, Pay When You Pass` scheme. It proves that helping aspiring professionals succeed is prioritized over making a profit. Salute to you, Coach William! Thank you so much for your guidance, care, and unwavering belief in your reviewees.",
    name: "Rosemarie D. Sales",
    title: "REALEX Alumni, Class of 2026",
  },
];

export default function Testimonials() {
  return (
    <section id="testimonials" className="py-24 md:py-32 bg-[#1B432E]/[0.03]">
      <div className="max-w-7xl mx-auto px-6 md:px-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <span className="text-[#B39255] font-sans text-sm tracking-[0.25em] uppercase font-medium">
            Testimonials
          </span>
          <h2 className="mt-4 font-serif text-[#1B432E] text-3xl md:text-display-sm font-bold">
            Voices of Excellence
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-6">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="relative flex h-full flex-col bg-white/60 backdrop-blur-sm rounded-lg p-8 md:p-10 border border-[#1B432E]/[0.06] hover:border-[#B39255]/30 transition-all duration-500 hover:shadow-lg"
            >
              <Quote className="w-8 h-8 text-[#B39255]/30 mb-6" />
              <p className="text-[#1B432E]/75 font-sans text-[15px] leading-[1.7] mb-8 italic text-justify">
                "{t.quote}"
              </p>
              <div className="mt-auto border-t border-[#1B432E]/[0.08] pt-5">
                <p className="font-serif text-[#1B432E] font-bold text-base">
                  {t.name}
                </p>
                <p className="text-[#B39255] font-sans text-xs font-medium tracking-wide mt-1">
                  {t.title}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
