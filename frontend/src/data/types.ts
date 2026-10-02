/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 理赔状态流转痕迹：每一次阶段变更都追加一条，只增不改。 */
export type ClaimTrail = {
  time: string
  action: string
  from: string
  to: string
  operator: string
  note?: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  // 理赔台账在行内挂痕迹数组，其余模块用不到这个槽位。
  [field: string]: string | number | boolean | ClaimTrail[]
}

/** 灾损保险理赔台账行：理赔案号唯一，状态沿 报出→定损→核赔→到账 顺推。 */
export type ClaimRow = EntryRow & {
  理赔案号: string
  投保标的: string
  所属乡镇: string
  承保公司: string
  报案日期: string
  定损金额: string
  赔付金额: string
  关联搬迁编号: string
  进入当前阶段日期: string
  amountIssue: boolean
  trail: ClaimTrail[]
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
