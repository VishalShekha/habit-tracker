// ---- CONFIG: edit these three lines for your repo ----
const CONFIG = {
  owner: "VishalShekha",
  repo: "habit-tracker",
  branch: "main",
  dataPath: "data/activities.json",
};
// --------------------------------------------------------

const els = {
  list: document.getElementById("activities"),
  addBtn: document.getElementById("addBtn"),
  addDialog: document.getElementById("addDialog"),
  addForm: document.getElementById("addForm"),
  cancelAdd: document.getElementById("cancelAdd"),
  newName: document.getElementById("newName"),
  newHours: document.getElementById("newHours"),
  newMinutes: document.getElementById("newMinutes"),
  statusLine: document.getElementById("statusLine"),
};

let state = { activities: [] };
let currentSha = null; // needed by the GitHub API to update the file safely

// ---------- reading data ----------
// Reading is just a normal fetch of the file GitHub Pages already serves.
// No token needed for this: it's a public read of a file in your own site.
async function loadData() {
  const res = await fetch(`./${CONFIG.dataPath}?t=${Date.now()}`); // cache-bust
  if (!res.ok) throw new Error("Could not load activities.json");
  state = await res.json();
  render();
}

// ---------- timestamp-based math ----------
// Nothing here counts down on its own. Every render just asks "what time is
// it right now?" and compares it to the stored resetAt timestamp. That means
// the numbers are correct even if the tab was closed for hours.
function remainingMs(activity) {
  const maxMs = activity.maxDurationMinutes * 60 * 1000;
  const elapsed = Date.now() - Date.parse(activity.resetAt);
  return Math.max(0, maxMs - elapsed);
}

function formatRemaining(ms) {
  if (ms <= 0) return "Expired";
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m left`;
  if (m === 0) return `${h}h left`;
  return `${h}h ${m}m left`;
}

// ---------- rendering ----------
function render() {
  els.list.innerHTML = "";
  for (const activity of state.activities) {
    const ms = remainingMs(activity);
    const maxMs = activity.maxDurationMinutes * 60 * 1000;
    const pct = maxMs === 0 ? 0 : (ms / maxMs) * 100;
    const expired = ms <= 0;

    const row = document.createElement("div");
    row.className = "activity-row" + (expired ? " expired" : "");
    row.innerHTML = `
      <div class="activity-top">
        <span class="activity-name">${escapeHtml(activity.name)}</span>
        <span class="activity-remaining">${formatRemaining(ms)}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="activity-actions">
        <button class="btn-remove" data-id="${activity.id}" data-action="remove">Remove</button>
        <button class="btn-reset" data-id="${activity.id}" data-action="reset">Reset</button>
      </div>
    `;
    els.list.appendChild(row);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Re-render on a timer. This only recomputes from timestamps each tick,
// it never accumulates a counter, so drift/sleep/closed-tab time is a non-issue.
setInterval(render, 30 * 1000);

// ---------- actions ----------
els.list.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const activity = state.activities.find((a) => a.id === id);
  if (!activity) return;

  if (btn.dataset.action === "reset") {
    activity.resetAt = new Date().toISOString();
    activity.notified = false;
  } else if (btn.dataset.action === "remove") {
    if (!confirm(`Remove "${activity.name}"?`)) return;
    state.activities = state.activities.filter((a) => a.id !== id);
  }
  render();
  await saveData();
});

els.addBtn.addEventListener("click", () => {
  els.addForm.reset();
  els.addDialog.showModal();
});
els.cancelAdd.addEventListener("click", () => els.addDialog.close());

els.addForm.addEventListener("submit", async () => {
  const name = els.newName.value.trim();
  const hours = parseInt(els.newHours.value, 10) || 0;
  const minutes = parseInt(els.newMinutes.value, 10) || 0;
  if (!name || hours + minutes === 0) return;

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
  state.activities.push({
    id,
    name,
    maxDurationMinutes: hours * 60 + minutes,
    resetAt: new Date().toISOString(),
    notified: false,
  });
  render();
  await saveData();
});

// ---------- writing data back to GitHub ----------
// This is the one part of the app that can't be a plain fetch, because
// GitHub Pages is static hosting with no server of its own. Writing a file
// to the repo has to go through GitHub's REST API, which requires an
// authenticated request. See README.md for what kind of token to use and why.
function getToken() {
  let token = localStorage.getItem("gh_pat");
  if (!token) {
    token = prompt(
      "Enter a GitHub fine-grained personal access token with 'Contents: Read and write' access to this repo.\n" +
      "It will be stored only in this browser (localStorage), never uploaded anywhere but GitHub's API."
    );
    if (token) localStorage.setItem("gh_pat", token.trim());
  }
  return token;
}

async function saveData() {
  const token = getToken();
  if (!token) {
    setStatus("Not saved: no token provided.");
    return;
  }

  const apiUrl = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataPath}`;

  try {
    // 1. Get the current file SHA (required by GitHub to update a file safely,
    //    so two writes don't silently clobber each other).
    if (!currentSha) {
      const getRes = await fetch(`${apiUrl}?ref=${CONFIG.branch}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (getRes.ok) {
        currentSha = (await getRes.json()).sha;
      }
    }

    // 2. Push the updated JSON.
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(state, null, 2))));
    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({
        message: "Update activities.json from web UI",
        content,
        sha: currentSha,
        branch: CONFIG.branch,
      }),
    });

    if (!putRes.ok) {
      const body = await putRes.json().catch(() => ({}));
      if (putRes.status === 401 || putRes.status === 403) {
        localStorage.removeItem("gh_pat"); // token was bad/expired, ask again next time
      }
      throw new Error(body.message || `GitHub API error ${putRes.status}`);
    }

    currentSha = (await putRes.json()).content.sha;
    setStatus("Saved to GitHub.");
  } catch (err) {
    console.error(err);
    setStatus("Save failed: " + err.message);
  }
}

function setStatus(msg) {
  els.statusLine.textContent = msg;
  setTimeout(() => {
    if (els.statusLine.textContent === msg) els.statusLine.textContent = "";
  }, 4000);
}

loadData().catch((err) => {
  console.error(err);
  setStatus("Could not load activities.json");
});
