/**
 * Destination reference data.
 *
 * Kept as a compact reviewable table rather than hundreds of object literals.
 * Row format:
 *   city|romanization|country|flag|group|timezone|popular|hint
 *
 * `group` decides the UI structure only: `cn` is the 国内 tab, `hkt` sits in
 * the international tab as its own 中国港澳台 group, and the rest are
 * continents. Time zones are internal plumbing — the interface never shows
 * them, so a city is recognised by its name, country and flag.
 *
 * Correctness matters more than coverage here: a wrong zone silently shifts the
 * arrival date, the jet-lag maths and the flight search. `places.test.mjs`
 * verifies every zone against the runtime and pins mainland China to
 * Asia/Shanghai, with Hong Kong, Macau and Taiwan keeping their own.
 */

export type PlaceGroup = "cn" | "hkt" | "as" | "eu" | "na" | "sa" | "oc" | "af";
export type PlaceKind = "city" | "area";

export type Place = {
  city: string;
  /** Areas stay selectable as destinations, but must not become departure cities. */
  kind: PlaceKind;
  /** Verified city used for transport searches; never an inferred airport code. */
  transportCity?: string;
  aliases?: readonly string[];
  romanization: string;
  country: string;
  flag: string;
  group: PlaceGroup;
  timezone: string;
  popular: boolean;
  hint: string;
  /** Pinyin initial for Chinese cities, Latin initial otherwise. */
  initial: string;
  /** True for mainland China only; 香港/澳门/台湾 group with international. */
  domestic: boolean;
};

export const GROUP_LABELS: Record<PlaceGroup, string> = {
  cn: "国内",
  hkt: "中国港澳台",
  as: "亚洲",
  eu: "欧洲",
  na: "北美洲",
  sa: "南美洲",
  oc: "大洋洲",
  af: "非洲",
};

/** Sidebar order for the international tab. */
export const INTERNATIONAL_GROUPS: readonly PlaceGroup[] = ["hkt", "as", "eu", "na", "sa", "oc", "af"];

