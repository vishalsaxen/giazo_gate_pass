import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, orderBy, limit,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";

// ---------- constants ----------
const SOCIETY = "Banke Bihari Dham, Dayalbagh, Agra";
const PHASES = [1, 2];
const HOUSES = 40;
const RING_WINDOW_MS = 5 * 60 * 1000;   // a pending visit older than this stops ringing
const GUARD_WAIT_MS = 2 * 60 * 1000;    // guard sees "no answer yet" after this
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const KYC_DOCS = {
  Owner: [
    ["aadhaar", "Aadhaar Card", "Front and back in one file"],
    ["pan", "PAN Card", "Self-attested copy"],
    ["saleDeed", "Sale Deed / Registry", "Registered copy"],
    ["electricityBill", "Electricity Bill", "Any of the last 3 months"]
  ],
  Tenant: [
    ["aadhaar", "Aadhaar Card", "Front and back in one file"],
    ["rentAgreement", "Rent Agreement", "Signed by owner and tenant"],
    ["policeVerification", "Police Verification", "Agra police tenant form"],
    ["ownerNoc", "Owner NOC", "Signed by the house owner"]
  ]
};

// ---------- tiny helpers ----------
const app = document.getElementById("app");
const $ = (s, el = app) => el.querySelector(s);
const $$ = (s, el = app) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (n) => String(n || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const ms = (ts) => (ts && ts.toMillis ? ts.toMillis() : Date.now());
const fmtTime = (ts) => new Date(ms(ts)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const addrLine = (phase, house) => `House No. ${house}, Phase ${phase}`;
const validMobile = (m) => /^[6-9]\d{9}$/.test(String(m).replace(/\D/g, ""));
const cleanMobile = (m) => String(m).replace(/\D/g, "").slice(-10);
let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3500);
}
function pressGroup(group, btn) { $$("button", group).forEach((b) => b.setAttribute("aria-pressed", String(b === btn))); }
const icons = {
  camera: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  bell: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 0 1-6 0"/></svg>',
  doc: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>',
  out: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>'
};

// ---------- setup check ----------
if (!firebaseConfig.apiKey || !firebaseConfig.appId) {
  app.innerHTML = `
    <div class="brand"><img src="icon.svg" alt=""><h1>GiaZo Gate Pass</h1><p class="muted">${SOCIETY}</p></div>
    <div class="card">
      <h2>Almost ready</h2>
      <p>The Firebase web config is missing. Paste the values from Firebase console &gt; Project settings &gt; Your apps into <code>public/firebase-config.js</code>.</p>
    </div>`;
  throw new Error("Missing Firebase config");
}

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);
const storage = getStorage(fb);

// ---------- session state ----------
let cleanups = [];
function resetListeners() { cleanups.forEach((f) => { try { f(); } catch {} }); cleanups = []; stopBuzzer(); }
const isAdminUser = (u) => !!u && u.emailVerified && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes((u.email || "").toLowerCase());

onAuthStateChanged(auth, async (user) => {
  resetListeners();
  if (!user) return renderLogin();
  if (isAdminUser(user)) return renderAdmin(user);
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return renderOnboarding(user);
    watchProfile(user);
  } catch (e) {
    console.error(e);
    renderError("Could not load your profile. Check your connection and try again.");
  }
});

function watchProfile(user) {
  let last = "";
  const off = onSnapshot(doc(db, "users", user.uid), (snap) => {
    const p = snap.data();
    if (!p) return renderOnboarding(user);
    // Re-render the role screen only when role or KYC state changes, so open forms are not wiped.
    const key = `${p.role}|${p.kycStatus}|${p.requestedRole || ""}|${p.residentType}`;
    if (key === last) { if (p.role === "resident") refreshKyc(user, p); return; }
    last = key;
    cleanups.filter((f) => f !== off).forEach((f) => f());
    cleanups = [off];
    stopBuzzer();
    if (p.role === "guard") renderGuard(user, p);
    else if (p.requestedRole === "guard") renderWaitingGuard(user, p);
    else renderResident(user, p);
  }, (e) => { console.error(e); renderError("Could not load your profile."); });
  cleanups.push(off);
}

