/** Saxlanmış load-test JSON üçün müqayisə və qənaətbəxş mətn (yalnız rəqəmlərdən çıxarılır). */

export interface ReportForInsights {
  id: string;
  displayName: string;
  randomTag: string;
  scenario: string;
  createdAt: string;
  k6?: { passed?: boolean; durationMs?: number };
  metricsSnapshot?: {
    repoSummary?: Array<{
      op: string;
      count?: number;
      avgPostgresMs: number | null;
      avgMongoMs: number | null;
      postgresFailures?: number;
      mongoFailures?: number;
    }>;
    httpSummary?: Array<{ avgTotalMs: number | null }>;
    decisionAccuracy?: {
      perOp?: Array<{
        op: string;
        correct: boolean | null;
        selected?: string;
        fasterDb?: string | null;
      }>;
      overall?: {
        evaluated: number;
        correct: number;
        accuracyPct: number | null;
      };
    };
  };
}

export type RepoBriefRow = {
  label: string;
  "PG ort. (ms)": number;
  "MG ort. (ms)": number;
};

export type AccuracyRow = {
  label: string;
  accuracyPct: number;
  evaluated: number;
};

export type InsightPackage = {
  briefs: ReturnType<typeof computeBrief>[];
  chartRepo: RepoBriefRow[];
  chartAccuracy: AccuracyRow[];
  compareFacts: string[];
  decisionAnalysis: string[];
  gaps: string[];
  conclusion: string;
};

function safeMean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return (
    Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
  );
}

function blendMs(avgPg: number | null, avgMg: number | null): number | null {
  if (avgPg != null && avgMg != null) return (avgPg + avgMg) / 2;
  return avgPg ?? avgMg ?? null;
}

export function computeBrief(r: ReportForInsights) {
  const repo = r.metricsSnapshot?.repoSummary ?? [];
  const pgVals = repo
    .map((x) => x.avgPostgresMs)
    .filter((n): n is number => typeof n === "number");
  const mgVals = repo
    .map((x) => x.avgMongoMs)
    .filter((n): n is number => typeof n === "number");

  let pgFasterOps = 0;
  let mgFasterOps = 0;
  let tieOps = 0;
  for (const row of repo) {
    const a = row.avgPostgresMs;
    const b = row.avgMongoMs;
    if (a != null && b != null) {
      if (a < b) pgFasterOps += 1;
      else if (b < a) mgFasterOps += 1;
      else tieOps += 1;
    }
  }

  const http = r.metricsSnapshot?.httpSummary ?? [];
  const httpAvgs = http
    .map((h) => h.avgTotalMs)
    .filter((n): n is number => typeof n === "number");

  const acc = r.metricsSnapshot?.decisionAccuracy?.overall;
  const perOp = r.metricsSnapshot?.decisionAccuracy?.perOp ?? [];
  const wrongOps = [
    ...new Set(perOp.filter((p) => p.correct === false).map((p) => p.op)),
  ];
  const unknownOps = [
    ...new Set(perOp.filter((p) => p.correct === null).map((p) => p.op)),
  ];

  const totalRepoCalls = repo.reduce((s, x) => s + (x.count ?? 0), 0);
  const totalFailures = repo.reduce(
    (s, x) => s + (x.postgresFailures ?? 0) + (x.mongoFailures ?? 0),
    0,
  );
  const failRate =
    totalRepoCalls > 0 ? totalFailures / totalRepoCalls : null;

  const avgPg = safeMean(pgVals);
  const avgMg = safeMean(mgVals);
  const avgHttp = safeMean(httpAvgs);
  const blend = blendMs(avgPg, avgMg);

  return {
    id: r.id,
    label: `${r.displayName} (#${r.randomTag})`,
    shortLabel: r.displayName,
    scenario: r.scenario,
    createdAt: r.createdAt,
    avgPg,
    avgMg,
    blend,
    avgHttp,
    pgFasterOps,
    mgFasterOps,
    tieOps,
    accPct: acc?.accuracyPct ?? null,
    accEval: acc?.evaluated ?? 0,
    accCorrect: acc?.correct ?? 0,
    k6Pass: r.k6?.passed ?? null,
    wrongOps,
    unknownOps,
    totalRepoCalls,
    totalFailures,
    failRate,
  };
}

