import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { authHeaders, loginAdmin, logout, refresh } from "../lib/auth.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const ADMIN_USERNAME = __ENV.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || "admin";

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || "1m",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:auth_login}": ["p(95)<400"],
    "http_req_duration{name:auth_refresh}": ["p(95)<300"],
    rotated_refresh_total: ["count>0"],
  },
};

const rotatedCounter = new Counter("rotated_refresh_total");
const meCounter = new Counter("me_ok_total");

export default function () {
  const tokens = loginAdmin(BASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD);
  const meRes = http.get(`${BASE_URL}/api/auth/me`, {
    ...authHeaders(tokens.accessToken),
    tags: { name: "auth_me" },
  });
  if (check(meRes, { "me 200": (r) => r.status === 200 })) {
    meCounter.add(1);
  }

  const metricsRes = http.get(`${BASE_URL}/api/metrics/summary`, {
    ...authHeaders(tokens.accessToken),
    tags: { name: "metrics_summary" },
  });
  check(metricsRes, { "metrics 200": (r) => r.status === 200 });

  const refreshed = refresh(BASE_URL, tokens.refreshToken);
  if (
    check(refreshed, {
      "refresh 200": (r) => r.status === 200,
      "refresh: yeni token verilib": (r) =>
        r.json("tokens.accessToken") &&
        r.json("tokens.accessToken") !== tokens.accessToken,
      "refresh: yeni refresh verilib": (r) =>
        r.json("tokens.refreshToken") &&
        r.json("tokens.refreshToken") !== tokens.refreshToken,
    })
  ) {
    rotatedCounter.add(1);
    const newRefresh = refreshed.json("tokens.refreshToken");
    const reused = refresh(BASE_URL, tokens.refreshToken);
    check(reused, { "kohne refresh 401 (rotation)": (r) => r.status === 401 });
    logout(BASE_URL, newRefresh);
  } else {
    logout(BASE_URL, tokens.refreshToken);
  }

  sleep(0.3 + Math.random() * 0.5);
}
