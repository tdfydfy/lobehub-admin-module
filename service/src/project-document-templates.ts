import type { QueryResultRow } from 'pg';

type QueryRunner = <T extends QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[] }>;

type Queryable =
  | QueryRunner
  | {
    query: QueryRunner;
  };

type DefaultProjectDocumentTemplate = {
  description: string;
  isEntry: boolean;
  slug: string;
  sortOrder: number;
  status: 'draft' | 'published';
  title: string;
};

function runQuery<T extends QueryResultRow>(
  executeQuery: Queryable,
  text: string,
  values?: unknown[],
) {
  if (typeof executeQuery === 'function') {
    return executeQuery<T>(text, values);
  }

  return executeQuery.query<T>(text, values);
}

function joinLines(lines: string[]) {
  return lines.join('\n');
}

function buildProjectKnowledgeMapContent(projectName: string) {
  return joinLines([
    `# ${projectName} 项目知识地图`,
    '',
    '## 文档用途',
    '- 本文档是本项目知识库的入口地图，用来说明项目资料分布、优先阅读顺序和当前待补充项。',
    '- 当用户提出一般性项目问题时，优先参考本地图，再按需进入对应主题文档。',
    '',
    '## 使用规则',
    '- 只把已填写、已确认的内容作为正式知识使用。',
    '- 带有“待补充”“待确认”的字段，不得直接对客户做事实性承诺。',
    '- 学校、学区、招生、政策、价格折扣等高风险信息，仍需结合全局合规文档和最新项目口径。',
    '',
    '## 推荐阅读顺序',
    '1. [01-project-core-card]：先看项目总卡，快速了解位置、产品、客户、卖点与风险。',
    '2. [02-product-and-pricing]：涉及户型、面积、价格、付款和优惠时重点查看。',
    '3. [03-location-school-faq]：涉及区位、配套、交通、学校和生活半径时重点查看。',
    '4. [04-competitor-summary]：涉及竞品对比、板块选择、客户适配判断时重点查看。',
    '5. [05-objection-handling]：涉及客户抗性、犹豫点、追问处理时重点查看。',
    '6. [06-project-dynamics]：涉及近期销售节点、加推、优惠、动态变化时重点查看。',
    '',
    '## 当前文档清单',
    '- [00-project-knowledge-map]：项目知识地图与目录入口',
    '- [01-project-core-card]：项目主卡',
    '- [02-product-and-pricing]：产品与价格',
    '- [03-location-school-faq]：区位配套与学校 FAQ',
    '- [04-competitor-summary]：竞品对比',
    '- [05-objection-handling]：客户异议与应对',
    '- [06-project-dynamics]：项目动态与销售节奏',
    '',
    '## 当前待补充项',
    '- 项目正式案名、开发商、总建面、容积率、绿化率',
    '- 主力户型面积段、主力总价段、楼栋分布',
    '- 周边商业、学校、医疗、公园、交通节点',
    '- 主竞品基础情况与点对点对比口径',
    '- 最近 30 天销售动态、优惠、加推与去化',
    '',
    '## 更新建议',
    '- 每次加推、调价、优惠变化后，优先更新 [02-product-and-pricing] 和 [06-project-dynamics]。',
    '- 每次竞品有新动作后，优先更新 [04-competitor-summary]。',
    '- 每次销售一线反馈新的常见问题后，优先更新 [05-objection-handling]。',
    '- 每次学校、政策、周边配套有新信息后，优先更新 [03-location-school-faq]。',
  ]);
}

