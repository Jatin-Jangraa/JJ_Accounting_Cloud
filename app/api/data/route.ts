import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, dbPath, readMeta, verifyPassword } from '../cloud-auth';

export const runtime = 'nodejs';

const round = (v: number) => Number((Number(v || 0)).toFixed(2));
const today = () => new Date().toISOString().slice(0, 10);

/** Load sql.js database from file */
async function openDb(filePath: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const initSqlJs = require('sql.js');
  // Use the public folder for the wasm file since Vercel strips binary files
  // from node_modules during serverless bundling.
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.join(process.cwd(), 'public', file),
  });
  const buf = fs.readFileSync(filePath);
  return new SQL.Database(buf);
}

type Row = Record<string, unknown>;
type ReportBook = 'Combined' | 'K' | 'P';

function all(db: any, sql: string, params: Record<string, unknown> = {}): Row[] {
  try {
    const keys: string[] = [];
    const vals: unknown[] = [];
    const prepared = sql.replace(/@(\w+)/g, (_, k) => {
      keys.push(k);
      vals.push(params[k] ?? null);
      return '?';
    });
    const [result] = db.exec(prepared, vals.length ? vals : undefined);
    if (!result) return [];
    return result.values.map((row: any) => {
      const obj: Row = {};
      result.columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });
      return obj;
    });
  } catch {
    return [];
  }
}

function one(db: any, sql: string, params: Record<string, unknown> = {}): Row | null {
  try {
    const keys: string[] = [];
    const vals: unknown[] = [];
    const prepared = sql.replace(/@(\w+)/g, (_, k) => {
      keys.push(k);
      vals.push(params[k] ?? null);
      return '?';
    });
    const [result] = db.exec(prepared, vals.length ? vals : undefined);
    if (!result?.values?.length) return null;
    const obj: Row = {};
    result.columns.forEach((col: string, i: number) => {
      obj[col] = result.values[0][i];
    });
    return obj;
  } catch {
    return null;
  }
}

function scalar(db: any, sql: string, params: Record<string, unknown> = {}): number {
  try {
    const keys: string[] = [];
    const vals: unknown[] = [];
    const prepared = sql.replace(/@(\w+)/g, (_, k) => {
      keys.push(k);
      vals.push(params[k] ?? null);
      return '?';
    });
    const [result] = db.exec(prepared, vals.length ? vals : undefined);
    return round(Number(result?.values?.[0]?.[0] ?? 0));
  } catch {
    return 0;
  }
}

