# Press & Paper

A React + TypeScript printing-shop POS with Supabase Auth, PostgreSQL persistence, shop-scoped permissions, and printable invoice PDFs. The supplied HTML prototype informed the navigation, navy sidebar, white panels, compact tables, and mobile layouts. Its sample actions and data are not used in production.

## Local development

Requires Node 22.12+ and npm. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

```sh
npm ci
cp .env.example .env.local
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local
npm run dev
```

The frontend needs only the project URL and anon/publishable key. **Never put a service-role key in any `VITE_` variable.** Without credentials, the login page offers a clearly labeled, fictional in-memory demo. Demo changes disappear on reload and never enter Supabase.

## Supabase setup

1. Create a Supabase project. Apply both SQL files in `supabase/migrations/` in filename order using the SQL editor, or install the Supabase CLI, run `supabase login`, `supabase link --project-ref YOUR_REF`, and `supabase db push`. Existing installations only need the new `202610220002_admin_staff_passwords.sql`; do not rerun the initial migration or bootstrap.
2. In Authentication settings, disable **Allow new users to sign up**. Set the Site URL to the app's exact URL and allow that URL as an authentication redirect. Configure a strong password policy and enable leaked password protection if available for your plan. SMTP is not needed for administrator-created staff accounts.
3. Create the first administrator in Authentication → Users using a secure password or the dashboard invitation flow. Copy the Auth user UUID. Edit `supabase/bootstrap.sql` with that UUID and email, then run it in the trusted SQL editor. It creates the first shop, administrator membership, settings, sequence, and expense categories. Do not bootstrap an already provisioned user twice. No fictional records are added.
4. Copy the project URL and anon/publishable key to `.env.local`. Restart Vite after changing environment variables. Sign in, configure shop details, add customers/products, then record opening inventory using **Stock adjustment**.
5. Deploy the staff management function:

On Windows, the helper reads the project reference from your frontend environment, prompts for Supabase CLI login, sets the allowed origin, deploys without Docker, and checks the live CORS response:

```powershell
cd C:\codes\PrintingshopPOS
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-staff.ps1
```

