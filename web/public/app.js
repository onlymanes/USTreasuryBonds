const SERIES_META = {
  THREEFYTP10: "10Y Term Premium (proxy for ACM)",
  DGS10: "10Y Treasury Yield",
  DGS30: "30Y Treasury Yield",
  DFII10: "10Y Real Yield",
  T10YIE: "10Y Inflation Expectation",
  T10Y2Y: "10Y-2Y Spread",
  GFDEBTN: "US Federal Debt",
  GFDEBTN_DELTA: "US Federal Debt Δ (current - previous)",
  VIXCLS: "VIX"
};

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  if (Math.abs(n) >= 100000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function calcWoW(data) {
  const last = data?.at(-1)?.value;
  const prev = data?.at(-2)?.value;
  if (last === undefined || prev === undefined) return { last, prev, delta: null, pct: null };
  const delta = last - prev;
  const pct = prev === 0 ? null : (delta / prev) * 100;
  return { last, prev, delta, pct };
}

function lastNYears(data, years = 3) {
  const arr = data || [];
  if (!arr.length) return arr;

  const end = new Date(arr.at(-1).date);
  if (Number.isNaN(end.getTime())) return arr;

  const start = new Date(end);
  start.setFullYear(start.getFullYear() - years);

  return arr.filter(d => new Date(d.date) >= start);
}

function tltDecision({ acmtp10, dgs10, vix }) {
  // 你之前那套框架：期限溢价 + 长端利率 + 风险偏好(VIX)
  const reasons = [];
  let color = "yellow";
  let action = "Sell Call / Wait（中性：偏向卖Covered Call或观望）";

  if (acmtp10 < 0) reasons.push("ACMTP10 < 0（期限溢价为负）");
  if (dgs10 < 3.5) reasons.push("DGS10 < 3.5（长端相对低）");
  if (vix < 18) reasons.push("VIX < 18（波动率温和）");

  if (acmtp10 < 0 && dgs10 < 3.5 && vix < 18) {
    color = "green";
    action = "Buy（可分批加仓TLT / 加久期）";
  } else if (acmtp10 > 0.5 || dgs10 > 4.5 || vix > 25) {
    color = "red";
    action = "Wait / Hedge（避免加仓；必要时用保护性Put或降低久期）";
    if (acmtp10 > 0.5) reasons.push("ACMTP10 > 0.5（期限溢价上行压估值）");
    if (dgs10 > 4.5) reasons.push("DGS10 > 4.5（长端利率偏高）");
    if (vix > 25) reasons.push("VIX > 25（风险/波动偏高）");
  }

  return { color, action, reasons };
}

async function loadJson(p) {
  // 加 cache bust，确保按钮刷新能拿到最新 Pages 内容
  const res = await fetch(`${p}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load ${p}: ${res.status}`);
  return res.json();
}

function renderSeriesCard(id, payload) {
  const name = SERIES_META[id] || id;
  const data = payload?.data || [];
  const { last, prev, delta, pct } = calcWoW(data);

  const rows = data.slice().reverse().slice(0, 40)
    .map(d => `<tr><td>${d.date}</td><td>${fmt(d.value)}</td></tr>`).join("");

  return `
    <div class="card">
      <div class="head">
        <div>
          <div class="title"><b>${id}</b> — ${name}</div>
          <div class="kpis">
            <div class="kpi"><b>本周</b>${fmt(last)}</div>
            <div class="kpi"><b>上周</b>${fmt(prev)}</div>
            <div class="kpi"><b>WoW</b>${fmt(delta)} (${pct===null? "-" : pct.toFixed(2) + "%"})</div>
          </div>
        </div>
        <div class="muted">points: ${data.length}</div>
      </div>

      <div class="chartWrap">
        <canvas id="c_${id}"></canvas>
      </div>

      <details>
        <summary>显示表格（最近40周）</summary>
        <table>
          <thead><tr><th>Date</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>
    </div>
  `;
}

function drawChart(id, label, data) {
  const canvas = document.getElementById(`c_${id}`);
  if (!canvas) return;
  new Chart(canvas, {
    type: "line",
    data: {
      labels: data.map(d => d.date),
      datasets: [{ label, data: data.map(d => d.value), borderWidth: 2 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { x: { ticks: { maxTicksLimit: 8 } } }
    }
  });
}

function toDeltaSeries(levelSeries) {
  const s = levelSeries || [];
  const out = [];
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1]?.value;
    const cur = s[i]?.value;
    if (prev === undefined || cur === undefined) continue;
    out.push({ date: s[i].date, value: cur - prev });
  }
  return out;
}

async function renderAll() {
  const index = await loadJson("./data/_index.json");
  document.getElementById("updatedAt").textContent = index.updatedAt || "-";

  const store = {};
  for (const id of index.series) {
    store[id] = await loadJson(`./data/${id}.json`);
  }

  // 仅对 GFDEBTN：裁剪为最近3年（其他 series 不变）
  if (store.GFDEBTN?.data?.length) {
    store.GFDEBTN.data = lastNYears(store.GFDEBTN.data, 3);
    store.GFDEBTN.points = store.GFDEBTN.data.length;
  }

  // GFDEBTN Δ：基于“裁剪后的 GFDEBTN”生成（自然也是最近3年）
  const debtLevel = store.GFDEBTN?.data || [];
  const debtDelta = toDeltaSeries(debtLevel);
  store.GFDEBTN_DELTA = {
    seriesId: "GFDEBTN_DELTA",
    updatedAt: store.GFDEBTN?.updatedAt || new Date().toISOString(),
    points: debtDelta.length,
    data: debtDelta
  };

  // TLT 信号
  const acmtp10 = store.THREEFYTP10?.data?.at(-1)?.value;
  const dgs10 = store.DGS10?.data?.at(-1)?.value;
  const vix = store.VIXCLS?.data?.at(-1)?.value;

  const { color, action, reasons } = tltDecision({ acmtp10, dgs10, vix });

  const light = document.getElementById("tltLight");
  light.className = `status ${color}`;
  document.getElementById("tltAction").textContent = action;
  document.getElementById("tltMetrics").textContent =
    `ACMTP10=${fmt(acmtp10)} | DGS10=${fmt(dgs10)} | VIX=${fmt(vix)}`;
  document.getElementById("tltReason").textContent =
    reasons.length ? `触发因素：${reasons.join("；")}` : "";

  // 8 个卡片
  const ids = [...index.series, "GFDEBTN_DELTA"];

  // grid
  grid.innerHTML = ids
    .map(id => renderSeriesCard(id, store[id]))
    .join("");

  // charts
  for (const id of ids) {
    drawChart(id, SERIES_META[id] || id, store[id]?.data || []);
  }
}

document.getElementById("reloadBtn").addEventListener("click", async () => {
  // 只刷新前端读取（不触发更新任务）
  await renderAll();
});

renderAll().catch(err => {
  console.error(err);
  alert(String(err));
});