function buildProjectCoreCardContent(projectName: string) {
  return joinLines([
    `# ${projectName} 项目主卡`,
    '',
    '## 文档用途',
    '- 本文档用于沉淀本项目最核心的一页信息，适合快速回答“项目怎么样”“项目位置在哪”“主打什么”“适合谁”等问题。',
    '- 当其他文档信息不足时，可先回到本文档做一轮总览。',
    '',
    '## 使用规则',
    '- 未填写字段视为未知，不得自行补全。',
    '- 价格、学校、政策、交付时间等敏感项必须写明口径来源或标记待确认。',
    '',
    '## 基础信息',
    '- 项目名称：',
    '- 推广案名：',
    '- 所在城市：',
    '- 所在板块：',
    '- 详细地址：',
    '- 开发主体：',
    '- 业态：',
    '- 总建面：',
    '- 容积率：',
    '- 绿化率：',
    '- 装修情况：',
    '- 预计交付时间：',
    '',
    '## 一句话定位',
    '- 建议填写一句项目定位，例如：位于主城改善板块、以改善高层和低密产品为主的综合住区。',
    '',
    '## 三个核心卖点',
    '1. 卖点一：',
    '2. 卖点二：',
    '3. 卖点三：',
    '',
    '## 三个主要风险点',
    '1. 风险一：',
    '2. 风险二：',
    '3. 风险三：',
    '',
    '## 主力客群',
    '- 首置 / 首改 / 再改：',
    '- 典型预算：',
    '- 典型职业或家庭结构：',
    '- 典型关注点：',
    '',
    '## 主力产品',
    '- 主力面积段：',
    '- 主力户型：',
    '- 主力总价带：',
    '- 当前主推楼栋 / 批次：',
    '',
    '## 一分钟项目介绍口径',
    '- 建议填写一段 60 秒以内的标准介绍，覆盖区位、产品、预算、适配客群。',
    '',
    '## 三句话快速回答',
    '- 如果客户很忙，可直接使用三句话回答：',
    '  1. 项目位置和板块价值：',
    '  2. 产品和总价带：',
    '  3. 当前最大关注点或窗口期：',
    '',
    '## 当前销售状态',
    '- 当前在售情况：',
    '- 最近加推情况：',
    '- 最近优惠情况：',
    '- 近期去化节奏：',
    '',
    '## 未确认项',
    '- 这里列出仍未确认但客户常问的问题，提醒一线不可外答。',
  ]);
}

function buildProductAndPricingContent(projectName: string) {
  return joinLines([
    `# ${projectName} 产品与价格`,
    '',
    '## 文档用途',
    '- 本文档用于沉淀项目产品线、面积段、总价带、付款方式和价格表达口径。',
    '',
    '## 使用规则',
    '- 优先说总价带，再说面积段，再说产品价值。',
    '- 单套房源价格、特价房、折扣细节必须以当期正式销控或案场公示为准。',
    '- 未确认的优惠，不得对客户承诺。',
    '',
    '## 产品线概览',
    '- 产品一：',
    '  - 面积段：',
    '  - 户型特点：',
    '  - 适配客群：',
    '- 产品二：',
    '  - 面积段：',
    '  - 户型特点：',
    '  - 适配客群：',
    '',
    '## 楼栋 / 批次信息',
    '- 当前在售楼栋：',
    '- 待推楼栋：',
    '- 主力成交楼栋：',
    '',
    '## 价格结构',
    '- 入门总价带：',
    '- 主力总价带：',
    '- 改善总价带：',
    '- 单价区间：',
    '',
    '## 付款方式',
    '- 首付政策：',
    '- 按揭方式：',
    '- 一次性付款说明：',
    '- 其他说明：',
    '',
    '## 当前优惠与节点',
    '- 当前优惠：',
    '- 节点活动：',
    '- 截止时间：',
    '',
    '## 推荐表达',
    '- 总价类推荐口径：',
    '- 价格对比类推荐口径：',
    '- 预算不足时的转向说法：',
    '',
    '## 禁用口径',
    '- 不得承诺具体单套房源最终成交价。',
    '- 不得承诺未公示折扣。',
    '- 不得把活动口径说成长期固定政策。',
    '',
    '## 常见追问',
    '- 客户问“最低多少钱能买到”时：',
    '- 客户问“有没有特价房”时：',
    '- 客户问“后面会不会涨价”时：',
  ]);
}