function repoSpeedPhrase(b: ReturnType<typeof computeBrief>): string {
  if (b.avgPg != null && b.avgMg != null) {
    if (b.avgPg < b.avgMg) {
      return `repo ortasında PostgreSQL (${b.avgPg} ms) MongoDB-dan (${b.avgMg} ms) daha aşağı orta gecikmə verir`;
    }
    if (b.avgMg < b.avgPg) {
      return `repo ortasında MongoDB (${b.avgMg} ms) PostgreSQL-dən (${b.avgPg} ms) daha aşağı orta gecikmə verir`;
    }
    return `PG və MG üçün repo orta gecikməsi eynidir (${b.avgPg} ms)`;
  }
  if (b.avgPg != null) return `yalnız PG orta gecikməsi hesablanıb (${b.avgPg} ms)`;
  if (b.avgMg != null) return `yalnız MG orta gecikməsi hesablanıb (${b.avgMg} ms)`;
  return "repo orta gecikməsi üçün kifayət qədər ədəd yoxdur";
}

function buildConclusion(
  reports: ReportForInsights[],
  briefs: ReturnType<typeof computeBrief>[],
  gaps: string[],
): string {
  const parts: string[] = [];

  if (briefs.length === 1) {
    const b = briefs[0];
    parts.push(
      `${b.label} (${b.scenario}) üçün ${repoSpeedPhrase(b)}; əməliyyat səviyyəsində PG daha tez olduğu məqamlar ${b.pgFasterOps}, MG üçün ${b.mgFasterOps}, bərabər ${b.tieOps}.`,
    );
    if (b.avgHttp != null) {
      parts.push(`HTTP buffer üzrə orta cavab müddəti ${b.avgHttp} ms.`);
    }
    if (b.accPct != null && b.accEval > 0) {
      parts.push(
        `DecisionEngine üçün snapshot-da düzgün uyğunluq ${b.accPct}% (${b.accCorrect}/${b.accEval}).`,
      );
    }
    if (b.wrongOps.length) {
      parts.push(`Səhv təsnifat göstərilən əməllər (JSON-da correct=false): ${b.wrongOps.join(", ")}.`);
    }
    if (b.k6Pass === false) {
      parts.push("k6 nəticəsi FAIL — yükləmə və ya doğruluq şərtləri üçün loqlara baxmaq məqsədəuyğundur.");
    } else if (b.k6Pass === true) {
      parts.push("k6 nəticəsi PASS.");
    }
    if (gaps.length) {
      parts.push(
        `Ehtiyatlılıq: ${gaps.slice(0, 2).join(" ")} İrəli gedəndə daha çox nümunə və qarışıq ssenari ilə yenidən yoxlanılmalıdır.`,
      );
    }
    return parts.join(" ");
  }

  const blends = briefs
    .map((b, i) => ({ b, i }))
    .filter((x) => x.b.blend != null) as Array<{
    b: (typeof briefs)[0];
    i: number;
  }>;
  if (blends.length) {
    const best = blends.reduce((a, x) =>
      (x.b.blend as number) < (a.b.blend as number) ? x : a,
    );
    parts.push(
      `Seçilmiş ${reports.length} testdən ən aşağı “(PG+MG)/2” repo blend dəyəri ${best.b.label} üçündür (${(best.b.blend as number).toFixed(2)} ms; ssenari: ${best.b.scenario}).`,
    );
  }

  const accRanked = briefs
    .filter((b) => b.accPct != null && b.accEval >= 2)
    .sort((a, b) => (b.accPct as number) - (a.accPct as number));
  if (accRanked.length) {
    const top = accRanked[0];
    parts.push(
      `DecisionEngine düzgünlüyü ən yüksək olan snapshot ${top.label} (${top.accPct}%, ${top.accCorrect}/${top.accEval}).`,
    );
    const bottom = accRanked[accRanked.length - 1];
    if (bottom.id !== top.id) {
      parts.push(
        `Ən aşağı düzgünlük ${bottom.label} (${bottom.accPct}%, ${bottom.accCorrect}/${bottom.accEval}) — bu testdə engine-in seçimi real sürətli DB ilə daha az üst-üstə düşür.`,
      );
    }
  }

  const httpRanked = briefs
    .filter((b) => b.avgHttp != null)
    .sort((a, b) => (a.avgHttp as number) - (b.avgHttp as number));
  if (httpRanked.length >= 2) {
    const bestH = httpRanked[0];
    const worstH = httpRanked[httpRanked.length - 1];
    parts.push(
      `HTTP orta cavab müddəti ən aşağı ${bestH.label} (${bestH.avgHttp} ms), ən yüksək ${worstH.label} (${worstH.avgHttp} ms).`,
    );
  } else if (httpRanked.length === 1) {
    parts.push(`Yalnız bir testdə tam HTTP orta müddəti var: ${httpRanked[0].avgHttp} ms (${httpRanked[0].label}).`);
  }

  const fails = briefs.filter((b) => b.failRate != null && b.failRate >= 0.05);
  if (fails.length) {
    parts.push(
      `Bir tərəfin uğursuz olduğu sorğular (repo xəta cəmi / toplu çağırış) bu testlərdə daha yüksəkdir: ${fails
        .map(
          (b) =>
            `${b.shortLabel} — ~${(Number(b.failRate) * 100).toFixed(1)}% (${b.totalFailures} xəta / ${b.totalRepoCalls} çağırış)`,
        )
        .join("; ")}.`,
    );
  }

  const failsK6 = briefs.filter((b) => b.k6Pass === false);
  if (failsK6.length) {
    parts.push(`k6 FAIL: ${failsK6.map((b) => b.shortLabel).join(", ")}.`);
  }

  const allWrong = [...new Set(briefs.flatMap((b) => b.wrongOps))];
  if (allWrong.length) {
    parts.push(
      `Birdən çox testdə düzgün olmayan qərarlar bu əməllərdə müşahidə olunub (fakt ikiqat yoxlamaya dəyər): ${allWrong.join(", ")}.`,
    );
  }

  parts.push(
    "Bu mətn yalnız saxlanmış JSON-dakı yığılmış göstəricilərdən çıxarılıb — real dünya latensi və yükləmə modelindən asılı olaraq fərq doğala bilər.",
  );

  return parts.join(" ");
}

