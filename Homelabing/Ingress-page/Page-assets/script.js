const GITHUB_USERNAME = "PelmeenidHapukoorega";
const STATS_API_URL = null;

async function renderGithubActivity() {
  const container = document.getElementById("activity-list");
  try {
    const res = await fetch(`https://api.github.com/users/${GITHUB_USERNAME}/events/public?per_page=8`);
    if (!res.ok) throw new Error();
    const events = await res.json();
    const pushEvents = events.filter(e => e.type === "PushEvent").slice(0, 6);
    if (pushEvents.length === 0) {
      container.innerHTML = `<div class="loading-text">No recent public push activity.</div>`;
      return;
    }
    container.innerHTML = pushEvents.map(event => {
      const repo = event.repo.name.split("/")[1] || event.repo.name;
      const commit = event.payload.commits && event.payload.commits[0];
      const msg = commit ? commit.message.split("\n")[0] : "commit";
      return `<a class="activity-item" href="https://github.com/${event.repo.name}" target="_blank" rel="noopener">
        <span class="activity-repo">${repo}</span>
        <span class="activity-msg">${escapeHtml(msg)}</span>
        <span class="activity-time">${timeAgo(new Date(event.created_at))}</span>
      </a>`;
    }).join("");
  } catch {
    container.innerHTML = `<div class="loading-text">Couldn't load GitHub activity right now.</div>`;
  }
}

function timeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  const units = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
  for (const [label, secs] of units) {
    const value = Math.floor(seconds / secs);
    if (value >= 1) return `${value}${label} ago`;
  }
  return "just now";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderStats() {
  document.getElementById("stat-status").innerHTML = `<span class="pulse-dot down"></span>not wired yet`;
  document.getElementById("stat-services").textContent = "8";
  document.getElementById("stat-uptime").textContent = "—";
  document.getElementById("stat-blocked").textContent = "—";
}

renderGithubActivity();
renderStats();