function renderError(msg) {
  app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(msg)}</p><button class="btn ghost" id="retry">Reload</button></div>`;
  $("#retry").onclick = () => location.reload();
}

function appbar(title, sub, user, extra = "") {
  const pic = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="">` : esc(initials(user.displayName || user.email));
  return `<div class="appbar"><div class="avatar">${pic}</div><div class="grow"><small>${esc(sub)}</small><h2>${esc(title)}</h2></div>${extra}<button class="iconbtn" id="logout" aria-label="Sign out" title="Sign out">${icons.out}</button></div>`;
}
function bindLogout() { const b = $("#logout"); if (b) b.onclick = () => signOut(auth); }

// ---------- login ----------
function renderLogin() {
  app.innerHTML = `
    <div class="brand"><img src="icon.svg" alt=""><h1>GiaZo Gate Pass</h1><p class="muted">${SOCIETY}</p></div>
    <div class="card">
      <button class="btn primary" id="google">Continue with Google</button>
      <div class="divider">or use email</div>
      <form id="emailForm" class="stack" novalidate>
        <div><label class="l" for="em">Email <em>*</em></label><input class="input" id="em" type="email" autocomplete="email" required></div>
        <div><label class="l" for="pw">Password <em>*</em></label><input class="input" id="pw" type="password" autocomplete="current-password" minlength="6" required></div>
        <button class="btn ghost" type="submit" id="emailBtn">Sign in</button>
        <div class="row" style="justify-content:space-between">
          <button type="button" class="link" id="toggle">New here? Create an account</button>
          <button type="button" class="link" id="reset">Forgot password</button>
        </div>
      </form>
    </div>
    <p class="small muted" style="text-align:center">Residents sign up here, then upload KYC documents for the Super Admin to verify.</p>`;
  let creating = false;
  $("#google").onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { if (e.code !== "auth/popup-closed-by-user") toast(authMsg(e)); }
  };
  $("#toggle").onclick = () => {
    creating = !creating;
    $("#emailBtn").textContent = creating ? "Create account" : "Sign in";
    $("#toggle").textContent = creating ? "Have an account? Sign in" : "New here? Create an account";
    $("#pw").autocomplete = creating ? "new-password" : "current-password";
  };
  $("#reset").onclick = async () => {
    const em = $("#em").value.trim();
    if (!em) return toast("Enter your email first.");
    try { await sendPasswordResetEmail(auth, em); toast("Password reset email sent."); } catch (e) { toast(authMsg(e)); }
  };
  $("#emailForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const em = $("#em").value.trim(), pw = $("#pw").value;
    if (!em || pw.length < 6) return toast("Enter your email and a password of at least 6 characters.");
    try {
      if (creating) await createUserWithEmailAndPassword(auth, em, pw);
      else await signInWithEmailAndPassword(auth, em, pw);
    } catch (e) { toast(authMsg(e)); }
  };
}
function authMsg(e) {
  const m = {
    "auth/invalid-credential": "Email or password is wrong.",
    "auth/email-already-in-use": "That email already has an account. Sign in instead.",
    "auth/weak-password": "Use a password of at least 6 characters.",
    "auth/invalid-email": "That email address is not valid.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/unauthorized-domain": "This website is not yet allowed in Firebase Authentication settings.",
    "auth/operation-not-allowed": "This sign-in method is turned off in Firebase Authentication > Sign-in method.",
    "auth/configuration-not-found": "Firebase Authentication is not set up yet. Open Authentication in the Firebase console and click Get started.",
    "auth/popup-blocked": "The browser blocked the sign-in window. Allow pop-ups for this site and try again.",
    "auth/network-request-failed": "No internet connection. Check it and try again.",
    "auth/user-disabled": "This account has been disabled."
  };
  console.error(e);
  return m[e.code] || `Sign-in failed (${e.code || e.message}). Try again.`;
}

// ---------- onboarding ----------
function houseGrid(id) {
  return `<div class="houses" id="${id}">${Array.from({ length: HOUSES }, (_, i) => `<button type="button" aria-pressed="false" data-h="${i + 1}" aria-label="House ${i + 1}">${i + 1}</button>`).join("")}</div>`;
}
function phaseSeg(id) {
  return `<div class="seg" id="${id}">${PHASES.map((p) => `<button type="button" aria-pressed="false" data-p="${p}">Phase ${p}</button>`).join("")}</div>`;
}

