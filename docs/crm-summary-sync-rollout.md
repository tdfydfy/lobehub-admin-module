# CRM 小结同步落地说明

## 目标

在不新增前端标签、不新增插件的前提下，把聊天中的“阶段性客户小结”自动写入 `crm.customer_profiles`，并通过消息正文里的“存档状态”提示用户是否保存成功。

## 后端行为

- 仅扫描项目托管会话中的 `assistant` 消息。
- 仅处理正文里同时包含 `存档状态：未保存` 和 ````crm-summary```` 代码块的消息。
- 消息静默一段时间后再处理，避免流式输出未完成就提前落库。
- 落库成功后，把正文中的 `存档状态：未保存` 改成 `存档状态：已保存`。
- 落库失败后，把正文中的 `存档状态：未保存` 改成 `存档状态：保存失败`。
- CRM 只保存基础字段和“客户情况小结”，不保存“跟进行动建议”。

## 模型固定输出模板

```md
阶段性客户小结

基础信息
- 客户姓名：<内容>
- 性别：<内容>
- 年龄：<内容>
- 家庭结构：<内容>
- 居住区域：<内容>
- 联系方式：<内容>
- 意向户型：<内容>
- 目标单价：<内容>
- 目标总价：<内容>
- 首访时间：<内容>
- 意向等级：<A/B/C/D 或未判级>
- 当前阶段：<内容>

客户情况小结
<不超过300汉字的自然语言总结>

跟进行动建议
1. <建议1>
2. <建议2>
3. <建议3，可选>

存档状态：未保存

```crm-summary
{
  "schema": "crm_customer_summary.v2",
  "persist": true,
  "customerName": "<内容或null>",
  "gender": "<内容或null>",
  "age": "<内容或null>",
  "familyStructure": "<内容或null>",
  "residenceArea": "<内容或null>",
  "contactInfo": "<内容或null>",
  "desiredLayout": "<内容或null>",
  "targetUnitPrice": "<内容或null>",
  "targetTotalPrice": "<内容或null>",
  "firstVisitTime": "<内容或null>",
  "intentGrade": "<A/B/C/D或null>",
  "currentStage": "<内容或null>",
  "summary": "<客户情况小结正文>"
}
```
```

## 全局知识库建议

把现有 `customer-discuss-rules` / `客户盘点规则` 更新为两层结构：

1. 上半部分保留业务方法论：
   - 信息收集
   - 诊断分析
   - 策略制定
   - 追问澄清
2. 下半部分新增“阶段性客户小结与 CRM 存档规范”：
   - 何时生成小结
   - 何时不要生成
   - 固定输出模板
   - `crm-summary` JSON 字段约束
   - “跟进行动建议不入库”

推荐再补一句运行时硬约束：

```txt
当你判断当前对话需要生成“阶段性客户小结”时，必须严格按照《客户盘点规则》中的固定模板输出，并在末尾附带合法的 crm-summary JSON。若信息不足，则继续追问，不要生成小结。注意：跟进行动建议只用于当前对话展示，不得写入 crm-summary JSON。
```

## 数据库变更

执行 [014_crm_customer_summary_sync.sql](/D:/claudecodefiles/lobehub-admin-module/sql/014_crm_customer_summary_sync.sql)：

- 为 `crm.customer_profiles` 增加：
  - `topic_id`
  - `intent_grade`
  - `current_stage`
  - `summary_json`
  - `last_summary_message_id`
  - `last_summary_at`
- 新增 `lobehub_admin.crm_summary_sync_state` 作为增量扫描游标表。
- 为 `public.messages` 增加 assistant 消息的 `updated_at` 索引，支撑增量轮询。

本轮优化不新增表结构，直接复用 `crm.customer_profiles` 现有字段：

- `gender`
- `age`
- `family_structure`
- `living_area`

其中前台模板中的“居住区域”写入数据库字段 `living_area`。
同时复用以下已有 CRM 字段：

- `desired_layout`
- `target_unit_price`
- `target_total_price`
- `first_visit_time`

## 环境变量

新增配置项，默认值已经写入 `.env.example`：

- `CRM_SUMMARY_SYNC_ENABLED=true`
- `CRM_SUMMARY_SYNC_INTERVAL_MS=5000`
- `CRM_SUMMARY_SYNC_BATCH_SIZE=50`
- `CRM_SUMMARY_SYNC_QUIET_PERIOD_MS=5000`
- `CRM_SUMMARY_SYNC_INITIAL_LOOKBACK_MINUTES=10`

## 上线顺序

1. 先执行数据库迁移。
2. 部署 admin service 新版本。
3. 在全局知识库中更新 `客户盘点规则`，让模型开始输出固定模板。
4. 用新会话做一次验证：
   - 助手输出固定模板
   - 初始显示 `存档状态：未保存`
   - 数秒后消息正文变为 `存档状态：已保存`
   - `crm.customer_profiles` 对应 `topic_id` 的记录被创建或更新

## 注意事项

- 这版不会即时给前端打新标签，用户主要通过消息正文看到状态变化。
- 如果当前对话页没有订阅消息更新，通常需要重新打开会话后才能看到最新状态。
- 历史消息不会自动全量回灌；默认只回看最近一小段时间并处理新产生的消息。