function buildLocationSchoolFaqContent(projectName: string) {
  return joinLines([
    `# ${projectName} 区位配套与学校 FAQ`,
    '',
    '## 文档用途',
    '- 本文档用于回答本项目的区位、交通、商业、学校、生活配套等高频问题。',
    '',
    '## 使用规则',
    '- 客观配套可以介绍事实。',
    '- 学校、学区、招生范围、划片信息必须遵循官方口径，不得自行承诺。',
    '',
    '## 区位概述',
    '- 所在板块：',
    '- 所在道路 / 地标：',
    '- 板块价值一句话说明：',
    '',
    '## 交通',
    '- 地铁 / 轻轨：',
    '- 主干道：',
    '- 到核心商圈时间：',
    '- 到高铁站 / 机场时间：',
    '',
    '## 商业与生活',
    '- 周边商业：',
    '- 周边菜场 / 超市：',
    '- 医疗资源：',
    '- 公园与休闲资源：',
    '',
    '## 学校与教育配套',
    '- 周边已知学校：',
    '- 周边幼儿园：',
    '- 周边小学：',
    '- 周边中学：',
    '- 教育配套介绍口径：',
    '',
    '## 学校合规提醒',
    '- 学区划分、招生范围、入学资格等信息，必须以政府和学校官方最新公示为准。',
    '- 若当前暂无明确公示，只能说“周边教育资源情况”，不能说“确定对口”。',
    '',
    '## 常见 FAQ',
    '- 问：项目具体位置在哪？',
    '  - 答：',
    '- 问：周边最大的配套优势是什么？',
    '  - 答：',
    '- 问：学校怎么样？',
    '  - 答：',
    '- 问：通勤方便吗？',
    '  - 答：',
    '- 问：周边生活成熟吗？',
    '  - 答：',
    '',
    '## 待确认项',
    '- 需要进一步核实的学校、道路、商业或配套信息：',
  ]);
}

function buildCompetitorSummaryContent(projectName: string) {
  return joinLines([
    `# ${projectName} 竞品对比`,
    '',
    '## 文档用途',
    '- 本文档用于沉淀本项目主要竞品和客户常见对比问题，帮助统一对比口径。',
    '',
    '## 使用规则',
    '- 重点讲“客户适配差异”，不做攻击性表达。',
    '- 只说有依据的事实，不夸大竞品缺点。',
    '',
    '## 核心竞品列表',
    '- 竞品 A：',
    '  - 位置：',
    '  - 产品：',
    '  - 总价带：',
    '  - 优势：',
    '  - 劣势：',
    '- 竞品 B：',
    '  - 位置：',
    '  - 产品：',
    '  - 总价带：',
    '  - 优势：',
    '  - 劣势：',
    '',
    '## 本项目相对优势',
    '1. 优势一：',
    '2. 优势二：',
    '3. 优势三：',
    '',
    '## 本项目相对短板',
    '1. 短板一：',
    '2. 短板二：',
    '',
    '## 客户适配差异',
    '- 更适合选择本项目的客户：',
    '- 更适合竞品的客户：',
    '- 如果客户在两者之间犹豫，建议的切入角度：',
    '',
    '## 推荐对比口径',
    '- 当客户问“和竞品 A 比哪个好”时：',
    '- 当客户问“为什么你们比竞品贵 / 便宜”时：',
    '- 当客户问“竞品去化更快怎么办”时：',
    '',
    '## 禁用口径',
    '- 禁止直接贬低竞品品质、客户群体、开发商信誉。',
    '- 禁止编造竞品销售数据和负面消息。',
  ]);
}