const RAW = `
# ── 中国大陆 ──────────────────────────────────────────────────────────────
北京|beijing|中国|🇨🇳|cn|Asia/Shanghai|1|首都 · 胡同与美术馆
上海|shanghai|中国|🇨🇳|cn|Asia/Shanghai|1|外滩 · 本帮与展览
广州|guangzhou|中国|🇨🇳|cn|Asia/Shanghai|1|早茶 · 老城
深圳|shenzhen|中国|🇨🇳|cn|Asia/Shanghai|1|海湾 · 设计之城
成都|chengdu|中国|🇨🇳|cn|Asia/Shanghai|1|慢生活 · 熊猫与茶
杭州|hangzhou|中国|🇨🇳|cn|Asia/Shanghai|1|西湖 · 山水
重庆|chongqing|中国|🇨🇳|cn|Asia/Shanghai|1|山城 · 火锅与江景
西安|xian|中国|🇨🇳|cn|Asia/Shanghai|1|城墙 · 兵马俑
昆明|kunming|中国|🇨🇳|cn|Asia/Shanghai|1|四季如春 · 石林
南京|nanjing|中国|🇨🇳|cn|Asia/Shanghai|1|梧桐 · 秦淮
武汉|wuhan|中国|🇨🇳|cn|Asia/Shanghai|1|江城 · 东湖
长沙|changsha|中国|🇨🇳|cn|Asia/Shanghai|1|湘江 · 夜生活
厦门|xiamen|中国|🇨🇳|cn|Asia/Shanghai|1|海岛 · 骑楼
青岛|qingdao|中国|🇨🇳|cn|Asia/Shanghai|1|海滨 · 德式老城
苏州|suzhou|中国|🇨🇳|cn|Asia/Shanghai|1|园林 · 评弹
天津|tianjin|中国|🇨🇳|cn|Asia/Shanghai|0|海河 · 近代建筑
大连|dalian|中国|🇨🇳|cn|Asia/Shanghai|0|滨海 · 广场与海鸥
宁波|ningbo|中国|🇨🇳|cn|Asia/Shanghai|0|书藏港城 · 老外滩
无锡|wuxi|中国|🇨🇳|cn|Asia/Shanghai|0|太湖 · 园林
温州|wenzhou|中国|🇨🇳|cn|Asia/Shanghai|0|山海 · 瓯江
佛山|foshan|中国|🇨🇳|cn|Asia/Shanghai|0|岭南 · 陶都
东莞|dongguan|中国|🇨🇳|cn|Asia/Shanghai|0|制造与休闲
珠海|zhuhai|中国|🇨🇳|cn|Asia/Shanghai|0|海岛 · 情侣路
三亚|sanya|中国|🇨🇳|cn|Asia/Shanghai|1|热带 · 海滨度假
哈尔滨|harbin|中国|🇨🇳|cn|Asia/Shanghai|0|冰雪 · 中央大街
沈阳|shenyang|中国|🇨🇳|cn|Asia/Shanghai|0|故都 · 皇城
长春|changchun|中国|🇨🇳|cn|Asia/Shanghai|0|电影城 · 净月
石家庄|shijiazhuang|中国|🇨🇳|cn|Asia/Shanghai|0|华北平原 · 正定
太原|taiyuan|中国|🇨🇳|cn|Asia/Shanghai|0|晋祠 · 汾河
呼和浩特|huhehaote|中国|🇨🇳|cn|Asia/Shanghai|0|草原 · 敕勒川
济南|jinan|中国|🇨🇳|cn|Asia/Shanghai|0|泉城 · 大明湖
郑州|zhengzhou|中国|🇨🇳|cn|Asia/Shanghai|0|中原 · 少林
洛阳|luoyang|中国|🇨🇳|cn|Asia/Shanghai|0|古都 · 龙门
开封|kaifeng|中国|🇨🇳|cn|Asia/Shanghai|0|八朝古都 · 清明上河园
兰州|lanzhou|中国|🇨🇳|cn|Asia/Shanghai|0|黄河 · 拉面
敦煌|dunhuang|中国|🇨🇳|cn|Asia/Shanghai|1|莫高窟 · 鸣沙山
西宁|xining|中国|🇨🇳|cn|Asia/Shanghai|0|青海湖 · 塔尔寺
银川|yinchuan|中国|🇨🇳|cn|Asia/Shanghai|0|塞上江南 · 西夏王陵
乌鲁木齐|wulumuqi|中国|🇨🇳|cn|Asia/Shanghai|0|天山 · 喀纳斯
喀什|kashi|中国|🇨🇳|cn|Asia/Shanghai|0|丝路 · 古城与帕米尔
拉萨|lasa|中国|🇨🇳|cn|Asia/Shanghai|1|高原 · 布达拉宫
日喀则|rikaze|中国|🇨🇳|cn|Asia/Shanghai|0|珠峰 · 冰川
林芝|linzhi|中国|🇨🇳|cn|Asia/Shanghai|0|南迦巴瓦 · 桃花
贵阳|guiyang|中国|🇨🇳|cn|Asia/Shanghai|0|避暑 · 苗岭
荔波|libo|中国|🇨🇳|cn|Asia/Shanghai|0|喀斯特 · 小七孔
安顺|anshun|中国|🇨🇳|cn|Asia/Shanghai|0|黄果树 · 屯堡
大理|dali|中国|🇨🇳|cn|Asia/Shanghai|1|苍山洱海 · 慢生活
丽江|lijiang|中国|🇨🇳|cn|Asia/Shanghai|1|古城 · 雪山
香格里拉|shangrila|中国|🇨🇳|cn|Asia/Shanghai|0|藏地 · 松赞林寺
西双版纳|xishuangbanna|中国|🇨🇳|cn|Asia/Shanghai|1|热带雨林 · 告庄西双景
景洪|jinghong|中国|🇨🇳|cn|Asia/Shanghai|0|澜沧江 · 城市街区
腾冲|tengchong|中国|🇨🇳|cn|Asia/Shanghai|0|火山 · 温泉与银杏
玉龙雪山|yulongxueshan|中国|🇨🇳|cn|Asia/Shanghai|0|雪山 · 蓝月谷
黄山|huangshan|中国|🇨🇳|cn|Asia/Shanghai|0|奇松 · 云海
婺源|wuyuan|中国|🇨🇳|cn|Asia/Shanghai|0|油菜花 · 徽派古村
景德镇|jingdezhen|中国|🇨🇳|cn|Asia/Shanghai|0|瓷都 · 陶溪川
洛阳老君山|laojunshan|中国|🇨🇳|cn|Asia/Shanghai|0|金顶 · 云海
张家界|zhangjiajie|中国|🇨🇳|cn|Asia/Shanghai|0|石英砂岩峰林
凤凰古城|fenghuang|中国|🇨🇳|cn|Asia/Shanghai|0|沱江 · 吊脚楼
桂林|guilin|中国|🇨🇳|cn|Asia/Shanghai|1|漓江 · 喀斯特
阳朔|yangshuo|中国|🇨🇳|cn|Asia/Shanghai|0|田园 · 骑行
南宁|nanning|中国|🇨🇳|cn|Asia/Shanghai|0|绿城 · 邕江
柳州|liuzhou|中国|🇨🇳|cn|Asia/Shanghai|0|螺蛳粉 · 山水
北海|beihai|中国|🇨🇳|cn|Asia/Shanghai|0|银滩 · 涠洲岛
海口|haikou|中国|🇨🇳|cn|Asia/Shanghai|0|椰城 · 骑楼老街
亚龙湾|yalongwan|中国|🇨🇳|cn|Asia/Shanghai|0|沙滩 · 潜水
海棠湾|haitangwan|中国|🇨🇳|cn|Asia/Shanghai|0|海岸 · 度假酒店
儋州|danzhou|中国|🇨🇳|cn|Asia/Shanghai|0|东坡书院 · 海口
九寨沟|jiuzhaigou|中国|🇨🇳|cn|Asia/Shanghai|1|五彩池 · 震后重生
峨眉山|emeishan|中国|🇨🇳|cn|Asia/Shanghai|0|云雾 · 报国寺
乐山|leshan|中国|🇨🇳|cn|Asia/Shanghai|0|大佛 · 江与山
稻城亚丁|daochengyading|中国|🇨🇳|cn|Asia/Shanghai|0|神山 · 高原草甸
甘孜|ganzi|中国|🇨🇳|cn|Asia/Shanghai|0|雪山 · 藏传文化
黄龙|huanglong|中国|🇨🇳|cn|Asia/Shanghai|0|五彩池 · 钙华
都江堰|dujiangyan|中国|🇨🇳|cn|Asia/Shanghai|0|都江堰 · 古镇
绵阳|mianyang|中国|🇨🇳|cn|Asia/Shanghai|0|科技城 · 剑门关
广元|guangyuan|中国|🇨🇳|cn|Asia/Shanghai|0|蜀道 · 剑门关
烟台|yantai|中国|🇨🇳|cn|Asia/Shanghai|0|蓬莱 · 葡萄酒
威海|weihai|中国|🇨🇳|cn|Asia/Shanghai|1|海岸线 · 刘公岛
曲阜|qufu|中国|🇨🇳|cn|Asia/Shanghai|0|三孔 · 儒家文化
泰安|taian|中国|🇨🇳|cn|Asia/Shanghai|0|泰山 · 登顶
临沂|linyi|中国|🇨🇳|cn|Asia/Shanghai|0|沂蒙 · 物流之都
潍坊|weifang|中国|🇨🇳|cn|Asia/Shanghai|0|风筝 · 滨海
鞍山|anshan|中国|🇨🇳|cn|Asia/Shanghai|0|钢都 · 千山
锦州|jinzhou|中国|🇨🇳|cn|Asia/Shanghai|0|古塔 · 海滨
丹东|dandong|中国|🇨🇳|cn|Asia/Shanghai|0|鸭绿江 · 边境
延吉|yanji|中国|🇨🇳|cn|Asia/Shanghai|0|边境 · 朝鲜族美食
大庆|daqing|中国|🇨🇳|cn|Asia/Shanghai|0|湿地 · 温泉
齐齐哈尔|qiqihar|中国|🇨🇳|cn|Asia/Shanghai|0|扎龙 · 丹顶鹤
牡丹江|mudanjiang|中国|🇨🇳|cn|Asia/Shanghai|0|镜泊湖 · 雪乡
鄂尔多斯|eerduosi|中国|🇨🇳|cn|Asia/Shanghai|0|草原 · 响沙湾
呼伦贝尔|hulunbeier|中国|🇨🇳|cn|Asia/Shanghai|1|草原 · 额尔古纳
包头|baotou|中国|🇨🇳|cn|Asia/Shanghai|0|稀土 · 五当召
大同|datong|中国|🇨🇳|cn|Asia/Shanghai|0|云冈石窟 · 古都
平遥|pingyao|中国|🇨🇳|cn|Asia/Shanghai|0|古城 · 乔家大院
扬州|yangzhou|中国|🇨🇳|cn|Asia/Shanghai|0|园林 · 早茶
徐州|xuzhou|中国|🇨🇳|cn|Asia/Shanghai|0|汉文化 · 云龙湖
常州|changzhou|中国|🇨🇳|cn|Asia/Shanghai|0|恐龙园 · 淹城
南通|nantong|中国|🇨🇳|cn|Asia/Shanghai|0|江海 · 狼山
绍兴|shaoxing|中国|🇨🇳|cn|Asia/Shanghai|0|黄酒 · 乌镇
嘉兴|jiaxing|中国|🇨🇳|cn|Asia/Shanghai|0|南湖 · 西塘
金华|jinhua|中国|🇨🇳|cn|Asia/Shanghai|0|义乌 · 通江
湖州|huzhou|中国|🇨🇳|cn|Asia/Shanghai|0|太湖 · 古镇
舟山|zhoushan|中国|🇨🇳|cn|Asia/Shanghai|0|海岛 · 普陀山
台州|taizhou|中国|🇨🇳|cn|Asia/Shanghai|0|山海 · 天台
衢州|quzhou|中国|🇨🇳|cn|Asia/Shanghai|0|南孔 · 江山
丽水|lishui|中国|🇨🇳|cn|Asia/Shanghai|0|瓯江 · 梯田
芜湖|wuhu|中国|🇨🇳|cn|Asia/Shanghai|0|长江 · 赭山
蚌埠|bengbu|中国|🇨🇳|cn|Asia/Shanghai|0|淮河 · 铁路枢纽
泉州|quanzhou|中国|🇨🇳|cn|Asia/Shanghai|1|宋元海丝 · 蟳埔
漳州|zhangzhou|中国|🇨🇳|cn|Asia/Shanghai|0|土楼 · 海滨
福州|fuzhou|中国|🇨🇳|cn|Asia/Shanghai|0|三坊七巷 · 榕城
莆田|putian|中国|🇨🇳|cn|Asia/Shanghai|0|湄洲岛 · 妈祖
南昌|nanchang|中国|🇨🇳|cn|Asia/Shanghai|0|滕王阁 · 赣江
九江|jiujiang|中国|🇨🇳|cn|Asia/Shanghai|0|庐山 · 鄱阳湖
上饶|shangrao|中国|🇨🇳|cn|Asia/Shanghai|0|婺源 · 三清山
岳阳|yueyang|中国|🇨🇳|cn|Asia/Shanghai|0|洞庭湖 · 岳阳楼
衡阳|hengyang|中国|🇨🇳|cn|Asia/Shanghai|0|南岳 · 衡山
株洲|zhuzhou|中国|🇨🇳|cn|Asia/Shanghai|0|工业 · 醴陵
襄阳|xiangyang|中国|🇨🇳|cn|Asia/Shanghai|0|古隆中 · 汉江
宜昌|yichang|中国|🇨🇳|cn|Asia/Shanghai|0|三峡 · 清江画廊
恩施|enshi|中国|🇨🇳|cn|Asia/Shanghai|1|土家族 · 大峡谷
十堰|shiyan|中国|🇨🇳|cn|Asia/Shanghai|0|武当山 · 神农架
洛阳龙门|longmen|中国|🇨🇳|cn|Asia/Shanghai|0|石窟 · 伊河
宝鸡|baoji|中国|🇨🇳|cn|Asia/Shanghai|0|青铜器 · 关中
延安|yanan|中国|🇨🇳|cn|Asia/Shanghai|0|黄土高原 · 宝塔山
华山|huashan|中国|🇨🇳|cn|Asia/Shanghai|1|奇险 · 西岳
张掖|zhangye|中国|🇨🇳|cn|Asia/Shanghai|0|丹霞 · 湿地
嘉峪关|jiayuguan|中国|🇨🇳|cn|Asia/Shanghai|0|关隘 · 悬壁长城
天水|tianshui|中国|🇨🇳|cn|Asia/Shanghai|0|麦积山 · 卦台山
吐鲁番|turpan|中国|🇨🇳|cn|Asia/Shanghai|0|葡萄 · 火焰山
伊犁|yili|中国|🇨🇳|cn|Asia/Shanghai|1|草原 · 赛里木湖
伊宁|yining|中国|🇨🇳|cn|Asia/Shanghai|0|伊犁河 · 老街
赛里木湖|sailimuhu|中国|🇨🇳|cn|Asia/Shanghai|0|高山湖 · 果子沟
阿勒泰|altay|中国|🇨🇳|cn|Asia/Shanghai|0|喀纳斯 · 禾木
石嘴山|shizuishan|中国|🇨🇳|cn|Asia/Shanghai|0|黄河 · 贺兰山
中卫|zhongwei|中国|🇨🇳|cn|Asia/Shanghai|0|沙坡头 · 腾格里
固原|guyuan|中国|🇨🇳|cn|Asia/Shanghai|0|六盘山 · 须弥山

# ── 中国港澳台 ───────────────────────────────────────────────────────────
香港|hongkong xianggang|中国香港|🇭🇰|hkt|Asia/Hong_Kong|1|海湾与街区
澳门|macau aomen|中国澳门|🇲🇴|hkt|Asia/Macau|1|历史街区
台北|taipei taibei|中国台湾|🇹🇼|hkt|Asia/Taipei|1|夜市与书店
高雄|kaohsiung gaoxiong|中国台湾|🇹🇼|hkt|Asia/Taipei|0|港口与海岸
台中|taichung taizhong|中国台湾|🇹🇼|hkt|Asia/Taipei|0|街区与美术馆
台南|tainan|中国台湾|🇹🇼|hkt|Asia/Taipei|0|古城与街巷
花莲|hualien hualian|中国台湾|🇹🇼|hkt|Asia/Taipei|0|海岸与山景
# ── 亚洲 ─────────────────────────────────────────────────────────────────
东京|tokyo dongjing|日本|🇯🇵|as|Asia/Tokyo|1|街区与庭园
大阪|osaka daban|日本|🇯🇵|as|Asia/Tokyo|1|食与市场
京都|kyoto jingdu|日本|🇯🇵|as|Asia/Tokyo|1|庭园与古街
札幌|sapporo zhahuang|日本|🇯🇵|as|Asia/Tokyo|0|公园与街区
福冈|fukuoka fugang|日本|🇯🇵|as|Asia/Tokyo|0|海湾与街区
名古屋|nagoya mingguwu|日本|🇯🇵|as|Asia/Tokyo|0|城堡与展览
冲绳|okinawa chongsheng|日本|🇯🇵|as|Asia/Tokyo|1|海岸与岛屿
那霸|naha naba|日本|🇯🇵|as|Asia/Tokyo|0|首里城与街区
箱根|hakone xianggen|日本|🇯🇵|as|Asia/Tokyo|0|山间与湖景
首尔|seoul shouer|韩国|🇰🇷|as|Asia/Seoul|1|咖啡与设计
釜山|busan fushan|韩国|🇰🇷|as|Asia/Seoul|0|海湾与市场
济州岛|jeju jizhoudao|韩国|🇰🇷|as|Asia/Seoul|0|海岸与岛屿
济州|jejusi jizhou|韩国|🇰🇷|as|Asia/Seoul|0|城市街区与海岸
新加坡|singapore xinjiapo|新加坡|🇸🇬|as|Asia/Singapore|1|城市花园
曼谷|bangkok mangu|泰国|🇹🇭|as|Asia/Bangkok|1|河岸与寺院
清迈|chiangmai qingmai|泰国|🇹🇭|as|Asia/Bangkok|1|街巷与山景
普吉岛|phuket pujidao|泰国|🇹🇭|as|Asia/Bangkok|1|海湾与岛屿
普吉|phuketcity puji|泰国|🇹🇭|as|Asia/Bangkok|0|老城与街区
苏梅岛|kohsamui sumeidao|泰国|🇹🇭|as|Asia/Bangkok|0|海岸与岛屿
吉隆坡|kualalumpur jilongpo|马来西亚|🇲🇾|as|Asia/Kuala_Lumpur|1|街区与城市公园
槟城|penang bincheng|马来西亚|🇲🇾|as|Asia/Kuala_Lumpur|0|老城与海岸
兰卡威|langkawi lankawi|马来西亚|🇲🇾|as|Asia/Kuala_Lumpur|0|海岸与岛屿
亚庇|kotakinabalu yabi|马来西亚|🇲🇾|as|Asia/Kuching|0|海湾与山景
巴厘岛|bali balidao|印度尼西亚|🇮🇩|as|Asia/Makassar|1|海岸与梯田
登巴萨|denpasar dengbasa|印度尼西亚|🇮🇩|as|Asia/Makassar|0|市集与博物馆
雅加达|jakarta yajiada|印度尼西亚|🇮🇩|as|Asia/Jakarta|0|街区与博物馆
河内|hanoi henei|越南|🇻🇳|as|Asia/Ho_Chi_Minh|0|湖泊与老街
胡志明市|hochiminh huzhimingshi|越南|🇻🇳|as|Asia/Ho_Chi_Minh|0|街区与市场
岘港|danang xiangang|越南|🇻🇳|as|Asia/Ho_Chi_Minh|1|海岸与山景
芽庄|nhatrang yazhuang|越南|🇻🇳|as|Asia/Ho_Chi_Minh|0|海岸与岛屿
马尼拉|manila manila|菲律宾|🇵🇭|as|Asia/Manila|0|历史街区
宿务|cebu suwu|菲律宾|🇵🇭|as|Asia/Manila|0|海岸与岛屿
金边|phnompenh jinbian|柬埔寨|🇰🇭|as|Asia/Phnom_Penh|0|河岸与街区
暹粒|siemreap xianli|柬埔寨|🇰🇭|as|Asia/Phnom_Penh|0|古迹与寺院
马尔代夫|maldives maerdaifu|马尔代夫|🇲🇻|as|Indian/Maldives|1|环礁与岛屿
马累|male mal e|马尔代夫|🇲🇻|as|Indian/Maldives|0|城市街区与海港
科伦坡|colombo kelunpo|斯里兰卡|🇱🇰|as|Asia/Colombo|0|海岸与街区
加德满都|kathmandu jiademandu|尼泊尔|🇳🇵|as|Asia/Kathmandu|0|古城与山景
新德里|newdelhi xindeli|印度|🇮🇳|as|Asia/Kolkata|0|古迹与城市公园
孟买|mumbai mengmai|印度|🇮🇳|as|Asia/Kolkata|0|街区与海湾
迪拜|dubai dibai|阿联酋|🇦🇪|as|Asia/Dubai|1|沙漠与海湾
阿布扎比|abudhabi abuzhabi|阿联酋|🇦🇪|as|Asia/Dubai|0|海湾与博物馆
多哈|doha duoha|卡塔尔|🇶🇦|as|Asia/Qatar|0|海岸与博物馆
伊斯坦布尔|istanbul yisitanbuer|土耳其|🇹🇷|as|Europe/Istanbul|1|海峡与历史街区
# ── 欧洲 ─────────────────────────────────────────────────────────────────
伦敦|london lundun|英国|🇬🇧|eu|Europe/London|1|博物馆与公园
爱丁堡|edinburgh aidingbao|英国|🇬🇧|eu|Europe/London|0|古城与山景
曼彻斯特|manchester manchesite|英国|🇬🇧|eu|Europe/London|0|街区与展览
巴黎|paris bali|法国|🇫🇷|eu|Europe/Paris|1|步行与美术馆
尼斯|nice nisi|法国|🇫🇷|eu|Europe/Paris|0|海岸与老城
里昂|lyon liang|法国|🇫🇷|eu|Europe/Paris|0|古街与餐食
罗马|rome luoma|意大利|🇮🇹|eu|Europe/Rome|1|古迹与广场
米兰|milan milan|意大利|🇮🇹|eu|Europe/Rome|0|设计与展览
威尼斯|venice weinisi|意大利|🇮🇹|eu|Europe/Rome|1|水城与街巷
佛罗伦萨|florence foluolunsa|意大利|🇮🇹|eu|Europe/Rome|0|美术馆与古街
巴塞罗那|barcelona basailuona|西班牙|🇪🇸|eu|Europe/Madrid|1|海滨与建筑
马德里|madrid madeli|西班牙|🇪🇸|eu|Europe/Madrid|0|广场与美术馆
塞维利亚|seville saiweiliya|西班牙|🇪🇸|eu|Europe/Madrid|0|历史街区
里斯本|lisbon lisiben|葡萄牙|🇵🇹|eu|Europe/Lisbon|0|海湾与街区
柏林|berlin bolin|德国|🇩🇪|eu|Europe/Berlin|0|街区与博物馆
慕尼黑|munich munihei|德国|🇩🇪|eu|Europe/Berlin|0|城市公园与展览
法兰克福|frankfurt falankefu|德国|🇩🇪|eu|Europe/Berlin|0|河岸与博物馆
阿姆斯特丹|amsterdam amusitedan|荷兰|🇳🇱|eu|Europe/Amsterdam|1|运河与美术馆
布鲁塞尔|brussels bulusaier|比利时|🇧🇪|eu|Europe/Brussels|0|广场与街区
苏黎世|zurich sulishi|瑞士|🇨🇭|eu|Europe/Zurich|0|湖泊与街区
日内瓦|geneva rineiwa|瑞士|🇨🇭|eu|Europe/Zurich|0|湖滨与城市公园
维也纳|vienna weiyena|奥地利|🇦🇹|eu|Europe/Vienna|0|音乐与美术馆
布拉格|prague bulage|捷克|🇨🇿|eu|Europe/Prague|1|古城与河岸
布达佩斯|budapest budapeisi|匈牙利|🇭🇺|eu|Europe/Budapest|0|河岸与街区
雅典|athens yadian|希腊|🇬🇷|eu|Europe/Athens|0|古迹与街区
圣托里尼|santorini shengtuolini|希腊|🇬🇷|eu|Europe/Athens|0|海岸与岛屿
哥本哈根|copenhagen gebenhagen|丹麦|🇩🇰|eu|Europe/Copenhagen|0|街区与海湾
斯德哥尔摩|stockholm sidegeermo|瑞典|🇸🇪|eu|Europe/Stockholm|0|岛屿与老城
奥斯陆|oslo aosilu|挪威|🇳🇴|eu|Europe/Oslo|0|峡湾与博物馆
赫尔辛基|helsinki heerxinji|芬兰|🇫🇮|eu|Europe/Helsinki|0|设计与海岸
雷克雅未克|reykjavik leikey a weike|冰岛|🇮🇸|eu|Atlantic/Reykjavik|0|海湾与街区
莫斯科|moscow mosike|俄罗斯|🇷🇺|eu|Europe/Moscow|0|广场与博物馆
圣彼得堡|saintpetersburg shengbidebao|俄罗斯|🇷🇺|eu|Europe/Moscow|0|河岸与美术馆
# ── 北美洲 ───────────────────────────────────────────────────────────────
纽约|newyork niuyue|美国|🇺🇸|na|America/New_York|1|街区与展览
洛杉矶|losangeles luoshanji|美国|🇺🇸|na|America/Los_Angeles|1|阳光与海岸
旧金山|sanfrancisco jiujinshan|美国|🇺🇸|na|America/Los_Angeles|1|海岸与海湾
拉斯维加斯|lasvegas lasiweijiasi|美国|🇺🇸|na|America/Los_Angeles|0|展演与街区
西雅图|seattle xiyatu|美国|🇺🇸|na|America/Los_Angeles|0|海湾与城市公园
芝加哥|chicago zhijiage|美国|🇺🇸|na|America/Chicago|0|建筑与湖滨
波士顿|boston boshidun|美国|🇺🇸|na|America/New_York|0|历史街区
华盛顿|washington huashengdun|美国|🇺🇸|na|America/New_York|0|博物馆与城市公园
迈阿密|miami ma ami|美国|🇺🇸|na|America/New_York|0|海岸与街区
檀香山|honolulu tanxiangshan|美国|🇺🇸|na|Pacific/Honolulu|0|海岸与岛屿
温哥华|vancouver wengehua|加拿大|🇨🇦|na|America/Vancouver|1|山海之间
多伦多|toronto duolunduo|加拿大|🇨🇦|na|America/Toronto|0|湖滨与街区
蒙特利尔|montreal mengtelier|加拿大|🇨🇦|na|America/Toronto|0|街区与展览
墨西哥城|mexicocity moxigecheng|墨西哥|🇲🇽|na|America/Mexico_City|0|壁画与市场
坎昆|cancun kankun|墨西哥|🇲🇽|na|America/Cancun|0|海岸与古迹
# ── 南美洲 ───────────────────────────────────────────────────────────────
圣保罗|saopaulo shengbaoluo|巴西|🇧🇷|sa|America/Sao_Paulo|0|街区与展览
里约热内卢|riodejaneiro liyuereneilu|巴西|🇧🇷|sa|America/Sao_Paulo|1|海湾与山景
布宜诺斯艾利斯|buenosaires buyinuosiailisi|阿根廷|🇦🇷|sa|America/Argentina/Buenos_Aires|0|街区与展览
利马|lima lima|秘鲁|🇵🇪|sa|America/Lima|0|海岸与历史街区
圣地亚哥|santiago shengdiyage|智利|🇨🇱|sa|America/Santiago|0|街区与山景
波哥大|bogota bogeda|哥伦比亚|🇨🇴|sa|America/Bogota|0|博物馆与街区
# ── 大洋洲 ───────────────────────────────────────────────────────────────
悉尼|sydney xini|澳大利亚|🇦🇺|oc|Australia/Sydney|1|海岸步道
墨尔本|melbourne moerben|澳大利亚|🇦🇺|oc|Australia/Melbourne|1|咖啡与街区
布里斯班|brisbane bulisiban|澳大利亚|🇦🇺|oc|Australia/Brisbane|0|河岸与城市公园
黄金海岸|goldcoast huangjinhaian|澳大利亚|🇦🇺|oc|Australia/Brisbane|0|海岸与公园
珀斯|perth posi|澳大利亚|🇦🇺|oc|Australia/Perth|0|海岸与街区
阿德莱德|adelaide adelaide|澳大利亚|🇦🇺|oc|Australia/Adelaide|0|博物馆与街区
奥克兰|auckland aokelan|新西兰|🇳🇿|oc|Pacific/Auckland|1|海湾与自然
皇后镇|queenstown huanghouzhen|新西兰|🇳🇿|oc|Pacific/Auckland|0|山景与湖泊
基督城|christchurch jiducheng|新西兰|🇳🇿|oc|Pacific/Auckland|0|城市公园与街区
楠迪|nadi nandi|斐济|🇫🇯|oc|Pacific/Fiji|0|海岸与岛屿
# ── 非洲 ─────────────────────────────────────────────────────────────────
开普敦|capetown kaipudun|南非|🇿🇦|af|Africa/Johannesburg|1|山海与街区
约翰内斯堡|johannesburg yuehanneisibao|南非|🇿🇦|af|Africa/Johannesburg|0|博物馆与街区
开罗|cairo kailuo|埃及|🇪🇬|af|Africa/Cairo|1|古迹与博物馆
卡萨布兰卡|casablanca kasabulanka|摩洛哥|🇲🇦|af|Africa/Casablanca|0|海岸与街区
马拉喀什|marrakech malakashen|摩洛哥|🇲🇦|af|Africa/Casablanca|0|老城与庭园
内罗毕|nairobi neiluobi|肯尼亚|🇰🇪|af|Africa/Nairobi|0|博物馆与街区
毛里求斯|mauritius maoliqiusi|毛里求斯|🇲🇺|af|Indian/Mauritius|0|海岸与岛屿
塞舌尔|seychelles saisheer|塞舌尔|🇸🇨|af|Indian/Mahe|0|海岸与岛屿
`;

