const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const cheerio = require('cheerio');

const PORT = Number(process.env.PORT || 3210);
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function normalizeSpace(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function parseCount(value = '') {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

function truncateText(value = '', maxLength = 120) {
  const text = normalizeSpace(value);
  if (!text) {
    return '';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function scaleLog(value, maxValue) {
  if (!value || !maxValue) {
    return 0;
  }
  return clamp((Math.log10(value + 1) / Math.log10(maxValue + 1)) * 100);
}

function daysSince(dateValue) {
  if (!dateValue) {
    return 365;
  }
  const diff = Date.now() - new Date(dateValue).getTime();
  return Math.max(0, diff / (1000 * 60 * 60 * 24));
}

function isoDateDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function buildHeaders(accept) {
  const headers = {
    'User-Agent': 'github-trending-daily-tool',
    Accept: accept,
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    headers['X-GitHub-Api-Version'] = '2022-11-28';
  }

  return headers;
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) {
    return null;
  }
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value, ttlMs = CACHE_TTL_MS) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function loadCached(key, loader, ttlMs = CACHE_TTL_MS) {
  const cached = getCached(key);
  if (cached) {
    return cached;
  }
  const value = await loader();
  setCached(key, value, ttlMs);
  return value;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: buildHeaders('text/html,application/xhtml+xml'),
  });
  if (!response.ok) {
    throw new Error(`请求失败：${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: buildHeaders('application/vnd.github+json'),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API 请求失败：${response.status} ${response.statusText} ${body}`);
  }
  return response.json();
}

function buildTrendingUrl(language, since) {
  const safeSince = ['daily', 'weekly', 'monthly'].includes(since) ? since : 'daily';
  const languagePath = language ? `/${encodeURIComponent(language.trim())}` : '';
  return `https://github.com/trending${languagePath}?since=${safeSince}`;
}

function extractTrendingRepos(html, since = 'daily') {
  const $ = cheerio.load(html);
  const repos = [];

  $('article.Box-row').each((_, element) => {
    const link = $(element).find('h2 a').first();
    const href = link.attr('href');
    if (!href) {
      return;
    }

    const [owner, repo] = href.replace(/^\//, '').split('/');
    if (!owner || !repo) {
      return;
    }

    const description = normalizeSpace($(element).find('p').first().text());
    const language = normalizeSpace($(element).find('[itemprop="programmingLanguage"]').first().text());
    const periodMatch = normalizeSpace($(element).text()).match(/([\d,]+)\s+stars?\s+(today|this week|this month)/i);
    const totalStars = parseCount($(element).find('a[href$="/stargazers"]').first().text());
    const forks = parseCount($(element).find('a[href$="/forks"]').first().text());

    repos.push({
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`,
      readmeUrl: `https://github.com/${owner}/${repo}#readme`,
      description,
      language,
      totalStars,
      forks,
      starsToday: since === 'daily' ? parseCount(periodMatch?.[1] || '0') : 0,
      starsWeek: since === 'weekly' ? parseCount(periodMatch?.[1] || '0') : 0,
      starsMonth: since === 'monthly' ? parseCount(periodMatch?.[1] || '0') : 0,
      previewImageUrl: `https://opengraph.githubassets.com/1/${owner}/${repo}`,
      sources: [since],
    });
  });

  return repos;
}

function stripMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\r/g, ' ');
}

function pickReadmeExcerpt(markdown = '') {
  const cleaned = stripMarkdown(markdown);
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((item) => normalizeSpace(item))
    .filter((item) => item.length >= 30 && item.length <= 280);

  return paragraphs[0] || '';
}

function extractChineseSnippet(text = '') {
  const snippets = text.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5a-zA-Z0-9、，。；：\s-]{6,80}/g) || [];
  return normalizeSpace(snippets.find((item) => /[\u4e00-\u9fa5]/.test(item)) || '');
}

