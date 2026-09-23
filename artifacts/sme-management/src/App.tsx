import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity as ActivityIcon, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Bell,
  Boxes, Check, ChevronDown, CircleDollarSign, FileBarChart2, Filter, Landmark,
  LayoutDashboard, Menu, PackagePlus, Pencil, Plus, Receipt, RefreshCw, Search,
  Settings as SettingsIcon, ShieldCheck, ShoppingBag, Trash2, TrendingUp, UserPlus,
  UsersRound, Wallet, X, Zap,
} from 'lucide-react';
import {
  getGetActivityQueryKey, getGetDashboardSummaryQueryKey, getGetExpensesQueryKey,
  getGetFinancialReportQueryKey, getGetProductsQueryKey, getGetSalesQueryKey,
  getGetUsersQueryKey, useCreateExpense, useCreateProduct, useCreateSale, useCreateUser,
  useDeleteProduct, useGetActivity, useGetDashboardSummary, useGetExpenses,
  useGetFinancialReport, useGetProducts, useGetSales, useGetUsers, useUpdateProduct,
  useUpdateUser,
} from '@workspace/api-client-react';
import type { Activity, Expense, FinancialReport, Product, Sale, SystemUser } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const money = (value: number) => `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(value || 0)}`;
const compactMoney = (value: number) => `₦${new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)}`;
const dateLabel = (value?: string) => value ? new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const timeLabel = (value?: string) => value ? new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—';
const initials = (name: string) => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
type AuthUser = SystemUser & {
  clerkUserId?: string;
  hasPasskey: boolean;
  accessVerified: boolean;
};
type AuthProfile = { user: AuthUser };
type BootstrapResponse = AuthProfile & { created?: boolean };

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const authFetch = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.error || `Request failed (${response.status})`, response.status);
  }
  return response.status === 204 ? (null as T) : response.json();
};
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#0f766e',
    colorForeground: '#183b3a',
    colorMutedForeground: '#6b7f7d',
    colorDanger: '#b42318',
    colorBackground: '#fbfaf7',
    colorInput: '#ffffff',
    colorInputForeground: '#183b3a',
    colorNeutral: '#d6dfdc',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'font-serif text-2xl font-bold text-[#183b3a]',
    headerSubtitle: 'text-[#6b7f7d]',
    socialButtonsBlockButtonText: 'text-[#183b3a]',
    formFieldLabel: 'text-[#183b3a]',
    footerActionLink: 'text-[#0f766e] font-semibold',
    footerActionText: 'text-[#6b7f7d]',
    dividerText: 'text-[#6b7f7d]',
    identityPreviewEditButton: 'text-[#0f766e]',
    formFieldSuccessText: 'text-emerald-700',
    alertText: 'text-[#b42318]',
    logoBox: 'mb-4',
    logoImage: 'max-h-10',
    socialButtonsBlockButton: 'border-[#d6dfdc] bg-white hover:bg-[#f2f7f5]',
    formButtonPrimary: 'bg-[#0f766e] hover:bg-[#0b5f59] text-white',
    formFieldInput: 'border-[#d6dfdc] bg-white text-[#183b3a]',
    footerAction: 'bg-transparent',
    dividerLine: 'bg-[#d6dfdc]',
    alert: 'bg-red-50 border-red-200',
    otpCodeFieldInput: 'border-[#d6dfdc] text-[#183b3a]',
    formFieldRow: 'text-[#183b3a]',
    main: 'bg-transparent',
  },
};

type IconType = typeof LayoutDashboard;
type UserRole = 'administrator' | 'manager' | 'cashier';
const roleRoutes: Record<UserRole, string[]> = {
  administrator: ['/dashboard', '/products', '/sales', '/expenses', '/reports', '/users', '/activity', '/settings'],
  manager: ['/dashboard', '/products', '/sales', '/expenses', '/reports'],
  cashier: ['/products', '/sales'],
};
const defaultRouteForRole = (role: UserRole) => role === 'cashier' ? '/products' : '/dashboard';
const navItems: { href: string; label: string; icon: IconType; roles: UserRole[] }[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, roles: ['administrator', 'manager'] },
  { href: '/products', label: 'Products', icon: Boxes, roles: ['administrator', 'manager', 'cashier'] },
  { href: '/sales', label: 'Sales', icon: ShoppingBag, roles: ['administrator', 'manager', 'cashier'] },
  { href: '/expenses', label: 'Expenses', icon: Wallet, roles: ['administrator', 'manager'] },
  { href: '/reports', label: 'Reports', icon: BarChart3, roles: ['administrator', 'manager'] },
  { href: '/users', label: 'Team access', icon: UsersRound, roles: ['administrator'] },
  { href: '/activity', label: 'Activity', icon: ActivityIcon, roles: ['administrator'] },
];

function useCurrentProfile() {
  const { isLoaded, isSignedIn } = useAuth();
  return useQuery<AuthProfile>({
    queryKey: ['auth-me'],
    queryFn: () => authFetch<AuthProfile>('/api/auth/me'),
    enabled: isLoaded && !!isSignedIn,
    retry: false,
    staleTime: 60_000,
  });
}