export function buildComparisonInsights(
  reports: ReportForInsights[],
): InsightPackage {
  if (!reports.length) {
    return {
      briefs: [],
      chartRepo: [],
      chartAccuracy: [],
      compareFacts: [],
      decisionAnalysis: [],
      gaps: [],
      conclusion:
        "Hesabat seçilməyib. Aşağıdan saxlanmış testləri işarələyin ki, diaqramlar və qənaət JSON-dakı faktiklardan hesablansın.",
    };
  }

  const briefs = reports.map(computeBrief);

  const chartRepo: RepoBriefRow[] = briefs.map((b) => ({
    label:
      b.shortLabel.length > 16 ? `${b.shortLabel.slice(0, 15)}…` : b.shortLabel,
    "PG ort. (ms)": Math.round((b.avgPg ?? 0) * 100) / 100,
    "MG ort. (ms)": Math.round((b.avgMg ?? 0) * 100) / 100,
  }));

  const chartAccuracy: AccuracyRow[] = briefs.flatMap((b) => {
    if (b.accPct === null || b.accEval === 0) return [];
    return [
      {
        label:
          b.shortLabel.length > 16
            ? `${b.shortLabel.slice(0, 15)}…`
            : b.shortLabel,
        accuracyPct: b.accPct,
        evaluated: b.accEval,
      },
    ];
  });

  const compareFacts: string[] = [];
  for (const b of briefs) {
    compareFacts.push(
      `${b.label}: ${repoSpeedPhrase(b)}; əməl üzrə PG üstünlük sayı ${b.pgFasterOps}, MG üstünlük ${b.mgFasterOps}, bərabərlik ${b.tieOps}.`,
    );
    if (b.avgHttp != null) {
      compareFacts.push(
        `${b.label}: HTTP buffer orta cavab müddəti ${b.avgHttp} ms.`,
      );
    }
    if (b.failRate != null && b.totalRepoCalls > 0) {
      compareFacts.push(
        `${b.label}: repo toplu çağırış ${b.totalRepoCalls}, qeydə alınmış bir tərəf xətalarının cəmi ${b.totalFailures} (ümumi nisbət ~${(
          Number(b.failRate) * 100
        ).toFixed(2)}%).`,
      );
    }
  }

  if (briefs.length >= 2) {
    const byBlend = [...briefs].sort(
      (a, b) => (a.blend ?? Infinity) - (b.blend ?? Infinity),
    );
    const first = byBlend[0];
    const last = byBlend[byBlend.length - 1];
    if (first.blend != null && last.blend != null && first.id !== last.id) {
      compareFacts.push(
        `(PG+MG)/2 repo blend ən aşağı: ${first.label} (${first.blend.toFixed(2)} ms), ən yüksək: ${last.label} (${last.blend.toFixed(2)} ms).`,
      );
    }
  }

  const decisionAnalysis: string[] = [];
  for (const b of briefs) {
    if (b.accPct != null && b.accEval > 0) {
      decisionAnalysis.push(
        `${b.label}: DecisionEngine düzgünlüyü ${b.accPct}% — ${b.accCorrect} düzgün / ${b.accEval} qiymətləndirilən.`,
      );
    } else {
      decisionAnalysis.push(
        `${b.label}: decisionAccuracy üçün qiymətləndirmə çox az və ya mövcud deyil (engine-in seçimi ilə real sürətli DB müqayisəsi snapshot-da boşdur).`,
      );
    }
    if (b.wrongOps.length) {
      decisionAnalysis.push(
        `${b.label}: səhv qəbul edilən əməllər (snapshot-da correct=false): ${b.wrongOps.join(", ")}.`,
      );
    }
    if (b.unknownOps.length) {
      decisionAnalysis.push(
        `${b.label}: nümunəsi az olduğu üçün “düzgün?” sahəsi boş qalan əməllər: ${b.unknownOps.join(", ")}.`,
      );
    }
  }

  const gaps: string[] = [];
  for (const b of briefs) {
    if (b.accEval > 0 && b.accEval < 5) {
      gaps.push(
        `${b.shortLabel} üçün qiymətləndirilən əməl sayı cəmi ${b.accEval} — daha stabil qənaət üçün daha uzun yükləmə tövsiyyə olunur.`,
      );
    }
    if (b.unknownOps.length) {
      gaps.push(
        `${b.shortLabel}: bəzi əməllərdə “correct” sahəsi boşdur; engine daha çoxdəfə seçim etmədən və ya bir tərəf uğursuz olduqda default/statistika səbəbi ilə qərar verə bilər.`,
      );
    }
    if (b.failRate != null && b.failRate >= 0.05) {
      gaps.push(
        `${b.shortLabel}: repo xətalarının toplu nisbəti yüksəkdir (~${(
          Number(b.failRate) * 100
        ).toFixed(1)}%).`,
      );
    }
    if (b.k6Pass === false) {
      gaps.push(
        `${b.shortLabel}: k6 FAIL — test və ya infra şərtlərini uyğunlaşdırmadan engine düzgünlüyünü ümumiləşdirmək risklidir.`,
      );
    }
  }

  const conclusion = buildConclusion(reports, briefs, gaps);

  return {
    briefs,
    chartRepo,
    chartAccuracy,
    compareFacts,
    decisionAnalysis,
    gaps,
    conclusion,
  };
}