function inferProjectProfile(repo) {
  const sample = `${repo.description || ''} ${repo.readmeExcerpt || ''} ${(repo.topics || []).join(' ')}`.toLowerCase();
  const rules = [
    {
      pattern: /(prompt|eval|red teaming|vulnerability|pentest|rag|llm-eval)/,
      category: 'AI 评测 / 安全',
      what: '用于测试 Prompt、Agent 和 RAG 应用的评测与安全检测工具。',
      who: '适合做大模型应用测试、红队评估和上线前质量校验的团队。',
      highlight: '覆盖提示词评测、对抗测试、漏洞扫描或 CI 集成。',
    },
    {
      pattern: /(browser|gui agent|page-agent|web interfaces|automation|playwright|ui-automation)/,
      category: '浏览器智能体',
      what: '用于网页界面自动化和浏览器操作的智能体工具。',
      who: '适合做网页自动化、AI 助手操作和浏览器工作流的开发者。',
      highlight: '重点在自然语言控制网页、表单和界面交互。',
    },
    {
      pattern: /(swarm intelligence|prediction|forecast|knowledge graph|agent-memory|simulation)/,
      category: '预测 / 多智能体',
      what: '用于群体智能建模、预测分析或多智能体模拟的引擎。',
      who: '适合做研究实验、预测分析和复杂系统建模的开发者。',
      highlight: '涉及预测、知识图谱、多智能体或仿真能力。',
    },
    {
      pattern: /(software development methodology|skills framework|workflow|delivery|engineering process)/,
      category: '工程方法 / 框架',
      what: '一套面向 AI 编程协作的技能框架和软件开发方法论。',
      who: '适合希望把 AI 代理纳入工程流程、规范交付的团队。',
      highlight: '强调流程规范、技能体系和工程协作。',
    },
    {
      pattern: /(chatbot|telegram|discord|qqbot|bot infrastructure|messaging)/,
      category: '聊天机器人 / 助手',
      what: '用于搭建多平台聊天机器人和 AI 助手的基础设施。',
      who: '适合做 IM 机器人、插件扩展和多平台助手接入的开发者。',
      highlight: '支持插件、消息平台接入和多模型集成。',
    },
    {
      pattern: /(text-to-speech|tts|speech|voice|audio)/,
      category: '语音 / TTS',
      what: '一个面向语音生成和文本转语音的开源项目。',
      who: '适合做语音合成、音色实验和语音产品集成的团队。',
      highlight: '重点在高质量 TTS、语音生成或音频建模。',
    },
    {
      pattern: /(hedge fund|trading|investment|quant)/,
      category: '金融实验 / 多代理',
      what: '一个用 AI 代理模拟投研或量化协作流程的项目。',
      who: '适合研究 AI 在金融分析、协作决策和策略实验中的应用。',
      highlight: '强调投研流程、多代理协作和策略对比。',
    },
    {
      pattern: /(agent|ai|llm|gpt|copilot|model|assistant)/,
      category: 'AI / 智能体',
      what: '一个围绕 AI Agent 或大模型应用构建的项目。',
      who: '适合在 AI 助手、Agent 工作流或 LLM 应用方向探索的开发者。',
      highlight: '围绕自动化流程、模型能力或多角色协作展开。',
    },
    {
      pattern: /(framework|sdk|library|toolkit|engine|runtime)/,
      category: '开发框架 / 工具库',
      what: '一个面向开发者的框架、引擎或工具库。',
      who: '适合做二次开发、系统集成或上层应用搭建的团队。',
      highlight: '重点在可复用能力、工程集成和扩展性。',
    },
  ];

  return rules.find((item) => item.pattern.test(sample)) || {
    category: '开源项目',
    what: '一个近期受到关注的开源项目。',
    who: '适合关注当下 GitHub 热点和技术方向的开发者。',
    highlight: '可以结合仓库主题、语言和 README 进一步判断适用场景。',
  };
}