function PublicHome() {
  return <div className="min-h-[100dvh] overflow-hidden bg-background text-foreground">
    <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-10 sm:py-7">
      <Link href="/" className="flex items-center gap-3" data-testid="link-home-brand"><div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_20px_hsl(var(--primary)/.2)]"><Zap size={19} fill="currentColor" /></div><div><div className="font-serif text-xl font-bold tracking-tight">Kola</div><div className="font-mono text-[9px] uppercase tracking-[.22em] text-muted-foreground">business desk</div></div></Link>
      <div className="flex items-center gap-1 sm:gap-2"><Link href="/sign-in" className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground sm:px-3.5" data-testid="link-home-login">Log in</Link><Link href="/sign-up" className="rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-105 sm:px-4" data-testid="link-home-signup">Create account</Link></div>
    </header>
    <main className="relative mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-10 sm:pt-16 lg:pb-24 lg:pt-24">
      <div className="pointer-events-none absolute -right-32 top-8 size-[28rem] rounded-full bg-accent/15 blur-3xl" />
      <div className="relative grid items-center gap-14 lg:grid-cols-[.95fr_1.05fr] lg:gap-20">
        <div className="animate-rise-in"><div className="mb-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-primary"><span className="size-1.5 rounded-full bg-accent" />Built for Nigerian SMEs</div><h1 className="max-w-2xl font-serif text-[3.4rem] font-bold leading-[.98] tracking-[-.055em] sm:text-7xl">Make the day <span className="text-primary">legible.</span></h1><p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">Kola brings sales, stock, expenses, reports, and team access into one calm business desk for the people running the shop.</p><div className="mt-9 flex flex-wrap gap-3"><Link href="/sign-up" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_hsl(var(--primary)/.18)] hover:brightness-105" data-testid="button-home-start">Start your business <ArrowUpRight size={16} /></Link><Link href="/sign-in" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-3 text-sm font-semibold hover:bg-secondary" data-testid="button-home-login">I already have an account</Link></div><div className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-2"><Check size={14} className="text-primary" />Sales and stock together</span><span className="inline-flex items-center gap-2"><Check size={14} className="text-primary" />Made for one branch</span></div></div>
        <div className="relative animate-rise-in [animation-delay:.12s]"><div className="absolute -inset-8 rounded-[3rem] bg-primary/5 blur-3xl" /><div className="relative overflow-hidden rounded-[1.35rem] border border-card-border bg-card shadow-[0_28px_80px_hsl(var(--foreground)/.12)]"><div className="flex items-center justify-between border-b border-border bg-secondary/35 px-5 py-4 sm:px-7"><div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Kola / Overview</div><div className="mt-1 font-serif text-lg font-bold">The day's signal</div></div><div className="flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-2.5 py-1.5 text-[10px] font-semibold text-primary"><span className="size-1.5 rounded-full bg-primary" />Live workspace</div></div><div className="grid gap-3 p-5 sm:grid-cols-[1.1fr_.9fr] sm:p-7"><div className="rounded-xl bg-primary p-5 text-primary-foreground"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.16em] text-primary-foreground/65">Revenue</span><TrendingUp size={16} /></div><div className="mt-7 font-serif text-3xl font-bold tracking-tight">Today, in focus</div><p className="mt-2 max-w-[15rem] text-xs leading-5 text-primary-foreground/70">A clear view of what has moved through the till.</p><div className="mt-7 flex h-12 items-end gap-1.5">{[28, 42, 35, 58, 48, 72, 64, 88, 76, 100].map((height, index) => <span key={index} className={`flex-1 rounded-t-sm ${index > 7 ? 'bg-accent' : 'bg-primary-foreground/25'}`} style={{ height: `${height}%` }} />)}</div></div><div className="space-y-3"><div className="rounded-xl border border-border bg-background p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold">Inventory</span><Boxes size={16} className="text-primary" /></div><div className="mt-6 h-2 rounded-full bg-secondary"><div className="h-full w-[68%] rounded-full bg-primary" /></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>Stock on hand</span><span>Review when needed</span></div></div><div className="rounded-xl border border-border bg-background p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold">Expenses</span><Wallet size={16} className="text-accent-foreground" /></div><div className="mt-3 text-xs leading-5 text-muted-foreground">Capture the small costs before they become a blind spot.</div><div className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-semibold text-primary"><Receipt size={13} />Keep the trail clean</div></div></div></div><div className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/25 px-5 py-3.5 font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground sm:px-7"><span className="rounded bg-card px-2 py-1 text-foreground">Sales</span><span>→</span><span className="rounded bg-card px-2 py-1 text-foreground">Stock</span><span>→</span><span className="rounded bg-card px-2 py-1 text-foreground">Reports</span></div></div></div>
      </div>
      <div className="relative mt-16 grid gap-4 border-t border-border pt-8 sm:grid-cols-3 lg:mt-24"><div><div className="mb-2 font-mono text-[10px] uppercase tracking-[.17em] text-primary">01 / See it</div><h2 className="font-serif text-lg font-bold">A pulse, not a spreadsheet.</h2><p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">The overview keeps today visible without burying the signal.</p></div><div><div className="mb-2 font-mono text-[10px] uppercase tracking-[.17em] text-primary">02 / Keep it moving</div><h2 className="font-serif text-lg font-bold">Record work in seconds.</h2><p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">Fast forms for the moments when the queue is already forming.</p></div><div><div className="mb-2 font-mono text-[10px] uppercase tracking-[.17em] text-primary">03 / Know why</div><h2 className="font-serif text-lg font-bold">Trust the trail.</h2><p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">Reports and activity make each decision easier to explain.</p></div></div>
    </main>
    <footer className="mx-auto max-w-7xl border-t border-border px-5 py-6 text-xs text-muted-foreground sm:px-10">Simple tools for the people building strong businesses.</footer>
  </div>;
}

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return <div className="flex min-h-[100dvh] bg-background px-4 py-6 sm:px-8 sm:py-10 lg:items-center"><div className="mx-auto grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[.9fr_1.1fr] lg:gap-20"><div className="hidden rounded-[1.5rem] bg-primary p-10 text-primary-foreground shadow-[0_24px_70px_hsl(var(--primary)/.2)] lg:block"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><Zap size={19} fill="currentColor" /></div><div><div className="font-serif text-xl font-bold">Kola</div><div className="font-mono text-[9px] uppercase tracking-[.22em] text-primary-foreground/60">business desk</div></div></div><div className="mt-28 max-w-sm"><div className="font-mono text-[10px] uppercase tracking-[.2em] text-primary-foreground/60">A calmer start</div><h1 className="mt-4 font-serif text-4xl font-bold leading-tight">Your next good decision starts with a clear desk.</h1><p className="mt-5 text-sm leading-6 text-primary-foreground/70">Keep the till, shelves, costs, and people moving in the same direction.</p></div><div className="mt-24 grid grid-cols-3 gap-2">{['Sales', 'Stock', 'Reports'].map((label) => <div key={label} className="rounded-lg border border-primary-foreground/15 bg-primary-foreground/8 px-3 py-3 text-xs font-semibold">{label}<div className="mt-4 h-1 rounded-full bg-accent/80" /></div>)}</div></div><div className="w-full max-w-[440px] justify-self-center"><div className="mb-5 flex items-center justify-center gap-3 lg:hidden"><div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Zap size={17} fill="currentColor" /></div><div className="font-serif text-lg font-bold">Kola</div></div>{mode === 'sign-in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}</div></div></div>;
}

function OnboardingPage() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({ name: user?.fullName || '', email: user?.primaryEmailAddress?.emailAddress || '', businessName: '', phone: '', address: '' });
  const onboarding = useMutation({
    mutationFn: (data: typeof form) => authFetch<BootstrapResponse>('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (response) => {
      queryClient.setQueryData(['auth-me'], response);
      setLocation('/dashboard');
    },
  });
  return <div className="min-h-[100dvh] bg-background px-5 py-10"><div className="mx-auto max-w-2xl"><div className="mb-8 flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Zap size={19} fill="currentColor" /></div><div><div className="font-serif text-xl font-bold">Set up your business</div><div className="text-xs text-muted-foreground">One last step before your desk is ready.</div></div></div><Panel title="Business details"><form onSubmit={(e) => { e.preventDefault(); onboarding.mutate(form); }}><div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6"><Field label="Your full name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} data-testid="input-onboarding-name" /></Field><Field label="Email address"><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} data-testid="input-onboarding-email" /></Field><Field label="Business name (for new businesses)" hint="Leave blank if your administrator already invited you."><input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} className={inputClass} data-testid="input-onboarding-business-name" placeholder="e.g. Kola Mini Mart" /></Field><Field label="Phone number"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} data-testid="input-onboarding-phone" placeholder="+234 ..." /></Field><Field label="Branch address" ><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={`${inputClass} sm:col-span-2`} data-testid="input-onboarding-address" placeholder="Street, city, state" /></Field></div><div className="border-t border-border px-5 py-4 sm:px-6">{onboarding.isError && <p className="mb-3 text-sm text-destructive">{(onboarding.error as Error).message}</p>}<div className="flex justify-end"><Button type="submit" disabled={onboarding.isPending} testId="button-finish-onboarding">{onboarding.isPending && <RefreshCw size={14} className="animate-spin" />}Open my business desk</Button></div></div></form></Panel></div></div>;
}

function PasskeyGate({ user, onUnlocked }: { user: AuthUser; onUnlocked: (profile: AuthProfile) => void }) {
  const [passkey, setPasskey] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setup = !user.hasPasskey;
  const roleLabel = user.role === 'administrator' ? 'Administrator' : user.role === 'manager' ? 'Manager' : 'Cashier';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (setup && passkey !== confirmation) {
      setError('The two passkeys do not match.');
      return;
    }
    setBusy(true);
    try {
      const response = await authFetch<AuthProfile>(`/api/auth/passkey/${setup ? 'set' : 'verify'}`, {
        method: 'POST',
        body: JSON.stringify({ passkey }),
      });
      onUnlocked(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not unlock this workspace.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10">
    <div className="w-full max-w-md">
      <div className="mb-8 flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck size={19} /></div><div><div className="font-serif text-xl font-bold">Kola</div><div className="text-xs text-muted-foreground">Private {roleLabel} workspace</div></div></div>
      <Panel title={setup ? `Create your ${roleLabel.toLowerCase()} passkey` : `Enter your ${roleLabel.toLowerCase()} passkey`}>
        <form onSubmit={submit}>
          <div className="space-y-4 px-5 py-5 sm:px-6">
            <p className="text-sm leading-6 text-muted-foreground">{setup ? `This six-digit passkey is your personal key for ${roleLabel.toLowerCase()} duties. Do not share it with another team member.` : `Your Clerk account is signed in. Enter your personal passkey to unlock ${roleLabel.toLowerCase()} duties.`}</p>
            <Field label="Six-digit passkey"><input required autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} type="password" value={passkey} onChange={(event) => setPasskey(event.target.value.replace(/\D/g, '').slice(0, 6))} className={`${inputClass} text-center font-mono text-lg tracking-[.35em]`} data-testid="input-role-passkey" placeholder="••••••" /></Field>
            {setup && <Field label="Confirm passkey"><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, '').slice(0, 6))} className={`${inputClass} text-center font-mono text-lg tracking-[.35em]`} data-testid="input-role-passkey-confirmation" placeholder="••••••" /></Field>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="border-t border-border px-5 py-4 sm:px-6"><Button type="submit" disabled={busy || passkey.length !== 6 || (setup && confirmation.length !== 6)} className="w-full">{busy && <RefreshCw size={14} className="animate-spin" />}{setup ? 'Create passkey and open workspace' : 'Unlock workspace'}</Button></div>
        </form>
      </Panel>
      <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">Each role has its own access key. Server permissions still apply even if someone tries to open a restricted page directly.</p>
    </div>
  </div>;
}

