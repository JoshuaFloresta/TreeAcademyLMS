import passFirstProgram from '../assets/pass-first-program.jpg'

export default function PassFirst() {
  return (
    <section id="pass-first" className="py-16 md:py-20 bg-[#F9F7F2]">
      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div className="max-w-2xl lg:pr-12">
            <span className="text-[#B39255] text-sm tracking-[0.25em] uppercase font-medium">
              Pass-First Review Program
            </span>
            <h2 className="mt-4 font-serif text-[#1B432E] text-3xl md:text-5xl font-bold leading-tight">
             Study without stress. Pay after success.
            </h2>
            <br></br>
            <p className="mt-28 text-[#1B432E]/80 text-lg leading-relaxed text-justify">
              Under TREE Academy, the Pass-First Review Program is our standards-based licensure preparation program for aspiring real estate brokers, appraisers, and consultants.
             We do things differently because we believe in your success. With our “Pass-First, Pay-Later” guarantee, you focus on preparation first and pay your review fees only after you successfully pass your licensure exam.
              Pass-First goes far beyond memorization. It builds deep understanding, professional judgment, practical application, and the confidence you need to step into the real estate industry ready to perform.
            </p>
          </div>

          <div className="relative flex justify-center lg:justify-end">
            <div className="overflow-hidden rounded-3xl border border-[#1B432E]/10 bg-[#1B432E]/5 shadow-xl w-full max-w-[520px]">
              <img
                src={passFirstProgram}
                alt="Pass-First Review Program overview"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#F9F7F2] to-transparent" />
          </div>
        </div>
      </div>
    </section>
  );
}
