import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.FRED_API_KEY;
if (!API_KEY) {
  console.error("Missing env FRED_API_KEY");
  process.exit(1);
}

const SERIES = ["THREEFYTP10","DGS10","DGS30","DFII10","T10YIE","T10Y2Y","GFDEBTN","VIXCLS"];
const MAX_WEEKS = 166;

// 输出到：web/public/data
const OUT_DIR = path.resolve("web/public/data");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function fetchFredWeekly(seriesId) {
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(API_KEY)}` +
    `&file_type=json` +
    `&frequency=w` +
    `&sort_order=desc` +
    `&limit=${MAX_WEEKS}`;

  const res = await fetch(url);

  // 如果错误，把 body 打出来（便于定位：无效key/series/限流等）
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FRED fetch failed: ${seriesId} ${res.status} ${text}`);
  }

  const json = await res.json();

  const data = (json.observations || [])
    .filter(o => o.value !== ".")
    .map(o => ({ date: o.date, value: Number(o.value) }))
    .reverse()
    .slice(-MAX_WEEKS);

  return {
    seriesId,
    updatedAt: new Date().toISOString(),
    points: data.length,
    data
  };
}

let changed = false;

for (const id of SERIES) {
  const payload = await fetchFredWeekly(id);
  const file = path.join(OUT_DIR, `${id}.json`);

  const next = JSON.stringify(payload, null, 2) + "\n";
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";

  if (prev !== next) {
    fs.writeFileSync(file, next, "utf8");
    changed = true;
    console.log(`Updated ${id}: ${payload.points} points`);
  } else {
    console.log(`No change ${id}`);
  }
}

// 生成一个索引文件（方便前端一次性知道更新时间）
const indexFile = path.join(OUT_DIR, `_index.json`);
const indexPayload = {
  updatedAt: new Date().toISOString(),
  series: SERIES
};
const nextIndex = JSON.stringify(indexPayload, null, 2) + "\n";
const prevIndex = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, "utf8") : "";

if (prevIndex !== nextIndex) {
  fs.writeFileSync(indexFile, nextIndex, "utf8");
  changed = true;
}

process.exit(0);