function NotificationsButton() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 45000 } });
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(() => localStorage.getItem('kola-notifications-read') === 'true');
  const lowStock = summary.data?.lowStockProducts || [];
  const notifications = [...lowStock.map((product) => ({ id: `stock-${product.id}`, title: 'Low stock alert', body: `${product.name} is at ${product.stock} ${product.unit}.`, icon: AlertTriangle })), ...(summary.data?.recentSales?.slice(0, 2) || []).map((sale) => ({ id: `sale-${sale.id}`, title: 'Sale recorded', body: `${sale.invoiceNumber} · ${money(sale.total)}`, icon: Receipt }))];
  const markRead = () => { setRead(true); localStorage.setItem('kola-notifications-read', 'true'); };
   return <div className="relative"><button onClick={() => { setOpen(!open); markRead(); }} data-testid="button-notifications" aria-label="Notifications" className="relative rounded-lg p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Bell size={18} />{notifications.length > 0 && !read && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-accent" />}</button>{open && <div className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-2xl"><div className="flex items-center justify-between border-b border-border px-4 py-3"><div><div className="text-sm font-semibold">Notifications</div><div className="text-[11px] text-muted-foreground">Important business details</div></div><button onClick={markRead} data-testid="button-mark-notifications-read" className="text-[11px] font-semibold text-primary">Mark read</button></div>{notifications.length ? <div className="max-h-80 divide-y divide-border overflow-y-auto">{notifications.map(({ id, title, body, icon: Icon }) => <div key={id} className="flex gap-3 px-4 py-3"><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/20 text-accent-foreground"><Icon size={15} /></div><div><div className="text-xs font-semibold">{title}</div><div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{body}</div></div></div>)}</div> : <div className="px-4 py-8 text-center text-xs text-muted-foreground">You’re all caught up.</div>}</div>}</div>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) {
        queryClient.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener]);
  return null;
}

