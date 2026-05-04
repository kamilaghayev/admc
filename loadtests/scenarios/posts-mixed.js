import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";
import { randomInt, randomItem, randomPostBody, randomUpdateBody } from "../lib/random.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const SEED_COUNT = Number(__ENV.SEED_COUNT || 50);

export const options = {
  stages: [
    { duration: __ENV.RAMP_UP || "30s", target: Number(__ENV.VUS_LOW || 10) },
    { duration: __ENV.HOLD_LOW || "1m", target: Number(__ENV.VUS_LOW || 10) },
    { duration: __ENV.RAMP_HIGH || "30s", target: Number(__ENV.VUS_HIGH || 50) },
    { duration: __ENV.HOLD_HIGH || "1m", target: Number(__ENV.VUS_HIGH || 50) },
    { duration: __ENV.RAMP_DOWN || "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<500"],
    "http_req_duration{name:posts_list}": ["p(95)<400"],
    "http_req_duration{name:posts_get}": ["p(95)<400"],
  },
};

const listTrend = new Trend("posts_list_ms", true);
const getTrend = new Trend("posts_get_ms", true);
const createTrend = new Trend("posts_create_ms", true);
const patchTrend = new Trend("posts_patch_ms", true);
const opsCounter = new Counter("posts_ops_total");

const JSON_HEADERS = { headers: { "Content-Type": "application/json" } };

export function setup() {
  const ids = [];
  for (let i = 0; i < SEED_COUNT; i++) {
    const r = http.post(
      `${BASE_URL}/api/posts`,
      JSON.stringify(randomPostBody("seed")),
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
  return { ids };
}

export default function (data) {
  const ids = data.ids;
  const dice = Math.random();

  if (dice < 0.5) {
    const r = http.get(`${BASE_URL}/api/posts?limit=20`, {
      tags: { name: "posts_list" },
    });
    listTrend.add(r.timings.duration);
    check(r, { "list 200": (x) => x.status === 200 });
    opsCounter.add(1);
  } else if (dice < 0.75) {
    const id = randomItem(ids);
    const r = http.get(`${BASE_URL}/api/posts/${id}`, {
      tags: { name: "posts_get" },
    });
    getTrend.add(r.timings.duration);
    check(r, { "get 200|404": (x) => x.status === 200 || x.status === 404 });
    opsCounter.add(1);
  } else if (dice < 0.92) {
    const r = http.post(
      `${BASE_URL}/api/posts`,
      JSON.stringify(randomPostBody("vu")),
      { ...JSON_HEADERS, tags: { name: "posts_create" } },
    );
    createTrend.add(r.timings.duration);
    if (check(r, { "create 201": (x) => x.status === 201 })) {
      const id = r.json("id");
      if (typeof id === "string") ids.push(id);
    }
    opsCounter.add(1);
  } else {
    const id = randomItem(ids);
    const r = http.patch(
      `${BASE_URL}/api/posts/${id}`,
      JSON.stringify(randomUpdateBody()),
      { ...JSON_HEADERS, tags: { name: "posts_patch" } },
    );
    patchTrend.add(r.timings.duration);
    check(r, { "patch 200|404": (x) => x.status === 200 || x.status === 404 });
    opsCounter.add(1);
  }

  sleep(0.2 + Math.random() * 0.4);
  if (ids.length > 250) ids.splice(0, randomInt(50));
}