function renderOnboarding(user) {
  app.innerHTML = `
    ${appbar("Welcome", user.email || "", user)}
    <div class="card">
      <h3>Tell us who you are</h3>
      <div class="opts" id="who"><button type="button" aria-pressed="true" data-v="resident">Resident</button><button type="button" aria-pressed="false" data-v="guard">Security guard</button></div>
      <div><label class="l" for="nm">Full name <em>*</em></label><input class="input" id="nm" autocomplete="name" value="${esc(user.displayName || "")}"></div>
      <div><label class="l" for="ph">Mobile number <em>*</em></label><div class="mobile"><input class="input cc" value="+91" disabled aria-label="Country code"><input class="input" id="ph" inputmode="numeric" autocomplete="tel-national" maxlength="11" placeholder="10 digits"></div></div>
      <div id="resFields" class="stack">
        <div><label class="l">I am the <em>*</em></label><div class="opts" id="rtype"><button type="button" aria-pressed="false" data-v="Owner">Owner</button><button type="button" aria-pressed="false" data-v="Tenant">Tenant</button></div></div>
        <div><label class="l">My house <em>*</em></label>${phaseSeg("phase")}</div>
        ${houseGrid("houses")}
        <div class="addr" id="addr">Pick your phase and house number.</div>
      </div>
      <button class="btn primary" id="save">Continue</button>
    </div>`;
  bindLogout();
  let who = "resident", rtype = "", phase = 0, house = 0;
  const showAddr = () => { $("#addr").innerHTML = phase && house ? `<b>${addrLine(phase, house)}</b><br>${SOCIETY}` : "Pick your phase and house number."; };
  $("#who").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; who = b.dataset.v; pressGroup($("#who"), b); $("#resFields").hidden = who !== "resident"; };
  $("#rtype").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; rtype = b.dataset.v; pressGroup($("#rtype"), b); };
  $("#phase").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; phase = +b.dataset.p; pressGroup($("#phase"), b); showAddr(); };
  $("#houses").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; house = +b.dataset.h; pressGroup($("#houses"), b); showAddr(); };
  $("#save").onclick = async () => {
    const name = $("#nm").value.trim(), phone = $("#ph").value;
    if (name.length < 2) return toast("Enter your full name.");
    if (!validMobile(phone)) return toast("Enter a valid 10-digit mobile number.");
    if (who === "resident" && !rtype) return toast("Choose Owner or Tenant.");
    if (who === "resident" && (!phase || !house)) return toast("Pick your phase and house number.");
    const data = {
      uid: user.uid, email: user.email || "", name, phone: cleanMobile(phone),
      role: "resident", requestedRole: who === "guard" ? "guard" : "",
      residentType: who === "resident" ? rtype : "", phase: who === "resident" ? phase : 0, house: who === "resident" ? house : 0,
      kycStatus: "none", docs: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    $("#save").disabled = true;
    try { await setDoc(doc(db, "users", user.uid), data); watchProfile(user); }
    catch (e) { console.error(e); toast("Could not save. Try again."); $("#save").disabled = false; }
  };
}

function renderWaitingGuard(user, p) {
  app.innerHTML = `${appbar("Hi, " + p.name.split(" ")[0], "Security guard", user)}
    <div class="card"><h3>Waiting for approval</h3><p>The Super Admin needs to approve your guard access. This screen will update by itself once it is done.</p></div>`;
  bindLogout();
}

