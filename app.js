(() => {
  const API = (window.SD_COIN_API_URL || "").replace(/\/$/, "");
  const tokenKey = "sd_coin_access_token";
  const token = () => sessionStorage.getItem(tokenKey);
  const deviceKeyName = "sd_coin_device_session";
  let deviceId = localStorage.getItem(deviceKeyName);
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem(deviceKeyName, deviceId); }
  const deviceLabel = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "Mobile" : "Desktop";
  const msg = (text, ok=false) => {
    const el = document.getElementById("form-message");
    if (el) { el.textContent = text; el.className = "message " + (ok ? "success" : "error"); }
  };
  async function api(path, options={}) {
    if (!API || API.includes("REPLACE-WITH")) throw new Error("Set your backend URL in config.js first.");
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token()) headers.Authorization = "Bearer " + token();
    const response = await fetch(API + path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
    return data;
  }
  function requireLogin() {
    if (!token()) { location.href = "login.html"; return false; }
    return true;
  }
  document.getElementById("register-form")?.addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try {
      const data = await api("/api/register", { method:"POST", body:JSON.stringify({name:f.get("name"), user_id:f.get("user_id"), email:f.get("email"), password:f.get("password")}) });
      sessionStorage.setItem(tokenKey, data.token); location.href = "dashboard.html";
    } catch(err) { msg(err.message); }
  });
  document.getElementById("login-form")?.addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try {
      const data = await api("/api/login", { method:"POST", body:JSON.stringify({identity:f.get("identity"), password:f.get("password")}) });
      sessionStorage.setItem(tokenKey, data.token); location.href = "dashboard.html";
    } catch(err) { msg(err.message); }
  });
  document.getElementById("logout-button")?.addEventListener("click", async () => {
    try { await api("/api/logout-all", {method:"POST", body:"{}"}); } catch (_) {}
    sessionStorage.removeItem(tokenKey); location.href = "login.html";
  });
  if (document.getElementById("balance")) {
    if (!requireLogin()) return;
    (async () => {
      try {
        const d = await api("/api/me");
        document.getElementById("welcome-name").textContent = "Welcome, " + d.name;
        document.getElementById("user-id").textContent = d.user_id;
        document.getElementById("balance").innerHTML = Number(d.balance).toLocaleString() + " <small>SD</small>";
        document.getElementById("detail-name").textContent = d.name;
        document.getElementById("detail-email").textContent = d.email;
        document.getElementById("detail-role").textContent = d.role;
        if (d.role === "admin") document.getElementById("admin-link")?.classList.remove("hidden");
      } catch(err) { sessionStorage.removeItem(tokenKey); msg(err.message); location.href = "login.html"; }
    })();
  }
  document.getElementById("transfer-form")?.addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const amount = Number(f.get("amount"));
    if (!Number.isSafeInteger(amount) || amount < 1) return msg("Enter a whole number of SD Coins.");
    try {
      const d = await api("/api/transfer", { method:"POST", body:JSON.stringify({receiver_id:f.get("receiver_id").trim(), amount, idempotency_key:crypto.randomUUID()}) });
      msg(d.message + " Transaction: " + d.transaction_id, true); e.currentTarget.reset();
      const me = await api("/api/me"); document.getElementById("balance").innerHTML = Number(me.balance).toLocaleString() + " <small>SD</small>";
    } catch(err) { msg(err.message); }
  });
  if (document.getElementById("history-list")) {
    if (!requireLogin()) return;
    (async () => {
      try {
        const d = await api("/api/transactions");
        const box = document.getElementById("history-list"); box.innerHTML = "";
        if (!d.transactions.length) { box.textContent = "No transactions yet."; return; }
        d.transactions.forEach(t => {
          const row = document.createElement("div"); row.className = "history-row";
          const left = document.createElement("div"); const title = document.createElement("strong");
          title.textContent = t.kind === "sent" ? "Sent to " + t.other_user : (t.kind === "received" ? "Received from " + t.other_user : (t.kind === "mining_reward" ? "Mining reward" : "Admin credit"));
          const date = document.createElement("small"); date.textContent = new Date(t.created_at).toLocaleString(); left.append(title,date);
          const amount = document.createElement("strong"); amount.className = t.kind === "sent" ? "negative" : "positive";
          amount.textContent = (t.kind === "sent" ? "−" : "+") + Number(t.amount).toLocaleString() + " SD";
          row.append(left,amount); box.append(row);
        });
      } catch(err) { msg(err.message); }
    })();
  }
  document.getElementById("issue-form")?.addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget); const amount = Number(f.get("amount"));
    if (!Number.isSafeInteger(amount) || amount < 1) return msg("Enter a whole number of SD Coins.");
    try {
      const d = await api("/api/admin/issue", { method:"POST", body:JSON.stringify({user_id:f.get("user_id").trim(), amount}) });
      msg(d.message, true); e.currentTarget.reset();
    } catch(err) { msg(err.message); }
  });

  // Opt-in browser mining. Each device must be logged in and the user must press Start.
  // A device pauses when its tab is hidden; it never mines silently in the background.
  let mining = false;
  const miningMsg = text => { const el = document.getElementById("mining-message"); if (el) el.textContent = text; };
  const sha256 = async value => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  };
  async function loadChain() {
    const box = document.getElementById("chain-list");
    if (!box) return;
    try {
      const data = await api("/api/chain"); box.innerHTML = "";
      const validity = document.getElementById("chain-validity");
      if (validity) validity.textContent = data.chain_valid ? "Verified" : "Integrity warning";
      data.blocks.slice(-6).reverse().forEach(b => {
        const row = document.createElement("div"); row.className = "chain-row";
        const left = document.createElement("div");
        const title = document.createElement("strong"); title.textContent = "Block #" + b.index + " · " + b.miner_user_id;
        const hash = document.createElement("small"); hash.textContent = b.hash;
        left.append(title, hash);
        const reward = document.createElement("b"); reward.textContent = "+" + b.reward + " SD";
        row.append(left, reward); box.append(row);
      });
    } catch (err) { box.textContent = err.message; }
  }
  async function sendPresence() {
    if (!token() || !document.getElementById("online-devices")) return;
    try {
      const data = await api("/api/presence", {method:"POST", body:JSON.stringify({device_id:deviceId, device_label:deviceLabel})});
      document.getElementById("online-devices").textContent = data.online_devices + " device(s) online on this account";
    } catch (_) {}
  }
  if (document.getElementById("online-devices") && token()) {
    sendPresence();
    setInterval(sendPresence, 30000);
  }
  document.getElementById("start-mining")?.addEventListener("click", async () => {
    if (!requireLogin() || mining) return;
    if (document.hidden) return miningMsg("Bring this tab to the front before starting mining.");
    mining = true;
    const start = document.getElementById("start-mining");
    const stop = document.getElementById("stop-mining");
    const status = document.getElementById("mining-status");
    start.disabled = true; stop.disabled = false; status.textContent = "Mining on this device";
    try {
      while (mining && !document.hidden) {
        const challenge = await api("/api/mining/challenge?device_id=" + encodeURIComponent(deviceId));
        let nonce = Number(challenge.nonce_start), found = "", count = 0;
        const startedAt = performance.now();
        miningMsg("This device is searching for a SHA-256 proof. Other signed-in devices can mine in parallel.");
        while (mining && !document.hidden && !found) {
          for (let i = 0; i < 250 && !found && mining && !document.hidden; i++, nonce++) {
            const payload = `${challenge.index}|${challenge.previous_hash}|${challenge.timestamp}|${challenge.miner_user_id}|${challenge.reward}|${nonce}`;
            const hash = await sha256(payload); count++;
            if (hash.startsWith("0".repeat(challenge.difficulty))) found = hash;
          }
          const seconds = Math.max((performance.now() - startedAt) / 1000, .001);
          document.getElementById("hash-rate").textContent = Math.round(count / seconds).toLocaleString() + " H/s";
          if (!found && mining && !document.hidden) await new Promise(resolve => setTimeout(resolve, 15));
        }
        if (!mining || document.hidden) break;
        miningMsg("Proof found. Submitting to the shared chain…");
        try {
          const result = await api("/api/mining/submit", {method:"POST", body:JSON.stringify({...challenge, nonce, hash:found})});
          miningMsg(result.message + " Block hash: " + result.block_hash);
          const me = await api("/api/me");
          document.getElementById("balance").innerHTML = Number(me.balance).toLocaleString() + " <small>SD</small>";
          await loadChain();
        } catch (submitError) {
          if (!/chain changed|another miner|409/i.test(submitError.message)) throw submitError;
          miningMsg("Another device completed this block first. This device is joining the next round.");
        }
        // Continue until the user stops or hides this tab. Every device has its own nonce range.
      }
    } catch (err) { miningMsg(err.message); }
    finally { mining = false; start.disabled = false; stop.disabled = true; status.textContent = "Ready"; }
  });
  document.getElementById("stop-mining")?.addEventListener("click", () => {
    mining = false; miningMsg("Mining stopped on this device.");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mining) {
      mining = false;
      miningMsg("Mining paused because this tab is not visible. Press Start when you return.");
    }
  });
  if (document.getElementById("chain-list")) loadChain();

  document.getElementById("password-form")?.addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const box = document.getElementById("password-message");
    try {
      const d = await api("/api/change-password", {method:"POST", body:JSON.stringify({current_password:f.get("current_password"), new_password:f.get("new_password")})});
      box.textContent = d.message; box.className = "message success"; e.currentTarget.reset();
      sessionStorage.removeItem(tokenKey);
      setTimeout(() => { location.href = "login.html"; }, 1400);
    } catch(err) { box.textContent = err.message; box.className = "message error"; }
  });

})();
