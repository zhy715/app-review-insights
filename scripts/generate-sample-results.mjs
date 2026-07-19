/**
 * Generate a cached sample pipeline result from sample-reviews.json.
 *
 * Purpose: lets reviewers without a DEEPSEEK_API_KEY see the full UI
 * (classifications → findings → PRD → version plan → test cases →
 * traceability graph) by loading a pre-computed result.
 *
 * The LLM-driven stages (classification nuance, finding aggregation, PRD
 * wording) are approximated here by deterministic keyword rules and hand-
 * authored content. The deterministic stages (cleaning, validation) use the
 * same logic as the real pipeline so the trace chain is consistent.
 *
 * Run: node scripts/generate-sample-results.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------- Read sample reviews ----------
const raw = JSON.parse(
  readFileSync(join(ROOT, "public/data/sample-reviews.json"), "utf8")
);
const rawReviews = raw.reviews || raw;

// ---------- Inline cleaner logic (mirrors src/lib/cleaner.ts) ----------
function detectLanguage(text) {
  const cjkCount = (text.match(/[一-鿿㐀-䶿豈-﫿]/g) || []).length;
  const japaneseCount = (text.match(/[぀-ゟ゠-ヿ]/g) || []).length;
  const koreanCount = (text.match(/[가-힯ᄀ-ᇿ]/g) || []).length;
  const totalChars = text.replace(/\s/g, "").length;
  if (totalChars === 0) return "en";
  const cjkRatio = (cjkCount + japaneseCount + koreanCount) / totalChars;
  if (cjkRatio > 0.3) {
    if (japaneseCount > cjkCount && japaneseCount > koreanCount) return "ja";
    if (koreanCount > cjkCount && koreanCount > japaneseCount) return "ko";
    return "zh";
  }
  const cyrillicCount = (text.match(/[Ѐ-ӿ]/g) || []).length;
  if (cyrillicCount / totalChars > 0.3) return "ru";
  return "en";
}

function normalizeContent(text) {
  return text.trim().replace(/\s+/g, " ").replace(/([.!?])\1{2,}/g, "$1").replace(/\n{3,}/g, "\n\n");
}

function textSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

function cleanReviews(reviews) {
  const nonEmpty = reviews.filter((r) => r.content.trim().length > 0);
  const seenIds = new Set();
  const idDeduped = [];
  for (const r of nonEmpty) {
    if (seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    idDeduped.push(r);
  }
  const contentDeduped = [];
  for (const r of idDeduped) {
    const isDup = contentDeduped.some(
      (e) => textSimilarity(r.content, e.content) > 0.9
    );
    if (isDup) continue;
    contentDeduped.push(r);
  }
  return contentDeduped.map((r) => ({
    ...r,
    language: detectLanguage(`${r.title} ${r.content}`),
    isDuplicate: false,
    normalizedContent: normalizeContent(r.content),
  }));
}

const cleanedReviews = cleanReviews(rawReviews);

// ---------- Sample rating + mock app metadata (iTunes Lookup approximation) ----------
// The real pipeline calls iTunes Lookup API in parallel with review collection.
// Here we mock the metadata so the AppMetadataCard and the sample-vs-full-store
// bias check in the Data Limitations finding both render in the cached sample.
const sampleAvgRating =
  cleanedReviews.reduce((s, r) => s + r.rating, 0) / cleanedReviews.length;
const appMetadata = {
  trackId: 839285684,
  trackName: "FitFlow Workouts",
  sellerName: "FitFlow Inc.",
  version: "3.2.2",
  averageUserRating: 4.2, // full-store average — higher than sample to demo bias
  averageUserRatingForCurrentVersion: 3.5,
  userRatingCount: 18534,
  userRatingCountForCurrentVersion: 2418,
  primaryGenreName: "Health & Fitness",
  contentAdvisoryRating: "4+",
  // artwork URLs omitted — would point to Apple's CDN in production; left out
  // here so the cached sample has no external image dependency.
};
const ratingGap = Math.abs(sampleAvgRating - appMetadata.averageUserRating);

// ---------- Keyword-based classification (approximates LLM stage) ----------
const KEYWORD_RULES = [
  { area: "订阅管理", topics: ["订阅", "价格", "扣费"], keywords: /subscription|charged|billing|cancel|refund|expensive|\$9\.99|\$79\.99|价格|订阅|扣费/i, severity: "critical" },
  { area: "稳定性", topics: ["崩溃", "闪退"], keywords: /crash|closes|se cierra|崩溃|闪退|crashes/i, severity: "critical" },
  { area: "认证", topics: ["登录失败"], keywords: /log in|log-in|authentication|login|登录|无法登录/i, severity: "critical" },
  { area: "媒体播放", topics: ["视频质量", "音频同步"], keywords: /video|audio|sync|quality|240p|encoding|CDN|视频|音频/i, severity: "major" },
  { area: "训练计时器", topics: ["计时器"], keywords: /timer|rest timer|计时器/i, severity: "major" },
  { area: "离线功能", topics: ["离线模式"], keywords: /offline|connection|downloads|离线/i, severity: "major" },
  { area: "数据同步", topics: ["跨设备同步"], keywords: /sync|cross-device|history sync|同步/i, severity: "major" },
  { area: "新手引导", topics: ["引导流程"], keywords: /onboarding|beginner|guidance|引导|新手/i, severity: "minor" },
  { area: "搜索", topics: ["搜索筛选"], keywords: /search|filter|搜索|筛选/i, severity: "major" },
  { area: "通知", topics: ["通知设置"], keywords: /notification|push|通知/i, severity: "minor" },
  { area: "数据导出", topics: ["数据导出"], keywords: /export|CSV|导出/i, severity: "minor" },
  { area: "Apple Watch", topics: ["Watch 支持"], keywords: /apple watch|watch|手表/i, severity: "minor" },
  { area: "冥想", topics: ["冥想功能"], keywords: /meditation|meditat|冥想/i, severity: "suggestion" },
  { area: "社交挑战", topics: ["挑战", "排行榜"], keywords: /challenge|leaderboard|friends|挑战|排行榜/i, severity: "suggestion" },
  { area: "睡眠追踪", topics: ["睡眠"], keywords: /sleep|睡眠/i, severity: "major" },
  { area: "存储管理", topics: ["存储占用"], keywords: /storage|GB|cache|存储|缓存/i, severity: "minor" },
  { area: "客户支持", topics: ["客服响应"], keywords: /support|customer service|客服|支持/i, severity: "major" },
  { area: "界面设计", topics: ["UI 设计"], keywords: /interface|design|UI|dark mode|界面|设计/i, severity: "suggestion" },
  { area: "自定义", topics: ["自定义计划"], keywords: /custom|customization|swap|自定义/i, severity: "minor" },
  { area: "第三方集成", topics: ["集成"], keywords: /myfitnesspal|calorie|sync|integration|集成|卡路里/i, severity: "minor" },
  { area: "恢复训练", topics: ["恢复"], keywords: /recovery|injury|mobility|恢复/i, severity: "suggestion" },
  { area: "女性训练", topics: ["女性专属"], keywords: /women|women's|pregnancy|postpartum|女性/i, severity: "minor" },
];

function classifyReview(r) {
  const text = `${r.title} ${r.content}`;
  const matched = KEYWORD_RULES.filter((rule) => rule.keywords.test(text));

  let featureArea = null;
  let topics = [];
  let severity = null;
  if (matched.length > 0) {
    featureArea = matched[0].area;
    topics = matched[0].topics;
    severity = matched[0].severity;
  }

  // Sentiment from rating
  let sentiment;
  if (r.rating >= 4) sentiment = "positive";
  else if (r.rating <= 2) sentiment = "negative";
  else sentiment = r.rating === 3 ? "neutral" : "mixed";

  // Severity override by rating for negative reviews
  if (sentiment === "negative" && !severity) {
    severity = r.rating === 1 ? "critical" : "major";
  }

  // Key excerpt: first 120 chars of content
  const keyExcerpts = [r.content.slice(0, 120)];

  return {
    reviewId: r.id,
    topics: topics.length > 0 ? topics : ["other"],
    sentiment,
    severity: severity || "minor",
    featureArea: featureArea || "other",
    keyExcerpts,
  };
}

const classifications = cleanedReviews.map(classifyReview);

// ---------- Hand-authored findings (approximates LLM aggregation) ----------
const findings = [
  {
    id: "F-001",
    title: "订阅管理与扣费问题严重",
    description: "多位用户反映无法取消订阅、被重复扣费、免费试用被立即收费，且客服未响应。这属于核心信任问题，直接影响用户留存和品牌口碑。涉及取消按钮失效、重复扣款、误导性试用条款三类子问题。",
    category: "pricing",
    severity: "critical",
    supportingReviewIds: ["sample-004", "sample-008", "sample-012", "sample-030"],
    supportingExcerpts: [
      "I've been trying to cancel my subscription for 2 weeks. The cancel button in settings doesn't work",
      "I was charged twice for the annual subscription ($79.99 x 2). Customer support is non-existent.",
      "The app says '7-day free trial' but it charged me immediately.",
      "I've emailed support three times about a billing error over the past month. Not a single response.",
    ],
    conflictingReviewIds: [],
    confidence: 0.95,
    source: "model",
    sampleCount: 4,
  },
  {
    id: "F-002",
    title: "应用崩溃导致训练进度丢失",
    description: "多个版本（3.2.0、3.2.1）中，用户在进行训练视频时应用崩溃，训练进度丢失。有用户反馈崩溃发生在视频开始约 5 分钟后。此问题严重影响核心功能可用性。",
    category: "bug",
    severity: "critical",
    supportingReviewIds: ["sample-002", "sample-023"],
    supportingExcerpts: [
      "Every time I start a workout video, the app crashes after about 5 minutes.",
      "Cada vez que intento ver un video de entrenamiento la aplicación se cierra después de unos minutos.",
    ],
    conflictingReviewIds: [],
    confidence: 0.9,
    source: "model",
    sampleCount: 2,
  },
  {
    id: "F-003",
    title: "更新后无法登录",
    description: "3.2.2 版本更新后部分用户无法登录，提示 'authentication failed'，且密码重置邮件未发送。这是回归性 Bug，阻断核心流程。",
    category: "bug",
    severity: "critical",
    supportingReviewIds: ["sample-016"],
    supportingExcerpts: [
      "After updating to 3.2.2 I can't log in anymore. It says 'authentication failed' even though my password is correct.",
    ],
    conflictingReviewIds: [],
    confidence: 0.8,
    source: "model",
    sampleCount: 1,
    uncertaintyNotes: "仅 1 条评论报告，但问题严重（完全无法登录），且明确指向 3.2.2 版本回归。",
  },
  {
    id: "F-004",
    title: "视频与音频质量问题",
    description: "用户反映音频与视频不同步（延迟 2-3 秒），以及视频质量在高速网络下随机降至 240p。影响训练跟练体验。",
    category: "performance",
    severity: "major",
    supportingReviewIds: ["sample-006", "sample-015"],
    supportingExcerpts: [
      "the trainer's audio is 2-3 seconds behind the video. It makes it really hard to follow along.",
      "On a 100Mbps connection, the video quality still drops to what looks like 240p sometimes.",
    ],
    conflictingReviewIds: [],
    confidence: 0.85,
    source: "model",
    sampleCount: 2,
  },
  {
    id: "F-005",
    title: "缺少离线模式",
    description: "网络不佳时应用不可用，用户强烈需求离线下载功能。这是高频功能请求，影响在健身房、户外等弱网环境的使用。",
    category: "feature_request",
    severity: "major",
    supportingReviewIds: ["sample-005"],
    supportingExcerpts: [
      "I often exercise in places with poor internet and the app is unusable without a connection. Please add offline downloads!",
    ],
    conflictingReviewIds: [],
    confidence: 0.85,
    source: "model",
    sampleCount: 1,
  },
  {
    id: "F-006",
    title: "训练计时器冻结",
    description: "组间休息计时器冻结，导致用户误判休息时长，间歇训练无法进行。该 Bug 已存在数月未修复。",
    category: "bug",
    severity: "major",
    supportingReviewIds: ["sample-011"],
    supportingExcerpts: [
      "The rest timer between sets keeps freezing. I'll think 30 seconds have passed and it's actually been 3 minutes.",
    ],
    conflictingReviewIds: [],
    confidence: 0.8,
    source: "model",
    sampleCount: 1,
  },
  {
    id: "F-007",
    title: "新手引导缺失",
    description: "新用户打开应用后直接进入高级训练，无引导流程询问健身水平和目标。对完全新手不友好，影响首次体验和转化。",
    category: "ux_issue",
    severity: "minor",
    supportingReviewIds: ["sample-018"],
    supportingExcerpts: [
      "First time opening the app and I was dumped straight into advanced workouts with no guidance.",
    ],
    conflictingReviewIds: [],
    confidence: 0.7,
    source: "model",
    sampleCount: 1,
  },
  {
    id: "F-008",
    title: "搜索与筛选功能失效",
    description: "搜索 'yoga' 返回 HIIT 训练，'no equipment' 筛选仍返回需要哑铃的训练。搜索过滤完全不生效，严重影响内容发现。",
    category: "ux_issue",
    severity: "major",
    supportingReviewIds: ["sample-019"],
    supportingExcerpts: [
      "Searching for 'yoga' returns random HIIT workouts. The search filters don't work — I filter by 'no equipment' and still get workouts that need dumbbells.",
    ],
    conflictingReviewIds: [],
    confidence: 0.85,
    source: "model",
    sampleCount: 1,
  },
  {
    id: "F-009",
    title: "订阅价格偏高",
    description: "用户反映月费 $9.99 高于同类应用（$4.99），中文用户也反映 ¥68/月 难以接受。建议推出更便宜的入门套餐或年费优惠。",
    category: "pricing",
    severity: "major",
    supportingReviewIds: ["sample-001", "sample-022"],
    supportingExcerpts: [
      "the subscription is way too expensive compared to other fitness apps. I can't justify $9.99/month when there are similar apps for $4.99.",
      "月费 ¥68 有点难以接受，希望能推出更便宜的入门套餐或者年费优惠。",
    ],
    conflictingReviewIds: [],
    confidence: 0.8,
    source: "model",
    sampleCount: 2,
  },
  {
    id: "F-010",
    title: "跨设备同步失败",
    description: "iPad 上只能看到最近 7 天的训练历史，iPhone 上数据完整。跨设备同步完全失效，重新登录也无法解决。导致用户丢失数周进度数据。",
    category: "bug",
    severity: "major",
    supportingReviewIds: ["sample-034"],
    supportingExcerpts: [
      "My workout history only shows the last 7 days on my iPad, but on my iPhone I can see everything. Cross-device sync is completely broken.",
    ],
    conflictingReviewIds: [],
    confidence: 0.8,
    source: "model",
    sampleCount: 1,
  },
  // Statistical findings
  {
    id: "F-011",
    title: "Overall Rating Analysis",
    description: `Average rating: ${(cleanedReviews.reduce((s, r) => s + r.rating, 0) / cleanedReviews.length).toFixed(1)}/5. ${cleanedReviews.filter((r) => r.rating <= 2).length}/${cleanedReviews.length} reviews (${((cleanedReviews.filter((r) => r.rating <= 2).length / cleanedReviews.length) * 100).toFixed(0)}%) are 1-2 stars. ${cleanedReviews.filter((r) => r.rating >= 4).length} reviews are 4-5 stars.`,
    category: "other",
    severity: "major",
    supportingReviewIds: cleanedReviews.filter((r) => r.rating <= 2).map((r) => r.id),
    supportingExcerpts: cleanedReviews.filter((r) => r.rating <= 2).slice(0, 3).map((r) => r.content.slice(0, 200)),
    conflictingReviewIds: cleanedReviews.filter((r) => r.rating >= 4).map((r) => r.id),
    confidence: 1.0,
    source: "statistical",
    sampleCount: cleanedReviews.filter((r) => r.rating <= 2).length,
  },
  {
    id: "F-012",
    title: "Data Limitations & Evidence Sufficiency",
    description: `本次分析的数据局限性：样本量较小（仅 ${cleanedReviews.length} 条有效评论），统计性结论可能不稳定；部分版本评论数过少（3.1.8 仅 1 条、3.1.9 仅 1 条），版本间对比结论需谨慎对待；样本平均评分 ${sampleAvgRating.toFixed(1)} 与 App Store 全量评分 ${appMetadata.averageUserRating.toFixed(1)} 偏差 ${ratingGap.toFixed(1)} 分（样本偏低），采集到的评论可能不代表整体用户感受（全量 ${appMetadata.userRatingCount} 条评分）。请在解读其他发现时将这些限制纳入考量。`,
    category: "other",
    severity: "minor",
    supportingReviewIds: [],
    supportingExcerpts: [],
    conflictingReviewIds: [],
    confidence: 1.0,
    source: "statistical",
    sampleCount: cleanedReviews.length,
    uncertaintyNotes: `样本量较小（仅 ${cleanedReviews.length} 条评论）；部分版本评论数过少；样本评分 ${sampleAvgRating.toFixed(1)} vs 全量 ${appMetadata.averageUserRating.toFixed(1)}（偏差 ${ratingGap.toFixed(1)}，样本偏低）`,
  },
];

// ---------- Hand-authored requirements ----------
const requirements = [
  {
    id: "REQ-001",
    title: "修复应用崩溃问题",
    description: "用户反馈在 3.2.0/3.2.1 版本中，开始训练视频约 5 分钟后应用崩溃，训练进度丢失。需要定位崩溃根因（内存泄漏/视频解码异常），并在下次发布前修复。用户反馈：'Every time I start a workout video, the app crashes after about 5 minutes.'",
    priority: "P0",
    sourceFindingIds: ["F-002"],
    sourceReviewIds: ["sample-002", "sample-023"],
    acceptance: ["在 iPhone 14 / iOS 17.4 上连续播放训练视频 30 分钟不崩溃", "崩溃率从当前水平降至 < 0.1%", "崩溃后训练进度可恢复"],
    version: "V1.0",
    isAssumption: false,
  },
  {
    id: "REQ-002",
    title: "修复 3.2.2 版本登录回归",
    description: "3.2.2 版本更新后部分用户无法登录，提示 'authentication failed'，密码重置邮件未发送。需回滚或修复认证模块的回归。用户反馈：'After updating to 3.2.2 I can't log in anymore.'",
    priority: "P0",
    sourceFindingIds: ["F-003"],
    sourceReviewIds: ["sample-016"],
    acceptance: ["3.2.2 用户使用正确密码可成功登录", "密码重置邮件在 1 分钟内送达", "认证失败时给出明确错误原因"],
    version: "V1.0",
    isAssumption: false,
  },
  {
    id: "REQ-003",
    title: "修复订阅管理与扣费问题",
    description: "用户无法取消订阅（取消按钮失效）、被重复扣费、免费试用被立即收费，且客服无响应。需修复取消流程、账单系统、试用逻辑。用户反馈：'I was charged twice for the annual subscription ($79.99 x 2).'",
    priority: "P0",
    sourceFindingIds: ["F-001"],
    sourceReviewIds: ["sample-004", "sample-008", "sample-012", "sample-030"],
    acceptance: ["取消订阅按钮在设置页可正常点击并生效", "重复扣费自动检测并退款", "7 天试用期内不扣费", "客服工单 48 小时内响应"],
    version: "V1.0",
    isAssumption: false,
  },
  {
    id: "REQ-004",
    title: "修复训练计时器冻结",
    description: "组间休息计时器冻结，导致间歇训练无法进行。该 Bug 已存在数月。用户反馈：'The rest timer between sets keeps freezing.'",
    priority: "P1",
    sourceFindingIds: ["F-006"],
    sourceReviewIds: ["sample-011"],
    acceptance: ["连续 10 组间歇训练中计时器不冻结", "计时器与系统时间同步，误差 < 1 秒", "应用后台返回前台后计时器继续正确运行"],
    version: "V1.0",
    isAssumption: false,
  },
  {
    id: "REQ-005",
    title: "增加离线训练模式",
    description: "用户在弱网环境无法使用应用。需支持训练视频离线下载。用户反馈：'I often exercise in places with poor internet and the app is unusable without a connection.'",
    priority: "P1",
    sourceFindingIds: ["F-005"],
    sourceReviewIds: ["sample-005"],
    acceptance: ["用户可下载训练视频至本地", "离线模式下可完整完成训练并记录进度", "下载管理支持选择画质和清理缓存"],
    version: "V1.1",
    isAssumption: false,
  },
  {
    id: "REQ-006",
    title: "优化订阅定价策略",
    description: "月费 $9.99 高于同类应用，用户反映难以接受。建议推出入门套餐或年费优惠。用户反馈：'I can't justify $9.99/month when there are similar apps for $4.99.'",
    priority: "P1",
    sourceFindingIds: ["F-009"],
    sourceReviewIds: ["sample-001", "sample-022"],
    acceptance: ["提供至少 3 档订阅方案（入门/标准/高级）", "年费方案相比月费优惠 >= 30%", "新用户可享 7 天真实免费试用（不扣费）"],
    version: "V1.1",
    isAssumption: false,
  },
  {
    id: "REQ-007",
    title: "改善新手引导流程",
    description: "新用户无引导直接进入高级训练。需增加 onboarding 流程询问健身水平和目标。用户反馈：'First time opening the app and I was dumped straight into advanced workouts with no guidance.'",
    priority: "P2",
    sourceFindingIds: ["F-007"],
    sourceReviewIds: ["sample-018"],
    acceptance: ["首次启动展示 3-5 步引导流程", "根据用户健身水平推荐合适的入门训练", "引导可跳过且可在设置中重新触发"],
    version: "V2.0",
    isAssumption: false,
  },
  {
    id: "REQ-008",
    title: "修复搜索与筛选功能",
    description: "搜索返回不相关结果，筛选条件不生效。需重构搜索索引和筛选逻辑。用户反馈：'Searching for yoga returns random HIIT workouts. The search filters don't work.'",
    priority: "P2",
    sourceFindingIds: ["F-008"],
    sourceReviewIds: ["sample-019"],
    acceptance: ["搜索 'yoga' 仅返回瑜伽类训练", "'no equipment' 筛选正确过滤出无需器械的训练", "搜索结果在 500ms 内返回"],
    version: "V2.0",
    isAssumption: false,
  },
];

// ---------- Version plan ----------
const versionPlan = [
  {
    version: "V1.0",
    theme: "关键修复——稳定性与信任",
    requirementTitles: ["修复应用崩溃问题", "修复 3.2.2 版本登录回归", "修复订阅管理与扣费问题", "修复训练计时器冻结"],
    rationale: "V1.0 聚焦阻断核心流程的严重 Bug 和直接影响用户信任的订阅扣费问题。崩溃和登录失败导致用户完全无法使用应用，订阅问题损害品牌信誉，必须在下一个版本立即修复。",
  },
  {
    version: "V1.1",
    theme: "高价值改进——离线与定价",
    requirementTitles: ["增加离线训练模式", "优化订阅定价策略"],
    rationale: "V1.1 解决高频功能请求（离线模式）和转化障碍（定价偏高）。这两个改进直接影响用户留存和付费转化，优先级仅次于 V1.0 的关键修复。",
  },
  {
    version: "V2.0",
    theme: "体验优化——引导与发现",
    requirementTitles: ["改善新手引导流程", "修复搜索与筛选功能"],
    rationale: "V2.0 聚焦体验优化类需求。新手引导改善首次转化，搜索修复提升内容发现效率。这些是重要但非紧急的改进，排在关键修复和高价值功能之后。",
  },
];

const executiveSummary = "基于 35 条用户评论（去重后 34 条）的分析，识别出 12 项产品发现，其中 3 项为严重级别（P0）：应用崩溃、登录回归、订阅扣费问题。建议分三个版本推进：V1.0（关键修复，4 项需求）、V1.1（离线模式与定价优化，2 项需求）、V2.0（体验优化，2 项需求）。负面评论占比约 50%，主要集中在订阅管理、稳定性和媒体播放三个领域。数据存在样本量较小的局限性（34 条），建议扩大样本后复核统计性结论。";

// ---------- Hand-authored test cases ----------
const testCases = [
  {
    id: "TC-001", requirementId: "REQ-001", title: "连续播放训练视频 30 分钟不崩溃",
    steps: ["Given 用户在 WiFi 网络下打开应用", "When 用户开始一个 30 分钟的训练视频", "Then 视频连续播放 30 分钟应用不崩溃"],
    expectedResult: "训练视频完整播放，应用无崩溃，训练进度正常记录",
    sourceReviews: ["sample-002"], priority: "P0",
  },
  {
    id: "TC-002", requirementId: "REQ-001", title: "崩溃后训练进度可恢复",
    steps: ["Given 用户正在播放训练视频且已进行 10 分钟", "When 应用因外部原因被系统杀死", "Then 用户重新打开应用时可从第 10 分钟继续"],
    expectedResult: "应用恢复后提示'继续上次训练'，进度从断点恢复",
    sourceReviews: ["sample-002"], priority: "P0",
  },
  {
    id: "TC-003", requirementId: "REQ-002", title: "3.2.2 用户使用正确密码可登录",
    steps: ["Given 用户已更新至 3.2.2 版本", "When 用户输入正确的邮箱和密码点击登录", "Then 登录成功进入主页"],
    expectedResult: "登录成功，无 'authentication failed' 错误",
    sourceReviews: ["sample-016"], priority: "P0",
  },
  {
    id: "TC-004", requirementId: "REQ-002", title: "密码重置邮件及时送达",
    steps: ["Given 用户在登录页点击'忘记密码'", "When 用户输入注册邮箱并提交", "Then 1 分钟内收到密码重置邮件"],
    expectedResult: "密码重置邮件在 60 秒内送达，链接可正常重置密码",
    sourceReviews: ["sample-016"], priority: "P0",
  },
  {
    id: "TC-005", requirementId: "REQ-003", title: "取消订阅按钮可正常点击并生效",
    steps: ["Given 用户已订阅并进入设置页", "When 用户点击'取消订阅'按钮", "Then 订阅在当前周期结束后取消"],
    expectedResult: "取消按钮可点击，取消后状态更新且收到确认邮件",
    sourceReviews: ["sample-004"], priority: "P0",
  },
  {
    id: "TC-006", requirementId: "REQ-003", title: "重复扣费自动检测并退款",
    steps: ["Given 用户在短时间内被扣费两次", "When 系统检测到同一周期的重复扣款", "Then 第二笔扣款自动退款"],
    expectedResult: "重复扣款在 24 小时内自动退款，用户收到通知",
    sourceReviews: ["sample-008"], priority: "P0",
  },
  {
    id: "TC-007", requirementId: "REQ-004", title: "连续间歇训练计时器不冻结",
    steps: ["Given 用户开始一个 10 组的间歇训练", "When 用户完成所有 10 组训练", "Then 每组休息计时器均正常倒计时"],
    expectedResult: "10 组训练中计时器全程不冻结，倒计时准确",
    sourceReviews: ["sample-011"], priority: "P1",
  },
  {
    id: "TC-008", requirementId: "REQ-004", title: "应用后台返回后计时器继续",
    steps: ["Given 用户正在间歇训练中", "When 用户切换到其他应用 10 秒后返回", "Then 计时器显示正确剩余时间"],
    expectedResult: "计时器与实际经过时间同步，不因后台切换而冻结",
    sourceReviews: ["sample-011"], priority: "P1",
  },
  {
    id: "TC-009", requirementId: "REQ-005", title: "下载训练视频至本地",
    steps: ["Given 用户在 WiFi 网络下", "When 用户点击训练视频的下载按钮", "Then 视频下载完成并标记为可离线播放"],
    expectedResult: "视频下载成功，离线模式下可播放",
    sourceReviews: ["sample-005"], priority: "P1",
  },
  {
    id: "TC-010", requirementId: "REQ-005", title: "离线模式完整完成训练",
    steps: ["Given 用户已下载训练视频且处于离线状态", "When 用户开始并完成训练", "Then 训练进度记录并在联网后同步"],
    expectedResult: "离线训练正常完成，进度本地记录，联网后自动同步",
    sourceReviews: ["sample-005"], priority: "P1",
  },
  {
    id: "TC-011", requirementId: "REQ-006", title: "多档订阅方案可选",
    steps: ["Given 用户进入订阅页", "When 用户查看可选方案", "Then 至少有入门/标准/高级 3 档方案"],
    expectedResult: "展示 3 档方案，价格和功能差异清晰",
    sourceReviews: ["sample-001"], priority: "P1",
  },
  {
    id: "TC-012", requirementId: "REQ-006", title: "年费方案优惠达标",
    steps: ["Given 用户查看年费方案", "When 对比月费 × 12 与年费价格", "Then 年费优惠幅度 >= 30%"],
    expectedResult: "年费相比月费累计至少优惠 30%",
    sourceReviews: ["sample-001"], priority: "P1",
  },
  {
    id: "TC-013", requirementId: "REQ-007", title: "首次启动展示引导流程",
    steps: ["Given 用户首次安装并打开应用", "When 应用启动完成", "Then 展示 3-5 步引导流程"],
    expectedResult: "引导流程询问健身水平并推荐入门训练",
    sourceReviews: ["sample-018"], priority: "P2",
  },
  {
    id: "TC-014", requirementId: "REQ-007", title: "引导可跳过并重新触发",
    steps: ["Given 用户在引导流程中", "When 用户点击'跳过'", "Then 引导关闭且可在设置中重新打开"],
    expectedResult: "引导可跳过，设置页有'重新查看引导'入口",
    sourceReviews: ["sample-018"], priority: "P2",
  },
  {
    id: "TC-015", requirementId: "REQ-008", title: "搜索 yoga 仅返回瑜伽训练",
    steps: ["Given 用户在搜索页", "When 用户输入 'yoga' 并搜索", "Then 结果仅包含瑜伽类训练"],
    expectedResult: "搜索结果全部为瑜伽相关训练，无 HIIT 等无关结果",
    sourceReviews: ["sample-019"], priority: "P2",
  },
  {
    id: "TC-016", requirementId: "REQ-008", title: "无器械筛选正确过滤",
    steps: ["Given 用户在训练库页", "When 用户勾选'无需器械'筛选", "Then 结果中所有训练均不需要器械"],
    expectedResult: "筛选结果不含需要哑铃/器械的训练",
    sourceReviews: ["sample-019"], priority: "P2",
  },
];

// ---------- Inline validation logic (mirrors src/lib/validator.ts) ----------
function validateTraceability(rawReviews, cleanedReviews, classifications, findings, requirements, testCases) {
  const issues = [];
  const cleanedReviewIds = new Set(cleanedReviews.map((r) => r.id));
  const findingIds = new Set(findings.map((f) => f.id));
  const requirementIds = new Set(requirements.map((r) => r.id));

  for (const finding of findings) {
    for (const reviewId of finding.supportingReviewIds) {
      if (!cleanedReviewIds.has(reviewId)) {
        issues.push({ type: "broken_link", severity: "error", message: `Finding "${finding.title}" references non-existent review: ${reviewId}`, details: "" });
      }
    }
  }
  for (const req of requirements) {
    for (const findingId of req.sourceFindingIds) {
      if (!findingIds.has(findingId)) {
        issues.push({ type: "broken_link", severity: "error", message: `Requirement "${req.title}" references non-existent finding: ${findingId}`, details: "" });
      }
    }
  }
  for (const tc of testCases) {
    if (!requirementIds.has(tc.requirementId)) {
      issues.push({ type: "broken_link", severity: "error", message: `Test case "${tc.title}" references non-existent requirement: ${tc.requirementId}`, details: "" });
    }
  }

  const revokedRequirementIds = requirements.filter((r) => r.sourceFindingIds.length === 0 && r.sourceReviewIds.length === 0).map((r) => r.id);
  const revokedSet = new Set(revokedRequirementIds);
  const revokedTestCaseIds = testCases.filter((tc) => revokedSet.has(tc.requirementId)).map((tc) => tc.id);
  const downgradedFindingIds = findings.filter((f) => f.confidence < 0.5).map((f) => f.id);

  const coveredReviewIds = new Set();
  for (const req of requirements) for (const rid of req.sourceReviewIds) coveredReviewIds.add(rid);

  const errors = issues.filter((i) => i.severity === "error");
  const lowConfidenceFindings = findings.filter((f) => f.confidence < 0.6);
  const unsupportedRequirements = requirements.filter((r) => r.isAssumption || r.sourceFindingIds.length === 0 || lowConfidenceFindings.some((f) => r.sourceFindingIds.includes(f.id)) || revokedSet.has(r.id)).map((r) => r.id);

  const missingLinks = [];
  for (const req of requirements) {
    if (req.sourceFindingIds.length === 0) missingLinks.push({ from: req.id, to: "findings" });
    if (req.sourceReviewIds.length === 0) missingLinks.push({ from: req.id, to: "reviews" });
  }
  for (const tc of testCases) {
    if (tc.sourceReviews.length === 0) missingLinks.push({ from: tc.id, to: "reviews" });
  }

  return {
    passed: errors.length === 0,
    issues,
    unsupportedRequirements,
    missingLinks,
    totalReviews: rawReviews.length,
    coveredReviews: coveredReviewIds.size,
    revokedRequirementIds,
    revokedTestCaseIds,
    downgradedFindingIds,
  };
}

const validation = validateTraceability(rawReviews, cleanedReviews, classifications, findings, requirements, testCases);

// ---------- Assemble final result ----------
const result = {
  appName: appMetadata.trackName + " (示例)",
  appId: "sample-data",
  appMetadata,
  analysisGoal: "综合产品改进分析（示例数据）",
  rawReviews,
  cleanedReviews,
  classifications,
  findings,
  requirements,
  versionPlan,
  executiveSummary,
  testCases,
  validation,
};

const outPath = join(ROOT, "public/data/sample-results.json");
writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
console.log(`✓ Generated ${outPath}`);
console.log(`  Raw reviews: ${rawReviews.length}`);
console.log(`  Cleaned reviews: ${cleanedReviews.length}`);
console.log(`  Classifications: ${classifications.length}`);
console.log(`  Findings: ${findings.length}`);
console.log(`  Requirements: ${requirements.length}`);
console.log(`  Test cases: ${testCases.length}`);
console.log(`  Validation passed: ${validation.passed}`);
console.log(`  Validation issues: ${validation.issues.length}`);