// ---------- guard ----------
function renderGuard(user, p) {
  app.innerHTML = `
    ${appbar("New Visitor", "Main Gate · " + p.name, user)}
    <form id="vf" class="stack" novalidate>
      <label class="photo" id="photoBox">
        <div class="shot">${icons.camera}</div><span id="photoTxt">Take visitor photo *</span>
        <input id="photo" type="file" accept="image/*" capture="environment">
      </label>
      <div class="card">
        <div><label class="l" for="vn">Visitor name <em>*</em></label><input class="input" id="vn" autocomplete="off"></div>
        <div><label class="l" for="vm">Visitor mobile <em>*</em></label><div class="mobile"><input class="input cc" value="+91" disabled aria-label="Country code"><input class="input" id="vm" inputmode="numeric" maxlength="11" placeholder="10 digits" autocomplete="off"></div></div>
      </div>
      <div class="card">
        <label class="l">Delivery address <em>*</em></label>
        ${phaseSeg("phase")}
        ${houseGrid("houses")}
        <div class="addr" id="addr">Pick the phase and house number.</div>
        <div><label class="l">House status <em>*</em></label>
          <div class="opts" id="occ"><button type="button" aria-pressed="false" data-v="Owner">Owner</button><button type="button" aria-pressed="false" data-v="Tenant">Tenant</button><button type="button" aria-pressed="false" data-v="Vacant">Vacant</button></div>
        </div>
      </div>
      <button class="btn primary" id="send" type="submit">${icons.bell.replace(/36/g, "20")} Submit &amp; ring resident</button>
    </form>
    <h3>Today at the gate</h3>
    <div class="list" id="log"><div class="empty">No visitors yet.</div></div>`;
  bindLogout();

  let phase = 0, house = 0, occ = "", photoBlob = null;
  const showAddr = () => { $("#addr").innerHTML = phase && house ? `<b>${addrLine(phase, house)}</b><br>${SOCIETY}` : "Pick the phase and house number."; };
  $("#phase").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; phase = +b.dataset.p; pressGroup($("#phase"), b); showAddr(); };
  $("#houses").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; house = +b.dataset.h; pressGroup($("#houses"), b); showAddr(); };
  $("#occ").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; occ = b.dataset.v; pressGroup($("#occ"), b); };
  $("#photo").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      photoBlob = await compressImage(f, 1024, 0.75);
      let img = $("#photoBox img");
      if (!img) { img = document.createElement("img"); img.alt = "Visitor photo"; $("#photoBox").appendChild(img); }
      img.src = URL.createObjectURL(photoBlob);
    } catch { toast("Could not read that photo. Try again."); }
  };

  $("#vf").onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $("#vn").value.trim(), mobile = $("#vm").value;
    if (!photoBlob) return toast("Take the visitor's photo.");
    if (name.length < 2) return toast("Enter the visitor's name.");
    if (!validMobile(mobile)) return toast("Enter a valid 10-digit mobile number.");
    if (!phase || !house) return toast("Pick the phase and house number.");
    if (!occ) return toast("Choose Owner, Tenant or Vacant.");
    const btn = $("#send"); btn.disabled = true;
    try {
      const vref = doc(collection(db, "visits"));
      const path = `visitors/${vref.id}.jpg`;
      await uploadBytes(ref(storage, path), photoBlob, { contentType: "image/jpeg" });
      await setDoc(vref, {
        name, mobile: cleanMobile(mobile), photoPath: path, phase, house, occupancy: occ,
        status: "pending", guardUid: user.uid, guardName: p.name, createdAt: serverTimestamp()
      });
      toast(occ === "Vacant" ? `House ${house} is vacant. Sent to Super Admin.` : `Buzzer sent to House ${house}, Phase ${phase}.`);
      phase = house = 0; occ = ""; photoBlob = null;
      $("#vn").value = ""; $("#vm").value = ""; $("#photo").value = "";
      $("#photoBox img")?.remove();
      $$("#phase button, #houses button, #occ button").forEach((b) => b.setAttribute("aria-pressed", "false"));
      showAddr(); btn.disabled = false; window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { console.error(e); toast("Could not send. Check the connection and try again."); btn.disabled = false; }
  };

  const since = new Date(); since.setHours(0, 0, 0, 0);
  const q = query(collection(db, "visits"), where("createdAt", ">=", since), orderBy("createdAt", "desc"), limit(50));
  cleanups.push(onSnapshot(q, (s) => {
    const rows = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("#log").innerHTML = rows.length ? rows.map(visitRow).join("") : `<div class="empty">No visitors yet.</div>`;
    hydratePhotos($("#log"));
  }, (e) => console.error(e)));
  const tick = setInterval(() => $$("[data-born]").forEach((el) => {
    if (Date.now() - +el.dataset.born > GUARD_WAIT_MS) { el.className = "pill no"; el.textContent = "No answer yet"; }
  }), 5000);
  cleanups.push(() => clearInterval(tick));
}

function statusPill(v) {
  if (v.status === "approved") return `<span class="pill ok">Approved</span>`;
  if (v.status === "denied") return `<span class="pill no">Denied</span>`;
  const born = ms(v.createdAt);
  if (Date.now() - born > GUARD_WAIT_MS) return `<span class="pill no">No answer yet</span>`;
  return `<span class="pill wait" data-born="${born}">Waiting</span>`;
}
function visitRow(v) {
  return `<div class="item"><div class="vphoto sm" data-photo="${esc(v.photoPath)}">${esc(initials(v.name))}</div>
    <div class="t"><b>${esc(v.name)}</b><small>${esc(addrLine(v.phase, v.house))} · ${esc(v.occupancy)} · ${fmtTime(v.createdAt)}</small></div>${statusPill(v)}</div>`;
}
const urlCache = new Map();
async function photoUrl(path) {
  if (!path) return "";
  if (!urlCache.has(path)) urlCache.set(path, getDownloadURL(ref(storage, path)).catch(() => ""));
  return urlCache.get(path);
}
function hydratePhotos(root) {
  $$("[data-photo]", root).forEach(async (el) => {
    const u = await photoUrl(el.dataset.photo);
    if (u) el.innerHTML = `<img src="${esc(u)}" alt="">`;
  });
}