function buildObjectionHandlingContent(projectName: string) {
  return joinLines([
    `# ${projectName} 客户异议与应对`,
    '',
    '## 文档用途',
    '- 本文档用于沉淀本项目销售中最常见的客户异议、追问路径和应对框架。',
    '',
    '## 使用规则',
    '- 先理解客户真实顾虑，再给回应。',
    '- 先问清楚预算、用途、家庭结构，再决定用哪条口径。',
    '- 对无法确认的问题，明确说明“需以正式口径为准”。',
    '',
    '## 高频异议',
    '',
    '### 异议一：价格高',
    '- 客户真实顾虑：',
    '- 建议追问：',
    '- 推荐回应：',
    '- 可转向的话题：',
    '',
    '### 异议二：位置偏',
    '- 客户真实顾虑：',
    '- 建议追问：',
    '- 推荐回应：',
    '- 可转向的话题：',
    '',
    '### 异议三：学校不确定',
    '- 客户真实顾虑：',
    '- 建议追问：',
    '- 推荐回应：',
    '- 合规提醒：',
    '',
    '### 异议四：配套不成熟',
    '- 客户真实顾虑：',
    '- 建议追问：',
    '- 推荐回应：',
    '- 可转向的话题：',
    '',
    '### 异议五：竞品更便宜 / 更热',
    '- 客户真实顾虑：',
    '- 建议追问：',
    '- 推荐回应：',
    '- 可转向的话题：',
    '',
    '## 常用追问框架',
    '- 预算先问什么：',
    '- 家庭结构先问什么：',
    '- 购房目的先问什么：',
    '- 当前对比项目先问什么：',
    '',
    '## 禁用口径',
    '- 不要直接否定客户顾虑。',
    '- 不要为了推进成交做事实性承诺。',
    '- 不要用“之后一定涨”“学区一定有”“优惠一定保留”等绝对化表达。',
  ]);
}

function buildProjectDynamicsContent(projectName: string) {
  return joinLines([
    `# ${projectName} 项目动态与销售节奏`,
    '',
    '## 文档用途',
    '- 本文档用于记录近期加推、优惠、活动、去化、市场反馈等动态信息。',
    '',
    '## 使用规则',
    '- 动态文档应按时间顺序持续更新。',
    '- 过期活动和旧口径要及时标明失效。',
    '',
    '## 当前阶段判断',
    '- 当前销售阶段：',
    '- 当前主推重点：',
    '- 当前客户最关注的问题：',
    '',
    '## 最近 30 天动态',
    '- 日期：',
    '  - 事件：',
    '  - 对销售的影响：',
    '  - 推荐表达：',
    '- 日期：',
    '  - 事件：',
    '  - 对销售的影响：',
    '  - 推荐表达：',
    '',
    '## 当前优惠与活动',
    '- 优惠内容：',
    '- 活动时间：',
    '- 适用范围：',
    '- 风险提醒：',
    '',
    '## 去化与市场反馈',
    '- 当前去化表现：',
    '- 到访情况：',
    '- 热门户型：',
    '- 冷门问题：',
    '',
    '## 本周建议',
    '- 建议主推点：',
    '- 建议重点客户：',
    '- 建议避免的话术：',
  ]);
}

const DEFAULT_PROJECT_DOCUMENT_TEMPLATES: DefaultProjectDocumentTemplate[] = [
  {
    description: '项目知识域入口地图，说明文档分布、优先阅读顺序和待补充项。',
    isEntry: true,
    slug: '00-project-knowledge-map',
    sortOrder: 0,
    status: 'draft',
    title: '00-项目知识地图',
  },
  {
    description: '项目一页总卡，覆盖位置、产品、客群、卖点、风险和销售状态。',
    isEntry: true,
    slug: '01-project-core-card',
    sortOrder: 10,
    status: 'draft',
    title: '01-项目主卡',
  },
  {
    description: '产品线、面积段、总价带、付款方式与价格表达口径。',
    isEntry: false,
    slug: '02-product-and-pricing',
    sortOrder: 20,
    status: 'draft',
    title: '02-产品与价格',
  },
  {
    description: '区位、交通、商业、学校与生活配套常见问答。',
    isEntry: false,
    slug: '03-location-school-faq',
    sortOrder: 30,
    status: 'draft',
    title: '03-区位配套与学校FAQ',
  },
  {
    description: '主要竞品概览、适配差异与标准对比口径。',
    isEntry: false,
    slug: '04-competitor-summary',
    sortOrder: 40,
    status: 'draft',
    title: '04-竞品对比',
  },
  {
    description: '客户高频异议、追问框架与推荐应对策略。',
    isEntry: false,
    slug: '05-objection-handling',
    sortOrder: 50,
    status: 'draft',
    title: '05-客户异议与应对',
  },
  {
    description: '加推、优惠、活动、去化与销售节奏的动态记录。',
    isEntry: false,
    slug: '06-project-dynamics',
    sortOrder: 60,
    status: 'draft',
    title: '06-项目动态与销售节奏',
  },
];

