// Runs inside GitHub Actions. Pure Node built-ins only — no npm install needed.
const fs = require("fs");

const DATA_PATH = "data/activities.json";
const raw = fs.readFileSync(DATA_PATH, "utf8");
const data = JSON.parse(raw);

const now = Date.now();
const newlyExpired = [];

for (const activity of data.activities) {
  const maxMs = activity.maxDurationMinutes * 60 * 1000;
  const resetAt = Date.parse(activity.resetAt);
  const expiredAt = resetAt + maxMs;

  if (now >= expiredAt && !activity.notified) {
    newlyExpired.push(activity.name);
    activity.notified = true; // so we don't email again every 15 minutes
  }
}

if (newlyExpired.length > 0) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
}

// Communicate results to the workflow via GITHUB_OUTPUT
const outFile = process.env.GITHUB_OUTPUT;
const hasExpired = newlyExpired.length > 0;
const list = newlyExpired.join(", ");

if (outFile) {
  fs.appendFileSync(outFile, `has_expired=${hasExpired}\n`);
  fs.appendFileSync(outFile, `expired_list=${list}\n`);
}

console.log(hasExpired ? `Expired: ${list}` : "Nothing expired.");