function buildChineseCard(repo) {
  const profile = inferProjectProfile(repo);
  const chineseHint = extractChineseSnippet(repo.description || repo.readmeExcerpt || '');
  const topicPart = (repo.topics || []).slice(0, 3).map((item) => `#${item}`).join('、');
  const official = truncateText(repo.description || repo.readmeExcerpt || '暂无官方简介', 88);

  return {
    category: profile.category,
    what: chineseHint || profile.what,
    who: profile.who,
    highlight: `${profile.highlight}${repo.language ? ` 常见技术栈：${repo.language}。` : ''}${topicPart ? ` 相关主题：${topicPart}。` : ''}`,
    official,
  };
}

async function fetchReadmeExcerpt(owner, repo) {
  try {
    const payload = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/readme`);
    const content = Buffer.from(payload.content || '', 'base64').toString('utf8');
    return pickReadmeExcerpt(content);
  } catch {
    return '';
  }
}

async function fetchRepoDetails(owner, repo) {
  return loadCached(`repo:${owner}/${repo}`, async () => {
    const payload = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`);
    const readmeExcerpt = payload.description ? '' : await fetchReadmeExcerpt(owner, repo);

    return {
      description: normalizeSpace(payload.description || ''),
      topics: Array.isArray(payload.topics) ? payload.topics : [],
      homepage: payload.homepage || '',
      openIssues: Number(payload.open_issues_count || 0),
      watchers: Number(payload.subscribers_count || 0),
      license: payload.license?.spdx_id || payload.license?.name || '',
      defaultBranch: payload.default_branch || '',
      updatedAt: payload.updated_at || '',
      createdAt: payload.created_at || '',
      stars: Number(payload.stargazers_count || 0),
      forks: Number(payload.forks_count || 0),
      language: payload.language || '',
      readmeExcerpt,
      previewImageUrl: `https://opengraph.githubassets.com/1/${owner}/${repo}`,
    };
  });
}

async function fetchOwnerProfile(owner) {
  return loadCached(`owner:${owner}`, async () => {
    const payload = await fetchJson(`https://api.github.com/users/${owner}`);
    return {
      login: payload.login || owner,
      location: normalizeSpace(payload.location || ''),
      type: payload.type || '',
    };
  });
}

function inferCountryFromLocation(location = '') {
  const sample = location.toLowerCase();
  const rules = [
    { pattern: /(china|beijing|shanghai|shenzhen|hangzhou|guangzhou|chengdu|wuhan|nanjing|suzhou|xiamen|hong kong)/, label: '中国' },
    { pattern: /(usa|united states|california|san francisco|new york|seattle|austin|boston|los angeles)/, label: '美国' },
    { pattern: /(uk|united kingdom|london|manchester|england)/, label: '英国' },
    { pattern: /(japan|tokyo|osaka)/, label: '日本' },
    { pattern: /(germany|berlin|munich)/, label: '德国' },
    { pattern: /(france|paris)/, label: '法国' },
    { pattern: /(canada|toronto|vancouver|montreal)/, label: '加拿大' },
    { pattern: /(singapore)/, label: '新加坡' },
    { pattern: /(india|bangalore|mumbai|delhi)/, label: '印度' },
    { pattern: /(korea|seoul)/, label: '韩国' },
    { pattern: /(australia|sydney|melbourne)/, label: '澳大利亚' },
    { pattern: /(netherlands|amsterdam)/, label: '荷兰' },
  ];

  return rules.find((item) => item.pattern.test(sample))?.label || (location ? '其他地区' : '未知');
}

