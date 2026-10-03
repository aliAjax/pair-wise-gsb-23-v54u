# hxwl-09 半导体洁净室巡检

洁净室在线粒子计数器的读数链路：采样任务 → 粒子读数（设备序号 + 阈值版本）→ 异常工单 → 班组长签认 → 审计事实。

## 技术栈

React + Vite + TypeScript + CSS（领域核心为纯 TS，无框架依赖）

## 本地运行

```bash
npm install
npm run dev          # 开发端口 5109
npm run selfcheck    # 领域链路不变量自检（26 项）
npm run typecheck    # tsc --noEmit
npm run build        # 产物构建
```

## 链路如何对上

| 现场问题 | 机制 | 代码 |
| --- | --- | --- |
| 读数、任务、阈值、工单对不上 | 读数携带 `taskId`、`deviceSerial`、`evaluation.thresholdVersionId`；工单以 `readingKey` 回指读数与阈值版本 | `src/domain/types.ts` |
| 乱序到达 | 同一设备读数按报文序号排序后重排片段与样本计数 | `ingest.ts · rebuildSegments` |
| 重发产生第二张工单 | 去重键 `设备序号#报文序号`；工单按 `readingKey` 幂等开立/更新/作废 | `ingest.ts · ingestBatch`、`evaluate.ts · reconcileWorkOrders` |
| 计数器归零被误报异常 | 累计值下降即开新片段（`SEG-n`），段内重新起算差分，下降本身不评估、不开单 | `ingest.ts · rebuildSegments` |
| 阈值改动后结果打架 | 待复核读数立即按新版本重算并同步工单；已签认读数冻结，签认时整份快照“当时依据” | `evaluate.ts · publishThreshold`、`signoff.ts` |
| 越权签认 | 班组长只能签认本班房间；审计员只读，写操作全部被拒并留痕 | `permissions.ts`、`signoff.ts` |
| 断网补录丢失 | 保存失败的草稿保留本机（localStorage），恢复网络后补传并按房间合并，重复补传由去重兜底 | `ingest.ts · saveDraft / flushDrafts`、`store.ts` |

## 角色

- **巡检员**：接入读数、断网存草稿、补传
- **班组长**：签认本班房间读数、发布阈值版本
- **审计员**：只读。所有面板可见，所有写操作禁用；接入、去重、开片段、重算、开/作废工单、签认与被拒均记入审计日志

## 演示路径

1. 「乱序到达」→ 时间线中样本计数仍按序号归位
2. 「重发上一条」→ 去重计数 +1，工单不增加
3. 「计数器归零」→ 出现 `SEG2`，计数下降无异常工单
4. 「超限读数」→ 异常工单自动开立
5. 发布更严的 ISO5 阈值 → 待复核读数立即重算、补开工单；已签认读数仍显示签认时的 TV-1 依据
6. 切换乙班班组长签甲班房间 → 被拒并留痕；切审计员 → 全部只读
7. 「黄光区断网补录」→ 草稿进入本机待补传；「恢复网络并补传」→ 按房间合并进 Y-0302 时间线
