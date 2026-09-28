const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5080";

export type AuthenticatedUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
};

export type LoginResponse = {
  token: string;
  user: AuthenticatedUser;
};

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/Auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? "Unable to sign in.");
  }

  return response.json() as Promise<LoginResponse>;
}

export async function getDashboardSummary(token: string) {
  const response = await fetch(`${apiBaseUrl}/api/v1/Dashboard/summary`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to load dashboard data.");
  }

  return response.json() as Promise<{
    totalStudents: number;
    activeStudents: number;
    totalTeachers: number;
    totalClasses: number;
    pendingPayments: number;
    todaysClasses: number;
    attendancePercentage: number;
    monthlyRevenue: number;
    upcomingExams: number;
    pendingHomework: number;
  }>;
}