function topEntries(mapObject, limit = 6) {
  return Object.entries(mapObject)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

async function buildInsights(items) {
  const topicCounts = {};
  const keywordCounts = {};
  const languageCounts = {};
  const categoryCounts = {};
  const countryCounts = {};

  const keywordRules = [
    'agent', 'ai', 'automation', 'workflow', 'claude', 'llm', 'rag', 'prompt',
    'browser', 'speech', 'tts', 'voice', 'code', 'evaluation', 'security',
    'prediction', 'knowledge-graph', 'chatbot', 'finance'
  ];

  for (const item of items) {
    (item.topics || []).forEach((topic) => {
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });

    const sample = `${item.fullName || ''} ${item.description || ''} ${item.readmeExcerpt || ''}`.toLowerCase();
    keywordRules.forEach((keyword) => {
      if (sample.includes(keyword)) {
        keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
      }
    });

    if (item.language) {
      languageCounts[item.language] = (languageCounts[item.language] || 0) + 1;
    }

    if (item.chineseCard?.category) {
      categoryCounts[item.chineseCard.category] = (categoryCounts[item.chineseCard.category] || 0) + 1;
    }
  }

  const ownerProfiles = await Promise.all(
    items.slice(0, 20).map(async (item) => ({
      owner: item.owner,
      profile: await fetchOwnerProfile(item.owner).catch(() => ({ location: '' })),
    })),
  );

  ownerProfiles.forEach(({ owner, profile }) => {
    const country = inferCountryFromLocation(profile.location || '');
    countryCounts[country] = (countryCounts[country] || 0) + 1;
    const item = items.find((entry) => entry.owner === owner);
    if (item) {
      item.ownerCountry = country;
    }
  });

  const topTopics = topEntries(topicCounts, 8);
  const fallbackKeywords = topEntries(keywordCounts, 8).map((item) => ({
    name: item.name,
    count: item.count,
  }));

  return {
    topics: topTopics.length ? topTopics : fallbackKeywords,
    languages: topEntries(languageCounts, 6),
    categories: topEntries(categoryCounts, 6),
    countries: topEntries(countryCounts, 6),
  };
}

function mapSearchItem(item) {
  const [owner, repo] = String(item.full_name || '').split('/');
  return {
    owner,
    repo,
    fullName: item.full_name,
    url: item.html_url,
    readmeUrl: `${item.html_url}#readme`,
    description: normalizeSpace(item.description || ''),
    language: item.language || '',
    totalStars: Number(item.stargazers_count || 0),
    forks: Number(item.forks_count || 0),
    starsToday: 0,
    starsWeek: 0,
    starsMonth: 0,
    previewImageUrl: `https://opengraph.githubassets.com/1/${item.full_name}`,
    sources: ['search'],
    searchStars: Number(item.stargazers_count || 0),
    searchForks: Number(item.forks_count || 0),
  };
}

async function searchRepositories(query, sort, perPage = 30) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=desc&per_page=${perPage}`;
  const payload = await fetchJson(url);
  return Array.isArray(payload.items) ? payload.items.map(mapSearchItem) : [];
}

function mergeRepoSignals(target, incoming) {
  target.sources = Array.from(new Set([...(target.sources || []), ...(incoming.sources || [])]));
  target.starsToday = Math.max(target.starsToday || 0, incoming.starsToday || 0);
  target.starsWeek = Math.max(target.starsWeek || 0, incoming.starsWeek || 0);
  target.starsMonth = Math.max(target.starsMonth || 0, incoming.starsMonth || 0);
  target.totalStars = Math.max(target.totalStars || 0, incoming.totalStars || 0);
  target.forks = Math.max(target.forks || 0, incoming.forks || 0);
  target.searchStars = Math.max(target.searchStars || 0, incoming.searchStars || 0);
  target.searchForks = Math.max(target.searchForks || 0, incoming.searchForks || 0);
  target.description = target.description || incoming.description || '';
  target.language = target.language || incoming.language || '';
  target.previewImageUrl = target.previewImageUrl || incoming.previewImageUrl || '';
  return target;
}

function buildRoughScore(repo) {
  return (repo.starsToday || 0) * 6 + (repo.starsWeek || 0) * 2.5 + (repo.starsMonth || 0) * 1.5 + (repo.totalStars || repo.searchStars || 0) * 0.03 + (repo.forks || repo.searchForks || 0) * 0.05 + (repo.sources || []).length * 20;
}

function computeRadar(repo, maxima) {
  const heatRaw = (repo.starsToday || 0) * 1 + (repo.starsWeek || 0) * 0.55 + (repo.starsMonth || 0) * 0.25;
  const heat = maxima.heatRaw ? clamp((heatRaw / maxima.heatRaw) * 100) : 0;
  const community = clamp(scaleLog((repo.stars || repo.totalStars || 0) + (repo.forks || 0), maxima.communityRaw));
  const activity = clamp(100 - daysSince(repo.updatedAt) * 3.2);
  const maturity = clamp(scaleLog((repo.stars || repo.totalStars || 0), maxima.starRaw) * 0.6 + scaleLog(repo.forks || 0, maxima.forkRaw) * 0.2 + (repo.license ? 10 : 0) + (repo.homepage ? 10 : 0));
  const focus = clamp(((repo.topics || []).length * 10) + (repo.language ? 12 : 0) + (repo.readmeExcerpt ? 12 : 0) + ((repo.sources || []).length * 8));

  return {
    heat: Math.round(heat),
    community: Math.round(community),
    activity: Math.round(activity),
    maturity: Math.round(maturity),
    focus: Math.round(focus),
  };
}

function decorateRepository(repo, maxima, mode) {
  const chineseCard = buildChineseCard(repo);
  const radar = computeRadar(repo, maxima);
  const trendScore = Math.round(radar.heat * 0.35 + radar.community * 0.25 + radar.activity * 0.15 + radar.maturity * 0.1 + radar.focus * 0.15);

  return {
    ...repo,
    shortDescription: truncateText(repo.description || repo.readmeExcerpt || '暂无仓库简介', 90),
    chineseCard,
    radar,
    trendScore,
    badgeText: mode === 'custom' ? `趋势分 ${trendScore}` : `★ +${parseCount(String(repo.starsToday || 0)).toLocaleString('zh-CN')} 今日 Star`,
    topicLinks: (repo.topics || []).map((topic) => ({
      name: topic,
      url: `https://github.com/topics/${encodeURIComponent(topic)}`,
    })),
  };
}