If your browser address uses `localhost` instead of `127.0.0.1`, append `-AppUrl http://localhost:5173`. Use `-SkipLogin` if the CLI is already authenticated, or `-DryRun` to validate local configuration without deploying. You still need to apply the staff SQL migration separately. This uses the official [Supabase CLI deployment](https://supabase.com/docs/reference/cli/supabase-functions-serve) flow with server-side bundling.

Equivalent CLI commands after authenticating and linking your project:

```sh
supabase secrets set APP_URL=https://your-app.example
supabase functions deploy manage-staff --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the Edge Functions runtime. The function validates the caller with `auth.getUser`, checks active administrator membership and the target's shop, validates the origin, and provisions membership through a service-only RPC. JWT verification is done explicitly in the function. For this local app, use `supabase secrets set APP_URL=http://127.0.0.1:5173` if you open that address; use `http://localhost:5173` instead if that is the address you use. The configured origin must match the browser address exactly. Invoice sharing uses native file sharing or a PDF download; invoice email delivery is not implemented.

The former `invite-staff` function remains as legacy source but is no longer used by the app. Existing invited users can have a password set by an administrator from the team list. Account creation uses Supabase's server-only [createUser with email_confirm](https://supabase.com/docs/reference/javascript/auth-admin-createuser), so no confirmation email is sent. Password changes use [updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).

## Administrator-managed passwords

- **User management → Add user:** enter name, email/login, role, password, and confirmation. The account can sign in immediately. Existing email addresses are rejected; creating an account never overwrites or adopts another Auth identity.
- **Set password:** an active administrator can replace a shop member's password, including their own. Minimum 12 characters, maximum 72 UTF-8 bytes, plus any stricter Supabase project password policy. Passwords cannot be viewed, recovered from the database, or cleared to an empty value. No password is saved to profiles, audit logs, or demo data.
- **Deactivate:** revokes shop-data access immediately through RLS, preserving historical records. It does not delete a password or financial history.
- The staff endpoint enforces active administrator status and same-shop membership server-side. Password change intent/completion/failure is audited without password contents. If provisioning fails, only a newly created identity without a profile is eligible for rollback; uncertain outcomes are reported for operator reconciliation.
- The app has no self-service password change or email-recovery form. **This is an app-level management policy:** Supabase's [authenticated account-owner updateUser API](https://supabase.com/docs/reference/javascript/auth-updateuser) can still change an account's own password outside this UI. Absolute prevention of that API requires a different authentication architecture or supported upstream restriction; this implementation does not claim to block it. An owner who loses all administrator access must recover it through the trusted Supabase dashboard.

For an additional shop, repeat bootstrap with another Auth user. Each user currently has one shop membership; data and foreign keys are scoped by `shop_id` throughout.

## Workflows and accounting rules

- **POS:** select catalog or custom lines, customer/walk-in, prices, quantities, discount, tax, and Cash/GCash/bank transfer/credit. Immediate methods record full collection. Credit requires a customer. Every completed order receives an invoice and receipt PDF.
- **Invoices:** save a draft or issue immediately. Drafts receive a number but do not affect revenue or stock; issue them from their detail screen. Issued line items, customer billing details, prices, terms, and business settings are immutable snapshots. Draft correction uses void-and-recreate to preserve history.
- **Totals:** round each line to PHP cents, subtract the absolute PHP discount, then round tax on the discounted subtotal. Tax defaults to 0%; no VAT registration is assumed. Quantity supports 3 decimals, money 2. Prices are tax-exclusive.
- **Collections:** the append-only payment ledger is allocated to invoices only. Partial payments and multiple methods are supported. Revenue reports use completed sales; collection reports use payment dates. They are not added together. Invoice summaries display collections on the invoices issued within the selected period, even when collected later. Dates use Asia/Manila.
- **Status:** draft/void are explicit; paid, partially paid, pending, and overdue are derived at read time from the ledger and Manila due date. An unpaid or partially paid invoice becomes overdue after its due date even without a new transaction. The stored status is also refreshed on payment. A zero-total issued invoice is paid.
- **Stock:** aggregate duplicate product lines, lock products in stable order, validate stock, deduct it, and append stock movements in the same transaction. Services do not deduct stock. Catalog edits cannot directly change quantity or tracking mode. Manual stock changes require a reason. Voiding an unpaid issued invoice returns its stock transactionally; drafts have no stock to return.
- **Financial history:** no client DELETE grants. Unpaid invoices can be voided by Administrator/Accountant with a reason. Invoices with payments cannot be voided; refunds/credit notes require a separate accounting process (not implemented). Expense edits retain financial before/after values in audit logs; void expenses rather than deleting them. Original receipts are kept outside the app and referenced by receipt number; file uploads are not implemented.
- **PDFs:** include billing and business details, itemized charges, discount/tax, totals, payment history, balance, notes and terms. The creation form, invoice detail, and export use the current saved business name, address, email, phone, logo, and accent color, including reprints of older invoices. Original business snapshots remain stored for history; saved customer billing, line prices, totals, tax, and invoice terms are preserved. Upload a PNG/JPEG logo (up to 500 KB) and save Settings before creating/exporting; saving waits for logo processing to finish. Removing a logo also removes it from future exports of older invoices. Standard PDF fonts use `PHP` for currency to avoid missing peso glyphs.
- **Scale:** the app fetches shop data in server-sized pages and incrementally renders table rows. This is appropriate for small shops; large deployments should move dashboard aggregation and search to paginated server queries before loading years of history.

| Role          | Permissions                                                           |
| ------------- | --------------------------------------------------------------------- |
| Administrator | All operations, account creation, passwords, team access, settings    |
| Cashier       | Sales, invoices, customers, payments                                  |
| Staff         | Catalog, stock adjustment, customers; operational records read access |
| Accountant    | Invoices, payments, expenses, financial review                        |

Profiles cannot be inserted, updated, or deleted directly by frontend roles. Administrators use an authorization-checked RPC to manage other staff; self-access changes are rejected. Deactivation takes effect in RLS immediately, even for existing Auth sessions. Active shop members can read operational sales/invoice/customer/catalog data; expenses and audit logs are restricted to Administrator/Accountant. The membership-checking helper uses a fixed search path and checks active membership without RLS recursion.

## Verification and deployment

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:built
```

Unit tests cover money calculation, status transitions, partial payments, and the UI role matrix. Database integration tests execute the actual migration and RPCs against embedded PostgreSQL, covering SQL permissions, numbering, stock, and payment invariants. Browser tests exercise demo navigation, forms, sales, partial payments, PDFs, and mobile layout. See `VERIFICATION.md` for checks actually performed in this workspace and remaining environment checks.

Build output is `dist/`; host it over HTTPS with SPA fallback to `index.html`. Navigation uses hashes. Restrict the Supabase redirect allowlist to deployed origins; the staff management function allows the configured app origin only. Keep secrets only in Supabase/server secret storage. Set up database backups, monitor errors, and exercise restore procedures before operating with live financial records. Enable MFA for administrators where appropriate to your deployment.

Browser tests use a locally installed Google Chrome (desktop plus a mobile viewport/touch emulation); they do not assert behavior in Safari on a physical iPhone. PDF and screenshot artifacts are written to the ignored `artifacts/` directory.

Useful files: `src/App.tsx` (screens/workflows), `src/domain.ts` (calculations/permissions), `src/pdf.ts` (PDF export), `src/styles.css` (responsive presentation), `supabase/migrations/` (database authority), `supabase/functions/manage-staff/` (trusted account/password management), `supabase/bootstrap.sql` (initial admin).
