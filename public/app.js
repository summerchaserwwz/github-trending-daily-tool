const pageMode = document.body.dataset.page || 'official';
const endpoint = pageMode === 'custom' ? './api/custom-top' : './api/official-top';

const cardsElement = document.querySelector('#cards');
const refreshButton = document.querySelector('#refreshButton');
const heroRefreshButton = document.querySelector('#heroRefreshButton');
const topNSelect = document.querySelector('#topNSelect');
const languageChips = document.querySelector('#languageChips');
const cardTemplate = document.querySelector('#cardTemplate');
const insightTemplate = document.querySelector('#insightTemplate');
const insightsGrid = document.querySelector('#insightsGrid');
const insightNote = document.querySelector('#insightNote');

let currentLanguage = '';
const isStaticSite = window.location.hostname.endsWith('github.io');

async function fetchJsonWithRetry(url, attempts = 3, delayMs = 500) {
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || payload.error || '请求失败');
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (index + 1)));
      }
    }
  }
  throw lastError || new Error('请求失败');
}

async function loadStaticPayload() {
  const fileName = pageMode === 'custom' ? 'custom-top.json' : 'official-top.json';
  const response = await fetch(`./data/${fileName}?ts=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('静态数据不存在');
  }
  return response.json();
}

const topicColorClasses = [
  'topic-macaron-1',
  'topic-macaron-2',
  'topic-macaron-3',
  'topic-macaron-4',
  'topic-macaron-5',
  'topic-macaron-6',
];

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(value || 0);
}

function formatTime(value) {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function buildLanguageUrl(language) {
  return language ? `https://github.com/trending/${encodeURIComponent(language.toLowerCase())}?since=daily` : '';
}

function getMetaIcon(label) {
  return {
    '总 Star': '⭐',
    'Fork': '⑂',
    '语言': '⌘',
    '主页': '↗',
    'README': '📘',
    '最近更新': '🕒',
  }[label] || '•';
}

function createMetaLink(label, value, href, variant = 'neutral') {
  const element = href ? document.createElement('a') : document.createElement('div');
  element.className = `meta-item meta-link meta-${variant}`;
  element.textContent = `${getMetaIcon(label)} ${label}：${value}`;
  if (href) {
    element.href = href;
    element.target = '_blank';
    element.rel = 'noreferrer';
  }
  return element;
}

function renderEmpty(message) {
  cardsElement.innerHTML = `<div class="empty-state">${message}</div>`;
}

function topicBars(items = []) {
  if (!items.length) {
    return '<div class="chart-empty">暂无明显话题聚类</div>';
  }
  const max = Math.max(...items.map((item) => item.count), 1);
  return `
    <div class="bar-chart">
      ${items.map((item) => `
        <div class="bar-row">
          <div class="bar-label">#${item.name}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(item.count / max) * 100}%"></div></div>
          <div class="bar-value">${item.count}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function countryBars(items = []) {
  if (!items.length) {
    return '<div class="chart-empty">地区信息暂时不足</div>';
  }
  const max = Math.max(...items.map((item) => item.count), 1);
  return `
    <div class="bar-chart country-chart">
      ${items.map((item) => `
        <div class="bar-row">
          <div class="bar-label">${item.name}</div>
          <div class="bar-track"><div class="bar-fill muted" style="width:${(item.count / max) * 100}%"></div></div>
          <div class="bar-value">${item.count}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function donutChart(items = []) {
  if (!items.length) {
    return '<div class="chart-empty">暂无语言分布</div>';
  }
  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const colors = ['#7dd3fc', '#a7f3d0', '#fde68a', '#fbcfe8', '#c4b5fd', '#fdba74'];
  const circles = items.slice(0, 6).map((item, index) => {
    const fraction = item.count / total;
    const length = circumference * fraction;
    const circle = `<circle cx="60" cy="60" r="44" fill="none" stroke="${colors[index % colors.length]}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" />`;
    offset += length;
    return circle;
  }).join('');

  const legend = items.slice(0, 6).map((item, index) => `
    <div class="donut-legend-item">
      <span class="legend-dot" style="background:${colors[index % colors.length]}"></span>
      <span>${item.name}</span>
      <strong>${Math.round((item.count / total) * 100)}%</strong>
    </div>
  `).join('');

  return `
    <div class="donut-wrap">
      <svg viewBox="0 0 120 120" class="donut-svg" aria-hidden="true">
        <circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="14" />
        ${circles}
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

function pickTopicFocus(items = []) {
  const names = items.map((item) => String(item.name || '').toLowerCase());
  if (names.some((name) => /(browser-automation|ui-automation|automation|workflow)/.test(name))) {
    return '自动化';
  }
  if (names.some((name) => /(agent|ai-agents|multi-agent|assistant)/.test(name))) {
    return 'AI Agent';
  }
  if (names.some((name) => /(rag|retrieval)/.test(name))) {
    return 'RAG';
  }
  if (names.some((name) => /(tts|speech|audio|voice)/.test(name))) {
    return '语音';
  }
  if (names.some((name) => /(security|pentest|red-teaming|vulnerability)/.test(name))) {
    return '安全评测';
  }
  if (names.some((name) => /(knowledge-graph|prediction|forecast)/.test(name))) {
    return '预测分析';
  }
  return '';
}

function buildInsightSummary(insights = {}) {
  const topCategory = insights.categories?.[0]?.name || '开源热点';
  const topLanguage = insights.languages?.[0]?.name || '多语言';
  const topicFocus = pickTopicFocus(insights.topics || []);
  return `今天热门项目主要集中在 ${topCategory}、${topLanguage}${topicFocus ? ` 和 ${topicFocus}` : ''} 方向。`;
}

function topEntries(mapObject, limit = 6) {
  return Object.entries(mapObject)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function deriveInsights(items = []) {
  const topicCounts = {};
  const keywordCounts = {};
  const languageCounts = {};
  const categoryCounts = {};
  const countryCounts = {};

  const keywordRules = [
    'agent', 'ai', 'automation', 'workflow', 'claude', 'llm', 'rag', 'prompt',
    'browser', 'speech', 'tts', 'voice', 'code', 'evaluation', 'security',
    'prediction', 'knowledge-graph', 'chatbot', 'finance',
  ];

  items.forEach((item) => {
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

    if (item.ownerCountry) {
      countryCounts[item.ownerCountry] = (countryCounts[item.ownerCountry] || 0) + 1;
    }
  });

  const topics = topEntries(topicCounts, 8);

  return {
    topics: topics.length ? topics : topEntries(keywordCounts, 8),
    languages: topEntries(languageCounts, 6),
    categories: topEntries(categoryCounts, 6),
    countries: topEntries(countryCounts, 6),
  };
}

function buildCustomViewPayload(payload) {
  const sourceItems = Array.isArray(payload.items) ? payload.items : [];
  const limit = Number(topNSelect?.value || '20');
  const limitedItems = sourceItems.slice(0, limit).map((item, index) => ({ ...item, rank: index + 1 }));
  const availableLanguages = new Set(
    limitedItems
      .map((item) => (item.language || '').toLowerCase())
      .filter(Boolean),
  );

  if (currentLanguage && !availableLanguages.has(currentLanguage.toLowerCase())) {
    currentLanguage = '';
  }

  const chipInsights = deriveInsights(limitedItems);
  const visibleItems = currentLanguage
    ? limitedItems.filter((item) => (item.language || '').toLowerCase() === currentLanguage.toLowerCase())
    : limitedItems;

  return {
    ...payload,
    items: visibleItems,
    insights: deriveInsights(visibleItems),
    chipInsights,
  };
}

function renderInsights(insights, note = '') {
  insightsGrid.innerHTML = '';
  const visibleCountries = (insights.countries || []).filter((item) => item.name !== '未知');
  insightNote.textContent = buildInsightSummary(insights);

  const cards = [
    { title: '热词话题', html: topicBars(insights.topics || []) },
    { title: '语言占比', html: donutChart(insights.languages || []) },
    ...(visibleCountries.length >= 2 ? [{ title: '地区分布（按作者公开位置推断）', html: countryBars(visibleCountries) }] : []),
  ];

  cards.forEach((entry) => {
    const fragment = insightTemplate.content.cloneNode(true);
    fragment.querySelector('.insight-title').textContent = entry.title;
    fragment.querySelector('.insight-content').innerHTML = entry.html;
    insightsGrid.appendChild(fragment);
  });
}

function renderLanguageChips(insights) {
  if (!languageChips) return;
  languageChips.innerHTML = '';
  const languages = insights.languages || [];
  const entries = [{ name: '全部', count: null, key: '' }, ...languages.map((item) => ({ ...item, key: item.name }))];

  entries.forEach((item) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `language-chip${currentLanguage === item.key ? ' active' : ''}`;
    chip.textContent = item.count === null ? item.name : `${item.name} · ${item.count}`;
    chip.addEventListener('click', () => {
      currentLanguage = item.key;
      loadData();
    });
    languageChips.appendChild(chip);
  });
}

function renderCards(payload) {
  cardsElement.innerHTML = '';
  const items = payload.items || [];
  if (!items.length) {
    renderEmpty('没有抓到项目，请稍后再试。');
    return;
  }

  items.forEach((item) => {
    const fragment = cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector('.card');
    const previewLink = fragment.querySelector('.preview-link');
    const previewImage = fragment.querySelector('.preview-image');
    const link = fragment.querySelector('.repo-link');

    previewLink.href = item.url;
    previewImage.src = item.previewImageUrl;
    previewImage.alt = `${item.fullName} 预览图`;
    fragment.querySelector('.rank').textContent = `第 ${item.rank} 名`;
    link.href = item.url;
    link.textContent = item.fullName;
    fragment.querySelector('.stars-today').textContent = item.badgeText;

    const radarWrap = fragment.querySelector('.radar-wrap');
    if (radarWrap) {
      radarWrap.remove();
    }

    fragment.querySelector('.summary-what').textContent = item.chineseCard.what;
    fragment.querySelector('.summary-who').textContent = item.chineseCard.highlight;
    const summaryHighlight = fragment.querySelector('.summary-highlight');
    if (summaryHighlight) summaryHighlight.remove();

    const metaGrid = fragment.querySelector('.meta-grid');
    metaGrid.appendChild(createMetaLink('总 Star', formatNumber(item.stars || item.totalStars), `${item.url}/stargazers`, 'star'));
    metaGrid.appendChild(createMetaLink('Fork', formatNumber(item.forks), `${item.url}/forks`, 'fork'));
    if (item.language) metaGrid.appendChild(createMetaLink('语言', item.language, buildLanguageUrl(item.language), 'language'));
    metaGrid.appendChild(createMetaLink('README', '查看详情', item.readmeUrl, 'readme'));
    if (item.homepage) metaGrid.appendChild(createMetaLink('主页', '打开主页', item.homepage, 'home'));
    if (item.updatedAt) metaGrid.appendChild(createMetaLink('最近更新', formatTime(item.updatedAt), `${item.url}/commits`, 'updated'));

    const topicsElement = fragment.querySelector('.topics');
    if (topicsElement) {
      topicsElement.remove();
    }

    card.addEventListener('click', (event) => {
      if (event.target.closest('a, button, input, select, option')) return;
      window.open(item.url, '_blank', 'noopener,noreferrer');
    });

    cardsElement.appendChild(fragment);
  });
}

async function loadData() {
  const params = new URLSearchParams();
  if (pageMode === 'custom') {
    params.set('limit', topNSelect?.value || '20');
  } else {
    params.set('limit', '20');
    params.set('since', 'daily');
  }
  if (currentLanguage) params.set('language', currentLanguage);

  if (refreshButton) refreshButton.disabled = true;
  if (heroRefreshButton) heroRefreshButton.disabled = true;
  cardsElement.innerHTML = '<div class="empty-state">正在加载最新趋势…</div>';
  try {
    let payload;
    if (isStaticSite) {
      payload = await loadStaticPayload();
    } else {
      try {
        payload = await fetchJsonWithRetry(`${endpoint}?${params.toString()}`);
      } catch (error) {
        payload = await loadStaticPayload();
      }
    }

    const viewPayload = pageMode === 'custom' ? buildCustomViewPayload(payload) : payload;

    renderLanguageChips(viewPayload.chipInsights || viewPayload.insights || {});
    renderInsights(viewPayload.insights || {}, viewPayload.note || '');
    renderCards(viewPayload);
  } catch (error) {
    renderEmpty(`加载失败：${error.message || '请稍后重试'}`);
  } finally {
    if (refreshButton) refreshButton.disabled = false;
    if (heroRefreshButton) heroRefreshButton.disabled = false;
  }
}

if (refreshButton) refreshButton.addEventListener('click', loadData);
if (heroRefreshButton) heroRefreshButton.addEventListener('click', loadData);
if (topNSelect) topNSelect.addEventListener('change', loadData);

loadData();