async function getOfficialTrending({ language, since, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit || 20), 1), 100);
  const cacheKey = `official:${language || 'all'}:${since}:${safeLimit}`;

  return loadCached(cacheKey, async () => {
    const html = await fetchText(buildTrendingUrl(language, since));
    const rawRepos = extractTrendingRepos(html, since);
    const baseRepos = rawRepos.slice(0, safeLimit);

    const enriched = await Promise.all(
      baseRepos.map(async (repo, index) => {
        const details = await fetchRepoDetails(repo.owner, repo.repo).catch(() => ({}));
        return {
          ...repo,
          rank: index + 1,
          ...details,
          description: normalizeSpace(details.description || repo.description || ''),
        };
      }),
    );

    const maxima = {
      heatRaw: Math.max(...enriched.map((item) => (item.starsToday || 0) + (item.starsWeek || 0) * 0.55 + (item.starsMonth || 0) * 0.25), 1),
      communityRaw: Math.max(...enriched.map((item) => (item.stars || item.totalStars || 0) + (item.forks || 0)), 1),
      starRaw: Math.max(...enriched.map((item) => item.stars || item.totalStars || 0), 1),
      forkRaw: Math.max(...enriched.map((item) => item.forks || 0), 1),
    };

    const items = enriched.map((item) => decorateRepository(item, maxima, 'official'));
    const insights = await buildInsights(items);
    return {
      fetchedAt: new Date().toISOString(),
      source: 'GitHub Official Trending',
      mode: 'official',
      since,
      availableCount: rawRepos.length,
      requestedLimit: safeLimit,
      note: rawRepos.length < safeLimit ? `官方页面当前只返回 ${rawRepos.length} 个项目。` : '',
      insights,
      items,
    };
  });
}