/**
 * A county, scenic site, province, island or archipelago is an area even when
 * travel sites loosely call it a city. Null means that we have not established
 * a single transport city: callers must omit a flight search, not guess one.
 *
 * The island gateways below are documented by the official tourism/airport
 * operators: visitokinawajapan.com/plan-your-trip/getting-to-okinawa/,
 * airport.co.kr/jejueng/cms/frCon/index.do?MENU_ID=270,
 * phuket.airportthai.co.th/about-us?lang=th,
 * indonesia.travel/id/en/destination/bali-nusa-tenggara/bali/denpasar,
 * old.visitmaldives.com/male-city/. No airport-code inference is used.
 */
const AREA_TRANSPORT_CITIES: Readonly<Record<string, string | null>> = {
  "荔波": null, "西双版纳": "景洪", "玉龙雪山": "丽江", "婺源": "上饶",
  "洛阳老君山": "洛阳", "凤凰古城": null, "阳朔": "桂林",
  "亚龙湾": "三亚", "海棠湾": "三亚", "九寨沟": null,
  "稻城亚丁": null, "甘孜": null, "黄龙": null, "平遥": null,
  "洛阳龙门": "洛阳", "华山": null, "伊犁": "伊宁", "赛里木湖": null,
  "冲绳": "那霸", "箱根": null, "济州岛": "济州", "普吉岛": "普吉",
  "苏梅岛": null, "槟城": null, "兰卡威": null, "巴厘岛": "登巴萨",
  "马尔代夫": "马累", "圣托里尼": null, "毛里求斯": null, "塞舌尔": null,
};

