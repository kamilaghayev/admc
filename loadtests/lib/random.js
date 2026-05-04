const TITLES = [
  "Multi-DB qeyd",
  "DecisionEngine müşahidəsi",
  "Latency analizi",
  "Race read nəticəsi",
  "Mirror write yoxlanışı",
  "Smart repo qeydiyyatı",
  "Postgres vs Mongo",
  "k6 yük testi qeydi",
  "Redis-aggregat dəyəri",
  "Real-time metrika",
];

const TAGS = [
  ["k6", "loadtest"],
  ["decision", "race"],
  ["postgres"],
  ["mongo"],
  ["mirror", "write"],
  ["read", "race"],
  ["benchmark"],
];

export function randomItem(xs) {
  return xs[Math.floor(Math.random() * xs.length)];
}

export function randomInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

export function randomPostBody(authorPrefix = "k6") {
  const idx = randomInt(1_000_000);
  return {
    title: `${randomItem(TITLES)} #${idx}`,
    content: `Avtomatik k6 sənədi. Random=${Math.random().toString(36).slice(2, 12)}`,
    author: `${authorPrefix}-${randomInt(20)}`,
    tags: randomItem(TAGS),
  };
}

export function randomUpdateBody() {
  return {
    content: `Yenilənmiş k6 mətn. ts=${Date.now()}`,
  };
}
