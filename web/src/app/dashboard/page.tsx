"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Bell, BookOpen, CalendarDays, CheckCircle2, ClipboardCheck, CreditCard, GraduationCap, LayoutDashboard, Menu, Search, Settings, ShieldCheck, Users, X } from "lucide-react";
import { AuthenticatedUser, getDashboardSummary } from "@/lib/api";

type Section = "overview" | "students" | "teachers" | "classes" | "courses" | "homework" | "exams" | "attendance" | "grades" | "payments" | "reports";
const navigation: Array<[Section, string, typeof LayoutDashboard]> = [
  ["overview", "Overview", LayoutDashboard], ["students", "Students", GraduationCap], ["teachers", "Teachers", Users],
  ["classes", "Classes & schedule", CalendarDays], ["courses", "Courses & lessons", BookOpen], ["homework", "Homework", ClipboardCheck],
  ["exams", "Exams", ShieldCheck], ["attendance", "Attendance", CheckCircle2], ["grades", "Grades", BarChart3], ["payments", "Payments", CreditCard], ["reports", "Reports", BarChart3],
];
const records: Record<string, string[][]> = {
  students: [["ST-1001", "Maya Al-Harbi", "Grade 8", "Active", "92%"], ["ST-1002", "Omar Khalid", "Grade 8", "Active", "88%"], ["ST-1003", "Lina Mansour", "Grade 7", "At risk", "64%"]],
  classes: [["Algebra Basics", "Mathematics", "Grade 8", "Teacher One", "24 / 30", "Active"], ["Reading Lab", "English", "Grade 7", "Sarah Ibrahim", "18 / 24", "Active"], ["General Science", "Science", "Grade 9", "Ahmed Nasser", "30 / 30", "Waitlist"]],
  payments: [["PM-2048", "Maya Al-Harbi", "$240", "Bank transfer", "Pending"], ["PM-2047", "Omar Khalid", "$180", "Card", "Approved"], ["PM-2046", "Lina Mansour", "$240", "Bank transfer", "Needs review"]],
};
const labels = { totalStudents: "Total students", activeStudents: "Active students", totalTeachers: "Teachers", totalClasses: "Classes", pendingPayments: "Pending payments", upcomingExams: "Upcoming exams" };
const titles: Record<Exclude<Section, "overview">, string> = { students: "Students", teachers: "Teachers", classes: "Classes & schedule", courses: "Courses & lessons", homework: "Homework", exams: "Exams", attendance: "Attendance", grades: "Grades", payments: "Payments", reports: "Reports" };
const roleSections: Record<string, Section[]> = {
  SuperAdmin: ["overview", "students", "teachers", "classes", "courses", "homework", "exams", "attendance", "grades", "payments", "reports"],
  Teacher: ["overview", "classes", "courses", "homework", "exams", "attendance", "grades", "reports"],
  Student: ["overview", "courses", "homework", "exams", "attendance", "grades"],
  Parent: ["overview", "attendance", "grades", "reports"],
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("eduflow.token");
    const storedUser = localStorage.getItem("eduflow.user");
    if (!token || !storedUser) { router.replace("/login"); return; }
    const parsedUser = JSON.parse(storedUser) as AuthenticatedUser;
    setUser(parsedUser);
    if (parsedUser.role === "SuperAdmin" || parsedUser.role === "Teacher") {
      getDashboardSummary(token).then(setSummary).catch(() => setError("Unable to load live dashboard data."));
    }
  }, [router]);

  const select = (next: Section) => { setSection(next); setQuery(""); setMobileOpen(false); };
  const signOut = () => { localStorage.clear(); router.replace("/login"); };
  if (!user) return <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] text-slate-500">Loading workspace...</main>;
  const current = navigation.find((item) => item[0] === section) ?? navigation[0];

  return <main className="min-h-screen bg-[#f6f8fb] text-slate-900">
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-20 items-center justify-between border-b border-slate-100 px-6"><button onClick={() => select("overview")} className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#171c38] text-lg font-black text-white">E</span><span><strong className="block text-sm tracking-[0.18em] text-[#171c38] uppercase">EduFlow</strong><small className="text-xs text-slate-400">Education OS</small></span></button><button onClick={() => setMobileOpen(false)} className="lg:hidden" aria-label="Close navigation"><X size={18} /></button></div>
      <div className="border-b border-slate-100 p-5"><div className="flex items-center gap-3 rounded-xl bg-[#f6f8fb] p-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e8e7ff] font-bold text-[#5551b7]">{user.name[0]}</span><span><strong className="block text-sm">{user.name}</strong><small className="text-xs text-slate-400">{user.role}</small></span></div></div>
      <nav className="flex-1 overflow-y-auto px-4 py-5"><p className="mb-3 px-3 text-[10px] font-bold tracking-[0.18em] text-slate-400 uppercase">Workspace</p>{navigation.filter(([key]) => (roleSections[user.role] ?? roleSections.Student).includes(key)).map(([key, label, Icon]) => <button key={key} onClick={() => select(key)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium ${section === key ? "bg-[#171c38] text-white" : "text-slate-500 hover:bg-slate-50"}`}><Icon size={17} />{label}</button>)}<p className="mb-3 mt-8 px-3 text-[10px] font-bold tracking-[0.18em] text-slate-400 uppercase">System</p><button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-500 hover:bg-slate-50"><Settings size={17} />Settings</button></nav>
      <div className="border-t border-slate-100 p-5"><div className="rounded-xl bg-[#f1f0ff] p-4"><p className="text-xs font-semibold text-[#5551b7]">Need help?</p><p className="mt-1 text-xs text-slate-500">Review workspace setup and permissions.</p></div></div>
    </aside>
    {mobileOpen && <button className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden" aria-label="Close navigation overlay" onClick={() => setMobileOpen(false)} />}
    <div className="lg:pl-72"><header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-5 lg:px-10"><div className="flex items-center gap-4"><button onClick={() => setMobileOpen(true)} className="lg:hidden" aria-label="Open navigation"><Menu size={20} /></button><div><p className="text-xs font-semibold tracking-[0.16em] text-slate-400 uppercase">Workspace / {current[1]}</p><h1 className="mt-1 text-lg font-bold">{section === "overview" ? `Good morning, ${user.name.split(" ")[0]}` : current[1]}</h1></div></div><div className="flex items-center gap-4"><button className="relative text-slate-500" aria-label="Notifications"><Bell size={19} /><span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-rose-500" /></button><button onClick={signOut} className="text-sm font-semibold text-slate-500">Sign out</button></div></header><section className="mx-auto max-w-[1440px] px-5 py-8 lg:px-10">{error && <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}{section === "overview" ? <Overview summary={summary} select={select} /> : <Module section={section} query={query} setQuery={setQuery} />}</section></div>
  </main>;
}

function Overview({ summary, select }: { summary: Record<string, number> | null; select: (next: Section) => void }) {
  return <><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-slate-500">Tuesday, September 28, 2026</p><h2 className="mt-2 text-3xl font-black tracking-tight">Your school at a glance.</h2></div><button onClick={() => select("reports")} className="rounded-xl bg-[#5551b7] px-4 py-2.5 text-sm font-bold text-white">View reports</button></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">{Object.entries(labels).map(([key, label]) => <article key={key} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-3 text-3xl font-black">{summary?.[key] ?? "-"}</p><p className="mt-2 text-xs font-medium text-emerald-600">↑ 8.4% this month</p></article>)}</div><div className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_0.8fr]"><section className="rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-6 py-5"><p className="text-xs font-semibold tracking-[0.16em] text-[#5551b7] uppercase">Attention needed</p><h3 className="mt-1 text-xl font-bold">Today&apos;s priorities</h3></div>{[["Homework awaiting review", "8 submissions", "homework"], ["Payment requests", "4 need approval", "payments"], ["Attendance exceptions", "3 students", "attendance"]].map(([title, detail, target]) => <button key={title} onClick={() => select(target as Section)} className="flex w-full items-center gap-4 border-b border-slate-100 px-6 py-4 text-left hover:bg-slate-50"><span className="h-2.5 w-2.5 rounded-full bg-[#7773d4]" /><span className="flex-1"><strong className="block text-sm">{title}</strong><small className="text-xs text-slate-500">{detail}</small></span><span className="text-slate-300">→</span></button>)}</section><section className="rounded-2xl bg-[#171c38] p-6 text-white"><div className="flex justify-between"><div><p className="text-xs font-semibold tracking-[0.16em] text-indigo-200 uppercase">Learning pulse</p><h3 className="mt-2 text-xl font-bold">Attendance this week</h3></div><CheckCircle2 className="text-emerald-300" /></div><p className="mt-8 text-5xl font-black">{summary?.attendancePercentage ?? 92}%</p><div className="mt-5 h-2 rounded-full bg-white/15"><div className="h-2 w-[92%] rounded-full bg-emerald-300" /></div><p className="mt-4 text-sm text-slate-300">Up 3.2% compared with last week.</p></section></div></>;
}

function Module({ section, query, setQuery }: { section: Exclude<Section, "overview">; query: string; setQuery: (value: string) => void }) {
  const data = records[section];
  const title = titles[section];
  const filtered = data?.filter((row) => row.join(" ").toLowerCase().includes(query.toLowerCase())) ?? [];
  return <><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-slate-500">Workspace module</p><h2 className="mt-2 text-3xl font-black tracking-tight">{title}</h2><p className="mt-2 text-sm text-slate-500">Manage {title.toLowerCase()} and keep your learning operation moving.</p></div><button className="rounded-xl bg-[#5551b7] px-4 py-2.5 text-sm font-bold text-white">+ Add {section === "students" ? "student" : section === "classes" ? "class" : "item"}</button></div>{data ? <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="flex flex-wrap justify-between gap-3 border-b border-slate-100 px-5 py-4"><div className="relative w-full max-w-sm"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#7773d4]" /></div><button className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">Filter</button></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-500 uppercase"><tr>{(section === "students" ? ["Code", "Student", "Level", "Status", "Progress"] : section === "classes" ? ["Class", "Subject", "Level", "Teacher", "Capacity", "Status"] : ["Reference", "Student", "Amount", "Method", "Status"]).map((head) => <th key={head} className="px-5 py-4">{head}</th>)}<th /></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map((row) => <tr key={row[0]} className="hover:bg-slate-50">{row.map((cell, index) => <td key={`${row[0]}-${index}`} className={`px-5 py-4 ${index === 0 ? "font-semibold text-slate-800" : "text-slate-500"}`}>{index === row.length - 1 ? <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cell === "Active" || cell === "Approved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{cell}</span> : cell}</td>)}<td className="px-5 py-4 text-right text-slate-400">•••</td></tr>)}</tbody></table></div></section> : <div className="flex min-h-[430px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-center"><BookOpen className="text-[#5551b7]" size={34} /><h3 className="mt-5 text-xl font-bold">{title} workspace is ready</h3><p className="mt-2 max-w-md text-sm text-slate-500">This module is wired into the application shell. Connect its API workflow to manage real records.</p></div>}</>;
}