function Button({ children, onClick, variant = 'primary', type = 'button', className = '', disabled = false, testId, ariaLabel }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; type?: 'button' | 'submit'; className?: string; disabled?: boolean; testId?: string; ariaLabel?: string;
}) {
  const styles = {
    primary: 'bg-primary text-primary-foreground shadow-sm hover:brightness-105 active:scale-[.98]',
    secondary: 'bg-secondary text-secondary-foreground border border-border hover:bg-accent/20',
    ghost: 'text-muted-foreground hover:text-foreground hover:bg-muted',
    danger: 'text-destructive hover:bg-destructive/10',
  };
  return <button type={type} onClick={onClick} disabled={disabled} aria-label={ariaLabel} data-testid={testId} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}>{children}</button>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useCurrentProfile().data || {};
  const { signOut } = useClerk();
  const role = user?.role || 'cashier';
  const visibleNav = navItems.filter((item) => item.roles.includes(role));
  const current = navItems.find((item) => item.href === location);
  return <div className="min-h-[100dvh] bg-background text-foreground">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-[82px] items-center gap-3 border-b border-sidebar-border px-6">
        <div className="grid size-9 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg"><Zap size={18} fill="currentColor" /></div>
        <div><div className="font-serif text-lg font-bold tracking-tight text-sidebar-foreground">Kola</div><div className="font-mono text-[9px] uppercase tracking-[.22em] text-sidebar-foreground/55">business desk</div></div>
      </div>
      <div className="px-4 pt-7">
        <div className="mb-3 px-3 font-mono text-[10px] font-medium uppercase tracking-[.18em] text-sidebar-foreground/40">Workspace</div>
        <nav className="space-y-1">
          {visibleNav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${label.toLowerCase().replace(' ', '-')}`} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${location === href ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}>
            <Icon size={17} strokeWidth={location === href ? 2.3 : 1.8} /><span>{label}</span>{location === href && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />}
          </Link>)}
        </nav>
      </div>
      <div className="mt-auto p-4">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3.5">
          <div className="mb-2 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/45">Plan</span><span className="rounded-full bg-sidebar-primary/15 px-2 py-0.5 font-mono text-[9px] uppercase text-sidebar-primary">Live</span></div>
          <p className="text-xs leading-relaxed text-sidebar-foreground/70">Your daily cockpit is ready.</p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-sidebar-border"><div className="h-full w-[72%] rounded-full bg-sidebar-primary" /></div>
        </div>
         {role === 'administrator' && <Link href="/settings" data-testid="link-settings-sidebar" className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"><SettingsIcon size={17} />Settings</Link>}
      </div>
    </aside>
    {mobileOpen && <button aria-label="Close navigation" data-testid="button-close-mobile-nav" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-sidebar/30 backdrop-blur-sm lg:hidden" />}
    <main className="min-h-[100dvh] lg:pl-[252px]">
       <header className="sticky top-0 z-20 flex h-[82px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md sm:px-8 lg:px-10">
         <div className="flex items-center gap-3"><button aria-label="Open navigation" onClick={() => setMobileOpen(true)} data-testid="button-open-mobile-nav" className="rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden"><Menu size={21} /></button><div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">KOLA / {current?.label || 'Workspace'}</div><h1 className="mt-1 font-serif text-xl font-bold tracking-tight sm:text-2xl">{current?.label || 'Workspace'}</h1></div></div>
         <div className="flex items-center gap-2.5"><NotificationsButton /><div className="hidden h-7 w-px bg-border sm:block" /><button onClick={() => signOut({ redirectUrl: basePath || '/' })} title="Sign out" className="flex items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-muted"><div className="grid size-9 place-items-center rounded-full bg-primary/12 font-mono text-xs font-medium text-primary">{initials(user?.name || 'User')}</div><div className="hidden sm:block"><div className="text-xs font-semibold">{user?.name || 'Signed in user'}</div><div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{role}</div></div><ChevronDown size={14} className="hidden text-muted-foreground sm:block" /></button></div>
      </header>
      <div className="app-scroll max-w-[1500px] overflow-x-hidden px-5 py-7 sm:px-8 lg:px-10 lg:py-9">{children}</div>
    </main>
  </div>;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-primary"><span className="size-1.5 rounded-full bg-accent" />{eyebrow}</div><h2 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2><p className="mt-2 max-w-xl text-sm text-muted-foreground">{description}</p></div>{action && <div className="shrink-0">{action}</div>}</div>;
}

function Panel({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return <section className={`rounded-xl border border-card-border bg-card shadow-[0_3px_18px_hsl(var(--foreground)/.025)] ${className}`}>{title && <div className="flex items-center justify-between border-b border-border/70 px-5 py-4"><h3 className="font-serif text-base font-bold">{title}</h3>{action}</div>}{children}</section>;
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3 p-5">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-12 rounded-lg opacity-60" />)}</div>;
}
function EmptyState({ icon: Icon, title, body, action }: { icon: IconType; title: string; body: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center px-6 py-16 text-center"><div className="mb-4 grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><Icon size={22} /></div><h3 className="font-serif text-lg font-bold">{title}</h3><p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>{action && <div className="mt-5">{action}</div>}</div>;
}
function ErrorState({ retry }: { retry: () => void }) {
  return <div className="flex flex-col items-center justify-center px-6 py-16 text-center"><div className="mb-4 grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive"><AlertTriangle size={22} /></div><h3 className="font-serif text-lg font-bold">Could not load this view</h3><p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p><Button variant="secondary" onClick={retry} className="mt-5"><RefreshCw size={15} />Try again</Button></div>;
}
function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="border-t border-destructive/15 bg-destructive/5 px-5 py-3 text-sm text-destructive sm:px-6">{error instanceof Error ? error.message : 'Could not save this change. Please try again.'}</p>;
}
function Modal({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"><div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl"><div className="flex items-start justify-between border-b border-border px-5 py-5 sm:px-6"><div><h2 className="font-serif text-xl font-bold">{title}</h2>{description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div><button onClick={onClose} aria-label="Close dialog" data-testid="button-close-modal" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X size={18} /></button></div>{children}</div></div>;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-foreground/75">{label}</span>{children}{hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}</label>;
}
const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/15';
function ModalActions({ onClose, busy, label = 'Save changes' }: { onClose: () => void; busy?: boolean; label?: string }) {
  return <div className="flex justify-end gap-2 border-t border-border px-5 py-4 sm:px-6"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy && <RefreshCw size={14} className="animate-spin" />}{label}</Button></div>;
}

function Dashboard() {
  const profile = useCurrentProfile();
  const query = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 45000 } });
  const summary = query.data;
  const today = new Intl.DateTimeFormat('en-NG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const name = profile.data?.user.name?.split(' ')[0] || 'there';
  return <><PageIntro eyebrow={today} title={`Good morning, ${name}.`} description="Here is the pulse of your business. Keep the day moving." action={<Link href="/sales" data-testid="link-new-sale-dashboard" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-105"><Plus size={17} />Record a sale</Link>} />
    {query.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-[132px] rounded-xl" />)}</div> : query.isError ? <Panel><ErrorState retry={() => query.refetch()} /></Panel> : summary ? <DashboardContent summary={summary} /> : <Panel><EmptyState icon={LayoutDashboard} title="Your cockpit is quiet" body="Once you record your first sale, the numbers will start to tell the story." /></Panel>}
  </>;
}
function DashboardContent({ summary }: { summary: { todayRevenue: number; monthRevenue: number; monthExpenses: number; monthProfit: number; totalProducts: number; lowStockCount: number; salesCount: number; recentSales: Sale[]; lowStockProducts: Product[] } }) {
  const stats = [{ label: "Today's revenue", value: money(summary.todayRevenue), note: 'Across all payments', icon: CircleDollarSign, tone: 'teal' }, { label: 'Revenue this month', value: compactMoney(summary.monthRevenue), note: `${summary.salesCount} completed sales`, icon: TrendingUp, tone: 'gold' }, { label: 'Expenses this month', value: compactMoney(summary.monthExpenses), note: 'Operating costs', icon: Wallet, tone: 'slate' }, { label: 'Net profit', value: compactMoney(summary.monthProfit), note: 'Revenue less expenses', icon: ArrowUpRight, tone: 'green' }];
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map(({ label, value, note, icon: Icon, tone }, i) => <div key={label} className={`animate-rise-in stagger-${i + 1} rounded-xl border border-card-border bg-card p-5 shadow-[0_3px_18px_hsl(var(--foreground)/.025)]`}><div className="flex items-start justify-between"><span className="text-xs font-semibold text-muted-foreground">{label}</span><span className={`grid size-8 place-items-center rounded-lg ${tone === 'gold' ? 'bg-accent/20 text-accent-foreground' : tone === 'teal' ? 'bg-primary/12 text-primary' : tone === 'green' ? 'bg-emerald-500/12 text-emerald-700' : 'bg-secondary text-muted-foreground'}`}><Icon size={16} /></span></div><div className="mt-5 font-serif text-2xl font-bold tracking-tight">{value}</div><div className="mt-1 text-[11px] text-muted-foreground">{note}</div></div>)}</div>
    <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]"><Panel title="Recent sales" action={<Link href="/sales" data-testid="link-view-all-sales" className="text-xs font-semibold text-primary hover:underline">View all</Link>}>{summary.recentSales?.length ? <div className="divide-y divide-border/70">{summary.recentSales.slice(0, 6).map((sale) => <div key={sale.id} data-testid={`row-recent-sale-${sale.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5"><div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Receipt size={16} /></div><div className="min-w-0"><div className="truncate text-sm font-semibold">{sale.customerName || 'Walk-in customer'}</div><div className="font-mono text-[10px] text-muted-foreground">{sale.invoiceNumber} · {timeLabel(sale.createdAt)}</div></div></div><div className="shrink-0 text-right"><div className="font-mono text-sm font-medium">{money(sale.total)}</div><div className="text-[10px] capitalize text-muted-foreground">{sale.paymentMethod}</div></div></div>)}</div> : <EmptyState icon={Receipt} title="No sales yet" body="Your latest transactions will appear here." />}</Panel>
      <Panel title="Stock watch" action={<Link href="/products" data-testid="link-manage-stock" className="text-xs font-semibold text-primary hover:underline">Manage stock</Link>}>{summary.lowStockProducts?.length ? <div className="divide-y divide-border/70">{summary.lowStockProducts.slice(0, 5).map((product) => <div key={product.id} className="flex items-center justify-between px-5 py-3.5"><div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/20 text-accent-foreground"><PackagePlus size={16} /></div><div className="min-w-0"><div className="truncate text-sm font-semibold">{product.name}</div><div className="font-mono text-[10px] text-muted-foreground">{product.sku} · {product.category}</div></div></div><div className="text-right"><div className="font-mono text-sm font-semibold text-destructive">{product.stock} {product.unit}</div><div className="text-[10px] text-muted-foreground">min {product.minStock}</div></div></div>)}</div> : <EmptyState icon={Boxes} title="Stock looks healthy" body="No products need attention right now." />}</Panel>
    </div><div className="rounded-xl border border-primary/20 bg-primary px-5 py-4 text-primary-foreground sm:flex sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-primary-foreground/65"><Zap size={12} fill="currentColor" />Daily rhythm</div><p className="mt-1 text-sm font-medium">You have {summary.lowStockCount} stock {summary.lowStockCount === 1 ? 'item' : 'items'} to review before the next rush.</p></div><Link href="/activity" data-testid="link-see-activity" className="mt-3 inline-flex text-xs font-semibold text-accent hover:underline sm:mt-0">See what changed →</Link></div>
  </div>;
}

function ProductsPage() {
  const [search, setSearch] = useState(''); const [stock, setStock] = useState<'all' | 'low' | 'out'>('all'); const [modal, setModal] = useState<Product | 'new' | null>(null);
  const params = useMemo(() => ({ ...(search ? { search } : {}), ...(stock !== 'all' ? { stock } : {}) }), [search, stock]);
  const query = useGetProducts(params, { query: { queryKey: getGetProductsQueryKey(params) } }); const products = query.data || [];
  const filtered = products;
  return <><PageIntro eyebrow="Inventory catalogue" title="Know what is on hand." description="Your branch in one clear view. Update prices, catch low stock, keep selling." action={<Button onClick={() => setModal('new')} testId="button-add-product"><Plus size={17} />Add product</Button>} />
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center"><div className="relative min-w-0 flex-1 sm:max-w-sm"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-products" className={`${inputClass} pl-9`} placeholder="Search by name or SKU" /></div><div className="flex items-center gap-2 overflow-x-auto"><Filter size={15} className="shrink-0 text-muted-foreground" />{(['all', 'low', 'out'] as const).map((option) => <button key={option} onClick={() => setStock(option)} data-testid={`button-filter-stock-${option}`} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${stock === option ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>{option === 'all' ? 'All stock' : option === 'low' ? 'Low stock' : 'Out of stock'}</button>)}</div></div>
    <Panel>{query.isLoading ? <Skeleton /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="border-b border-border bg-secondary/35 font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-5 py-3.5">Product</th><th className="px-3 py-3.5">Category</th><th className="px-3 py-3.5">Sell price</th><th className="px-3 py-3.5">Cost</th><th className="px-3 py-3.5">Stock</th><th className="px-3 py-3.5">Status</th><th className="px-5 py-3.5 text-right">Actions</th></tr></thead><tbody className="divide-y divide-border/65">{filtered.map((product) => <ProductRow key={product.id} product={product} onEdit={() => setModal(product)} />)}</tbody></table></div> : <EmptyState icon={Boxes} title="No products found" body={search ? 'Try a different name or SKU.' : 'Start your catalogue with the products you sell every day.'} action={<Button onClick={() => setModal('new')}><Plus size={15} />Add first product</Button>} />}</Panel>
    {modal && <ProductModal product={modal === 'new' ? undefined : modal} onClose={() => setModal(null)} />}
  </>;
}
function ProductRow({ product, onEdit }: { product: Product; onEdit: () => void }) {
  const client = useQueryClient(); const remove = useDeleteProduct(); const low = product.stock <= product.minStock; const out = product.stock === 0;
  const handleDelete = () => { if (window.confirm(`Delete ${product.name}?`)) remove.mutate({ id: product.id }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetProductsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); } }); };
   return <tr data-testid={`row-product-${product.id}`} className="group hover:bg-secondary/25"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 font-mono text-xs font-medium text-primary">{initials(product.name)}</div><div><div className="text-sm font-semibold">{product.name}</div><div className="font-mono text-[10px] text-muted-foreground">{product.sku}</div></div></div></td><td className="px-3 py-4 text-sm text-muted-foreground">{product.category}</td><td className="px-3 py-4 font-mono text-sm">{money(product.price)}</td><td className="px-3 py-4 font-mono text-sm text-muted-foreground">{money(product.cost)}</td><td className="px-3 py-4"><span className={`font-mono text-sm font-semibold ${out || low ? 'text-destructive' : ''}`}>{product.stock}</span><span className="ml-1 text-xs text-muted-foreground">{product.unit}</span></td><td className="px-3 py-4"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${out ? 'bg-destructive/10 text-destructive' : low ? 'bg-accent/25 text-accent-foreground' : 'bg-emerald-500/10 text-emerald-700'}`}>{out ? 'Out of stock' : low ? 'Low stock' : 'In stock'}</span></td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"><Button variant="ghost" onClick={onEdit} ariaLabel={`Edit ${product.name}`} testId={`button-edit-product-${product.id}`}><Pencil size={15} /></Button><Button variant="danger" onClick={handleDelete} ariaLabel={`Delete ${product.name}`} disabled={remove.isPending} testId={`button-delete-product-${product.id}`}><Trash2 size={15} /></Button></div></td></tr>;
}
function ProductModal({ product, onClose }: { product?: Product; onClose: () => void }) {
  const client = useQueryClient(); const create = useCreateProduct(); const update = useUpdateProduct();
  const [form, setForm] = useState({ name: product?.name || '', sku: product?.sku || '', category: product?.category || 'General', price: String(product?.price || ''), cost: String(product?.cost || ''), stock: String(product?.stock || ''), minStock: String(product?.minStock || '5'), unit: product?.unit || 'pcs' });
  const change = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const submit = (e: FormEvent) => { e.preventDefault(); const data = { name: form.name, sku: form.sku, category: form.category, price: Number(form.price), cost: Number(form.cost), stock: Number(form.stock), minStock: Number(form.minStock), unit: form.unit }; if (product) update.mutate({ id: product.id, data }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetProductsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); onClose(); } }); else create.mutate({ data }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetProductsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); onClose(); } }); };
  const busy = create.isPending || update.isPending;
   return <Modal title={product ? 'Edit product' : 'Add product'} description="Keep the catalogue accurate for everyone on the floor." onClose={onClose}><form onSubmit={submit}><div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6"><Field label="Product name"><input required value={form.name} onChange={(e) => change('name', e.target.value)} className={inputClass} data-testid="input-product-name" placeholder="e.g. Golden Penny noodles" /></Field><Field label="SKU"><input required value={form.sku} onChange={(e) => change('sku', e.target.value)} className={inputClass} data-testid="input-product-sku" placeholder="e.g. NOO-001" /></Field><Field label="Category"><input required value={form.category} onChange={(e) => change('category', e.target.value)} className={inputClass} data-testid="input-product-category" placeholder="e.g. Groceries" /></Field><Field label="Unit"><input required value={form.unit} onChange={(e) => change('unit', e.target.value)} className={inputClass} data-testid="input-product-unit" placeholder="pcs, bag, crate" /></Field><Field label="Selling price"><input required min="0" type="number" value={form.price} onChange={(e) => change('price', e.target.value)} className={inputClass} data-testid="input-product-price" placeholder="0" /></Field><Field label="Cost price"><input required min="0" type="number" value={form.cost} onChange={(e) => change('cost', e.target.value)} className={inputClass} data-testid="input-product-cost" placeholder="0" /></Field><Field label="Opening stock"><input required min="0" type="number" value={form.stock} onChange={(e) => change('stock', e.target.value)} className={inputClass} data-testid="input-product-stock" placeholder="0" /></Field><Field label="Low-stock threshold"><input required min="0" type="number" value={form.minStock} onChange={(e) => change('minStock', e.target.value)} className={inputClass} data-testid="input-product-min-stock" placeholder="5" /></Field></div><MutationError error={create.error || update.error} /><ModalActions onClose={onClose} busy={busy} label={product ? 'Update product' : 'Add product'} /></form></Modal>;
}