const PLACE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "长春": ["长春冰雪", "changchunbingxue", "bingxue"],
  "乌鲁木齐": ["urumqi"],
};

function parse(table: string): Place[] {
  const places: Place[] = [];
  for (const line of table.split("\n")) {
    const row = line.trim();
    if (!row || row.startsWith("#")) continue;
    const [city, romanization, country, flag, group, timezone, popular, hint] = row.split("|");
    if (!city || !romanization || !country || !flag || !Object.hasOwn(GROUP_LABELS, group) || !timezone || !hint || !["0", "1"].includes(popular)) throw new Error(`Malformed place row: ${row}`);
    const initial = (/^[a-z]/i.test(romanization ?? "") ? romanization[0] : "#").toUpperCase();
    places.push({
      city: city.trim(),
      kind: Object.hasOwn(AREA_TRANSPORT_CITIES, city) ? "area" : "city",
      ...(AREA_TRANSPORT_CITIES[city] ? { transportCity: AREA_TRANSPORT_CITIES[city] as string } : {}),
      ...(PLACE_ALIASES[city] ? { aliases: PLACE_ALIASES[city] } : {}),
      romanization: (romanization ?? "").trim(),
      country: (country ?? "").trim(),
      flag: (flag ?? "").trim(),
      group: group as PlaceGroup,
      timezone: timezone.trim(),
      popular: popular === "1",
      hint: (hint ?? "").trim(),
      initial,
      domestic: group === "cn",
    });
  }
  return places;
}