function buildDefaultProjectDocumentContent(projectName: string, slug: string) {
  switch (slug) {
    case '00-project-knowledge-map':
      return buildProjectKnowledgeMapContent(projectName);
    case '01-project-core-card':
      return buildProjectCoreCardContent(projectName);
    case '02-product-and-pricing':
      return buildProductAndPricingContent(projectName);
    case '03-location-school-faq':
      return buildLocationSchoolFaqContent(projectName);
    case '04-competitor-summary':
      return buildCompetitorSummaryContent(projectName);
    case '05-objection-handling':
      return buildObjectionHandlingContent(projectName);
    case '06-project-dynamics':
      return buildProjectDynamicsContent(projectName);
    default:
      return '';
  }
}

export async function seedDefaultProjectDocuments(
  executeQuery: Queryable,
  projectId: string,
  projectName: string,
  actorId: string | null,
) {
  const existingResult = await runQuery<{ count: string }>(
    executeQuery,
    `
    select count(*)::text as count
    from lobehub_admin.project_documents
    where project_id = $1
    `,
    [projectId],
  );

  if (Number(existingResult.rows[0]?.count ?? 0) > 0) {
    return { createdDocumentCount: 0, skipped: true };
  }

  for (const template of DEFAULT_PROJECT_DOCUMENT_TEMPLATES) {
    await runQuery(
      executeQuery,
      `
      insert into lobehub_admin.project_documents (
        project_id,
        slug,
        title,
        description,
        content_md,
        status,
        sort_order,
        is_entry,
        created_by,
        updated_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      `,
      [
        projectId,
        template.slug,
        template.title,
        template.description,
        buildDefaultProjectDocumentContent(projectName, template.slug),
        template.status,
        template.sortOrder,
        template.isEntry,
        actorId,
      ],
    );
  }

  return {
    createdDocumentCount: DEFAULT_PROJECT_DOCUMENT_TEMPLATES.length,
    skipped: false,
  };
}

export async function seedMissingDefaultProjectDocuments(
  executeQuery: Queryable,
  projectId: string,
  projectName: string,
  actorId: string | null,
) {
  const existingResult = await runQuery<{ slug: string }>(
    executeQuery,
    `
    select slug
    from lobehub_admin.project_documents
    where project_id = $1
    `,
    [projectId],
  );

  const existingSlugs = new Set(existingResult.rows.map((row) => row.slug));
  const templatesToCreate = DEFAULT_PROJECT_DOCUMENT_TEMPLATES.filter(
    (template) => !existingSlugs.has(template.slug),
  );

  for (const template of templatesToCreate) {
    await runQuery(
      executeQuery,
      `
      insert into lobehub_admin.project_documents (
        project_id,
        slug,
        title,
        description,
        content_md,
        status,
        sort_order,
        is_entry,
        created_by,
        updated_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      `,
      [
        projectId,
        template.slug,
        template.title,
        template.description,
        buildDefaultProjectDocumentContent(projectName, template.slug),
        template.status,
        template.sortOrder,
        template.isEntry,
        actorId,
      ],
    );
  }

  return {
    createdDocumentCount: templatesToCreate.length,
    skipped: templatesToCreate.length === 0,
  };
}

export async function seedDefaultProjectDocumentsForZeroDocProjects(
  executeQuery: Queryable,
  actorId: string | null,
) {
  const result = await runQuery<{ project_id: string; project_name: string }>(
    executeQuery,
    `
    select
      p.id as project_id,
      p.name as project_name
    from lobehub_admin.projects p
    where not exists (
      select 1
      from lobehub_admin.project_documents pd
      where pd.project_id = p.id
    )
    order by p.created_at asc
    `,
  );

  let affectedProjectCount = 0;
  let createdDocumentCount = 0;

  for (const row of result.rows) {
    const seedResult = await seedDefaultProjectDocuments(
      executeQuery,
      row.project_id,
      row.project_name,
      actorId,
    );

    if (seedResult.createdDocumentCount > 0) {
      affectedProjectCount += 1;
      createdDocumentCount += seedResult.createdDocumentCount;
    }
  }

  return {
    affectedProjectCount,
    createdDocumentCount,
  };
}