function SalesPage() {
  const [modal, setModal] = useState(false); const [period, setPeriod] = useState<'all' | 'today' | 'week' | 'month'>('all'); const [search, setSearch] = useState('');
  const params = useMemo(() => ({ period, ...(search ? { search } : {}) }), [period, search]); const query = useGetSales(params, { query: { queryKey: getGetSalesQueryKey(params) } }); const sales = query.data || [];
  return <><PageIntro eyebrow="Revenue desk" title="Sales, without the scramble." description="Record a clean invoice in seconds and keep the till aligned." action={<Button onClick={() => setModal(true)} testId="button-create-sale"><Plus size={17} />New sale</Button>} /><div className="mb-5 flex flex-col gap-3 sm:flex-row"><div className="relative min-w-0 flex-1 sm:max-w-sm"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-sales" className={`${inputClass} pl-9`} placeholder="Search invoice or customer" /></div><div className="flex gap-2 overflow-x-auto">{(['all', 'today', 'week', 'month'] as const).map((item) => <button key={item} onClick={() => setPeriod(item)} data-testid={`button-filter-sales-${item}`} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${period === item ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>{item === 'all' ? 'All time' : `This ${item}`}</button>)}</div></div><Panel>{query.isLoading ? <Skeleton /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : sales.length ? <SalesTable sales={sales} /> : <EmptyState icon={ShoppingBag} title="No sales in this view" body="Ready when you are. Start a new sale to keep your numbers moving." action={<Button onClick={() => setModal(true)}><Plus size={15} />Record a sale</Button>} />}</Panel>{modal && <SaleModal onClose={() => setModal(false)} />}</>;
}
function SalesTable({ sales }: { sales: Sale[] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead className="border-b border-border bg-secondary/35 font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-5 py-3.5">Invoice</th><th className="px-3 py-3.5">Customer</th><th className="px-3 py-3.5">Items</th><th className="px-3 py-3.5">Payment</th><th className="px-3 py-3.5">Amount</th><th className="px-5 py-3.5 text-right">Date</th></tr></thead><tbody className="divide-y divide-border/65">{sales.map((sale) => <tr key={sale.id} data-testid={`row-sale-${sale.id}`} className="hover:bg-secondary/25"><td className="px-5 py-4 font-mono text-xs font-medium text-primary">{sale.invoiceNumber}</td><td className="px-3 py-4 text-sm font-semibold">{sale.customerName || 'Walk-in customer'}</td><td className="px-3 py-4 text-sm text-muted-foreground">{sale.items?.reduce((sum, item) => sum + item.quantity, 0) || 0} units</td><td className="px-3 py-4"><span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold capitalize text-muted-foreground">{sale.paymentMethod}</span></td><td className="px-3 py-4 font-mono text-sm font-semibold">{money(sale.total)}</td><td className="px-5 py-4 text-right"><div className="text-xs">{dateLabel(sale.createdAt)}</div><div className="font-mono text-[10px] text-muted-foreground">{timeLabel(sale.createdAt)}</div></td></tr>)}</tbody></table></div>;
}
function SaleModal({ onClose }: { onClose: () => void }) {
  const client = useQueryClient(); const productsQuery = useGetProducts({ stock: 'all' }, { query: { queryKey: getGetProductsQueryKey({ stock: 'all' }) } }); const create = useCreateSale();
  const [customer, setCustomer] = useState(''); const [payment, setPayment] = useState<'cash' | 'transfer' | 'card'>('cash'); const [productId, setProductId] = useState(''); const [quantity, setQuantity] = useState('1'); const [items, setItems] = useState<{ productId: number; quantity: number; name: string; unitPrice: number }[]>([]);
  const products = productsQuery.data || []; const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const addItem = () => { const product = products.find((item) => String(item.id) === productId); if (!product) return; setItems((prev) => { const existing = prev.find((item) => item.productId === product.id); return existing ? prev.map((item) => item.productId === product.id ? { ...item, quantity: item.quantity + Number(quantity) } : item) : [...prev, { productId: product.id, quantity: Number(quantity), name: product.name, unitPrice: product.price }]; }); setProductId(''); setQuantity('1'); };
  const submit = (e: FormEvent) => { e.preventDefault(); if (!items.length) return; create.mutate({ data: { customerName: customer || undefined, paymentMethod: payment, items: items.map(({ productId, quantity }) => ({ productId, quantity })) } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetSalesQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); client.invalidateQueries({ queryKey: getGetProductsQueryKey() }); onClose(); } }); };
   return <Modal title="Record a sale" description="Add the basket, take payment, and keep moving." onClose={onClose}><form onSubmit={submit}><div className="space-y-5 px-5 py-5 sm:px-6"><div className="grid gap-4 sm:grid-cols-2"><Field label="Customer name (optional)"><input value={customer} onChange={(e) => setCustomer(e.target.value)} className={inputClass} data-testid="input-sale-customer" placeholder="Walk-in customer" /></Field><Field label="Payment method"><select value={payment} onChange={(e) => setPayment(e.target.value as 'cash' | 'transfer' | 'card')} className={inputClass} data-testid="select-sale-payment"><option value="cash">Cash</option><option value="transfer">Transfer</option><option value="card">Card</option></select></Field></div><div className="rounded-xl border border-border bg-secondary/30 p-3"><div className="mb-2 font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Add items</div><div className="flex gap-2"><select value={productId} onChange={(e) => setProductId(e.target.value)} className={`${inputClass} min-w-0 flex-1`} data-testid="select-sale-product"><option value="">Choose product</option>{products.filter((product) => product.active && product.stock > 0).map((product) => <option key={product.id} value={product.id}>{product.name} · {money(product.price)}</option>)}</select><input min="1" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`${inputClass} w-20`} data-testid="input-sale-quantity" /><Button type="button" variant="secondary" onClick={addItem} ariaLabel="Add item to sale" testId="button-add-sale-item"><Plus size={15} /></Button></div></div>{items.length > 0 && <div className="divide-y divide-border rounded-lg border border-border">{items.map((item) => <div key={item.productId} className="flex items-center justify-between px-3 py-2.5 text-sm"><div><span className="font-semibold">{item.name}</span><span className="ml-2 text-xs text-muted-foreground">× {item.quantity}</span></div><div className="flex items-center gap-2"><span className="font-mono text-sm">{money(item.quantity * item.unitPrice)}</span><button type="button" aria-label={`Remove ${item.name}`} onClick={() => setItems((prev) => prev.filter((row) => row.productId !== item.productId))} data-testid={`button-remove-sale-item-${item.productId}`} className="text-muted-foreground hover:text-destructive"><X size={14} /></button></div></div>)}</div>}<div className="flex items-center justify-between rounded-lg bg-primary px-4 py-3 text-primary-foreground"><span className="text-sm font-semibold">Sale total</span><span className="font-mono text-lg font-medium">{money(total)}</span></div></div><MutationError error={create.error} /><ModalActions onClose={onClose} busy={create.isPending || productsQuery.isLoading} label="Complete sale" /></form></Modal>;
}

function ExpensesPage() {
  const [modal, setModal] = useState(false); const [period, setPeriod] = useState<'all' | 'today' | 'week' | 'month'>('all'); const query = useGetExpenses({ period }, { query: { queryKey: getGetExpensesQueryKey({ period }) } }); const expenses = query.data || [];
  return <><PageIntro eyebrow="Outgoings" title="Keep costs in their place." description="A clean expense trail makes the profit number worth trusting." action={<Button onClick={() => setModal(true)} testId="button-record-expense"><Plus size={17} />Record expense</Button>} /><div className="mb-5 flex gap-2 overflow-x-auto">{(['all', 'today', 'week', 'month'] as const).map((item) => <button key={item} onClick={() => setPeriod(item)} data-testid={`button-filter-expenses-${item}`} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${period === item ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>{item === 'all' ? 'All time' : `This ${item}`}</button>)}</div><Panel>{query.isLoading ? <Skeleton /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : expenses.length ? <ExpenseTable expenses={expenses} /> : <EmptyState icon={Wallet} title="No expenses logged" body="Record rent, restocking, logistics and the other costs behind the day." action={<Button onClick={() => setModal(true)}><Plus size={15} />Record first expense</Button>} />}</Panel>{modal && <ExpenseModal onClose={() => setModal(false)} />}</>;
}
function ExpenseTable({ expenses }: { expenses: Expense[] }) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return <><div className="flex items-center justify-between border-b border-border bg-secondary/25 px-5 py-4"><span className="text-xs text-muted-foreground">{expenses.length} recorded expenses</span><span className="font-mono text-sm font-semibold">{money(total)} total</span></div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left"><thead className="border-b border-border font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-5 py-3.5">Description</th><th className="px-3 py-3.5">Category</th><th className="px-3 py-3.5">Expense date</th><th className="px-5 py-3.5 text-right">Amount</th></tr></thead><tbody className="divide-y divide-border/65">{expenses.map((expense) => <tr key={expense.id} data-testid={`row-expense-${expense.id}`} className="hover:bg-secondary/25"><td className="px-5 py-4 text-sm font-semibold">{expense.description}</td><td className="px-3 py-4"><span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">{expense.category}</span></td><td className="px-3 py-4 text-sm text-muted-foreground">{dateLabel(expense.expenseDate)}</td><td className="px-5 py-4 text-right font-mono text-sm font-semibold">{money(expense.amount)}</td></tr>)}</tbody></table></div></>;
}
function ExpenseModal({ onClose }: { onClose: () => void }) {
  const client = useQueryClient(); const create = useCreateExpense(); const [form, setForm] = useState({ category: 'Operations', description: '', amount: '', expenseDate: new Date().toISOString().slice(0, 10) }); const change = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ data: { ...form, amount: Number(form.amount) } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetExpensesQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); client.invalidateQueries({ queryKey: getGetFinancialReportQueryKey() }); onClose(); } }); };
   return <Modal title="Record an expense" description="Capture the detail while it is still fresh." onClose={onClose}><form onSubmit={submit}><div className="space-y-4 px-5 py-5 sm:px-6"><Field label="Category"><select value={form.category} onChange={(e) => change('category', e.target.value)} className={inputClass} data-testid="select-expense-category"><option>Operations</option><option>Inventory</option><option>Staff</option><option>Transport</option><option>Utilities</option><option>Rent</option><option>Other</option></select></Field><Field label="Description"><input required value={form.description} onChange={(e) => change('description', e.target.value)} className={inputClass} data-testid="input-expense-description" placeholder="What was this for?" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Amount"><input required min="0" type="number" value={form.amount} onChange={(e) => change('amount', e.target.value)} className={inputClass} data-testid="input-expense-amount" placeholder="0" /></Field><Field label="Expense date"><input required type="date" value={form.expenseDate} onChange={(e) => change('expenseDate', e.target.value)} className={inputClass} data-testid="input-expense-date" /></Field></div></div><MutationError error={create.error} /><ModalActions onClose={onClose} busy={create.isPending} label="Save expense" /></form></Modal>;
}

