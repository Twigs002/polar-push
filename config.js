// Public Supabase config — same project as quay-clock + quay-leads.
// Both values are intended to be public. Row-level access is gated by
// Postgres RLS on every table (any active staff may read standings;
// only super/admin staff may write entries).
window.QUAY = {
  SUPABASE_URL: "https://dqszbqiimbfvmmnpgpsb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxc3picWlpbWJmdm1tbnBncHNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NDk4OTQsImV4cCI6MjA5NjQyNTg5NH0.M9RQnJEidyIMZAwbELTSPakiSnvuWBdHTjD7nuOdCZY",
  AUTH_EMAIL_DOMAIN: "quay1.local",
};

// Operation Polar Push — 8-week team competition.
window.POLAR = {
  TITLE: "Operation Polar Push",
  SUBTITLE: "8-week team competition",
  START: "2026-08-01",   // Sat 1 Aug 2026
  END:   "2026-09-30",   // 30 Sep 2026
  PRIZE: "Fully paid weekend away · R15,000",
};
