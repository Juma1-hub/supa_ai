"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type DerivAccount = { accountId: string; accountType: string; currency: string; balance: number | string | null; isVirtual: boolean };
type LinkedAccount = { deriv_account_id?: string; account_id?: string; account_type?: string; currency?: string };
export default function AccountChoicePage() {
  const [accounts,setAccounts]=useState<DerivAccount[]>([]); const [linked,setLinked]=useState<LinkedAccount[]>([]);
  const [loading,setLoading]=useState(true); const [busyId,setBusyId]=useState(""); const [error,setError]=useState("");
  useEffect(()=>{ let alive=true; (async()=>{ try {
    const supabase=getSupabaseBrowserClient(); const {data:{session},error:sessionError}=await supabase.auth.getSession();
    if(sessionError || !session){ window.location.replace("/"); return; }
    const [accountsResponse,linksResponse]=await Promise.all([
      fetch("/api/auth/deriv/accounts",{cache:"no-store"}),
      fetch("/api/account/links",{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"})
    ]);
    const accountData=await accountsResponse.json(); if(!accountsResponse.ok) throw new Error(accountData.error||"Could not load Deriv accounts.");
    const linkData=await linksResponse.json(); if(linksResponse.ok) setLinked(linkData.accounts||[]);
    if(alive) setAccounts(accountData.accounts||[]);
  } catch(err){if(alive)setError(err instanceof Error?err.message:"Could not load accounts.");} finally{if(alive)setLoading(false);} })(); return()=>{alive=false;};},[]);
  async function choose(account:DerivAccount){ setBusyId(account.accountId); setError(""); try{
    const supabase=getSupabaseBrowserClient(); const {data:{session}}=await supabase.auth.getSession();
    if(!session) throw new Error("Your Supa AI session expired. Please sign in again.");
    const response=await fetch("/api/account/link",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({accountId:account.accountId,isVirtual:account.isVirtual})});
    const result=await response.json(); if(!response.ok) throw new Error(result.error||"Could not securely link this account.");
    localStorage.setItem("supa_deriv_selected_account",JSON.stringify(account));
    localStorage.setItem("supa_deriv_selected_account_id",account.accountId);
    window.location.assign("/workspace");
  }catch(err){setError(err instanceof Error?err.message:"Account verification failed.");setBusyId("");}}
  const isLinked=(id:string)=>linked.some(a=>(a.deriv_account_id||a.account_id)===id);
  return <main className="auth-page"><section className="auth-card account-choice-card"><div className="brand-lockup auth-brand"><div className="brand-mark">S<span>+</span></div><div><div className="brand-name">supa<span>ai</span></div><div className="brand-subtitle">TRADING INTELLIGENCE</div></div></div>
    <div className="auth-eyebrow">ACCOUNT SELECTION</div><h1>Choose your <span>trading account.</span></h1><p className="auth-copy">Your Deriv account will be verified and securely linked to your authenticated Supa AI profile.</p>
    {loading&&<p className="account-state">Loading your Deriv accounts…</p>}{error&&<div className="auth-error" role="alert">{error}<p><a href="/">Return to sign in</a></p></div>}
    {!loading&&!error&&accounts.length===0&&<div className="account-state">Deriv did not return any selectable accounts. Please reconnect your Deriv account.</div>}
    {!loading&&accounts.length>0&&<div className="account-options">{accounts.map((account,index)=><button className="account-option" key={`${account.accountId}-${index}`} disabled={!!busyId} onClick={()=>void choose(account)}><span className={`account-option-icon ${account.isVirtual?"demo":"real"}`}>{account.isVirtual?"D":"R"}</span><span className="account-option-copy"><b>{account.isVirtual?"Demo Account":"Real Account"}</b><small>{account.accountId} · {account.currency||"Currency unavailable"}</small><small>Balance: {account.balance!==null&&account.balance!==undefined?`${account.currency||""} ${Number(account.balance).toFixed(2)}`:"Unavailable"}</small><small>{busyId===account.accountId?"Verifying and linking…":isLinked(account.accountId)?"Linked to your Supa AI profile":"Verify and link account"}</small></span><span className="account-option-arrow">→</span></button>)}</div>}
    <p className="auth-footnote">Account linking stores verified account metadata, not your Deriv OAuth token. Selecting an account does not start trading. Real-money trading remains disabled.</p>
  </section></main>;
}