function ReportsPage() {
  const today = new Date(); const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10); const [from, setFrom] = useState(monthStart); const [to, setTo] = useState(today.toISOString().slice(0, 10)); const params = useMemo(() => ({ from, to }), [from, to]); const query = useGetFinancialReport(params, { query: { queryKey: getGetFinancialReportQueryKey(params) } }); const report = query.data;
  return <><PageIntro eyebrow="Financial intelligence" title="The month, in focus." description="Use the numbers to make the next decision with a little more confidence." action={<Button variant="secondary" onClick={() => query.refetch()}><RefreshCw size={15} />Refresh</Button>} /><div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} data-testid="input-report-from" /></Field><span className="hidden pb-3 text-muted-foreground sm:block">to</span><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} data-testid="input-report-to" /></Field><div className="pb-0.5 text-xs text-muted-foreground sm:ml-2">Report updates as you change the range.</div></div>{query.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-28 rounded-xl" />)}</div> : query.isError ? <Panel><ErrorState retry={() => query.refetch()} /></Panel> : report ? <ReportContent report={report} /> : <Panel><EmptyState icon={FileBarChart2} title="No report yet" body="Choose a date range with recorded activity to see the story." /></Panel>}</>;
}
function ReportContent({ report }: { report: FinancialReport }) {
  const max = Math.max(...(report.expenseBreakdown || []).map((item) => item.amount), 1); const cards = [{ label: 'Revenue', value: report.revenue, icon: ArrowUpRight, color: 'text-primary' }, { label: 'Expenses', value: report.expenses, icon: ArrowDownRight, color: 'text-destructive' }, { label: 'Net profit', value: report.profit, icon: TrendingUp, color: 'text-emerald-700' }, { label: 'Sales count', value: report.salesCount, icon: Receipt, color: 'text-accent-foreground' }];
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(({ label, value, icon: Icon, color }) => <div key={label} className="rounded-xl border border-card-border bg-card p-5 shadow-[0_3px_18px_hsl(var(--foreground)/.025)]"><Icon size={17} className={color} /><div className="mt-4 text-xs font-semibold text-muted-foreground">{label}</div><div className="mt-1 font-serif text-2xl font-bold">{label === 'Sales count' ? value : money(value)}</div></div>)}</div><div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><Panel title="Expense breakdown"><div className="space-y-5 p-5">{report.expenseBreakdown?.length ? report.expenseBreakdown.map((item) => <div key={item.category}><div className="mb-2 flex justify-between text-sm"><span className="font-semibold">{item.category}</span><span className="font-mono text-xs">{money(item.amount)}</span></div><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.max(7, (item.amount / max) * 100)}%` }} /></div></div>) : <EmptyState icon={Wallet} title="No costs in this range" body="Your expense categories will appear here." />}</div></Panel><Panel title="What the numbers say"><div className="p-5"><div className="rounded-xl bg-secondary/70 p-5"><div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Profit margin</div><div className="mt-2 font-serif text-4xl font-bold text-primary">{report.revenue ? `${Math.round((report.profit / report.revenue) * 100)}%` : '—'}</div><p className="mt-3 text-sm leading-relaxed text-muted-foreground">After {money(report.expenses)} in expenses, every ₦1 of revenue kept <span className="font-semibold text-foreground">{report.revenue ? `₦${(report.profit / report.revenue).toFixed(2)}` : '—'}</span> in the business.</p></div><div className="mt-5 flex items-center gap-3 text-sm"><div className="grid size-9 place-items-center rounded-lg bg-accent/20 text-accent-foreground"><ShieldCheck size={17} /></div><span className="text-muted-foreground">Built from your recorded sales and expenses.</span></div></div></Panel></div></div>;
}

function UsersPage() {
  const client = useQueryClient(); const query = useGetUsers(); const create = useCreateUser(); const update = useUpdateUser(); const [modal, setModal] = useState<SystemUser | 'new' | null>(null); const users = query.data || [];
  const handleUserUpdate = (user: SystemUser, data: { role?: 'administrator' | 'manager' | 'cashier'; status?: 'active' | 'inactive' }) => update.mutate({ id: user.id, data }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetUsersQueryKey() }); client.invalidateQueries({ queryKey: getGetActivityQueryKey() }); } });
  return <><PageIntro eyebrow="Access control" title="The right people, clearly." description="Keep roles focused so everyone can move quickly without stepping on the wrong workflow." action={<Button onClick={() => setModal('new')} testId="button-add-user"><UserPlus size={17} />Invite teammate</Button>} /><Panel>{query.isLoading ? <Skeleton /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : users.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-border bg-secondary/35 font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-5 py-3.5">Team member</th><th className="px-3 py-3.5">Role</th><th className="px-3 py-3.5">Status</th><th className="px-3 py-3.5">Last active</th><th className="px-5 py-3.5 text-right">Manage</th></tr></thead><tbody className="divide-y divide-border/65">{users.map((user) => <tr key={user.id} data-testid={`row-user-${user.id}`} className="group hover:bg-secondary/25"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-accent/25 font-mono text-xs font-medium text-accent-foreground">{initials(user.name)}</div><div><div className="text-sm font-semibold">{user.name}</div><div className="text-xs text-muted-foreground">{user.email}</div></div></div></td><td className="px-3 py-4"><select value={user.role} onChange={(e) => handleUserUpdate(user, { role: e.target.value as 'administrator' | 'manager' | 'cashier' })} className="rounded-md border-0 bg-transparent py-1 text-xs font-semibold capitalize outline-none hover:bg-secondary" data-testid={`select-user-role-${user.id}`}><option value="administrator">Administrator</option><option value="manager">Manager</option><option value="cashier">Cashier</option></select></td><td className="px-3 py-4"><button onClick={() => handleUserUpdate(user, { status: user.status === 'active' ? 'inactive' : 'active' })} data-testid={`button-toggle-user-${user.id}`} className={`rounded-full px-2 py-1 text-[10px] font-semibold ${user.status === 'active' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-secondary text-muted-foreground'}`}>{user.status === 'active' ? 'Active' : 'Inactive'}</button></td><td className="px-3 py-4 text-xs text-muted-foreground">{dateLabel(user.lastActive)}<span className="ml-1 font-mono text-[10px]">· {timeLabel(user.lastActive)}</span></td><td className="px-5 py-4 text-right"><Button variant="ghost" onClick={() => setModal(user)} testId={`button-edit-user-${user.id}`}><Pencil size={15} />Edit</Button></td></tr>)}</tbody></table></div> : <EmptyState icon={UsersRound} title="Your team is waiting" body="Invite the people who help keep this branch moving." action={<Button onClick={() => setModal('new')}><UserPlus size={15} />Invite teammate</Button>} />}</Panel>{modal && <UserModal user={modal === 'new' ? undefined : modal} onClose={() => setModal(null)} />}</>;
}
function UserModal({ user, onClose }: { user?: SystemUser; onClose: () => void }) {
  const client = useQueryClient(); const create = useCreateUser(); const update = useUpdateUser(); const [form, setForm] = useState({ name: user?.name || '', email: user?.email || '', role: user?.role || 'cashier' as 'administrator' | 'manager' | 'cashier', status: user?.status || 'active' as 'active' | 'inactive' }); const change = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const submit = (e: FormEvent) => { e.preventDefault(); if (user) update.mutate({ id: user.id, data: { name: form.name, role: form.role, status: form.status } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetUsersQueryKey() }); onClose(); } }); else create.mutate({ data: { name: form.name, email: form.email, role: form.role } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetUsersQueryKey() }); onClose(); } }); };
   return <Modal title={user ? 'Edit teammate' : 'Invite teammate'} description="Access is easy to adjust as the branch grows." onClose={onClose}><form onSubmit={submit}><div className="space-y-4 px-5 py-5 sm:px-6"><Field label="Full name"><input required value={form.name} onChange={(e) => change('name', e.target.value)} className={inputClass} data-testid="input-user-name" placeholder="e.g. Tunde Adebayo" /></Field>{!user && <Field label="Email address"><input required type="email" value={form.email} onChange={(e) => change('email', e.target.value)} className={inputClass} data-testid="input-user-email" placeholder="name@business.com" /></Field>}<Field label="Role"><select value={form.role} onChange={(e) => change('role', e.target.value)} className={inputClass} data-testid="select-user-role"><option value="administrator">Administrator — everything</option><option value="manager">Manager — day-to-day operations</option><option value="cashier">Cashier — sales and stock</option></select></Field>{user && <Field label="Account status"><select value={form.status} onChange={(e) => change('status', e.target.value)} className={inputClass} data-testid="select-user-status"><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>}</div><MutationError error={create.error || update.error} /><ModalActions onClose={onClose} busy={create.isPending || update.isPending} label={user ? 'Update teammate' : 'Send invite'} /></form></Modal>;
}

