/**
 * Third-party services a project can be wired to.
 *
 * Two categories, and the distinction matters because it decides where a key
 * is allowed to end up:
 *
 *   'ai'      — used by Zory itself, in this browser, to propose edits. The
 *               key never leaves the device and never enters the project.
 *   'service' — belongs to the site being built. The key is written into the
 *               exported project's .env, never into the project document.
 *   'account' — a service Zory acts on your behalf with, like pushing to a
 *               repository. Same rule as an AI key: this browser only, never
 *               exported, never sent to us.
 *
 * Nothing here is ever stored in the project graph. The graph is exported, and
 * it is synced to Firestore when a user backs up, so a key placed in it would
 * be published twice over by design. See integrations/store.ts.
 */

export type IntegrationCategory = 'ai' | 'service' | 'account';

export interface IntegrationField {
  /** Key under which the value is stored, and the exported env var name. */
  id: string;
  label: string;
  /** Shown under the input. Say what it is and where to get it. */
  hint?: string;
  /** Masked in the UI and never logged. */
  secret: boolean;
  placeholder?: string;
}

export interface Integration {
  id: string;
  name: string;
  category: IntegrationCategory;
  /** One line: what wiring this up gets you. */
  summary: string;
  /** Where to get the credentials. */
  docsUrl: string;
  fields: IntegrationField[];
  /**
   * AI only. Whether the browser can call this provider directly.
   * A provider without CORS cannot be used from the editor at all, so it is
   * better to say so than to offer a field that silently never works.
   */
  browserCallable?: boolean;
  /** AI only. Free allowance, so the choice can be made on facts. */
  freeTier?: string;
}

export const INTEGRATIONS: Integration[] = [
  // ------------------------------------------------------------------ AI ---
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'ai',
    summary: 'The most generous free allowance of the lot. Recommended.',
    docsUrl: 'https://aistudio.google.com/apikey',
    browserCallable: true,
    freeTier: '~1,500 requests a day, free',
    fields: [
      {
        id: 'GEMINI_API_KEY',
        label: 'API key',
        hint: 'From Google AI Studio. Free, no card required.',
        secret: true,
        placeholder: 'AIza…',
      },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    category: 'ai',
    summary: 'Very fast, generous free allowance, runs open models.',
    docsUrl: 'https://console.groq.com/keys',
    browserCallable: true,
    freeTier: 'Thousands of requests a day, free',
    fields: [
      { id: 'GROQ_API_KEY', label: 'API key', secret: true, placeholder: 'gsk_…' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'ai',
    summary: 'One key for many models. Free models are heavily rate limited.',
    docsUrl: 'https://openrouter.ai/keys',
    browserCallable: true,
    freeTier: '~50 requests a day on free models',
    fields: [
      { id: 'OPENROUTER_API_KEY', label: 'API key', secret: true, placeholder: 'sk-or-v1-…' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'ai',
    summary: 'Claude. Best quality here; paid after a small trial.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    browserCallable: true,
    freeTier: 'Paid',
    fields: [
      { id: 'ANTHROPIC_API_KEY', label: 'API key', secret: true, placeholder: 'sk-ant-…' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'ai',
    summary: 'GPT models. Paid.',
    docsUrl: 'https://platform.openai.com/api-keys',
    browserCallable: true,
    freeTier: 'Paid',
    fields: [{ id: 'OPENAI_API_KEY', label: 'API key', secret: true, placeholder: 'sk-…' }],
  },

  // ------------------------------------------------------------- account ---
  {
    id: 'github',
    name: 'GitHub',
    category: 'account',
    summary: 'Push a project to a repository as one commit you can review.',
    docsUrl: 'https://github.com/settings/personal-access-tokens/new',
    fields: [
      {
        id: 'GITHUB_TOKEN',
        label: 'Fine-grained token',
        hint: 'Give it Contents: read and write on the repositories you want Studio to push to. Nothing else.',
        secret: true,
        placeholder: 'github_pat_…',
      },
    ],
  },

  // ------------------------------------------------------------- services ---
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'service',
    summary: 'Take payments from the site you build.',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    fields: [
      {
        id: 'VITE_STRIPE_PUBLISHABLE_KEY',
        label: 'Publishable key',
        hint: 'Safe in the browser. This is the one your pages use.',
        secret: false,
        placeholder: 'pk_live_…',
      },
      {
        id: 'STRIPE_SECRET_KEY',
        label: 'Secret key',
        hint: 'Server only. Written to .env and never into a page.',
        secret: true,
        placeholder: 'sk_live_…',
      },
    ],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'service',
    summary: 'Postgres, auth and storage for the exported site.',
    docsUrl: 'https://supabase.com/dashboard/project/_/settings/api',
    fields: [
      { id: 'VITE_SUPABASE_URL', label: 'Project URL', secret: false, placeholder: 'https://xyz.supabase.co' },
      {
        id: 'VITE_SUPABASE_ANON_KEY',
        label: 'Anon key',
        hint: 'Public by design; row level security is what protects the data.',
        secret: false,
      },
      {
        id: 'SUPABASE_SERVICE_ROLE_KEY',
        label: 'Service role key',
        hint: 'Bypasses every row level security policy. Server only.',
        secret: true,
      },
    ],
  },
  {
    id: 'firebase',
    name: 'Firebase',
    category: 'service',
    summary: 'Auth, Firestore and hosting for the exported site.',
    docsUrl: 'https://console.firebase.google.com/',
    fields: [
      { id: 'VITE_FIREBASE_API_KEY', label: 'API key', secret: false },
      { id: 'VITE_FIREBASE_AUTH_DOMAIN', label: 'Auth domain', secret: false },
      { id: 'VITE_FIREBASE_PROJECT_ID', label: 'Project ID', secret: false },
      { id: 'VITE_FIREBASE_APP_ID', label: 'App ID', secret: false },
    ],
  },
  {
    id: 'resend',
    name: 'Resend',
    category: 'service',
    summary: 'Send email from forms on the exported site.',
    docsUrl: 'https://resend.com/api-keys',
    fields: [{ id: 'RESEND_API_KEY', label: 'API key', secret: true, placeholder: 're_…' }],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'service',
    summary: 'Product analytics on the exported site.',
    docsUrl: 'https://posthog.com/docs/getting-started/install',
    fields: [
      { id: 'VITE_POSTHOG_KEY', label: 'Project API key', secret: false, placeholder: 'phc_…' },
      { id: 'VITE_POSTHOG_HOST', label: 'Host', secret: false, placeholder: 'https://eu.i.posthog.com' },
    ],
  },
];

export function findIntegration(id: string): Integration | undefined {
  return INTEGRATIONS.find((integration) => integration.id === id);
}

export const AI_INTEGRATIONS = INTEGRATIONS.filter((i) => i.category === 'ai');
export const SERVICE_INTEGRATIONS = INTEGRATIONS.filter((i) => i.category === 'service');
export const ACCOUNT_INTEGRATIONS = INTEGRATIONS.filter((i) => i.category === 'account');
