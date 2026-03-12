const fs = require('node:fs/promises');
const path = require('node:path');
const { getOfficialTrending, getCustomTop } = require('../server');

async function writeJson(outputDir, fileName, payload) {
  await fs.writeFile(
    path.join(outputDir, fileName),
    JSON.stringify(payload, null, 2),
    'utf8',
  );
}

async function main() {
  const outputDir = path.join(__dirname, '..', 'public', 'data');
  await fs.mkdir(outputDir, { recursive: true });

  const [officialPayload, customPayload] = await Promise.all([
    getOfficialTrending({
      language: '',
      since: 'daily',
      limit: 20,
    }),
    getCustomTop({
      language: '',
      limit: 100,
    }),
  ]);

  await Promise.all([
    writeJson(outputDir, 'official-top.json', officialPayload),
    writeJson(outputDir, 'custom-top.json', customPayload),
    writeJson(outputDir, 'trending.json', officialPayload),
  ]);

  console.log(`已导出官方榜：${officialPayload.items.length} 条 -> public/data/official-top.json`);
  console.log(`已导出自定义榜：${customPayload.items.length} 条 -> public/data/custom-top.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
