/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

// 理赔状态流转痕迹：报出 → 定损 → 核赔 → 到账，每次动作追加一条，只增不改。
export type ClaimTrace = {
  阶段: string
  动作: string
  时间: string
  经办人: string
  说明?: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  // 理赔台账专用：状态每往前推进一步留一条痕迹。
  traces?: ClaimTrace[]
  [field: string]: string | number | boolean | ClaimTrace[] | null | undefined
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