export const PLACES: readonly Place[] = parse(RAW);

export const DOMESTIC_PLACES: readonly Place[] = PLACES.filter((place) => place.group === "cn");
export const INTERNATIONAL_PLACES: readonly Place[] = PLACES.filter((place) => place.group !== "cn");

/** One eligibility rule for suggestions, alphabet sections and search results. */
export function selectablePlaces(pool: readonly Place[] = PLACES, { citiesOnly = false, exclude }: { citiesOnly?: boolean; exclude?: string } = {}): readonly Place[] {
  return pool.filter((place) => (!citiesOnly || place.kind === "city") && place.city !== exclude);
}

/** Resolve a selected catalog name or legacy alias without substituting a POI. */
export function transportCityFor(city: string): string | null {
  const key = searchKey(city.trim());
  if (!key) return null;
  const place = PLACES.find((entry) => searchKey(entry.city) === key || entry.aliases?.some((alias) => searchKey(alias) === key));
  return place ? place.kind === "city" ? place.city : place.transportCity ?? null : null;
}

export function placesInGroup(group: PlaceGroup): readonly Place[] {
  return PLACES.filter((place) => place.group === group);
}

/** Ranked by how often the traveller has chosen it, so habits surface first. */
export function popularFirst(places: readonly Place[], learned: readonly string[] = []): readonly Place[] {
  const learnedRank = new Map(learned.map((city, index) => [city, index]));
  const rank = (place: Place) => learnedRank.get(place.city) ?? (place.popular ? learned.length : learned.length + 1);
  // Stable ordering retains the catalog's familiar popular-city order, while
  // the account's explicitly ranked history takes precedence.
  return places.slice().sort((a, b) => rank(a) - rank(b));
}