async function getCustomTop({ language, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit || 20), 1), 100);
  const cacheKey = `custom:${language || 'all'}:${safeLimit}`;

  return loadCached(cacheKey, async () => {
    const [dailyHtml, weeklyHtml, monthlyHtml, recentSearch, risingSearch] = await Promise.all([
      fetchText(buildTrendingUrl(language, 'daily')),
      fetchText(buildTrendingUrl(language, 'weekly')),
      fetchText(buildTrendingUrl(language, 'monthly')),
      searchRepositories(`${language ? `language:${language} ` : ''}stars:>150 pushed:>=${isoDateDaysAgo(21)}`, 'updated', 30).catch(() => []),
      searchRepositories(`${language ? `language:${language} ` : ''}stars:>80 created:>=${isoDateDaysAgo(120)}`, 'stars', 30).catch(() => []),
    ]);

    const merged = new Map();
    const sources = [
      ...extractTrendingRepos(dailyHtml, 'daily'),
      ...extractTrendingRepos(weeklyHtml, 'weekly'),
      ...extractTrendingRepos(monthlyHtml, 'monthly'),
      ...recentSearch,
      ...risingSearch,
    ];

    for (const repo of sources) {
      if (!repo.fullName) {
        continue;
      }
      const existing = merged.get(repo.fullName);
      merged.set(repo.fullName, existing ? mergeRepoSignals(existing, repo) : repo);
    }

    const roughCandidates = Array.from(merged.values())
      .sort((left, right) => buildRoughScore(right) - buildRoughScore(left))
      .slice(0, Math.max(120, safeLimit));

    const enriched = await Promise.all(
      roughCandidates.map(async (repo) => {
        const details = await fetchRepoDetails(repo.owner, repo.repo).catch(() => ({}));
        return {
          ...repo,
          ...details,
          description: normalizeSpace(details.description || repo.description || ''),
        };
      }),
    );

    const maxima = {
      heatRaw: Math.max(...enriched.map((item) => (item.starsToday || 0) + (item.starsWeek || 0) * 0.55 + (item.starsMonth || 0) * 0.25), 1),
      communityRaw: Math.max(...enriched.map((item) => (item.stars || item.totalStars || 0) + (item.forks || 0)), 1),
      starRaw: Math.max(...enriched.map((item) => item.stars || item.totalStars || 0), 1),
      forkRaw: Math.max(...enriched.map((item) => item.forks || 0), 1),
    };

    const scored = enriched
      .map((item) => decorateRepository(item, maxima, 'custom'))
      .sort((left, right) => right.trendScore - left.trendScore)
      .slice(0, safeLimit)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    const insights = await buildInsights(scored);

    return {
      fetchedAt: new Date().toISOString(),
      source: 'Custom Trend Top',
      mode: 'custom',
      availableCount: scored.length,
      requestedLimit: safeLimit,
      note: '综合 daily / weekly / monthly 官方榜与搜索候选后计算趋势分。',
      insights,
      items: scored,
    };
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function serveStaticFile(reqPath, res) {
  const relativePath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: '禁止访问' });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: '文件不存在' });
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/api/official-top') {
    try {
      const limit = requestUrl.searchParams.get('limit') || '20';
      const since = requestUrl.searchParams.get('since') || 'daily';
      const language = normalizeSpace(requestUrl.searchParams.get('language') || '');
      sendJson(res, 200, await getOfficialTrending({ language, since, limit }));
    } catch (error) {
      sendJson(res, 500, { error: '官方榜抓取失败', detail: error instanceof Error ? error.message : '未知错误' });
    }
    return;
  }

  if (requestUrl.pathname === '/api/custom-top') {
    try {
      const limit = requestUrl.searchParams.get('limit') || '20';
      const language = normalizeSpace(requestUrl.searchParams.get('language') || '');
      sendJson(res, 200, await getCustomTop({ language, limit }));
    } catch (error) {
      sendJson(res, 500, { error: '自定义趋势抓取失败', detail: error instanceof Error ? error.message : '未知错误' });
    }
    return;
  }

  if (requestUrl.pathname === '/healthz') {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    return;
  }

  await serveStaticFile(requestUrl.pathname, res);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`GitHub Trending Daily Tool 已启动: http://localhost:${PORT}`);
  });
}

module.exports = {
  getOfficialTrending,
  getCustomTop,
};
