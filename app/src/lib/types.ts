// Shapes of the JSON the Python server returns (only the fields the app reads).

export interface Reply {
  email: string;
  name: string;
  organization: string;
  subject: string;
  snippet: string;
  suggestion: string;
  likely_no: boolean;
  received: number;
}

export interface Draft {
  id: number;
  email: string;
  subject: string;
  body: string;
  source: string;
  quality: number;
  status: string;
  created: number;
  name?: string;
  organization?: string;
}

export interface Task {
  id: number;
  kind: string;
  title: string;
  note: string;
  contact: string;
  due: number | null;
  priority: string;
  status: string;
  contact_name?: string;
  contact_org?: string;
  sequence_name?: string | null;
}

export interface HeadsUp {
  level: "bad" | "warn" | "info" | string;
  message: string;
}

export interface Counts {
  replies: number;
  drafts: number;
  tasks: number;
  new_leads: number;
}

export interface Briefing {
  replies: Reply[];
  drafts: Draft[];
  tasks: { overdue: Task[]; today: Task[] };
  new_leads: { count: number; items: { email: string; name: string; title: string; organization: string }[] };
  heads_up: HeadsUp[];
  counts: Counts;
}

export interface Plan {
  text: string;
  kind: "find" | "workflow" | "unsupported";
  steps: string[];
  confirm: boolean;
  suggestion: string;
  schedule: string;
  by: string;
  needs_yes: boolean;
}

export type PlanReply =
  | { kind: "answer"; answer: string }
  | { kind: "plan"; id: string; plan: Plan; runnable: boolean };

export interface RunResult {
  ok: boolean;
  leads: number;
  verified: number;
  drafts_waiting: number;
  sent: number;
  workflow: string;
  message: string;
  scheduled?: string;
}

export interface Person {
  email: string;
  name: string;
  title: string;
  organization: string;
  domain: string;
  tier: string;
  fit_score: number;
  stage: string;
  status: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  linkedin_url: string;
  website: string;
  industry: string;
  source: string;
  last_contacted: number | null;
  created: number;
  tags: string[];
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface Stage {
  key: string;
  label: string;
  tone?: string;
}

export interface Meta {
  contact_stages: Stage[];
  deal_stages: (Stage & { probability: number })[];
}

export interface Activity {
  id: number;
  kind: string;
  summary: string;
  ts: number;
  label: string;
  name?: string;
  ref?: string;
}
