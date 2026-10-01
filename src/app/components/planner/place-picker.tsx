import { useMemo, useState } from "react";
import { Icon } from "../zen-ui";
import styles from "../zen-dashboard.module.css";

/**
 * A destination list that looks like an OTA's city picker: type-ahead, grouped
 * regions, national flags and a live time-zone readout.
 *
 * The traveller should recognise a place by country and flag rather than type a
 * city name they may spell differently, so selecting here fills both the city
 * and its time zone at once.
 */

export type Place = {
  city: string;
  country: string;
  flag: string;
  region: string;
  timezone: string;
  /** Short label used in the list, e.g. "关西 · 红叶季前后". */
  hint: string;
};

export const PLACES: readonly Place[] = [
  { city: "东京", country: "日本", flag: "🇯🇵", region: "亚洲", timezone: "Asia/Tokyo", hint: "街区与温泉" },
  { city: "京都", country: "日本", flag: "🇯🇵", region: "亚洲", timezone: "Asia/Tokyo", hint: "庭园与古镇" },
  { city: "大阪", country: "日本", flag: "🇯🇵", region: "亚洲", timezone: "Asia/Tokyo", hint: "食与市场" },
  { city: "箱根", country: "日本", flag: "🇯🇵", region: "亚洲", timezone: "Asia/Tokyo", hint: "山间静养" },
  { city: "首尔", country: "韩国", flag: "🇰🇷", region: "亚洲", timezone: "Asia/Seoul", hint: "咖啡与设计" },
  { city: "台北", country: "中国台湾", flag: "🇹🇼", region: "亚洲", timezone: "Asia/Taipei", hint: "夜市与书店" },
  { city: "香港", country: "中国香港", flag: "🇭🇰", region: "亚洲", timezone: "Asia/Hong_Kong", hint: "海湾与山路" },
  { city: "新加坡", country: "新加坡", flag: "🇸🇬", region: "亚洲", timezone: "Asia/Singapore", hint: "城市花园" },
  { city: "曼谷", country: "泰国", flag: "🇹🇭", region: "亚洲", timezone: "Asia/Bangkok", hint: "河岸与寺" },
  { city: "清迈", country: "泰国", flag: "🇹🇭", region: "亚洲", timezone: "Asia/Bangkok", hint: "慢节奏北方" },
  { city: "巴厘岛", country: "印度尼西亚", flag: "🇮🇩", region: "亚洲", timezone: "Asia/Makassar", hint: "海岸与梯田" },
  { city: "吉隆坡", country: "马来西亚", flag: "🇲🇾", region: "亚洲", timezone: "Asia/Singapore", hint: "雨林边缘" },
  { city: "上海", country: "中国", flag: "🇨🇳", region: "亚洲", timezone: "Asia/Shanghai", hint: "出发常客" },
  { city: "北京", country: "中国", flag: "🇨🇳", region: "亚洲", timezone: "Asia/Shanghai", hint: "胡同与城墙" },
  { city: "广州", country: "中国", flag: "🇨🇳", region: "亚洲", timezone: "Asia/Shanghai", hint: "早茶与老城" },
  { city: "悉尼", country: "澳大利亚", flag: "🇦🇺", region: "大洋洲", timezone: "Australia/Sydney", hint: "海岸步道" },
  { city: "墨尔本", country: "澳大利亚", flag: "🇦🇺", region: "大洋洲", timezone: "Australia/Sydney", hint: "咖啡与街区" },
  { city: "奥克兰", country: "新西兰", flag: "🇳🇿", region: "大洋洲", timezone: "Pacific/Auckland", hint: "海湾与自然" },
  { city: "伦敦", country: "英国", flag: "🇬🇧", region: "欧洲", timezone: "Europe/London", hint: "博物馆与公园" },
  { city: "巴黎", country: "法国", flag: "🇫🇷", region: "欧洲", timezone: "Europe/Paris", hint: "步行与美术馆" },
  { city: "罗马", country: "意大利", flag: "🇮🇹", region: "欧洲", timezone: "Europe/Paris", hint: "古迹与广场" },
  { city: "巴塞罗那", country: "西班牙", flag: "🇪🇸", region: "欧洲", timezone: "Europe/Paris", hint: "海滨与建筑" },
  { city: "苏黎世", country: "瑞士", flag: "🇨🇭", region: "欧洲", timezone: "Europe/Paris", hint: "湖与山" },
  { city: "纽约", country: "美国", flag: "🇺🇸", region: "美洲", timezone: "America/New_York", hint: "街区与展览" },
  { city: "旧金山", country: "美国", flag: "🇺🇸", region: "美洲", timezone: "America/Los_Angeles", hint: "海岸与海湾" },
  { city: "洛杉矶", country: "美国", flag: "🇺🇸", region: "美洲", timezone: "America/Los_Angeles", hint: "阳光与棕榈" },
  { city: "温哥华", country: "加拿大", flag: "🇨🇦", region: "美洲", timezone: "America/Los_Angeles", hint: "山海之间" },
  { city: "多伦多", country: "加拿大", flag: "🇨🇦", region: "美洲", timezone: "America/New_York", hint: "湖滨与街区" },
  { city: "墨西哥城", country: "墨西哥", flag: "🇲🇽", region: "美洲", timezone: "America/New_York", hint: "壁画与市场" },
  { city: "迪拜", country: "阿联酋", flag: "🇦🇪", region: "中东非洲", timezone: "Asia/Dubai", hint: "沙漠与海湾" },
  { city: "开普敦", country: "南非", flag: "🇿🇦", region: "中东非洲", timezone: "Europe/London", hint: "山海与葡萄园" },
];

