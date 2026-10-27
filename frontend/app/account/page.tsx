"use client";

import { useEffect, useState } from "react";

type DerivAccount = {
accountId: string;
accountType: string;
currency: string;
balance: number | string | null;
isVirtual: boolean;
};

export default function AccountChoicePage() {
const [accounts, setAccounts] = useState<DerivAccount[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState("");

useEffect(() => {
fetch("/api/auth/deriv/accounts", { cache: "no-store" })
.then(async (response) => {
const data = await response.json();

```
    if (!response.ok) {
      throw new Error(
        data.error || "Could not load accounts."
      );
    }

    setAccounts(data.accounts || []);
  })
  .catch((err) => {
    setError(
      err instanceof Error
        ? err.message
        : "Could not load accounts."
    );
  })
  .finally(() => {
    setLoading(false);
  });
```

}, []);

const choose = (account: DerivAccount) => {
sessionStorage.setItem(
"supa_deriv_selected_account",
JSON.stringify(account)
);

```
window.location.assign("/workspace");
```

};

return ( <main className="auth-page"> <section className="auth-card account-choice-card"> <div className="brand-lockup auth-brand"> <div className="brand-mark">
S<span>+</span> </div>

```
      <div>
        <div className="brand-name">
          supa<span>ai</span>
        </div>
        <div className="brand-subtitle">
          TRADING INTELLIGENCE
        </div>
      </div>
    </div>

    <div className="auth-eyebrow">ACCOUNT SELECTION</div>

    <h1>
      Choose your <span>trading account.</span>
    </h1>

    <p className="auth-copy">
      You are signed in through Deriv. Select one of the
      accounts returned for your authorization.
    </p>

    {loading && (
      <p className="account-state">
        Loading your Deriv accounts…
      </p>
    )}

    {error && (
      <div className="auth-error">
        {error}
        <p>
          Confirm that your OAuth app has the required
          permissions, then try signing in again.
        </p>
        <a href="/" className="text-button">
          Back to sign in
        </a>
      </div>
    )}

    {!loading && !error && accounts.length === 0 && (
      <div className="account-state">
        Deriv did not return any selectable accounts for
        this authorization. Please sign in again or check
        your application&apos;s permissions.
      </div>
    )}

    {!loading && !error && accounts.length > 0 && (
      <div className="account-options">
        {accounts.map((account, index) => (
          <button
            className="account-option"
            key={`${account.accountId}-${index}`}
            onClick={() => choose(account)}
          >
            <span
              className={`account-option-icon ${
                account.isVirtual ? "demo" : "real"
              }`}
            >
              {account.isVirtual ? "D" : "R"}
            </span>

            <span className="account-option-copy">
              <b>
                {account.isVirtual
                  ? "Demo Account"
                  : "Real Account"}
              </b>

              <small>
                {account.accountId ||
                  String(account.accountType)}
                {account.currency
                  ? ` · ${account.currency}`
                  : ""}
              </small>

              <small>
                Balance:{" "}
                {account.balance !== null &&
                account.balance !== undefined &&
                account.balance !== ""
                  ? `${account.currency || ""} ${Number(
                      account.balance
                    ).toFixed(2)}`
                  : "Unavailable"}
              </small>
            </span>

            <span className="account-option-arrow">
              →
            </span>
          </button>
        ))}
      </div>
    )}

    <p className="auth-footnote">
      Choosing an account does not start trading. Real-money
      trading remains unavailable until trading safeguards
      and order handling are implemented and tested.
    </p>
  </section>
</main>
```

);
}