// ---------- resident ----------
function renderResident(user, p) {
  const approved = p.kycStatus === "approved";
  app.innerHTML = `
    ${appbar("Hi, " + p.name.split(" ")[0], `${addrLine(p.phase, p.house)} · ${p.residentType}`, user)}
    <div id="kycBanner"></div>
    <div id="buzz" ${approved ? "" : "hidden"}></div>
    <div id="pending" class="stack"></div>
    <div class="card" id="kycCard"></div>
    <div ${approved ? "" : "hidden"}><h3 style="margin-bottom:8px">Recent visitors</h3><div class="list" id="history"><div class="empty">No visitors yet.</div></div></div>`;
  bindLogout();
  refreshKyc(user, p);
  if (!approved) return;

  const enabled = buzzerReady();
  $("#buzz").innerHTML = enabled ? "" : `<div class="banner rose stack"><span>Turn on the buzzer so this phone rings when a visitor arrives. Keep this page open.</span><button class="btn primary" id="enableBuzz">Turn on buzzer</button></div>`;
  const en = $("#enableBuzz");
  if (en) en.onclick = async () => { await enableBuzzer(); $("#buzz").innerHTML = ""; toast("Buzzer is on."); updateRinging(); };

  let pending = [];
  const q = query(collection(db, "visits"), where("phase", "==", p.phase), where("house", "==", p.house), limit(30));
  cleanups.push(onSnapshot(q, (s) => {
    const all = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    pending = all.filter((v) => v.status === "pending" && Date.now() - ms(v.createdAt) < RING_WINDOW_MS);
    const done = all.filter((v) => !pending.includes(v));
    $("#pending").innerHTML = pending.map(alertCard).join("");
    $("#history").innerHTML = done.length ? done.map(visitRow).join("") : `<div class="empty">No visitors yet.</div>`;
    hydratePhotos($("#pending")); hydratePhotos($("#history"));
    $$("[data-act]").forEach((b) => (b.onclick = () => decide(user, p, b.dataset.id, b.dataset.act)));
    pending.filter((v) => !notified.has(v.id)).forEach((v) => { notified.add(v.id); notify(v); });
    updateRinging();
  }, (e) => console.error(e)));
  const tick = setInterval(() => {
    $$("[data-until]").forEach((el) => {
      const left = Math.max(0, +el.dataset.until - Date.now());
      el.textContent = left ? `Stops ringing in ${String(Math.floor(left / 60000)).padStart(2, "0")}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}` : "Missed";
    });
    pending = pending.filter((v) => Date.now() - ms(v.createdAt) < RING_WINDOW_MS);
    updateRinging();
  }, 1000);
  cleanups.push(() => clearInterval(tick));
  function updateRinging() { if (pending.length && buzzerReady()) startBuzzer(); else stopBuzzer(); }
}
const notified = new Set();

function alertCard(v) {
  return `<div class="alert"><div class="ring">${icons.bell}</div><h3>Visitor at Main Gate</h3><p>Security is waiting for your answer</p>
      <div class="timer" data-until="${ms(v.createdAt) + RING_WINDOW_MS}"></div></div>
    <div class="card">
      <div class="visitor"><div class="vphoto" data-photo="${esc(v.photoPath)}">${esc(initials(v.name))}</div><div><h3>${esc(v.name)}</h3><p class="muted small">Logged by ${esc(v.guardName || "Security")}</p></div></div>
      <dl class="kv"><dt>Mobile</dt><dd>+91 ${esc(v.mobile)}</dd><dt>Deliver to</dt><dd>${esc(addrLine(v.phase, v.house))}</dd><dt>Time</dt><dd>${fmtTime(v.createdAt)}</dd></dl>
      <div class="actions"><button class="btn deny" data-act="denied" data-id="${v.id}">Deny</button><button class="btn approve" data-act="approved" data-id="${v.id}">Approve</button></div>
    </div>`;
}
async function decide(user, p, id, status) {
  try {
    await updateDoc(doc(db, "visits", id), { status, decidedBy: user.uid, decidedByName: p.name, decidedAt: serverTimestamp() });
    toast(status === "approved" ? "Approved. The gate can let them in." : "Denied. The gate will turn them away.");
  } catch (e) { console.error(e); toast("Could not save your answer. Try again."); }
}

