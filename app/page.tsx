'use client';

import { useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
type Tab = 'dashboard' | 'trial-balance' | 'profit-loss' | 'balance-sheet' | 'journal' | 'ledgers' | 'lending';
type ReportBook = 'Combined' | 'K' | 'P';
type SetupStatus = { hasKey: boolean; companyName?: string | null; uploadedAt?: string | null };

interface CloudData {
  company: Row | null;
  uploadedAt: string | null;
  dashboard: {
    totalSales: number;
    totalPurchases: number;
    cashBalance: number;
    bankBalance: number;
    profitLoss: number;
    totalIncome: number;
    totalExpenses: number;
    receivables: number;
    payables: number;
  };
  trialBalance: Row[];
  incomeRows: Row[];
  expenseRows: Row[];
  interestReceivable: Row[];
  interestPayable: Row[];
  profitLoss: number;
  balanceSheet: Row[];
  ledgers: (Row & { statement: Row[] })[];
  vouchers: (Row & { entries: Row[] })[];
  lending: Row[];
  loanAccounts: (Row & { transactions: Row[] })[];
  records: Row[];
}

// ─── Utils ────────────────────────────────────────────────────────────────────
const money = (v: unknown) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupee = (v: unknown) => `₹${money(v)}`;
const dateText = (d?: unknown) => d ? String(d).split('-').reverse().join('/') : '';
const num = (v: unknown) => Number(v || 0);
const bookLabel = (book: ReportBook) => book === 'K' ? 'Kacha' : book === 'P' ? 'Packa' : 'Combined';
const accessTokenStorageKey = 'jj-accounting-cloud-access-key';
const balanceText = (value: unknown) => {
  const signed = num(value);
  return signed >= 0 ? `${rupee(signed)} Dr` : `${rupee(Math.abs(signed))} Cr`;
};
const loanOpening = (account: Row, book: ReportBook) => {
  const k = num(account.openingKBalance ?? account.opening_k_balance) * ((account.openingKType ?? account.opening_k_type) === 'Cr' ? -1 : 1);
  const p = num(account.openingPBalance ?? account.opening_p_balance) * ((account.openingPType ?? account.opening_p_type) === 'Cr' ? -1 : 1);
  if (book === 'K') return k;
  if (book === 'P') return p;
  return k + p;
};
const timeAgo = (iso: string) => {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return `${Math.round(diff / 1440)}d ago`;
};

// ─── Root Component ───────────────────────────────────────────────────────────
export default function CloudDashboard() {
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [generatedKey, setGeneratedKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [token, setToken] = useState(() => typeof window === 'undefined' ? '' : window.localStorage.getItem(accessTokenStorageKey) || '');
  const [data, setData] = useState<CloudData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('dashboard');
  const [book, setBook] = useState<ReportBook>('Combined');

  useEffect(() => {
    fetch('/api/setup').then(r => r.json()).then(setSetup).catch(() => setSetup({ hasKey: false }));
  }, []);

  const generateKey = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/setup', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to generate key.');
      setGeneratedKey(body.key);
      setSetup(p => ({ ...p, hasKey: true }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const copyKey = () => {
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const loadData = async (targetBook = book, accessKey = token) => {
    setLoading(true);
    setError('');
    let unauthorized = false;
    try {
      const res = await fetch(`/api/data?book=${targetBook}`, { headers: { authorization: `Bearer ${accessKey}` } });
      const body = await res.json();
      unauthorized = res.status === 401;
      if (!res.ok) throw new Error(body.error || 'Could not load data.');
      window.localStorage.setItem(accessTokenStorageKey, accessKey);
      setToken(accessKey);
      setData(body);
    } catch (e: any) {
      if (unauthorized && typeof window !== 'undefined') window.localStorage.removeItem(accessTokenStorageKey);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (setup?.hasKey && token && !data && !loading) {
      void loadData(book, token);
    }
  }, [setup?.hasKey, token]);

  const handleBookChange = async (nextBook: ReportBook) => {
    setBook(nextBook);
    if (token) {
      await loadData(nextBook);
    }
  };

  if (!setup) return <div className="splash"><div className="splash-spinner" /></div>;
  if (data) return (
    <Dashboard
      data={data}
      tab={tab}
      setTab={setTab}
      book={book}
      onBookChange={handleBookChange}
      loading={loading}
      onLogout={() => {
        window.localStorage.removeItem(accessTokenStorageKey);
        setData(null);
        setToken('');
      }}
    />
  );

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-logo large">JJ</div>
          <h1>JJ Accounting Cloud</h1>
          <p>Secure access to your accounting data</p>
        </div>

        <div className="key-section">
          <div className="key-section-header">
            <span className="key-icon">🔑</span>
            <div>
              <strong>Access Key</strong>
              <small>Generate a key here, then paste it into the desktop app under Settings → Cloud Sync.</small>
            </div>
          </div>
          {generatedKey ? (
            <div className="generated-key-wrap">
              <div className="generated-key">{generatedKey}</div>
              <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={copyKey}>{copied ? '✓ Copied!' : 'Copy Key'}</button>
              <p className="key-note">⚠️ Save this key — it won&apos;t be shown again.</p>
            </div>
          ) : (
            <>
              <button className="generate-btn" onClick={generateKey} disabled={generating}>
                {generating ? 'Generating…' : setup.hasKey ? 'Regenerate Access Key' : 'Generate Access Key'}
              </button>
              {setup.hasKey && <p className="key-exists-note">✓ A key is already set. Enter it below to open the dashboard.</p>}
            </>
          )}
        </div>

        <div className="divider"><span>enter key to view dashboard</span></div>

        <div className="login-section">
          <label className="login-field">
            <span>Access Key</span>
            <input id="access-key-input" type="password" value={token} onChange={e => setToken(e.target.value)}
              placeholder="Paste your access key here" onKeyDown={e => e.key === 'Enter' && token.trim() && loadData()} />
          </label>
          {error && <p className="error-msg">{error}</p>}
          <button id="open-dashboard-btn" className="open-btn" onClick={() => loadData()} disabled={loading || !token.trim()}>
            {loading ? 'Loading…' : 'Open Dashboard →'}
          </button>
        </div>

        {setup.companyName && (
          <div className="company-hint">
            Last synced from: <strong>{setup.companyName}</strong>
            {setup.uploadedAt && <span> · {timeAgo(setup.uploadedAt)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard Shell ──────────────────────────────────────────────────────────
function Dashboard({
  data,
  tab,
  setTab,
  book,
  onBookChange,
  loading,
  onLogout
}: {
  data: CloudData;
  tab: Tab;
  setTab: (t: Tab) => void;
  book: ReportBook;
  onBookChange: (b: ReportBook) => void;
  loading: boolean;
  onLogout: () => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'trial-balance', label: 'Trial Balance', icon: '⚖️' },
    { id: 'profit-loss', label: 'Profit & Loss', icon: '📈' },
    { id: 'balance-sheet', label: 'Balance Sheet', icon: '🏦' },
    { id: 'journal', label: 'Journal / Daybook', icon: '📒' },
    { id: 'ledgers', label: 'Ledger Accounts', icon: '📋' },
    { id: 'lending', label: 'Lacha / Packa', icon: '💰' },
  ];

  const visibleTabs = tabs.map((item) => item.id === 'lending' ? { ...item, label: 'Kacha / Packa' } : item);
  const activeTab = visibleTabs.find(t => t.id === tab);

  const handleTabClick = (id: Tab) => {
    setTab(id);
    setSidebarOpen(false);
  };

  return (
    <div className="shell">
      {/* Mobile sidebar overlay backdrop */}
      <div className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />

      <aside className={`sidebar${sidebarOpen ? ' mobile-open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">JJ</div>
          <div><strong>JJ Accounting</strong><small>Cloud Dashboard</small></div>
        </div>
        {data.uploadedAt && <div className="sync-badge"><span className="sync-dot" />Synced {timeAgo(data.uploadedAt)}</div>}
        <nav>
          {visibleTabs.map(t => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => handleTabClick(t.id)}>
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </nav>
        <button className="logout-btn" onClick={onLogout}>← Back to login</button>
      </aside>

      <main className="content">
        {/* Mobile top bar — shown only on ≤900px via CSS */}
        <div className="mobile-topbar">
          <button
            className={`hamburger-btn${sidebarOpen ? ' open' : ''}`}
            onClick={() => setSidebarOpen(o => !o)}
            aria-label="Toggle navigation"
          >
            <span /><span /><span />
          </button>
          <span className="mobile-topbar-title">
            {activeTab ? `${activeTab.icon} ${activeTab.label}` : 'JJ Accounting'}
          </span>
          <div className="book-selector">
            <button className={book === 'K' ? 'active' : ''} onClick={() => onBookChange('K')}>K</button>
            <button className={book === 'P' ? 'active' : ''} onClick={() => onBookChange('P')}>P</button>
            <button className={book === 'Combined' ? 'active' : ''} onClick={() => onBookChange('Combined')}>All</button>
          </div>
          {loading && <div className="mini-loader" style={{ flexShrink: 0 }}>…</div>}
        </div>

        {/* Desktop title bar — hidden on ≤900px via CSS */}
        <div className="content-title-bar">
          <div className="content-title">
            <h2>{data.company?.name as string || 'JJ Accounting'}</h2>
            {data.uploadedAt && <span className="content-subtitle">Last synced: {new Date(data.uploadedAt).toLocaleString('en-IN')}</span>}
          </div>
          <div className="top-toolbar">
            <div className="book-selector">
              <button className={book === 'K' ? 'active' : ''} onClick={() => onBookChange('K')}>Kacha</button>
              <button className={book === 'P' ? 'active' : ''} onClick={() => onBookChange('P')}>Packa</button>
              <button className={book === 'Combined' ? 'active' : ''} onClick={() => onBookChange('Combined')}>Combined</button>
            </div>
            {loading && <div className="mini-loader">Updating data…</div>}
          </div>
        </div>

        <div className="content-body" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s ease' }}>
          {tab === 'dashboard' && <DashboardJournalView vouchers={data.vouchers} book={book} />}
          {tab === 'trial-balance' && <TrialBalanceView rows={data.trialBalance} />}
          {tab === 'profit-loss' && <ProfitLossView data={data} />}
          {tab === 'balance-sheet' && <BalanceSheetView rows={data.balanceSheet} />}
          {tab === 'journal' && <div className="view-stack"><h3>Journal / Daybook</h3><JournalBook vouchers={data.vouchers} /></div>}
          {tab === 'ledgers' && <LedgersView ledgers={data.ledgers} />}
          {tab === 'lending' && <LendingView lending={data.lending} loanAccounts={data.loanAccounts} book={book} />}
        </div>
      </main>
    </div>
  );
}

// ─── Dashboard View ───────────────────────────────────────────────────────────
function DashboardView({ data, setTab, book }: { data: CloudData; setTab: (t: Tab) => void; book: ReportBook }) {
  const d = data.dashboard;
  const recentVouchers = data.vouchers.slice(0, 10);
  return (
    <div className="view-stack">
      <div className="metrics-grid">
        <MetricCard label="Cash Balance" value={rupee(d.cashBalance)} color={d.cashBalance >= 0 ? 'green' : 'red'} icon="💵" />
        <MetricCard label="Bank Balance" value={rupee(d.bankBalance)} color={d.bankBalance >= 0 ? 'green' : 'red'} icon="🏦" />
        <MetricCard label="Total Sales" value={rupee(d.totalSales)} color="blue" icon="📈" />
        <MetricCard label="Total Purchases" value={rupee(d.totalPurchases)} color="orange" icon="🛒" />
        <MetricCard label="Receivables" value={rupee(d.receivables)} color="blue" icon="⬆️" />
        <MetricCard label="Payables" value={rupee(d.payables)} color="red" icon="⬇️" />
        <MetricCard label="Total Income" value={rupee(d.totalIncome)} color="green" icon="💚" />
        <MetricCard label="Total Expenses" value={rupee(d.totalExpenses)} color="red" icon="❤️" />
        <MetricCard label="Net Profit / Loss" value={rupee(d.profitLoss)} color={d.profitLoss >= 0 ? 'green' : 'red'} icon={d.profitLoss >= 0 ? '✅' : '❌'} wide />
      </div>

      <div className="section-header">
        <h3>Recent Journal Entries ({book === 'Combined' ? 'Combined Books' : book === 'K' ? 'Lacha (Khacha)' : 'Packa Book'})</h3>
        <button className="link-btn" onClick={() => setTab('journal')}>View all →</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Voucher No</th><th>Type</th><th>Narration</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>
            {recentVouchers.map((v, i) => (
              <tr key={i}>
                <td>{dateText(v.date)}</td>
                <td><span className="badge">{String(v.voucher_no)}</span></td>
                <td>{String(v.type)}</td>
                <td className="narration">{String(v.narration)}</td>
                <td className="num">{rupee(v.total_debit)}</td>
                <td className="num">{rupee(v.total_credit)}</td>
              </tr>
            ))}
            {!recentVouchers.length && <tr><td colSpan={6} className="no-data">No journal entries found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Trial Balance ────────────────────────────────────────────────────────────
function DashboardJournalView({ vouchers, book }: { vouchers: (Row & { entries: Row[] })[]; book: ReportBook }) {
  return (
    <div className="view-stack">
      <div className="section-header">
        <h3>Journal Entries ({bookLabel(book)})</h3>
      </div>
      <JournalBook vouchers={vouchers} />
    </div>
  );
}

function JournalBook({ vouchers }: { vouchers: (Row & { entries: Row[] })[] }) {
  const rows = vouchers.flatMap((voucher) => {
    const entries = (voucher.entries as Row[]).map((entry, index) => ({ voucher, entry, index, kind: 'entry' as const }));
    return voucher.narration ? [...entries, { voucher, entry: {}, index: entries.length, kind: 'narration' as const }] : entries;
  });
  const totalDebit = vouchers.reduce((sum, voucher) => sum + num(voucher.total_debit), 0);
  const totalCredit = vouchers.reduce((sum, voucher) => sum + num(voucher.total_credit), 0);

  return (
    <div className="table-wrap journal-book-wrap">
      <table className="journal-book-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Particulars</th>
            <th>L.F.</th>
            <th className="num">Debit</th>
            <th className="num">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            if (row.kind === 'narration') {
              return <tr key={`${row.voucher.id}-n-${rowIndex}`} className="journal-narration"><td></td><td colSpan={4}>({String(row.voucher.narration)})</td></tr>;
            }
            const isDebit = num(row.entry.debit) > 0;
            return (
              <tr key={`${row.voucher.id}-${row.index}`} className={row.index === 0 ? 'journal-entry-start' : ''}>
                <td>{row.index === 0 ? dateText(row.voucher.date) : ''}</td>
                <td className={isDebit ? 'journal-dr-line' : 'journal-cr-line'}>
                  {isDebit ? `${String(row.entry.ledger_name)} A/c Dr.` : `To ${String(row.entry.ledger_name)} A/c`}
                  {row.index === 0 && <small>{String(row.voucher.voucher_no || row.voucher.type || '')}</small>}
                </td>
                <td className="muted">-</td>
                <td className="num dr">{isDebit ? rupee(row.entry.debit) : ''}</td>
                <td className="num cr">{!isDebit ? rupee(row.entry.credit) : ''}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={5} className="no-data">No journal entries found.</td></tr>}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr>
              <td></td>
              <td><strong>Total</strong></td>
              <td></td>
              <td className="num"><strong>{rupee(totalDebit)}</strong></td>
              <td className="num"><strong>{rupee(totalCredit)}</strong></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function TrialBalanceView({ rows }: { rows: Row[] }) {
  const [search, setSearch] = useState('');
  const filtered = rows
    .filter((r) => Math.abs(num(r.debit) - num(r.credit)) >= 0.005)
    .filter(r => !search || String(r.ledgerName).toLowerCase().includes(search.toLowerCase()));
  const totalDr = filtered.reduce((s, r) => s + num(r.debit), 0);
  const totalCr = filtered.reduce((s, r) => s + num(r.credit), 0);

  return (
    <div className="view-stack">
      <div className="view-toolbar">
        <h3>Trial Balance</h3>
        <input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ledger…" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ledger Name</th><th>Group</th>
              <th className="num">Debit (Dr)</th><th className="num">Credit (Cr)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                <td className="ledger-name">{String(r.ledgerName)}</td>
                <td><span className={`group-tag group-${String(r.groupName).toLowerCase()}`}>{String(r.groupName)}</span></td>
                <td className="num dr">{num(r.debit) > 0 ? rupee(r.debit) : ''}</td>
                <td className="num cr">{num(r.credit) > 0 ? rupee(r.credit) : ''}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={4} className="no-data">No outstanding ledger balances.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td colSpan={2}><strong>Total</strong></td>
              <td className="num dr"><strong>{rupee(totalDr)}</strong></td>
              <td className="num cr"><strong>{rupee(totalCr)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Profit & Loss ────────────────────────────────────────────────────────────
function ProfitLossView({ data }: { data: CloudData }) {
  const { incomeRows, expenseRows, interestReceivable = [], interestPayable = [], profitLoss } = data;

  const standardIncome = incomeRows.reduce((s, r) => s + Number(r.credit) - Number(r.debit), 0);
  const totalInterestReceivable = interestReceivable.reduce((s, r) => s + Number(r.totalInterest || 0), 0);
  const totalIncome = standardIncome + totalInterestReceivable;

  const standardExpenses = expenseRows.reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);
  const totalInterestPayable = interestPayable.reduce((s, r) => s + Number(r.totalInterest || 0), 0);
  const totalExpenses = standardExpenses + totalInterestPayable;

  return (
    <div className="view-stack">
      <h3>Profit &amp; Loss Account</h3>
      <div className="pl-grid">
        <div className="pl-side">
          <div className="pl-side-header expenses-header">Expenses (Dr)</div>
          <table>
            <tbody>
              {expenseRows.map((r, i) => (
                <tr key={i}>
                  <td>{String(r.ledgerName)}</td>
                  <td className="num">{rupee(Math.abs(Number(r.debit) - Number(r.credit)))}</td>
                </tr>
              ))}
              {interestPayable.length > 0 && (
                <>
                  <tr className="sub-header-row"><td colSpan={2}>Accrued Interest Payable (Loan Accounts)</td></tr>
                  {interestPayable.map((r, i) => (
                    <tr key={`ip-${i}`} className="interest-sub-row">
                      <td><span className="bullet">└</span> Interest to {String(r.accountName)} <span className="interest-sub-info">(Balance: {rupee(Math.abs(Number(r.totalBalance)))})</span></td>
                      <td className="num cr">{rupee(r.totalInterest)}</td>
                    </tr>
                  ))}
                </>
              )}
              {!expenseRows.length && !interestPayable.length && <tr><td colSpan={2} className="no-data">No expense entries.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="pl-total">
                <td><strong>Total Expenses</strong></td>
                <td className="num"><strong>{rupee(totalExpenses)}</strong></td>
              </tr>
              {profitLoss >= 0 && (
                <tr className="pl-profit">
                  <td><strong>Net Profit</strong></td>
                  <td className="num"><strong className="profit-text">{rupee(profitLoss)}</strong></td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        <div className="pl-side">
          <div className="pl-side-header income-header">Income (Cr)</div>
          <table>
            <tbody>
              {incomeRows.map((r, i) => (
                <tr key={i}>
                  <td>{String(r.ledgerName)}</td>
                  <td className="num">{rupee(Math.abs(Number(r.credit) - Number(r.debit)))}</td>
                </tr>
              ))}
              {interestReceivable.length > 0 && (
                <>
                  <tr className="sub-header-row"><td colSpan={2}>Accrued Interest Receivable (Loan Accounts)</td></tr>
                  {interestReceivable.map((r, i) => (
                    <tr key={`ir-${i}`} className="interest-sub-row">
                      <td><span className="bullet">└</span> Interest from {String(r.accountName)} <span className="interest-sub-info">(Balance: {rupee(Math.abs(Number(r.totalBalance)))})</span></td>
                      <td className="num dr">{rupee(r.totalInterest)}</td>
                    </tr>
                  ))}
                </>
              )}
              {!incomeRows.length && !interestReceivable.length && <tr><td colSpan={2} className="no-data">No income entries.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="pl-total">
                <td><strong>Total Income</strong></td>
                <td className="num"><strong>{rupee(totalIncome)}</strong></td>
              </tr>
              {profitLoss < 0 && (
                <tr className="pl-profit">
                  <td><strong>Net Loss</strong></td>
                  <td className="num"><strong className="loss-text">{rupee(Math.abs(profitLoss))}</strong></td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </div>

      <div className={`pl-summary ${profitLoss >= 0 ? 'pl-summary-profit' : 'pl-summary-loss'}`}>
        <span>{profitLoss >= 0 ? '✅ Net Profit' : '❌ Net Loss'}</span>
        <strong>{rupee(Math.abs(profitLoss))}</strong>
      </div>
    </div>
  );
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────
function BalanceSheetView({ rows }: { rows: Row[] }) {
  type SectionRow = { type: 'header' | 'detail' | 'total' | 'space'; label: string; amount?: number };
  const liabilities = new Map<string, Row[]>();
  const assets = new Map<string, Row[]>();

  const add = (side: Map<string, Row[]>, category: string, row: Row) => {
    if (!side.has(category)) side.set(category, []);
    side.get(category)!.push(row);
  };

  for (const row of rows) {
    const netBalance = num(row.debit) - num(row.credit);
    if (Math.abs(netBalance) < 0.005) continue;
    const groupName = String(row.groupName || '');
    const ledgerName = String(row.ledgerName || '').toLowerCase();
    const loanCategory = row.loanAccountCategory ? String(row.loanAccountCategory) : '';
    if (netBalance > 0) {
      if (row.isLoanAccount && loanCategory) add(assets, loanCategory, row);
      else if (ledgerName.includes('cash') || ledgerName.includes('bank')) add(assets, 'Cash & Bank', row);
      else if (groupName === 'Income' || groupName === 'Expenses') add(assets, groupName, row);
      else add(assets, groupName === 'Capital' ? 'Capital Account' : 'Other Assets', row);
    } else {
      if (row.isLoanAccount && loanCategory) add(liabilities, loanCategory, row);
      else if (groupName === 'Capital') add(liabilities, 'Capital Account', row);
      else if (ledgerName.includes('gst') || ledgerName.includes('tax')) add(liabilities, 'Duties & Taxes', row);
      else if (groupName === 'Income' || groupName === 'Expenses') add(liabilities, groupName, row);
      else add(liabilities, 'Other Liabilities', row);
    }
  }

  const sortKeys = (keys: string[], capitalFirst = false) => keys.sort((a, b) => {
    if (capitalFirst && a === 'Capital Account') return -1;
    if (capitalFirst && b === 'Capital Account') return 1;
    if (!capitalFirst && a === 'Cash & Bank') return 1;
    if (!capitalFirst && b === 'Cash & Bank') return -1;
    return a.localeCompare(b);
  });

  const buildSide = (source: Map<string, Row[]>, isAsset: boolean): SectionRow[] => {
    const result: SectionRow[] = [];
    const keys = sortKeys(Array.from(source.keys()), !isAsset);
    for (const category of keys) {
      const categoryRows = source.get(category) ?? [];
      result.push({ type: 'header', label: category });
      let categoryTotal = 0;
      for (const row of categoryRows) {
        const amount = isAsset ? num(row.debit) - num(row.credit) : num(row.credit) - num(row.debit);
        result.push({ type: 'detail', label: String(row.ledgerName), amount });
        categoryTotal += amount;
      }
      result.push({ type: 'total', label: `Total ${category}`, amount: categoryTotal });
      result.push({ type: 'space', label: '' });
    }
    return result;
  };

  const leftSide = buildSide(liabilities, false);
  const rightSide = buildSide(assets, true);
  const totalLiabilities = Array.from(liabilities.values()).flat().reduce((s, r) => s + num(r.credit) - num(r.debit), 0);
  const totalAssets = Array.from(assets.values()).flat().reduce((s, r) => s + num(r.debit) - num(r.credit), 0);
  const maxRows = Math.max(leftSide.length, rightSide.length);

  const renderCell = (item: SectionRow | undefined, split = false) => {
    if (!item) return <><td></td><td></td><td className={split ? 'split-border' : undefined}></td></>;
    if (item.type === 'header') return <td className={`category-header ${split ? 'split-border' : ''}`} colSpan={3}><strong>{item.label}</strong></td>;
    if (item.type === 'space') return <><td className="space-cell">&nbsp;</td><td className="space-cell"></td><td className={`space-cell ${split ? 'split-border' : ''}`}></td></>;
    if (item.type === 'total') {
      return <><td className="category-total"><strong>{item.label}</strong></td><td className="category-total"></td><td className={`num category-total ${split ? 'split-border' : ''}`}><strong>{rupee(item.amount)}</strong></td></>;
    }
    return <><td className="ledger-cell">{item.label}</td><td className="num">{rupee(item.amount)}</td><td className={split ? 'split-border' : undefined}></td></>;
  };

  return (
    <div className="view-stack">
      <h3>Balance Sheet</h3>
      <div className="table-wrap">
        <table className="report-table balance-table">
          <thead>
            <tr>
              <th>Liability / Capital</th>
              <th className="num">Amount</th>
              <th className="num split-border">Total</th>
              <th>Asset</th>
              <th className="num">Amount</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {maxRows ? Array.from({ length: maxRows }).map((_, index) => (
              <tr key={index}>
                {renderCell(leftSide[index], true)}
                {renderCell(rightSide[index])}
              </tr>
            )) : <tr><td colSpan={6} className="no-data">No outstanding asset or liability balances.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><strong>Total Liabilities &amp; Capital</strong></td>
              <td className="num split-border"><strong>{rupee(totalLiabilities)}</strong></td>
              <td colSpan={2}><strong>Total Assets</strong></td>
              <td className="num"><strong>{rupee(totalAssets)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Journal / Daybook ────────────────────────────────────────────────────────
function JournalView({ vouchers }: { vouchers: (Row & { entries: Row[] })[] }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('All');
  const [expanded, setExpanded] = useState<number | null>(null);

  const types = ['All', ...Array.from(new Set(vouchers.map(v => String(v.type))))];
  const filtered = vouchers.filter(v => {
    const matchType = type === 'All' || v.type === type;
    const matchSearch = !search || String(v.narration).toLowerCase().includes(search.toLowerCase()) || String(v.voucher_no).toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  return (
    <div className="view-stack">
      <div className="view-toolbar">
        <h3>Journal / Daybook</h3>
        <div className="toolbar-right">
          <select value={type} onChange={e => setType(e.target.value)} className="select-input">
            {types.map(t => <option key={t}>{t}</option>)}
          </select>
          <input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search narration…" />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th style={{ width: 28 }} /><th>Date</th><th>Voucher No</th><th>Type</th><th>Narration</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>
            {filtered.map((v, i) => (
              <>
                <tr key={i} className="voucher-row" onClick={() => setExpanded(expanded === i ? null : i)}>
                  <td className="expand-cell">{expanded === i ? '▾' : '▸'}</td>
                  <td>{dateText(v.date)}</td>
                  <td><span className="badge">{String(v.voucher_no)}</span></td>
                  <td><span className={`type-tag type-${String(v.type).toLowerCase().replace(' ', '-')}`}>{String(v.type)}</span></td>
                  <td className="narration">{String(v.narration)}</td>
                  <td className="num dr">{rupee(v.total_debit)}</td>
                  <td className="num cr">{rupee(v.total_credit)}</td>
                </tr>
                {expanded === i && (v.entries as Row[]).map((e, j) => (
                  <tr key={`e-${j}`} className="entry-row">
                    <td /><td /><td />
                    <td className="entry-indent" colSpan={2}>
                      {Number(e.debit) > 0 ? `  ${String(e.ledger_name)} A/c Dr` : `  To ${String(e.ledger_name)} A/c`}
                      {e.narration ? <span className="entry-narration"> — {String(e.narration)}</span> : ''}
                    </td>
                    <td className="num dr">{Number(e.debit) > 0 ? rupee(e.debit) : ''}</td>
                    <td className="num cr">{Number(e.credit) > 0 ? rupee(e.credit) : ''}</td>
                  </tr>
                ))}
              </>
            ))}
            {!filtered.length && <tr><td colSpan={7} className="no-data">No entries found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Ledger Accounts ──────────────────────────────────────────────────────────
function LedgersView({ ledgers }: { ledgers: (Row & { statement: Row[] })[] }) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('All');
  const [selected, setSelected] = useState<(Row & { statement: Row[] }) | null>(null);

  const groups = ['All', ...Array.from(new Set(ledgers.map(l => String(l.group_name))))];
  const filtered = ledgers.filter(l => {
    const matchGroup = group === 'All' || l.group_name === group;
    const matchSearch = !search || String(l.name).toLowerCase().includes(search.toLowerCase());
    return matchGroup && matchSearch;
  });

  if (selected) return <OldLedgerStatement ledger={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="view-stack">
      <div className="view-toolbar">
        <h3>Ledger Accounts</h3>
        <div className="toolbar-right">
          <select value={group} onChange={e => setGroup(e.target.value)} className="select-input">
            {groups.map(g => <option key={g}>{g}</option>)}
          </select>
          <input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ledger…" />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ledger Name</th><th>Group</th><th>Phone</th><th className="num">Dr Balance</th><th className="num">Cr Balance</th><th /></tr></thead>
          <tbody>
            {filtered.map((l, i) => {
              const stmt = l.statement as Row[];
              const lastBal = stmt.length ? Number(stmt[stmt.length - 1].balance) : 0;
              return (
                <tr key={i} className="clickable-row" onClick={() => setSelected(l)}>
                  <td className="ledger-name">{String(l.name)}</td>
                  <td><span className={`group-tag group-${String(l.group_name).toLowerCase()}`}>{String(l.group_name)}</span></td>
                  <td>{l.phone ? String(l.phone) : <span className="muted">—</span>}</td>
                  <td className="num dr">{lastBal > 0 ? rupee(lastBal) : ''}</td>
                  <td className="num cr">{lastBal < 0 ? rupee(Math.abs(lastBal)) : ''}</td>
                  <td className="action-cell">View →</td>
                </tr>
              );
            })}
            {!filtered.length && <tr><td colSpan={6} className="no-data">No ledgers found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LedgerStatement({ ledger, onBack }: { ledger: Row & { statement: Row[] }; onBack: () => void }) {
  const allRows = ledger.statement as Row[];
  const openingRow = allRows[0] as Row | undefined;
  const txnRows = allRows.slice(1);
  const openingBal = openingRow ? num(openingRow.balance) : 0;
  const closingBal = allRows.length ? num(allRows[allRows.length - 1].balance) : 0;
  const debitEntries = [
    ...(openingRow && num(openingRow.debit) > 0 ? [{ opening: true as const, row: openingRow }] : []),
    ...txnRows.filter((row) => num(row.debit) > 0).map((row) => ({ row }))
  ];
  const creditEntries = [
    ...(openingRow && num(openingRow.credit) > 0 ? [{ opening: true as const, row: openingRow }] : []),
    ...txnRows.filter((row) => num(row.credit) > 0).map((row) => ({ row }))
  ];
  const maxRows = Math.max(debitEntries.length, creditEntries.length, 5);
  const totalDebit = debitEntries.reduce((sum, entry) => sum + num(entry.row.debit), 0);
  const totalCredit = creditEntries.reduce((sum, entry) => sum + num(entry.row.credit), 0);

  return (
    <div className="view-stack">
      <div className="view-toolbar">
        <button className="back-btn" onClick={onBack}>← Back to Ledgers</button>
        <div>
          <h3 style={{ margin: 0 }}>{String(ledger.name)}</h3>
          <span className={`group-tag group-${String(ledger.group_name).toLowerCase()}`}>{String(ledger.group_name)}</span>
        </div>
      </div>

      <div className="ledger-summary">
        <div className="ledger-summary-item">
          <span>Opening Balance</span>
          <strong className={openingBal >= 0 ? 'dr' : 'cr'}>
            {openingBal === 0 ? '₹0.00' : openingBal >= 0 ? `${rupee(openingBal)} Dr` : `${rupee(Math.abs(openingBal))} Cr`}
          </strong>
        </div>
        <div className="ledger-summary-item">
          <span>Closing Balance</span>
          <strong className={closingBal >= 0 ? 'dr' : 'cr'}>
            {closingBal >= 0 ? `${rupee(closingBal)} Dr` : `${rupee(Math.abs(closingBal))} Cr`}
          </strong>
        </div>
        <div className="ledger-summary-item">
          <span>Transactions</span>
          <strong>{txnRows.length}</strong>
        </div>
      </div>

      <div className="table-wrap">
        <table className="old-ledger-table">
          <thead>
            <tr>
              <th colSpan={4} className="ledger-side-title debit-title">Debit Side (Dr.)</th>
              <th colSpan={4} className="ledger-side-title credit-title">Credit Side (Cr.)</th>
            </tr>
            <tr>
              <th>Date</th><th>Particulars</th><th>Voucher</th><th className="num">Amount</th>
              <th>Date</th><th>Particulars</th><th>Voucher</th><th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {/* Opening Balance row — always first, styled distinctly */}
            {openingRow && (
              <tr className="opening-bal-row">
                <td>{openingRow.date ? dateText(openingRow.date) : <span className="muted">—</span>}</td>
                <td><span className="badge opening-badge">OB</span></td>
                <td><span className="type-tag type-opening">Opening</span></td>
                <td><strong>Opening Balance</strong></td>
                <td className="num dr"><strong>{Number(openingRow.debit) > 0 ? rupee(openingRow.debit) : ''}</strong></td>
                <td className="num cr"><strong>{Number(openingRow.credit) > 0 ? rupee(openingRow.credit) : ''}</strong></td>
                <td className={`num ${openingBal >= 0 ? 'dr' : 'cr'}`}>
                  <strong>{openingBal >= 0 ? `${rupee(openingBal)} Dr` : `${rupee(Math.abs(openingBal))} Cr`}</strong>
                </td>
              </tr>
            )}
            {/* Transaction rows */}
            {txnRows.map((row, i) => (
              <tr key={i}>
                <td>{dateText(row.date)}</td>
                <td><span className="badge">{String(row.voucherNo)}</span></td>
                <td><span className={`type-tag type-${String(row.type).toLowerCase().replace(' ', '-')}`}>{String(row.type)}</span></td>
                <td className="narration">{String(row.narration)}</td>
                <td className="num dr">{Number(row.debit) > 0 ? rupee(row.debit) : ''}</td>
                <td className="num cr">{Number(row.credit) > 0 ? rupee(row.credit) : ''}</td>
                <td className={`num ${Number(row.balance) >= 0 ? 'dr' : 'cr'}`}>
                  {Number(row.balance) >= 0 ? `${rupee(row.balance)} Dr` : `${rupee(Math.abs(Number(row.balance)))} Cr`}
                </td>
              </tr>
            ))}
            {!txnRows.length && (
              <tr><td colSpan={7} className="no-data">No transactions — only opening balance.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Lending (Lacha / Packa) ──────────────────────────────────────────────────
function OldLedgerStatement({ ledger, onBack }: { ledger: Row & { statement: Row[] }; onBack: () => void }) {
  const allRows = ledger.statement as Row[];
  const openingRow = allRows[0] as Row | undefined;
  const txnRows = allRows.slice(1);
  const openingBal = openingRow ? num(openingRow.balance) : 0;
  const closingBal = allRows.length ? num(allRows[allRows.length - 1].balance) : 0;
  const debitEntries = [
    ...(openingRow && num(openingRow.debit) > 0 ? [{ opening: true as const, row: openingRow }] : []),
    ...txnRows.filter((row) => num(row.debit) > 0).map((row) => ({ row }))
  ];
  const creditEntries = [
    ...(openingRow && num(openingRow.credit) > 0 ? [{ opening: true as const, row: openingRow }] : []),
    ...txnRows.filter((row) => num(row.credit) > 0).map((row) => ({ row }))
  ];
  const maxRows = Math.max(debitEntries.length, creditEntries.length, 5);
  const totalDebit = debitEntries.reduce((sum, entry) => sum + num(entry.row.debit), 0);
  const totalCredit = creditEntries.reduce((sum, entry) => sum + num(entry.row.credit), 0);

  return (
    <div className="view-stack">
      <div className="view-toolbar">
        <button className="back-btn" onClick={onBack}>Back to Ledgers</button>
        <div>
          <h3 style={{ margin: 0 }}>{String(ledger.name)} Ledger</h3>
          <span className={`group-tag group-${String(ledger.group_name).toLowerCase()}`}>{String(ledger.group_name)}</span>
        </div>
      </div>

      <div className="ledger-summary">
        <div className="ledger-summary-item"><span>Opening Balance</span><strong className={openingBal >= 0 ? 'dr' : 'cr'}>{openingBal === 0 ? rupee(0) : balanceText(openingBal)}</strong></div>
        <div className="ledger-summary-item"><span>Closing Balance</span><strong className={closingBal >= 0 ? 'dr' : 'cr'}>{balanceText(closingBal)}</strong></div>
        <div className="ledger-summary-item"><span>Transactions</span><strong>{txnRows.length}</strong></div>
      </div>

      <div className="table-wrap">
        <table className="old-ledger-table">
          <thead>
            <tr>
              <th colSpan={4} className="ledger-side-title debit-title">Debit Side (Dr.)</th>
              <th colSpan={4} className="ledger-side-title credit-title">Credit Side (Cr.)</th>
            </tr>
            <tr>
              <th>Date</th><th>Particulars</th><th>Voucher</th><th className="num">Amount</th>
              <th>Date</th><th>Particulars</th><th>Voucher</th><th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(debitEntries.length || creditEntries.length) ? Array.from({ length: maxRows }).map((_, index) => {
              const debit = debitEntries[index];
              const credit = creditEntries[index];
              const debitRow = debit?.row;
              const creditRow = credit?.row;
              const debitOpening = Boolean(debit && 'opening' in debit);
              const creditOpening = Boolean(credit && 'opening' in credit);
              return (
                <tr key={index}>
                  <td>{debitRow ? dateText(debitRow.date) : ''}</td>
                  <td>{debitOpening ? <strong>Opening Balance</strong> : String(debitRow?.narration || '')}</td>
                  <td>{debitRow ? <span className="badge">{String(debitRow.voucherNo || debitRow.type || '')}</span> : ''}</td>
                  <td className="num dr">{debitRow ? rupee(debitRow.debit) : ''}</td>
                  <td>{creditRow ? dateText(creditRow.date) : ''}</td>
                  <td>{creditOpening ? <strong>Opening Balance</strong> : String(creditRow?.narration || '')}</td>
                  <td>{creditRow ? <span className="badge">{String(creditRow.voucherNo || creditRow.type || '')}</span> : ''}</td>
                  <td className="num cr">{creditRow ? rupee(creditRow.credit) : ''}</td>
                </tr>
              );
            }) : <tr><td colSpan={8} className="no-data">No transactions or opening balance.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Debit Total</td>
              <td className="num">{rupee(totalDebit)}</td>
              <td colSpan={3}>Credit Total</td>
              <td className="num">{rupee(totalCredit)}</td>
            </tr>
            <tr>
              <td colSpan={6} className="balance-title">Closing Balance</td>
              <td colSpan={2} className={`num ${closingBal >= 0 ? 'dr' : 'cr'}`}>{balanceText(closingBal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function LendingView({ lending, loanAccounts, book }: { lending: Row[]; loanAccounts: (Row & { transactions: Row[] })[]; book: ReportBook }) {
  const [selected, setSelected] = useState<(Row & { transactions: Row[] }) | null>(null);
  const [search, setSearch] = useState('');

  const totalK = lending.reduce((s, r) => s + Number(r.kBalance), 0);
  const totalP = lending.reduce((s, r) => s + Number(r.pBalance), 0);
  const totalInterest = lending.reduce((s, r) => s + Number(r.interest), 0);
  const totalNet = lending.reduce((s, r) => s + Number(r.netBalance), 0);

  const filtered = lending.filter(r => !search || String(r.accountName).toLowerCase().includes(search.toLowerCase()));

  if (selected) {
    const txns = selected.transactions as Row[];
    const details = lending.find(l => l.accountId === selected.id);
    return (
      <div className="view-stack">
        <div className="view-toolbar">
          <button className="back-btn" onClick={() => setSelected(null)}>← Back to Lending</button>
          <div>
            <h3 style={{ margin: 0 }}>{String(selected.name)}</h3>
            <span className="muted">{String(selected.category)}{selected.phone ? ` · ${String(selected.phone)}` : ''}</span>
          </div>
        </div>
        {details && (
          <div className="ledger-summary">
            <div className="ledger-summary-item"><span>K (Lacha) Balance</span><strong className={Number(details.kBalance) >= 0 ? 'dr' : 'cr'}>{rupee(Math.abs(Number(details.kBalance)))} {Number(details.kBalance) >= 0 ? 'Dr' : 'Cr'}</strong></div>
            <div className="ledger-summary-item"><span>P (Packa) Balance</span><strong className={Number(details.pBalance) >= 0 ? 'dr' : 'cr'}>{rupee(Math.abs(Number(details.pBalance)))} {Number(details.pBalance) >= 0 ? 'Dr' : 'Cr'}</strong></div>
            <div className="ledger-summary-item"><span>Accrued Interest</span><strong className="accent">{rupee(details.interest)}</strong></div>
            <div className="ledger-summary-item"><span>Net Balance</span><strong className={Number(details.netBalance) >= 0 ? 'dr' : 'cr'}>{rupee(Math.abs(Number(details.netBalance)))} {Number(details.netBalance) >= 0 ? 'Dr' : 'Cr'}</strong></div>
          </div>
        )}
        <LoanAccountFolio account={selected} rows={txns} book={book} />
      </div>
    );
  }

  return (
    <div className="view-stack">
      <div className="view-toolbar">
        <h3>Lacha / Packa (Lending) Summary</h3>
        <input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search account…" />
      </div>

      <div className="lending-totals">
        <div className="lending-total-card"><span>Total K (Lacha)</span><strong className="dr">{rupee(totalK)}</strong></div>
        <div className="lending-total-card"><span>Total P (Packa)</span><strong className="dr">{rupee(totalP)}</strong></div>
        <div className="lending-total-card"><span>Accrued Interest</span><strong className="accent">{rupee(totalInterest)}</strong></div>
        <div className="lending-total-card highlight"><span>Grand Total</span><strong className="dr">{rupee(totalNet)}</strong></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Account Name</th><th>Category</th><th>Phone</th><th className="num">K (Lacha)</th><th className="num">P (Packa)</th><th className="num">Interest</th><th className="num">Net Balance</th><th /></tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const acct = loanAccounts.find(a => a.id === r.accountId);
              return (
                <tr key={i} className={acct ? 'clickable-row' : ''} onClick={() => acct && setSelected(acct)}>
                  <td className="ledger-name">{String(r.accountName)}</td>
                  <td><span className="badge">{String(r.category)}</span></td>
                  <td>{r.phone ? String(r.phone) : <span className="muted">—</span>}</td>
                  <td className={`num ${Number(r.kBalance) >= 0 ? 'dr' : 'cr'}`}>{rupee(Math.abs(Number(r.kBalance)))} {Number(r.kBalance) >= 0 ? 'Dr' : 'Cr'}</td>
                  <td className={`num ${Number(r.pBalance) >= 0 ? 'dr' : 'cr'}`}>{rupee(Math.abs(Number(r.pBalance)))} {Number(r.pBalance) >= 0 ? 'Dr' : 'Cr'}</td>
                  <td className="num accent">{rupee(r.interest)}</td>
                  <td className={`num ${Number(r.netBalance) >= 0 ? 'dr' : 'cr'}`}><strong>{rupee(Math.abs(Number(r.netBalance)))} {Number(r.netBalance) >= 0 ? 'Dr' : 'Cr'}</strong></td>
                  <td className="action-cell">{acct ? 'View →' : ''}</td>
                </tr>
              );
            })}
            {!filtered.length && <tr><td colSpan={8} className="no-data">No accounts found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────
function LoanAccountFolio({ account, rows, book }: { account: Row; rows: Row[]; book: ReportBook }) {
  const openingSigned = loanOpening(account, book);
  const openingBalance = Math.abs(openingSigned);
  const openingType = openingSigned < 0 ? 'Cr' : 'Dr';
  const openingDate = String(account.openingDate ?? account.opening_date ?? '');
  const defaultRate = num(account.defaultRate ?? account.default_rate);
  const openingDays = (() => {
    if (!openingDate) return 0;
    const [fromYear, fromMonth, fromDay] = openingDate.split('-').map(Number);
    const now = new Date();
    const diff = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000);
    return Number.isFinite(diff) && diff > 0 ? diff : 0;
  })();
  const openingInterest = openingBalance * defaultRate / 100 / 30 * openingDays * (openingType === 'Cr' ? -1 : 1);
  const visibleRows = rows.filter((row) => book === 'Combined' || row.book === book);
  const debitRows = visibleRows.filter((row) => row.side === 'Dr').sort((a, b) => `${a.date}-${a.id ?? 0}`.localeCompare(`${b.date}-${b.id ?? 0}`));
  const creditRows = visibleRows.filter((row) => row.side === 'Cr').sort((a, b) => `${a.date}-${a.id ?? 0}`.localeCompare(`${b.date}-${b.id ?? 0}`));
  const debitEntries = [...(openingBalance > 0 && openingType === 'Dr' ? [{ opening: true as const }] : []), ...debitRows.map((row) => ({ row }))];
  const creditEntries = [...(openingBalance > 0 && openingType === 'Cr' ? [{ opening: true as const }] : []), ...creditRows.map((row) => ({ row }))];
  const debitTotal = debitRows.reduce((sum, row) => sum + num(row.amount), openingType === 'Dr' ? openingBalance : 0);
  const creditTotal = creditRows.reduce((sum, row) => sum + num(row.amount), openingType === 'Cr' ? openingBalance : 0);
  const interest = openingInterest + visibleRows.reduce((sum, row) => sum + num(row.interest), 0);
  const closingBalance = debitTotal - creditTotal;
  const maxRows = Math.max(debitEntries.length, creditEntries.length, 5);
  const title = book === 'Combined' ? 'Account Ledger' : `${bookLabel(book)} Ledger`;

  return (
    <section className="book-ledger">
      <div className="book-ledger-title">
        <h3>{title}</h3>
        <span>{balanceText(closingBalance)}</span>
      </div>
      <div className="table-wrap">
        <table className="old-ledger-table">
          <thead>
            <tr>
              <th colSpan={4} className="ledger-side-title debit-title">Debit Side (Dr.)</th>
              <th colSpan={4} className="ledger-side-title credit-title">Credit Side (Cr.)</th>
            </tr>
            <tr>
              <th>Date</th><th>Particulars</th><th className="num">Amount</th><th className="num">Interest</th>
              <th>Date</th><th>Particulars</th><th className="num">Amount</th><th className="num">Interest</th>
            </tr>
          </thead>
          <tbody>
            {(visibleRows.length || openingBalance > 0) ? Array.from({ length: maxRows }).map((_, index) => {
              const debitEntry = debitEntries[index];
              const creditEntry = creditEntries[index];
              const debit = debitEntry && 'row' in debitEntry ? debitEntry.row : undefined;
              const credit = creditEntry && 'row' in creditEntry ? creditEntry.row : undefined;
              const debitOpening = Boolean(debitEntry && 'opening' in debitEntry);
              const creditOpening = Boolean(creditEntry && 'opening' in creditEntry);
              return (
                <tr key={index}>
                  <td>{debitOpening ? dateText(openingDate) : dateText(debit?.date)}</td>
                  <td>{debitOpening ? <strong>Opening Balance</strong> : String(debit?.counterLedgerName ?? debit?.counter_name ?? '')}</td>
                  <td className="num">{debitOpening ? rupee(openingBalance) : debit ? rupee(debit.amount) : ''}</td>
                  <td className="num">{debitOpening ? rupee(Math.abs(openingInterest)) : debit ? rupee(debit.interest) : ''}</td>
                  <td>{creditOpening ? dateText(openingDate) : dateText(credit?.date)}</td>
                  <td>{creditOpening ? <strong>Opening Balance</strong> : String(credit?.counterLedgerName ?? credit?.counter_name ?? '')}</td>
                  <td className="num">{creditOpening ? rupee(openingBalance) : credit ? rupee(credit.amount) : ''}</td>
                  <td className="num">{creditOpening ? rupee(Math.abs(openingInterest)) : credit ? rupee(Math.abs(num(credit.interest))) : ''}</td>
                </tr>
              );
            }) : <tr><td colSpan={8} className="no-data">No {bookLabel(book)} transactions yet.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Debit Total</td>
              <td className="num">{rupee(debitTotal)}</td>
              <td className="num">{rupee(Math.max(interest, 0))}</td>
              <td colSpan={2}>Credit Total</td>
              <td className="num">{rupee(creditTotal)}</td>
              <td className="num">{rupee(Math.abs(Math.min(interest, 0)))}</td>
            </tr>
            <tr>
              <td colSpan={6} className="balance-title">{title} Closing Balance</td>
              <td colSpan={2} className={`num ${closingBalance >= 0 ? 'dr' : 'cr'}`}>{balanceText(closingBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function MetricCard({ label, value, color, icon, wide }: { label: string; value: string; color: string; icon: string; wide?: boolean }) {
  return (
    <div className={`metric-card metric-${color} ${wide ? 'metric-wide' : ''}`}>
      <div className="metric-icon">{icon}</div>
      <div className="metric-content">
        <span className="metric-label">{label}</span>
        <strong className="metric-value">{value}</strong>
      </div>
    </div>
  );
}