function ActivityPage() {
  const query = useGetActivity(); const activities = query.data || [];
  return <><PageIntro eyebrow="Audit trail" title="Everything that changed." description="A quiet record of the actions that keep your business honest." action={<Button variant="secondary" onClick={() => query.refetch()}><RefreshCw size={15} />Refresh feed</Button>} /><Panel>{query.isLoading ? <Skeleton rows={7} /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : activities.length ? <div className="divide-y divide-border/70">{activities.map((item) => <ActivityRow key={item.id} item={item} />)}</div> : <EmptyState icon={ActivityIcon} title="No activity recorded" body="Actions from your team will appear here as work gets done." />}</Panel></>;
}
function ActivityRow({ item }: { item: Activity }) {
  return <div data-testid={`row-activity-${item.id}`} className="flex gap-4 px-5 py-4 sm:px-6"><div className="relative flex flex-col items-center"><div className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-primary"><Check size={16} /></div><div className="mt-2 h-full w-px bg-border" /></div><div className="min-w-0 pb-3"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-sm font-semibold">{item.action}</span><span className="font-mono text-[10px] text-muted-foreground">{dateLabel(item.createdAt)} · {timeLabel(item.createdAt)}</span></div><p className="mt-1 text-sm text-muted-foreground">{item.description}</p><div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground"><div className="grid size-4 place-items-center rounded-full bg-primary/15 font-mono text-[8px] text-primary">{initials(item.actor)}</div>{item.actor}</div></div></div>;
}

