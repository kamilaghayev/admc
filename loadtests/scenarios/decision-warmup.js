import http from "k6/http";
import { check, sleep } from "k6";
import { Gauge, Counter } from "k6/metrics";
import { authHeaders, loginAdmin } from "../lib/auth.js";
import { randomItem, randomPostBody, randomUpdateBody } from "../lib/random.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const ADMIN_USERNAME = __ENV.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || "admin";
const ACCURACY_THRESHOLD = Number(__ENV.ACCURACY_THRESHOLD || 60);
const SEED_COUNT = Number(__ENV.SEED_COUNT || 30);

export const options = {
  scenarios: {
    warmup: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP_UP || "30s", target: Number(__ENV.VUS || 20) },
        { duration: __ENV.HOLD || "90s", target: Number(__ENV.VUS || 20) },
        { duration: __ENV.RAMP_DOWN || "20s", target: 0 },
      ],
      gracefulStop: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    decision_accuracy_pct: [`value>=${ACCURACY_THRESHOLD}`],
    decision_evaluated_ops: ["value>=1"],
  },
};

const accuracyGauge = new Gauge("decision_accuracy_pct");
const evaluatedGauge = new Gauge("decision_evaluated_ops");
const correctOpsCounter = new Counter("decision_correct_ops");

const JSON_HEADERS = { headers: { "Content-Type": "application/json" } };

export function setup() {
  const ids = [];
  for (let i = 0; i < SEED_COUNT; i++) {
    const r = http.post(
      `${BASE_URL}/api/posts`,
      JSON.stringify(randomPostBody("warmup")),
      { ...JSON_HEADERS, tags: { name: "posts_seed" } },
    );
    if (r.status === 201) {
      const id = r.json("id");
      if (typeof id === "string") ids.push(id);
    }
  }
  if (ids.length === 0) {
    throw new Error(`seed failed; API not reachable at ${BASE_URL}`);
  }
  const tokens = loginAdmin(BASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD);
  return { ids, accessToken: tokens.accessToken };
}

export default function (data) {
  const dice = Math.random();
  if (dice < 0.55) {
    const r = http.get(`${BASE_URL}/api/posts?limit=20`, {
      tags: { name: "posts_list" },
    });
    check(r, { "list 200": (x) => x.status === 200 });
  } else if (dice < 0.85) {
    const id = randomItem(data.ids);
    const r = http.get(`${BASE_URL}/api/posts/${id}`, {
      tags: { name: "posts_get" },
    });
    check(r, { "get 200|404": (x) => x.status === 200 || x.status === 404 });
  } else if (dice < 0.95) {
    const r = http.post(
      `${BASE_URL}/api/posts`,
      JSON.stringify(randomPostBody("warmup-vu")),
      { ...JSON_HEADERS, tags: { name: "posts_create" } },
    );
    if (check(r, { "create 201": (x) => x.status === 201 })) {
      const id = r.json("id");
      if (typeof id === "string") data.ids.push(id);
    }
  } else {
    const id = randomItem(data.ids);
    http.patch(
      `${BASE_URL}/api/posts/${id}`,
      JSON.stringify(randomUpdateBody()),
      { ...JSON_HEADERS, tags: { name: "posts_patch" } },
    );
  }
  sleep(0.1 + Math.random() * 0.3);
}

export function teardown(data) {
  const r = http.get(`${BASE_URL}/api/metrics/decision/accuracy`, {
    ...authHeaders(data.accessToken),
    tags: { name: "decision_accuracy" },
  });
  if (
    !check(r, { "accuracy 200": (x) => x.status === 200 })
  ) {
    console.error(`accuracy endpoint failed: ${r.status} ${r.body}`);
    return;
  }
  const overall = r.json("overall");
  const perOp = r.json("perOp") || [];
  const evaluated = Number(overall?.evaluated || 0);
  const correct = Number(overall?.correct || 0);
  const pct = overall?.accuracyPct == null ? 0 : Number(overall.accuracyPct);

  evaluatedGauge.add(evaluated);
  accuracyGauge.add(pct);
  correctOpsCounter.add(correct);

  console.log("--- DecisionEngine accuracy ---");
  console.log(
    `evaluated=${evaluated} correct=${correct} accuracyPct=${pct} threshold=${ACCURACY_THRESHOLD}`,
  );
  for (const p of perOp) {
    const c =
      p.correct === true ? "OK"
      : p.correct === false ? "WRONG"
      : "n/a";
    console.log(
      `  ${p.op.padEnd(15)} selected=${p.selected.padEnd(8)} faster=${String(p.fasterDb).padEnd(8)} ${c} pg=${p.pgAvgMs}ms mg=${p.mgAvgMs}ms samples(pg/mg)=${p.samples.pg}/${p.samples.mg} (${p.reason})`,
    );
  }
}