function refreshKyc(user, p) {
  const banner = $("#kycBanner"), card = $("#kycCard");
  if (!banner || !card) return;
  const st = p.kycStatus;
  banner.innerHTML = st === "approved" ? "" :
    st === "pending" ? `<div class="banner warn">Your documents are with the Super Admin for verification. Visitor alerts start once you are verified.</div>` :
    st === "rejected" ? `<div class="banner no">Your KYC was not approved${p.kycNote ? `: ${esc(p.kycNote)}` : ""}. Re-upload the documents and send them again.</div>` :
    `<div class="banner rose">Upload all your documents to get verified. Visitor alerts start once the Super Admin approves them.</div>`;
  const list = KYC_DOCS[p.residentType] || KYC_DOCS.Owner;
  const docs = p.docs || {};
  const locked = st === "approved" || st === "pending";
  const have = list.filter(([k]) => docs[k]).length;
  card.innerHTML = `
    <div class="row" style="justify-content:space-between"><h3>KYC documents</h3><span class="pill ${st === "approved" ? "ok" : st === "pending" ? "wait" : st === "rejected" ? "no" : "rose"}">${{ approved: "Verified", pending: "In review", rejected: "Rejected", none: "Not sent" }[st] || "Not sent"}</span></div>
    <div class="row" style="justify-content:space-between"><span class="small muted">All documents are required</span><span class="small muted">${have} of ${list.length} added</span></div>
    <div class="progress"><i style="width:${(have / list.length) * 100}%"></i></div>
    <div class="list">${list.map(([k, label, hint]) => `
      <div class="item doc" style="background:var(--rose-soft)"><div class="ic">${icons.doc}</div>
        <div class="t"><b>${label} <span style="color:var(--bad)">*</span></b><small>${docs[k] ? esc(docs[k].name) : hint}</small></div>
        ${locked ? (docs[k] ? `<span class="pill ok">Added</span>` : "") :
          `<label class="btn sm ${docs[k] ? "ghost" : "primary"} upl">${docs[k] ? "Replace" : "Upload"}<input type="file" accept="image/*,application/pdf" data-doc="${k}"></label>`}
      </div>`).join("")}</div>
    ${locked ? "" : `<p class="small muted">PDF, JPG or PNG up to 5 MB each. Only the Super Admin can see these files.</p>
      <button class="btn primary" id="sendKyc" ${have === list.length ? "" : "disabled"}>Send for KYC approval</button>`}`;
  $$("[data-doc]", card).forEach((inp) => (inp.onchange = () => uploadKyc(user, p, inp)));
  const send = $("#sendKyc", card);
  if (send) send.onclick = async () => {
    if (list.some(([k]) => !docs[k])) return toast("Upload every document first.");
    send.disabled = true;
    try { await updateDoc(doc(db, "users", user.uid), { kycStatus: "pending", kycSubmittedAt: serverTimestamp(), updatedAt: serverTimestamp() }); toast("Sent to Super Admin for approval."); }
    catch (e) { console.error(e); toast("Could not send. Try again."); send.disabled = false; }
  };
}
async function uploadKyc(user, p, inp) {
  let f = inp.files[0]; if (!f) return;
  const isPdf = f.type === "application/pdf";
  if (!isPdf && !f.type.startsWith("image/")) return toast("Use a PDF, JPG or PNG file.");
  const label = inp.closest("label"); label.textContent = "Uploading…";
  try {
    let blob = f, ext = isPdf ? "pdf" : "jpg";
    if (!isPdf) blob = await compressImage(f, 1800, 0.85);
    if (blob.size > MAX_FILE_BYTES) { toast("That file is over 5 MB. Use a smaller one."); return refreshKyc(user, p); }
    const key = inp.dataset.doc;
    const path = `kyc/${user.uid}/${key}-${Date.now()}.${ext}`;
    await uploadBytes(ref(storage, path), blob, { contentType: isPdf ? "application/pdf" : "image/jpeg" });
    await updateDoc(doc(db, "users", user.uid), { [`docs.${key}`]: { path, name: f.name, uploadedAt: Date.now() }, updatedAt: serverTimestamp() });
    toast("Uploaded.");
  } catch (e) { console.error(e); toast("Upload failed. Try again."); refreshKyc(user, p); }
}