function SettingsPage() {
  const { user: clerkUser } = useUser();
  const profile = useCurrentProfile();
  const [adminSaved, setAdminSaved] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [admin, setAdmin] = useState({ name: '', email: '' });
  const [prefs, setPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kola-preferences') || '{"lowStock":true,"dailyDigest":true,"compact":false}') as { lowStock: boolean; dailyDigest: boolean; compact: boolean }; }
    catch { return { lowStock: true, dailyDigest: true, compact: false }; }
  });
  const profileName = profile.data?.user.name;
  const profileEmail = profile.data?.user.email;
  const clerkName = clerkUser?.fullName;
  const clerkEmail = clerkUser?.primaryEmailAddress?.emailAddress;
  useEffect(() => {
    if (profileName || profileEmail || clerkName || clerkEmail) setAdmin({ name: profileName || clerkName || '', email: profileEmail || clerkEmail || '' });
  }, [profileName, profileEmail, clerkName, clerkEmail]);
  const saveAdmin = (e: FormEvent) => {
    e.preventDefault(); setAdminError('');
    authFetch('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(admin) }).then(() => {
      setAdminSaved(true); queryClient.invalidateQueries({ queryKey: ['auth-me'] }); window.setTimeout(() => setAdminSaved(false), 2600);
    }).catch((error) => setAdminError(error instanceof Error ? error.message : 'Could not save changes.'));
  };
  const togglePref = (key: keyof typeof prefs) => setPrefs((prev) => { const next = { ...prev, [key]: !prev[key] }; localStorage.setItem('kola-preferences', JSON.stringify(next)); return next; });
  const prefItems: { key: keyof typeof prefs; title: string; body: string }[] = [
    { key: 'lowStock', title: 'Low-stock alerts', body: 'Show a reminder when products reach their threshold.' },
    { key: 'dailyDigest', title: 'Daily business digest', body: 'Keep the overview focused on the daily pulse.' },
    { key: 'compact', title: 'Compact tables', body: 'Fit more rows on screen when scanning history.' },
  ];
  return <><PageIntro eyebrow="Workspace preferences" title="Make Kola yours." description="Small choices that keep the desk comfortable for long days and quick decisions." /><div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]"><div className="space-y-5"><Panel title="Business profile"><div className="space-y-4 px-5 py-5 sm:px-6"><div className="rounded-xl bg-primary p-5 text-primary-foreground"><div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary-foreground/60">Business workspace</div><div className="mt-3 flex items-center gap-3"><div className="grid size-12 place-items-center rounded-2xl bg-accent font-serif text-lg font-bold text-accent-foreground">K</div><div><div className="font-serif text-xl font-bold">Your business desk</div><div className="text-xs text-primary-foreground/65">Nigerian Naira · one focused workspace</div></div></div></div><div className="rounded-xl border border-border bg-secondary/30 p-4"><div className="flex gap-3"><Landmark size={18} className="mt-0.5 shrink-0 text-primary" /><div><div className="text-sm font-semibold">Business details live in onboarding</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Your branch identity is set when the business profile is created. Ask an administrator to update it if anything changes.</p></div></div></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-border p-3"><div className="font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">Currency</div><div className="mt-1 text-sm font-semibold">Nigerian Naira (₦)</div></div><div className="rounded-lg border border-border p-3"><div className="font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">Signed in as</div><div className="mt-1 truncate text-sm font-semibold">{admin.email || 'Loading profile...'}</div></div></div></div></Panel><Panel title="Administrator information"><form onSubmit={saveAdmin}><div className="space-y-4 px-5 py-5 sm:px-6"><div className="rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm text-muted-foreground">This profile identifies activity across the business and keeps your account details current.</div><Field label="Full name"><input required value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} className={inputClass} data-testid="input-settings-admin-name" /></Field><Field label="Email address"><input required type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} className={inputClass} data-testid="input-settings-admin-email" /></Field>{adminError && <p className="text-sm text-destructive">{adminError}</p>}</div><div className="flex justify-end border-t border-border px-5 py-4 sm:px-6"><Button type="submit" disabled={!admin.name || !admin.email} testId="button-save-admin-info">{adminSaved ? <><Check size={15} />Saved</> : 'Save administrator info'}</Button></div></form></Panel></div><Panel title="App preferences"><div className="divide-y divide-border/70">{prefItems.map((item) => <div key={item.key} className="flex items-start justify-between gap-4 px-5 py-5 sm:px-6"><div><div className="text-sm font-semibold">{item.title}</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p></div><button type="button" role="switch" aria-checked={prefs[item.key]} onClick={() => togglePref(item.key)} data-testid={`button-toggle-${String(item.key)}`} className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full p-1 ${prefs[item.key] ? 'bg-primary' : 'bg-secondary'}`}><span className={`block size-4 rounded-full bg-card shadow-sm transition-transform ${prefs[item.key] ? 'translate-x-5' : ''}`} /></button></div>)}</div><div className="m-5 rounded-xl border border-border bg-secondary/35 p-4 sm:m-6"><div className="flex gap-3"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" /><div><div className="text-sm font-semibold">Your data stays yours</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Kola is built for one branch at a time, so the numbers stay clear and useful.</p></div></div></div></Panel></div></>;
}

function NotFound() {
  return <div className="grid min-h-[70dvh] place-items-center text-center"><div><div className="font-mono text-sm text-primary">404 / NOT FOUND</div><h1 className="mt-2 font-serif text-4xl font-bold">That page took a wrong turn.</h1><p className="mt-3 text-sm text-muted-foreground">The workspace you are looking for does not exist.</p><Link href="/" data-testid="link-back-home" className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Back to overview</Link></div></div>;
}

function Router() {
  const [location] = useLocation();
  const profile = useCurrentProfile();
  const role = profile.data?.user.role || 'cashier';
  const allowedRoutes = roleRoutes[role];
  if (location !== '/' && !allowedRoutes.includes(location)) {
    return <Redirect to={defaultRouteForRole(role)} />;
  }
  return <ErrorBoundary resetKey={location}><Switch><Route path="/dashboard" component={Dashboard} /><Route path="/products" component={ProductsPage} /><Route path="/sales" component={SalesPage} /><Route path="/expenses" component={ExpensesPage} /><Route path="/reports" component={ReportsPage} /><Route path="/users" component={UsersPage} /><Route path="/activity" component={ActivityPage} /><Route path="/settings" component={SettingsPage} /><Route path="/" component={() => <Redirect to={defaultRouteForRole(role)} />} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function AuthenticatedWorkspace() {
  const { isLoaded, isSignedIn } = useAuth();
  const profile = useCurrentProfile();
  if (!isLoaded) return <div className="grid min-h-[100dvh] place-items-center bg-background px-6"><div className="w-full max-w-sm space-y-3"><div className="mx-auto h-10 w-10 rounded-xl skeleton" /><div className="skeleton mx-auto h-4 w-40 rounded" /><div className="skeleton mx-auto h-3 w-56 rounded opacity-70" /></div></div>;
  if (!isSignedIn) return <Switch><Route path="/sign-in/*?" component={() => <AuthPage mode="sign-in" />} /><Route path="/sign-up/*?" component={() => <AuthPage mode="sign-up" />} /><Route path="/" component={PublicHome} /><Route component={PublicHome} /></Switch>;
  if (profile.isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-background px-6"><div className="w-full max-w-sm space-y-3"><div className="skeleton h-12 w-full rounded-xl" /><div className="skeleton h-28 w-full rounded-xl" /><div className="skeleton h-4 w-2/3 rounded opacity-70" /></div></div>;
  if (profile.isError) {
    return profile.error instanceof ApiError && profile.error.status === 404
      ? <OnboardingPage />
      : <div className="grid min-h-[100dvh] place-items-center bg-background px-6"><div className="w-full max-w-lg"><ErrorState retry={() => profile.refetch()} /></div></div>;
  }
  if (profile.data?.user && !profile.data.user.accessVerified) {
    return <PasskeyGate user={profile.data.user} onUnlocked={(response) => queryClient.setQueryData(['auth-me'], response)} />;
  }
  return <Shell><Router /></Shell>;
}

function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return <WouterRouter base={basePath}><ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to access your business desk' } }, signUp: { start: { title: 'Create your business account', subtitle: 'Get started with a clearer way to run the day' } } }}><QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator /><TooltipProvider><AuthenticatedWorkspace /><Toaster /></TooltipProvider></QueryClientProvider></ClerkProvider></WouterRouter>;
}
export default App;