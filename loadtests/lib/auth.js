import http from "k6/http";
import { check, fail } from "k6";

export function loginAdmin(baseUrl, username, password) {
  const res = http.post(
    `${baseUrl}/api/auth/login`,
    JSON.stringify({ username, password }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "auth_login" } },
  );
  if (
    !check(res, {
      "login: 200": (r) => r.status === 200,
      "login: has access token": (r) => !!r.json("tokens.accessToken"),
    })
  ) {
    fail(`login failed (${res.status}): ${res.body}`);
  }
  return {
    accessToken: res.json("tokens.accessToken"),
    refreshToken: res.json("tokens.refreshToken"),
    user: res.json("user"),
  };
}

export function authHeaders(accessToken) {
  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
}

export function refresh(baseUrl, refreshToken) {
  const res = http.post(
    `${baseUrl}/api/auth/refresh`,
    JSON.stringify({ refreshToken }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "auth_refresh" } },
  );
  return res;
}

export function logout(baseUrl, refreshToken) {
  return http.post(
    `${baseUrl}/api/auth/logout`,
    JSON.stringify({ refreshToken }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "auth_logout" } },
  );
}