/** Cities offered most often as an origin, so the common case is one tap. */
export const ORIGIN_PLACES: readonly Place[] = PLACES.filter((place) =>
  ["上海", "北京", "广州", "深圳", "杭州", "香港", "东京", "新加坡"].includes(place.city));

const REGION_ORDER = ["亚洲", "欧洲", "美洲", "大洋洲", "中东非洲"];

/** Local wall-clock at a destination, so time-zone effects are visible up front. */
function localTimeAt(timezone: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
    }).format(new Date());
  } catch {
    return "";
  }
}

export function PlacePicker({
  label,
  value,
  placeholder,
  suggestions,
  onSelect,
  exclude,
}: {
  label: string;
  value: string;
  placeholder: string;
  /** Ranked by the traveller's own history; shown first. */
  suggestions?: readonly string[];
  onSelect: (place: Place) => void;
  exclude?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Place | null>(null);

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = PLACES.filter((place) => {
      if (place.city === exclude) return false;
      if (!needle) return true;
      return `${place.city}${place.country}${place.region}${place.hint}`.toLowerCase().includes(needle);
    });
    const ranked = matches.slice().sort((a, b) => {
      const rank = (place: Place) => (suggestions?.includes(place.city) ? -1 : 0);
      return rank(a) - rank(b) || REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region);
    });
    return REGION_ORDER
      .map((region) => ({ region, places: ranked.filter((place) => place.region === region) }))
      .filter((group) => group.places.length > 0);
  }, [query, suggestions, exclude]);

  const suggestionPlaces = (suggestions ?? [])
    .map((city) => PLACES.find((place) => place.city === city))
    .filter((place): place is Place => Boolean(place) && place!.city !== exclude);

  return (
    <div className={styles.field}>
      <label>{label}</label>
      <button
        type="button"
        className={styles.placeTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {value
          ? <><span className={styles.placeFlag}>{PLACES.find((place) => place.city === value)?.flag ?? "📍"}</span>{value}</>
          : <span className={styles.mutedText}>{placeholder}</span>}
        <Icon name="arrow" size={16} />
      </button>

      {open && (
        <div className={styles.placeMenu} role="listbox">
          <div className={styles.placeSearch}>
            <Icon name="compass" size={16} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索城市或国家"
              aria-label={`搜索${label}`}
            />
          </div>
          {preview && (
            <p className={styles.placePreview}>
              <span className={styles.placeFlag}>{preview.flag}</span>
              {preview.city} · 当地时间 {localTimeAt(preview.timezone)}
            </p>
          )}
          {!query && suggestionPlaces.length > 0 && (
            <>
              <div className={styles.placeGroupTitle}>你常去</div>
              <div className={styles.chipRow}>
                {suggestionPlaces.map((place) => (
                  <button key={place.city} type="button" className={styles.chip} onClick={() => { onSelect(place); setOpen(false); }}>
                    {place.flag} {place.city}
                  </button>
                ))}
              </div>
            </>
          )}
          {grouped.map((group) => (
            <div key={group.region}>
              <div className={styles.placeGroupTitle}>{group.region}</div>
              <div className={styles.placeList}>
                {group.places.map((place) => (
                  <button
                    key={place.city}
                    type="button"
                    role="option"
                    aria-selected={place.city === value}
                    className={`${styles.placeRow} ${place.city === value ? styles.active : ""}`}
                    onMouseEnter={() => setPreview(place)}
                    onFocus={() => setPreview(place)}
                    onClick={() => { onSelect(place); setOpen(false); setQuery(""); }}
                  >
                    <span className={styles.placeFlag}>{place.flag}</span>
                    <span className={styles.placeText}>
                      <strong>{place.city}</strong>
                      <small>{place.country} · {place.hint}</small>
                    </span>
                    <small className={styles.placeZone}>{localTimeAt(place.timezone)}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {grouped.length === 0 && <p className={styles.note}>没有匹配的地点，换个关键词试试。</p>}
        </div>
      )}
    </div>
  );
}