// ---------- buzzer ----------
let audioCtx = null, ringTimer = null;
const buzzerReady = () => !!audioCtx && audioCtx.state === "running";
async function enableBuzzer() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();
  if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch {} }
  try { await navigator.wakeLock?.request("screen"); } catch {}
}
function beep(t0, freq) {
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = "square"; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
  o.connect(g).connect(audioCtx.destination); o.start(t0); o.stop(t0 + 0.3);
}
function startBuzzer() {
  if (ringTimer || !buzzerReady()) return;
  const ring = () => { const t = audioCtx.currentTime; beep(t, 880); beep(t + 0.35, 660); beep(t + 0.7, 880); navigator.vibrate?.([300, 150, 300, 150, 300]); };
  ring(); ringTimer = setInterval(ring, 1800);
}
function stopBuzzer() { clearInterval(ringTimer); ringTimer = null; navigator.vibrate?.(0); }
function notify(v) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
  try { new Notification("Visitor at Main Gate", { body: `${v.name} for ${addrLine(v.phase, v.house)}. Open Gate Pass to approve.`, icon: "icon.svg", tag: v.id, requireInteraction: true }); } catch {}
}

// ---------- admin ----------
function renderAdmin(user) {
  app.innerHTML = `
    ${appbar("Super Admin", "GiaZo Gate Pass", user)}
    <div class="stats"><div class="stat"><b id="sPend">–</b><small>KYC pending</small></div><div class="stat"><b id="sOk">–</b><small>Verified</small></div><div class="stat"><b id="sGate">–</b><small>Gate waiting</small></div></div>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="true" data-tab="kyc">KYC requests</button>
      <button role="tab" aria-selected="false" data-tab="people">People</button>
      <button role="tab" aria-selected="false" data-tab="gate">Gate log</button>
    </div>
    <div id="pane" class="list"></div>`;
  bindLogout();
  let tab = "kyc", users = [], visits = [];
  $(".tabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; tab = b.dataset.tab; $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b))); draw(); };

  cleanups.push(onSnapshot(collection(db, "users"), (s) => { users = s.docs.map((d) => ({ id: d.id, ...d.data() })); draw(); }, (e) => { console.error(e); toast("Admin access denied. Check ADMIN_EMAILS and the security rules."); }));
  cleanups.push(onSnapshot(query(collection(db, "visits"), orderBy("createdAt", "desc"), limit(100)), (s) => { visits = s.docs.map((d) => ({ id: d.id, ...d.data() })); draw(); }, (e) => console.error(e)));

  function draw() {
    $("#sPend").textContent = users.filter((u) => u.kycStatus === "pending").length;
    $("#sOk").textContent = users.filter((u) => u.kycStatus === "approved").length;
    $("#sGate").textContent = visits.filter((v) => v.status === "pending").length;
    const pane = $("#pane");
    if (tab === "kyc") {
      const rows = users.filter((u) => u.kycStatus === "pending").sort((a, b) => ms(a.kycSubmittedAt) - ms(b.kycSubmittedAt));
      pane.innerHTML = rows.length ? rows.map(kycReq).join("") : `<div class="empty">No KYC requests waiting.</div>`;
    } else if (tab === "people") {
      const rows = [...users].sort((a, b) => (a.phase - b.phase) || (a.house - b.house));
      pane.innerHTML = rows.length ? rows.map(personRow).join("") : `<div class="empty">Nobody has signed up yet.</div>`;
    } else {
      pane.innerHTML = visits.length ? visits.map((v) => `<div class="card" style="padding:12px;gap:8px">${visitRow(v).replace('class="item"', 'class="item" style="padding:0"')}
        ${v.status === "pending" ? `<div class="actions"><button class="btn deny sm" style="width:100%" data-visit="${v.id}" data-s="denied">Deny</button><button class="btn approve sm" style="width:100%" data-visit="${v.id}" data-s="approved">Approve</button></div>` : v.decidedByName ? `<span class="small muted">${v.status === "approved" ? "Approved" : "Denied"} by ${esc(v.decidedByName)}</span>` : ""}</div>`).join("") : `<div class="empty">No visitors logged yet.</div>`;
      hydratePhotos(pane);
    }
    bindAdminActions(user, users);
  }
}
function kycReq(u) {
  const list = KYC_DOCS[u.residentType] || KYC_DOCS.Owner;
  const docs = u.docs || {};
  return `<div class="card" style="gap:10px">
    <div class="row"><div class="avatar">${esc(initials(u.name))}</div><div class="grow" style="flex:1;min-width:0"><b>${esc(u.name)}</b><div class="small muted">${esc(addrLine(u.phase, u.house))} · +91 ${esc(u.phone)}</div><div class="small muted">${esc(u.email)}</div></div><span class="pill rose">${esc(u.residentType)}</span></div>
    <div class="chips">${list.map(([k, label]) => docs[k] ? `<button class="chip" data-open="${esc(docs[k].path)}">${label}</button>` : `<span class="chip missing">${label} missing</span>`).join("")}</div>
    <input class="input" placeholder="Reason, if rejecting" id="note-${u.id}">
    <div class="actions"><button class="btn deny sm" style="width:100%" data-kyc="${u.id}" data-s="rejected">Reject</button><button class="btn approve sm" style="width:100%" data-kyc="${u.id}" data-s="approved" ${list.every(([k]) => docs[k]) ? "" : "disabled"}>Approve</button></div>
  </div>`;
}
function personRow(u) {
  const kyc = { approved: ["ok", "Verified"], pending: ["wait", "In review"], rejected: ["no", "Rejected"] }[u.kycStatus] || ["rose", "No KYC"];
  const where = u.role === "guard" || u.requestedRole === "guard" ? "Security guard" : `${addrLine(u.phase, u.house)} · ${u.residentType}`;
  const act = u.role === "guard"
    ? `<button class="btn ghost sm" data-role="${u.id}" data-r="resident">Remove guard</button>`
    : u.requestedRole === "guard"
      ? `<button class="btn primary sm" data-role="${u.id}" data-r="guard">Approve guard</button>`
      : u.kycStatus === "approved" ? `<button class="btn ghost sm" data-kyc="${u.id}" data-s="none">Revoke KYC</button>` : "";
  return `<div class="item"><div class="avatar">${esc(initials(u.name))}</div><div class="t"><b>${esc(u.name)}</b><small>${esc(where)} · +91 ${esc(u.phone)}</small></div>
    ${u.role === "guard" ? `<span class="pill ok">Guard</span>` : u.requestedRole === "guard" ? `<span class="pill wait">Wants guard</span>` : `<span class="pill ${kyc[0]}">${kyc[1]}</span>`}${act}</div>`;
}
function bindAdminActions(user, users) {
  $$("[data-open]").forEach((b) => (b.onclick = async () => {
    try { window.open(await getDownloadURL(ref(storage, b.dataset.open)), "_blank", "noopener"); } catch { toast("Could not open that file."); }
  }));
  $$("[data-kyc]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.kyc, s = b.dataset.s;
    const note = ($(`#note-${id}`)?.value || "").trim();
    if (s === "rejected" && !note) return toast("Add a reason so the resident knows what to fix.");
    b.disabled = true;
    try {
      await updateDoc(doc(db, "users", id), { kycStatus: s, kycNote: s === "rejected" ? note : "", reviewedBy: user.email, reviewedAt: serverTimestamp() });
      toast(s === "approved" ? "Resident verified." : s === "rejected" ? "KYC rejected." : "KYC revoked.");
    } catch (e) { console.error(e); toast("Could not save. Try again."); b.disabled = false; }
  }));
  $$("[data-role]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await updateDoc(doc(db, "users", b.dataset.role), { role: b.dataset.r, requestedRole: "", updatedAt: serverTimestamp() }); toast(b.dataset.r === "guard" ? "Guard access approved." : "Guard access removed."); }
    catch (e) { console.error(e); toast("Could not save. Try again."); b.disabled = false; }
  }));
  $$("[data-visit]").forEach((b) => (b.onclick = async () => {
    try { await updateDoc(doc(db, "visits", b.dataset.visit), { status: b.dataset.s, decidedBy: user.uid, decidedByName: "Super Admin", decidedAt: serverTimestamp() }); }
    catch (e) { console.error(e); toast("Could not save. Try again."); }
  }));
}

// ---------- images ----------
async function compressImage(file, max, quality) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", quality));
}