const COUNTRY_ALIASES: Record<string, string> = {
  "中国": "china", "中国香港": "hongkong", "中国澳门": "macau macao", "中国台湾": "taiwan",
  "日本": "japan", "韩国": "korea southkorea", "新加坡": "singapore", "泰国": "thailand",
  "马来西亚": "malaysia", "印度尼西亚": "indonesia", "越南": "vietnam", "菲律宾": "philippines",
  "柬埔寨": "cambodia", "马尔代夫": "maldives", "斯里兰卡": "srilanka", "尼泊尔": "nepal", "印度": "india",
  "阿联酋": "uae unitedarabemirates", "卡塔尔": "qatar", "土耳其": "turkey turkiye",
  "英国": "uk unitedkingdom britain", "法国": "france", "意大利": "italy", "西班牙": "spain", "葡萄牙": "portugal",
  "德国": "germany", "荷兰": "netherlands", "比利时": "belgium", "瑞士": "switzerland", "奥地利": "austria",
  "捷克": "czechia", "匈牙利": "hungary", "希腊": "greece", "丹麦": "denmark", "瑞典": "sweden",
  "挪威": "norway", "芬兰": "finland", "冰岛": "iceland", "俄罗斯": "russia",
  "美国": "usa unitedstates", "加拿大": "canada", "墨西哥": "mexico", "巴西": "brazil", "阿根廷": "argentina",
  "秘鲁": "peru", "智利": "chile", "哥伦比亚": "colombia", "澳大利亚": "australia", "新西兰": "newzealand",
  "斐济": "fiji", "南非": "southafrica", "埃及": "egypt", "摩洛哥": "morocco", "肯尼亚": "kenya",
  "毛里求斯": "mauritius", "塞舌尔": "seychelles",
};
function searchKey(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f\s'’.-]/g, "");
}

/** Free-text match across city, romanization and country, in either script. */
export function searchPlaces(query: string, pool: readonly Place[] = PLACES): readonly Place[] {
  const needle = searchKey(query.trim());
  if (!needle) return pool;
  return pool.filter((place) =>
    searchKey(`${place.city} ${place.romanization} ${place.country} ${COUNTRY_ALIASES[place.country] ?? ""} ${place.hint} ${place.aliases?.join(" ") ?? ""}`).includes(needle));
}

/** Groups by index letter so a rail can jump straight to one. */
export function groupByInitial(places: readonly Place[]): Array<[string, Place[]]> {
  const groups = new Map<string, Place[]>();
  for (const place of places) {
    const key = /^[A-Z]$/.test(place.initial) ? place.initial : "#";
    groups.set(key, [...(groups.get(key) ?? []), place]);
  }
  return [...groups].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)));
}

/** The letters actually present, so the rail never offers an empty section. */
export function initialsOf(places: readonly Place[]): string[] {
  return [...new Set(places.map((place) => place.initial))].filter((letter) => letter !== "#").sort();
}