function tableExists(db: any, table: string): boolean {
  try {
    const [r] = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table.replace(/'/g, "''")}'`);
    return Boolean(r?.values?.length);
  } catch {
    return false;
  }
}

/** Compute trial balance / ledger balances */
function ledgerBalances(db: any, book: string): Row[] {
  const bookFilter = book && book !== 'Combined' ? book : null;
  const rows = all(db, `
    SELECT l.id ledger_id, l.name ledger_name, l.group_name, l.party_type, l.is_system,
      la.id loan_id, la.category loan_category,
      CASE
        WHEN la.id IS NULL THEN CASE WHEN @book IS NULL THEN l.opening_balance * CASE WHEN l.opening_type='Cr' THEN -1 ELSE 1 END ELSE 0 END
        WHEN @book='K' THEN la.opening_k_balance * CASE WHEN la.opening_k_type='Cr' THEN -1 ELSE 1 END
        WHEN @book='P' THEN la.opening_p_balance * CASE WHEN la.opening_p_type='Cr' THEN -1 ELSE 1 END
        ELSE la.opening_k_balance * CASE WHEN la.opening_k_type='Cr' THEN -1 ELSE 1 END
           + la.opening_p_balance * CASE WHEN la.opening_p_type='Cr' THEN -1 ELSE 1 END
      END opening_signed,
      COALESCE(SUM(CASE WHEN v.id IS NULL THEN 0 ELSE ve.debit END),0) debit_total,
      COALESCE(SUM(CASE WHEN v.id IS NULL THEN 0 ELSE ve.credit END),0) credit_total
    FROM ledgers l
    LEFT JOIN loan_accounts la ON la.ledger_id=l.id
    LEFT JOIN voucher_entries ve ON ve.ledger_id=l.id AND ve.balance_bd_id IS NULL
    LEFT JOIN vouchers v ON v.id=ve.voucher_id
      AND (@book IS NULL OR EXISTS (SELECT 1 FROM loan_transactions lt WHERE lt.voucher_id=v.id AND lt.book=@book))
    GROUP BY l.id
    ORDER BY l.name
  `, { book: bookFilter });

  return rows.map((row) => {
    const opening = Number(row.opening_signed || 0);
    const balance = opening + Number(row.debit_total || 0) - Number(row.credit_total || 0);
    return {
      ledgerId: row.ledger_id,
      ledgerName: row.ledger_name,
      groupName: row.group_name,
      partyType: row.party_type,
      isSystem: Boolean(row.is_system),
      isLoanAccount: row.loan_id !== null && row.loan_id !== undefined,
      loanAccountCategory: row.loan_category ?? null,
      debit: balance >= 0 ? round(balance) : 0,
      credit: balance < 0 ? round(Math.abs(balance)) : 0,
    };
  });
}

function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const start = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const end = Date.UTC(toYear, toMonth - 1, toDay);
  const diff = Math.floor((end - start) / 86_400_000);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

function loanInterest(row: Row, asOf: string): number {
  if (Number(row.account_default_rate) === 0) return 0;
  const days = daysBetween(String(row.date || ''), asOf);
  const interest = Number(row.amount || 0) * (Number(row.monthly_rate || 0) / 100) / 30 * days;
  return round(row.side === 'Dr' ? interest : -interest);
}

/** Lending summary (Khacha/Packa) */
function lendingSummary(db: any, book: string): Row[] {
  const asOf = today();
  const bookFilter = book && book !== 'Combined' ? book : null;
  const accounts = all(db, 'SELECT * FROM loan_accounts ORDER BY name');
  return accounts.map((account) => {
    const txns = all(db, `
      SELECT t.*, a.default_rate account_default_rate FROM loan_transactions t
      JOIN loan_accounts a ON a.id=t.account_id
      WHERE t.account_id=@id AND t.balance_bd_id IS NULL
        AND (@book IS NULL OR t.book=@book)
      ORDER BY t.date, t.id
    `, { id: account.id, book: bookFilter }).map((t) => ({
      id: Number(t.id),
      amount: Number(t.amount),
      monthly_rate: Number(t.monthly_rate),
      side: String(t.side || ''),
      book: String(t.book || ''),
      date: String(t.date || ''),
      interest_amount: Number(t.interest_amount || 0),
      account_default_rate: Number(t.account_default_rate || account.default_rate || 0)
    }));

    let kBalance = bookFilter === 'P' ? 0 : Number(account.opening_k_balance || 0) * (account.opening_k_type === 'Cr' ? -1 : 1);
    let pBalance = bookFilter === 'K' ? 0 : Number(account.opening_p_balance || 0) * (account.opening_p_type === 'Cr' ? -1 : 1);
    let interest = 0;

    for (const row of txns) {
      const signed = row.side === 'Dr' ? row.amount : -row.amount;
      if (row.book === 'K') kBalance += signed;
      else pBalance += signed;

      interest += loanInterest(row, asOf);
    }
    const totalBalance = round(kBalance + pBalance);
    const netInterest = round(interest);
    return {
      accountId: account.id,
      accountName: account.name,
      category: account.category,
      phone: account.phone,
      kBalance: round(kBalance),
      pBalance: round(pBalance),
      totalBalance,
      interest: netInterest,
      netBalance: round(totalBalance + netInterest),
    };
  });
}

/** Vouchers with their entries */
function listVouchers(db: any, book: string, limit = 500): Row[] {
  const bookFilter = book && book !== 'Combined' ? book : null;
  const vouchers = all(db, `
    SELECT v.*, l.name party_name FROM vouchers v
    LEFT JOIN ledgers l ON l.id=v.party_ledger_id
    WHERE (@book IS NULL OR EXISTS (SELECT 1 FROM loan_transactions lt WHERE lt.voucher_id=v.id AND lt.book=@book))
    ORDER BY v.date DESC, v.id DESC
    LIMIT ${limit}
  `, { book: bookFilter });
  return vouchers.map((v) => {
    const entries = all(db, `
      SELECT ve.*, l.name ledger_name FROM voucher_entries ve
      JOIN ledgers l ON l.id=ve.ledger_id
      WHERE ve.voucher_id=@id ORDER BY ve.id
    `, { id: v.id });
    return { ...v, entries };
  });
}

/** Ledger statement */
function ledgerStatement(db: any, ledgerId: number, book: string): Row[] {
  const bookFilter = book && book !== 'Combined' ? book : null;
  const ledgerInfo = one(db, `
    SELECT l.opening_balance, l.opening_type, la.id loan_id,
      la.opening_k_balance, la.opening_k_type,
      la.opening_p_balance, la.opening_p_type,
      la.opening_date loan_opening_date
    FROM ledgers l
    LEFT JOIN loan_accounts la ON la.ledger_id=l.id
    WHERE l.id=@id
  `, { id: ledgerId });

  let openingSigned = 0;
  let openingDate = '';

  if (ledgerInfo) {
    openingDate = String(ledgerInfo.loan_opening_date || '');
    const hasLoan = ledgerInfo.loan_id !== null && ledgerInfo.loan_id !== undefined;
    if (!hasLoan) {
      if (bookFilter === null) {
        openingSigned = Number(ledgerInfo.opening_balance || 0) * (ledgerInfo.opening_type === 'Cr' ? -1 : 1);
      } else {
        openingSigned = 0;
      }
    } else {
      const kOpening = Number(ledgerInfo.opening_k_balance || 0) * (ledgerInfo.opening_k_type === 'Cr' ? -1 : 1);
      const pOpening = Number(ledgerInfo.opening_p_balance || 0) * (ledgerInfo.opening_p_type === 'Cr' ? -1 : 1);
      if (bookFilter === 'K') {
        openingSigned = kOpening;
      } else if (bookFilter === 'P') {
        openingSigned = pOpening;
      } else {
        openingSigned = kOpening + pOpening;
      }
    }
  }

  const rows = all(db, `
    SELECT v.date, v.voucher_no, v.type, COALESCE(ve.narration, v.narration) narration, ve.debit, ve.credit
    FROM voucher_entries ve
    JOIN vouchers v ON v.id=ve.voucher_id
    WHERE ve.ledger_id=@ledgerId AND ve.balance_bd_id IS NULL
      AND (@book IS NULL OR EXISTS (SELECT 1 FROM loan_transactions lt WHERE lt.voucher_id=v.id AND lt.book=@book))
    ORDER BY v.date, v.id
  `, { ledgerId, book: bookFilter });

  const openingRow = {
    date: openingDate || '',
    voucherNo: '—',
    type: 'Opening',
    narration: 'Opening Balance',
    debit: openingSigned >= 0 ? Math.abs(openingSigned) : 0,
    credit: openingSigned < 0 ? Math.abs(openingSigned) : 0,
    balance: openingSigned,
  };

  let balance = openingSigned;
  const stmtRows = rows.map((row) => {
    balance += Number(row.debit) - Number(row.credit);
    return {
      date: row.date,
      voucherNo: row.voucher_no,
      type: row.type,
      narration: row.narration,
      debit: round(Number(row.debit)),
      credit: round(Number(row.credit)),
      balance: round(balance),
    };
  });

  return [openingRow, ...stmtRows];
}

function mapLoanAccountForWeb(db: any, account: Row, book: ReportBook): Row {
  const bookFilter = book && book !== 'Combined' ? book : null;
  const asOf = today();
  const transactions = all(db, `
    SELECT t.*, a.default_rate account_default_rate, cl.name counter_name, cl.name counter_ledger_name
    FROM loan_transactions t
    JOIN loan_accounts a ON a.id=t.account_id
    LEFT JOIN ledgers cl ON cl.id=t.counter_ledger_id
    WHERE t.account_id=@id AND t.balance_bd_id IS NULL
      AND (@book IS NULL OR t.book=@book)
    ORDER BY t.date, t.id
    LIMIT 500
  `, { id: account.id, book: bookFilter }).map((transaction) => {
    const interest = loanInterest(transaction, asOf);
    return {
      ...transaction,
      accountId: transaction.account_id,
      accountName: account.name,
      counterLedgerId: transaction.counter_ledger_id,
      counterLedgerName: transaction.counter_ledger_name,
      interestLedgerId: transaction.interest_ledger_id,
      monthlyRate: transaction.monthly_rate,
      interestAmount: transaction.interest_amount,
      days: daysBetween(String(transaction.date || ''), asOf),
      interest
    };
  });

  return {
    ...account,
    ledgerId: account.ledger_id,
    ledgerName: account.ledger_name,
    defaultRate: account.default_rate,
    openingKBalance: account.opening_k_balance,
    openingKType: account.opening_k_type,
    openingPBalance: account.opening_p_balance,
    openingPType: account.opening_p_type,
    openingDate: account.opening_date,
    transactions,
  };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const meta = readMeta();
  const password = bearerToken(request.headers.get('authorization'));

  if (!meta.passwordHash)
    return NextResponse.json({ error: 'Sync from the desktop app first.' }, { status: 401 });
  if (!password || !verifyPassword(password, meta))
    return NextResponse.json({ error: 'Invalid website password.' }, { status: 401 });
  if (!fs.existsSync(dbPath))
    return NextResponse.json({ error: 'No database synced yet.' }, { status: 404 });

  const { searchParams } = request.nextUrl;
  const book = searchParams.get('book') || 'Combined';

  let db: any = null;
  try {
    db = await openDb(dbPath);

    const company = tableExists(db, 'company')
      ? (one(db, 'SELECT * FROM company ORDER BY id LIMIT 1') ?? null)
      : null;

    // Trial balance (filtered by book)
    const trialBalance = ledgerBalances(db, book);

    // Dynamic P&L Interest computation
    const loanAccountsList = tableExists(db, 'loan_accounts') ? all(db, 'SELECT * FROM loan_accounts') : [];
    const interestReceivable: Row[] = [];
    const interestPayable: Row[] = [];
    const asOf = today();

    for (const account of loanAccountsList) {
      const allRows = all(db, `
        SELECT t.*, a.name account_name, a.default_rate account_default_rate, c.name counter_ledger_name
        FROM loan_transactions t
        JOIN loan_accounts a ON a.id=t.account_id
        JOIN ledgers c ON c.id=t.counter_ledger_id
        WHERE t.account_id=@id AND t.balance_bd_id IS NULL
      `, { id: account.id });

      const kOpening = Number(account.opening_k_balance || 0) * (account.opening_k_type === 'Cr' ? -1 : 1);
      const pOpening = Number(account.opening_p_balance || 0) * (account.opening_p_type === 'Cr' ? -1 : 1);
      let kBal = kOpening;
      let pBal = pOpening;
      for (const r of allRows) {
        const signed = r.side === 'Dr' ? Number(r.amount) : -Number(r.amount);
        if (r.book === 'K') kBal += signed;
        else pBal += signed;
      }

      const openingDays = daysBetween(String(account.opening_date || today()), asOf);
      const kOpeningInterest = Math.abs(kOpening) * (Number(account.default_rate) || 0) / 100 / 30 * openingDays * (kOpening >= 0 ? 1 : -1);
      const pOpeningInterest = Math.abs(pOpening) * (Number(account.default_rate) || 0) / 100 / 30 * openingDays * (pOpening >= 0 ? 1 : -1);

      let kInterest = round(kOpeningInterest);
      let pInterest = round(pOpeningInterest);

      for (const r of allRows) {
        if (Number(r.account_default_rate) === 0) continue;
        const days = daysBetween(String(r.date), asOf);
        const interestVal = Number(r.amount || 0) * (Number(r.monthly_rate || 0) / 100) / 30 * days;
        const signedInterest = r.side === 'Dr' ? interestVal : -interestVal;
        if (r.book === 'K') kInterest += signedInterest;
        else pInterest += signedInterest;
      }

      let effectiveKBal = book === 'P' ? 0 : kBal;
      let effectivePBal = book === 'K' ? 0 : pBal;
      let effectiveKInt = book === 'P' ? 0 : kInterest;
      let effectivePInt = book === 'K' ? 0 : pInterest;

      const totalBalance = round(effectiveKBal + effectivePBal);
      const totalInterest = round(effectiveKInt + effectivePInt);

      if (Math.abs(totalInterest) < 0.005) continue;

      const row = {
        accountId: account.id,
        accountName: account.name,
        category: account.category ?? 'Debtors',
        kBalance: round(effectiveKBal),
        pBalance: round(effectivePBal),
        totalBalance,
        kInterest: round(effectiveKInt),
        pInterest: round(effectivePInt),
        totalInterest
      };

      if (totalBalance > 0) {
        interestReceivable.push(row);
      } else if (totalBalance < 0) {
        interestPayable.push({
          ...row,
          totalInterest: Math.abs(totalInterest),
          kInterest: Math.abs(round(effectiveKInt)),
          pInterest: Math.abs(round(effectivePInt))
        });
      }
    }

    const totalInterestReceivable = interestReceivable.reduce((s, r) => s + Number(r.totalInterest || 0), 0);
    const totalInterestPayable = interestPayable.reduce((s, r) => s + Number(r.totalInterest || 0), 0);

    // P&L
    const incomeRows = trialBalance.filter((r) => r.groupName === 'Income');
    const expenseRows = trialBalance.filter((r) => r.groupName === 'Expenses');
    const totalIncome = incomeRows.reduce((s, r) => s + Number(r.credit) - Number(r.debit), 0) + totalInterestReceivable;
    const totalExpenses = expenseRows.reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0) + totalInterestPayable;
    const profitLoss = round(totalIncome - totalExpenses);

    // Balance sheet
    const balanceSheet = trialBalance;

    // Dashboard
    const totalSales = scalar(db, "SELECT COALESCE(SUM(grand_total),0) FROM invoices WHERE type='Sales'");
    const totalPurchases = scalar(db, "SELECT COALESCE(SUM(grand_total),0) FROM invoices WHERE type='Purchase'");
    const cashRow = trialBalance.find((r) => String(r.ledgerName).toLowerCase() === 'cash');
    const bankRow = trialBalance.find((r) => String(r.ledgerName).toLowerCase() === 'bank');

    // Ledgers with statements
    const ledgers = all(db, `
      SELECT id, name, group_name, opening_balance, opening_type, party_type, phone, email, address
      FROM ledgers ORDER BY name
    `).map((l) => ({
      ...l,
      statement: ledgerStatement(db!, Number(l.id), book),
    }));

    // Vouchers (filtered by book)
    const vouchers = listVouchers(db, book, 300);

    // Lending (Lacha/Packa)
    const lending = tableExists(db, 'loan_accounts') ? lendingSummary(db, book) : [];

    // Loan accounts with their transactions (filtered by book)
    const loanAccounts = tableExists(db, 'loan_accounts') ? all(db, `
      SELECT a.*, l.name ledger_name FROM loan_accounts a
      LEFT JOIN ledgers l ON l.id=a.ledger_id
      ORDER BY a.name
    `).map((a) => mapLoanAccountForWeb(db!, a, book as ReportBook)) : [];

    // Records (balance BD history)
    const records = tableExists(db, 'balance_bd_history') ? all(db, `
      SELECT h.*, a.name account_name FROM balance_bd_history h
      LEFT JOIN loan_accounts a ON a.id=h.loan_account_id
      ORDER BY h.date DESC, h.id DESC
    `) : [];

    return NextResponse.json({
      company,
      uploadedAt: meta.uploadedAt ?? null,
      dashboard: {
        totalSales,
        totalPurchases,
        cashBalance: cashRow ? Number(cashRow.debit) - Number(cashRow.credit) : 0,
        bankBalance: bankRow ? Number(bankRow.debit) - Number(bankRow.credit) : 0,
        profitLoss,
        totalIncome: round(totalIncome),
        totalExpenses: round(totalExpenses),
        receivables: round(trialBalance.filter(r => r.groupName === 'Assets' && Number(r.debit) > 0).reduce((s, r) => s + Number(r.debit), 0)),
        payables: round(trialBalance.filter(r => r.groupName === 'Liabilities' && Number(r.credit) > 0).reduce((s, r) => s + Number(r.credit), 0)),
      },
      trialBalance,
      incomeRows,
      expenseRows,
      interestReceivable,
      interestPayable,
      profitLoss,
      balanceSheet,
      ledgers,
      vouchers,
      lending,
      loanAccounts,
      records,
    });
  } catch (error: any) {
    console.error('[/api/data]', error);
    return NextResponse.json({ error: error.message || 'Internal error.' }, { status: 500 });
  } finally {
    db?.close();
  }
}
