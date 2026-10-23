import type { TravelQuery, VerifiedOffer } from "./travel-search-types";

// Explicit service requests only; this is not an open-ended classifier for
// all destinations or travel products.
const SERVICES = [
  {
    request: /喝茶|饮茶|品茶|茶馆|茶室|茶楼|茶社|茶舍|茶坊|茶艺|下午茶|tea\s*(?:house|room)|afternoon\s*tea/i,
    evidence: /喝茶|饮茶|品茶|茶馆|茶室|茶楼|茶社|茶舍|茶坊|茶轩|茶艺|下午茶|tea\s*(?:house|room)|afternoon\s*tea/i,
    venue: /茶馆|茶室|茶楼|茶社|茶舍|茶坊|茶艺|下午茶|tea\s*(?:house|room)|afternoon\s*tea/i,
  },
  {
    request: /咖啡|café|cafe|coffee/i,
    evidence: /咖啡|café|cafe|coffee/i,
    venue: /咖啡馆|咖啡店|咖啡厅|咖啡吧|café|cafe|coffee\s*(?:house|shop|bar)/i,
  },
  {
    request: /吃饭|用餐|就餐|餐厅|餐馆|餐食|早餐|午餐|晚餐|早午餐|自助餐|美食|火锅|烧烤|restaurant|dining|meal|brunch|buffet/i,
    evidence: /餐厅|餐馆|餐食|早餐|午餐|晚餐|早午餐|自助餐|小吃|火锅|烧烤|面馆|烤肉|西餐|日料|中餐|restaurant|dining|meal|brunch|buffet/i,
    venue: /餐厅|餐馆|自助餐|早午餐|火锅|烧烤|面馆|烤肉|西餐|日料|中餐|restaurant|dining|brunch|buffet/i,
  },
  {
    request: /按摩|足疗|足浴|推拿|水疗|温泉|泡汤|\bspa\b|massage/i,
    evidence: /按摩|足疗|足浴|推拿|水疗|温泉|泡汤|\bspa\b|massage/i,
    venue: /按摩店|足疗店|足浴店|足浴馆|推拿店|水疗中心|温泉馆|泡汤|spa\s*(?:center|centre)|massage\s*(?:studio|parlor|parlour)/i,
  },
] as const;
const PRODUCT_FACTS = new Set(["标签", "套餐说明", "票种"]);
const SERVICE_PACKAGE = /套餐|体验券|门票|套票|次卡|服务券|餐券|代金券|\d+\s*分钟|\d+\s*min\b/i;
const LODGING_REQUEST = /住宿|入住|住在|客房|房间|(?:附近|周边|旁边|旁).{0,4}(?:酒店|宾馆|民宿|客栈)|(?:酒店|宾馆|民宿|客栈)(?:推荐)?\s*$/;

export function searchRelevanceDetail(code?: string | null): string | undefined {
  if (code === "SEARCH_NO_RELEVANT_MATCHES") return "返回的商品没有提供所需服务的明确来源信息，未将普通酒店或景点当作匹配的服务推荐。这次没有自动扩大搜索。";
  if (code === "SEARCH_RELEVANCE_LIMITED") return "仅展示来源标题或商品标签明确提到所需服务的结果；能否入座、实际距离、营业状态与是否可单独使用仍需在来源页核对。";
  return undefined;
}

/** Product evidence is not proof of seating, walk-in access or proximity. */
export function relevantTravelOffers(offers: VerifiedOffer[], query: TravelQuery): { offers: VerifiedOffer[]; code?: string } {
  if (["flight", "train", "hotel", "marriott_hotel"].includes(query.kind)) return { offers };
  const requested = [query.args.query, query.args.keyword, query.args.keyWords].filter(value => typeof value === "string").join(" ");
  const services = SERVICES.filter(service => service.request.test(requested));
  // E.g. "咖啡馆附近酒店" or "含早餐的酒店" is still a lodging query.
  if (!services.length || LODGING_REQUEST.test(requested)) return { offers };
  const matching = offers.filter(offer => {
    const evidence = [offer.name, ...offer.facts.filter(fact => PRODUCT_FACTS.has(fact.label)).map(fact => fact.value)].join(" ");
    const lodgingOrScenic = ["hotel", "marriott_hotel", "poi"].includes(offer.kind)
      || /住宿|酒店相关|景点/.test(offer.category)
      || /酒店|宾馆|民宿|客栈|山庄|度假村|客房|套房|大床|双床|\bhotel\b|\bresort\b/i.test(offer.name);
    return services.some(service => {
      if (!service.evidence.test(evidence)) return false;
      // Amenities and scenic-site tags do not establish a separately available
      // service. Require a service venue/title or explicit package instead.
      return (!lodgingOrScenic && service.evidence.test(offer.name)) || service.venue.test(offer.name)
        || SERVICE_PACKAGE.test(offer.name);
    });
  });
  return { offers: matching, code: matching.length ? "SEARCH_RELEVANCE_LIMITED" : "SEARCH_NO_RELEVANT_MATCHES" };
}
