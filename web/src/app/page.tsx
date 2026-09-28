const stats = [
  { label: "Active learners", value: "12.4K" },
  { label: "Live classes", value: "186" },
  { label: "Completion rate", value: "94%" },
  { label: "Avg. satisfaction", value: "4.9/5" },
];

const modules = [
  {
    title: "Teacher workspace",
    description: "Create lessons, manage classes, and track assignments with transparent performance insights.",
  },
  {
    title: "Student portal",
    description: "Access courses, watch secure videos, submit homework, and keep pace with graded milestones.",
  },
  {
    title: "Admin control",
    description: "Monitor enrollments, payments, attendance, and compliance with a single operational dashboard.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto max-w-7xl px-6 pb-20 pt-10 lg:px-8">
        <nav className="mb-16 flex items-center justify-between rounded-full border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500 font-bold text-slate-950">
              E
            </div>
            <div>
              <p className="text-sm font-semibold tracking-[0.22em] text-violet-300 uppercase">EduFlow</p>
            </div>
          </div>

          <div className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#platform" className="transition hover:text-white">Platform</a>
            <a href="#modules" className="transition hover:text-white">Modules</a>
            <a href="#security" className="transition hover:text-white">Security</a>
          </div>

          <a href="/login" className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-400">
            Open workspace
          </a>
        </nav>

        <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <span className="inline-flex rounded-full border border-violet-400/40 bg-violet-500/10 px-3 py-1 text-xs font-medium tracking-[0.2em] text-violet-200 uppercase">
              Online education platform
            </span>

            <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight text-white md:text-6xl">
              Manage learning, growth, and outcomes in one place.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              A secure, role-based education platform for schools, academies, and training organizations to run courses, classes, exams, payment workflows, and learner engagement at scale.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <a href="/login" className="rounded-full bg-violet-500 px-6 py-3 font-semibold text-white transition hover:bg-violet-400">
                Open workspace
              </a>
              <a href="#modules" className="rounded-full border border-white/15 bg-white/5 px-6 py-3 font-semibold text-white transition hover:bg-white/10">
                Explore modules
              </a>
            </div>
          </div>

          <div className="rounded-3xl border border-violet-400/25 bg-gradient-to-br from-violet-500/20 via-slate-900 to-sky-500/10 p-6 shadow-2xl shadow-violet-900/30">
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Platform snapshot</p>
                  <h2 className="mt-2 text-2xl font-bold text-white">School dashboard</h2>
                </div>
                <div className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                  Active
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl bg-slate-900 p-4">
                  <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
                    <span>Course completion</span>
                    <span className="font-semibold text-white">94%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-800">
                    <div className="h-2.5 w-[94%] rounded-full bg-violet-500" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-slate-900 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Enrollments</p>
                    <p className="mt-3 text-3xl font-black text-white">1,284</p>
                  </div>
                  <div className="rounded-2xl bg-slate-900 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Revenue</p>
                    <p className="mt-3 text-3xl font-black text-white">$42k</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-slate-900/70">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-6 py-8 md:grid-cols-4 lg:px-8">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center md:text-left">
              <p className="text-3xl font-black text-white">{stat.value}</p>
              <p className="mt-2 text-sm text-slate-400">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="modules" className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="mb-10 max-w-2xl">
          <p className="text-sm font-medium tracking-[0.2em] text-violet-300 uppercase">Core modules</p>
          <h2 className="mt-3 text-3xl font-black text-white md:text-4xl">Built for every stakeholder in the learning journey.</h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {modules.map((module) => (
            <article key={module.title} className="rounded-3xl border border-white/10 bg-slate-900 p-6 transition hover:border-violet-500/40 hover:bg-slate-900/95">
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-xl text-violet-200">
                •
              </div>
              <h3 className="text-xl font-bold text-white">{module.title}</h3>
              <p className="mt-3 text-base leading-7 text-slate-300">{module.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="security" className="mx-auto max-w-7xl px-6 pb-20 lg:px-8">
        <div className="rounded-3xl border border-violet-500/20 bg-gradient-to-r from-violet-500/10 to-sky-500/10 p-8 md:p-12">
          <div className="grid gap-8 md:grid-cols-[1fr_0.9fr] md:items-center">
            <div>
              <p className="text-sm font-medium tracking-[0.2em] text-violet-200 uppercase">Secure delivery</p>
              <h2 className="mt-3 text-3xl font-black text-white md:text-4xl">Protecting premium learning content without harming the experience.</h2>
            </div>

            <ul className="space-y-3 text-slate-200">
              <li className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">Watermarking and session-based access controls</li>
              <li className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">Role-aware permissions and audit tracking</li>
              <li className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">Anti-sharing policies for protected educational videos</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
