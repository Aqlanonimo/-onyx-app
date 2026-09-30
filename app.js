/*
 * ONYX starter app
 * 1) Create a Supabase project.
 * 2) Run supabase/schema.sql in the Supabase SQL Editor.
 * 3) Paste the Project URL and anon/publishable key below.
 * Never put a service_role/secret key in browser code.
 */
const SUPABASE_URL = "https://ookbnfusuaqkjtknqyzj.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "sb_publishable_52D2gGb3SIV09_DDY90pfQ_9oetGYHs";
const STARTING_BALANCE_NOTE = "The initial balance is created by the database trigger.";

const $ = (id) => document.getElementById(id);
const configured = SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("PASTE_") &&
  !SUPABASE_ANON_KEY.includes("PASTE_") &&
  SUPABASE_ANON_KEY.length > 20;
let client = null;
let currentUser = null;
let currentProfile = null;
let toastTimer = null;

function message(id, text, error = false) {
  const el = $(id); if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", error);
}
function toast(text) {
  const el = $("toast"); el.textContent = text; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function formatONX(value) {
  return Number(value || 0).toLocaleString("pt-BR", {minimumFractionDigits:2, maximumFractionDigits:2});
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function setView(loggedIn) {
  $("authView").classList.toggle("hidden", loggedIn);
  $("appView").classList.toggle("hidden", !loggedIn);
  $("setupNotice").classList.toggle("hidden", configured);
}
async function showAccount() {
  if (!client || !currentUser) return;
  const [{data: profile, error: pErr}, {data: wallet, error: wErr}] = await Promise.all([
    client.from("profiles").select("username,role").eq("id", currentUser.id).single(),
    client.from("wallets").select("balance").eq("user_id", currentUser.id).single()
  ]);
  if (pErr || wErr) {
    toast("Não foi possível carregar a conta. Confira se o SQL foi executado.");
    console.error(pErr || wErr); return;
  }
  currentProfile = profile;
  $("displayName").textContent = profile.username || currentUser.email.split("@")[0];
  $("userTag").textContent = "@" + (profile.username || "usuario");
  $("balance").innerHTML = `${formatONX(wallet.balance)} <small>ONX</small>`;
  $("adminPanel").classList.toggle("hidden", profile.role !== "admin");
  await loadHistory();
}
async function loadHistory() {
  if (!client || !currentUser) return;
  const {data, error} = await client.from("transactions")
    .select("id,from_user,to_user,amount,memo,kind,created_at,from_profile:profiles!transactions_from_user_fkey(username),to_profile:profiles!transactions_to_user_fkey(username)")
    .or(`from_user.eq.${currentUser.id},to_user.eq.${currentUser.id}`)
    .order("created_at", {ascending:false}).limit(20);
  if (error) { console.error(error); $("historyList").innerHTML = '<div class="empty">Não foi possível carregar o histórico.</div>'; return; }
  if (!data || !data.length) { $("historyList").innerHTML = '<div class="empty">Nenhuma transação ainda. Faça sua primeira transferência!</div>'; return; }
  $("historyList").innerHTML = data.map(tx => {
    const incoming = tx.to_user === currentUser.id;
    const title = tx.kind === "mint" ? "Moedas recebidas do administrador" : (incoming ? `Recebido de @${tx.from_profile?.username || "conta"}` : `Enviado para @${tx.to_profile?.username || "conta"}`);
    const amount = `${incoming ? "+" : "−"} ${formatONX(tx.amount)} ONX`;
    const date = new Date(tx.created_at).toLocaleString("pt-BR", {dateStyle:"short",timeStyle:"short"});
    return `<div class="history-row"><div class="history-icon">${tx.kind === "mint" ? "✦" : incoming ? "↙" : "↗"}</div><div><div class="history-title">${escapeHtml(title)}</div><div class="history-sub">${escapeHtml(tx.memo || "Transferência ONYX")} · ${date}</div></div><div class="history-amount ${incoming ? "positive":"negative"}">${amount}</div></div>`;
  }).join("");
}
async function enterSession(session) {
  currentUser = session?.user || null;
  if (!currentUser) { setView(false); return; }
  setView(true);
  await showAccount();
}
async function init() {
  if (!configured || !window.supabase) {
    $("connectionLabel").textContent = "Configure o Supabase";
    setView(false);
    return;
  }
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
  });
  $("connectionLabel").textContent = "Conexão configurada";
  $("authForm").addEventListener("submit", async (event) => {
    event.preventDefault(); message("authMessage", "Entrando...");
    const {data,error} = await client.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
    if (error) return message("authMessage", error.message, true);
    message("authMessage", "Login realizado."); await enterSession(data.session);
  });
  $("signupBtn").addEventListener("click", async () => {
    const email = $("email").value.trim(), password = $("password").value;
    if (!email || password.length < 8) return message("authMessage","Informe o e-mail e uma senha com pelo menos 8 caracteres.",true);
    message("authMessage","Criando conta...");
    const {data,error} = await client.auth.signUp({email,password});
    if (error) return message("authMessage",error.message,true);
    if (data.session) { message("authMessage","Conta criada!"); await enterSession(data.session); }
    else message("authMessage","Conta criada. Verifique seu e-mail para confirmar e depois entre.");
  });
  $("logoutBtn").addEventListener("click", async () => { await client.auth.signOut(); currentUser=null; currentProfile=null; setView(false); });
  $("refreshBtn").addEventListener("click", async () => { await showAccount(); toast("Dados atualizados."); });
  $("transferForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const recipient = $("recipient").value.trim().replace(/^@/,"").toLowerCase();
    const amount = Number($("amount").value);
    const memo = $("memo").value.trim();
    if (!recipient || !Number.isFinite(amount) || amount <= 0) return message("transferMessage","Confira destinatário e quantidade.",true);
    const button = event.submitter; if (button) button.disabled = true;
    message("transferMessage","Processando transferência segura...");
    const {data,error} = await client.rpc("transfer_onx", {p_recipient_username:recipient,p_amount:amount,p_memo:memo || null});
    if (button) button.disabled = false;
    if (error) return message("transferMessage",error.message,true);
    message("transferMessage",`Transferência concluída. Referência: ${String(data).slice(0,8)}…`);
    $("transferForm").reset(); await showAccount(); toast("ONX enviado com sucesso.");
  });
  $("mintForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = $("mintRecipient").value.trim().replace(/^@/,"").toLowerCase();
    const amount = Number($("mintAmount").value), reason = $("mintReason").value.trim();
    if (!username || !Number.isFinite(amount) || amount <= 0 || !reason) return message("mintMessage","Confira os campos.",true);
    const {data,error} = await client.rpc("admin_mint_onx", {p_recipient_username:username,p_amount:amount,p_reason:reason});
    if (error) return message("mintMessage",error.message,true);
    message("mintMessage",`Emissão concluída. Referência: ${String(data).slice(0,8)}…`);
    $("mintForm").reset(); await showAccount(); toast("ONX emitido.");
  });
  const {data:{session}} = await client.auth.getSession();
  await enterSession(session);
  client.auth.onAuthStateChange((_event, sessionNow) => { setTimeout(() => enterSession(sessionNow),0); });
}
document.addEventListener("DOMContentLoaded", init);
