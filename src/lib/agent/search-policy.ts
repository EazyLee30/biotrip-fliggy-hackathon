import type { SearchKind } from "@/lib/travel-search-types";

export type AgentSearchPolicy = { maxQueries: number; allowedKinds?: SearchKind[] };

/** Only explicit limits in the current user turn may narrow tool execution. */
export function searchPolicyFromText(text: string): AgentSearchPolicy {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const once = /(?:搜索|检索|查询|飞猪|工具|search|query|call)/.test(normalized) && (/(?:只|仅|最多)(?:能|要|需|做|用|使用|调(?:用)?|执行|进行|检索|搜索|搜|查|一次|一轮|一项|飞猪|的|语义|关键词|航班|工具|次|\s)*(?:一|1)次/.test(normalized)
    || /(?:只|仅|最多)(?:搜索|检索|搜|查)(?:一|1)(?:次|回)/.test(normalized)
    || /\b(?:only\s+(?:one|1)\s+(?:search|query|call)|(?:search|query|call)\s+(?:only\s+)?once|at\s+most\s+(?:one|1)\s+(?:search|query|call))\b/.test(normalized));
  const noSearch = /(?:不要|不必|不用|禁止)(?:再|进行|调用|任何|联网|飞猪|的|\s)*(?:搜索|检索|查询)/.test(normalized)
    || /\b(?:do not|don['’]t|no)\s+(?:web\s+)?search\b/.test(normalized);
  const kinds: Array<[SearchKind, string]> = [
    ["semantic", "语义(?:搜索|检索)?|fliggy_ai_search|semantic(?: search)?"],
    ["keyword", "关键词(?:搜索|检索)?|fliggy_fast_search|keyword(?: search)?"],
    ["flight", "航班(?:搜索|检索)?|search_flight|flight(?: search)?"],
    ["train", "火车(?:搜索|检索)?|车次(?:搜索|检索)?|search_domestic_train|train(?: search)?"],
    ["hotel", "酒店(?:搜索|检索)?|search_hotels|hotel(?: search)?"],
    ["poi", "poi(?:搜索|检索)?|search_poi"],
    ["marriott_hotel", "万豪酒店(?:搜索|检索)?|search_marriott_hotels"],
    ["marriott_package", "万豪套餐(?:搜索|检索)?|search_marriott_packages"],
  ];
  const allowedKinds = kinds.filter(([, pattern]) => new RegExp(`(?:只|仅)(?:能|要|需|做|用|使用|调(?:用)?|执行|进行|一次|1次|一轮|一项|飞猪|的|\\s)*(?:${pattern})|\\bonly\\s+(?:use\\s+)?(?:${pattern})(?:\\b|$)`, "i").test(normalized)).map(([kind]) => kind);
  return { maxQueries: noSearch ? 0 : once ? 1 : 4, ...(allowedKinds.length ? { allowedKinds } : {}) };
}

export function searchIsRestricted(policy: AgentSearchPolicy): boolean {
  return policy.maxQueries < 4 || Boolean(policy.allowedKinds?.length);
}

export function expectsCurrentSearch(text: string, policy: AgentSearchPolicy): boolean {
  if (policy.maxQueries <= 0 || !searchIsRestricted(policy)) return false;
  const recap = /(?:复述|解释|总结|回顾|比较|整理|概括)[^。！？\n]{0,60}(?:已有|历史|上次|之前|刚才|刚刚)[^。！？\n]{0,60}(?:结果|回执|内容)/.test(text)
    || /(?:summarize|explain|recap|review|compare)\s+(?:the\s+)?(?:previous|earlier|existing|last)\s+(?:search\s+)?results?/i.test(text);
  const newRequest = /(?:请|现在|这次|本次|重新|然后|接着|再帮我)(?:帮我|再|用|做|执行|进行|调用|\s)*(?:只|仅|最多)[^，。；！？\n]{0,20}(?:搜索|检索|查询)/.test(text);
  return !recap || newRequest;
}

export function contextAccessFromText(text: string): { memory: boolean; body: boolean } {
  // A negative access clause may mention both sources, e.g. “不读取身体记录或旅行记忆”.
  const clauses = text.toLowerCase().split(/[，。；！？,;.!?\n]/).filter(clause => /(?:不(?:要|用|必|需)?|无需|禁止)(?:再|去|自动|主动|帮我|\s)*(?:读取|读|使用|访问|调用|获取|参考|查)|\b(?:do not|don['’]t|without|no)\s+(?:read|reading|access|accessing|use|using|fetch|fetching)\b/.test(clause));
  return {
    memory: !clauses.some(clause => /记忆|偏好记录|memory|memories/.test(clause)),
    body: !clauses.some(clause => /身体|疲劳|健康|whoop|body|health|fatigue/.test(clause)),
  };
}
