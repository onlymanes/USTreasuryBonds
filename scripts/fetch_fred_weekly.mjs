import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.FRED_API_KEY;
if (!API_KEY) {
  console.error("Missing env FRED_API_KEY");
  process.exit(1);
}

const SERIES = ["THREEFYTP10","DGS10","DGS30","DFII10","T10YIE","T10Y2Y","GFDEBTN","VIXCLS"];
const MAX_POINTS = 166;

// GFDEBTN 不支持 frequency=w，必须用原始频率（空）/或 q/sa/a
const SERIES_FREQ = {
  GFDEBTN: "" // 原始频率（不要 frequency 参数）
};

// 输出到：web/public/data
const OUT_DIR = path.resolve("web/public/data");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function fetchFred(seriesId) {
  const freq = Object.prototype.hasOwnProperty.call(SERIES_FREQ, seriesId)
    ? SERIES_FREQ[seriesId]
    : "w";

  const freqParam = freq === "" ? "" : `&frequency=${encodeURIComponent(freq)}`;

  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(API_KEY)}` +
    `&file_type=json` +
    `${freqParam}` +
    `&sort_order=desc` +
    `&limit=${MAX_POINTS}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FRED fetch failed: ${seriesId} ${res.status} ${text}`);
  }

  const json = await res.json();

  const data = (json.observations || [])
    .filter(o => o.value !== ".")
    .map(o => ({ date: o.date, value: Number(o.value) }))
    .reverse()
    .slice(-MAX_POINTS);

  return {
    seriesId,
    freq: freq === "" ? "native" : freq,
    updatedAt: new Date().toISOString(),
    points: data.length,
    data
  };
}

let changed = false;

for (const id of SERIES) {
  const payload = await fetchFred(id);
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

// 索引文件
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
