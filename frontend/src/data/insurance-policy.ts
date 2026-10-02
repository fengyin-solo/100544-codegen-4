import type { EntryRow } from './types'

/**
 * 灾损保险理赔台账的业务口径。
 * 定损金额、赔付进度、极值判定、超期判定全部集中在本文件，
 * 理赔台账页面与避险搬迁清单两处都从这里取数，保证同一条案子读到的数不两样。
 */

export const INSURANCE_KEY = 'insurance'

// 状态只能顺着这条路推进：报出 → 定损 → 核赔 → 到账。
export const CLAIM_STAGES = ['报出', '定损', '核赔', '到账'] as const

// 每阶段允许停留的工作日上限（按自然日计），超过且没往前一步即超期。
export const STAGE_LIMIT_DAYS: Record<string, number> = {
  报出: 3,
  定损: 5,
  核赔: 7,
  到账: Infinity,
}

// 各阶段对应的赔付进度（按业务口径核定的固定进度，不允许页面自说自话）。
export const STAGE_PROGRESS: Record<string, number> = {
  报出: 10,
  定损: 40,
  核赔: 80,
  到账: 100,
}

// 单案定损金额上限（元）。0、负数及超过该上限的极值记录单独退回核对，不进入正常台账。
export const ASSESSMENT_LIMIT = 1_000_000

export const INSURED_CATEGORIES = ['农房', '农作物', '农业设施', '家庭财产', '基础设施'] as const

export const CLAIM_FIELDS = [
  '理赔案号',
  '投保标的',
  '被保险人',
  '承保公司',
  '出险乡镇',
  '报案日期',
  '定损金额',
  '核赔金额',
  '到账金额',
  '关联搬迁单号',
  '最近推进日',
]

export function stageIndex(status: string): number {
  return CLAIM_STAGES.indexOf(status as (typeof CLAIM_STAGES)[number])
}

// 赔付进度由当前阶段唯一决定——「赔付进度谁说了算」的口径就在这里。
export function claimProgress(status: string): number {
  return STAGE_PROGRESS[status] ?? 0
}

/**
 * 定损金额口径：只有「提交定损」落进来的金额才算数；
 * 报案时填的申报金额、被保险人自报价都不算定损金额。
 * 已到「核赔/到账」的案子，定损金额保持定损环节录入值不变。
 */
export function assessmentAmount(row: EntryRow): number | null {
  // 被退回核对的记录，极值金额不视为有效定损金额。
  if (isReturnedForCheck(row)) return null
  if (stageIndex(String(row.status)) < stageIndex('定损')) {
    return null
  }
  const value = Number(row.定损金额)
  return Number.isFinite(value) ? value : null
}

// 极值：0、负数、超过单案上限，一律退回核对。
export function isExtremeAmount(amount: number): boolean {
  return !Number.isFinite(amount) || amount <= 0 || amount > ASSESSMENT_LIMIT
}

export function isReturnedForCheck(row: EntryRow): boolean {
  return Boolean(row.abnormal) && String(row.退回核对) === '是'
}

// 今天与最近推进日相差的天数。
export function daysSinceLatest(row: EntryRow, today: string): number {
  const latest = String(row.最近推进日 ?? '')
  if (!latest) return 0
  const diff = new Date(`${today}T00:00:00`).getTime() - new Date(`${latest}T00:00:00`).getTime()
  return Math.max(0, Math.round(diff / 86_400_000))
}

// 超期：还没到账，且在当前阶段停留超过口径规定的天数。
export function isOverdue(row: EntryRow, today: string): boolean {
  const status = String(row.status)
  if (status === '到账' || isReturnedForCheck(row)) return false
  return daysSinceLatest(row, today) > STAGE_LIMIT_DAYS[status]
}

export function overdueDays(row: EntryRow, today: string): number {
  const status = String(row.status)
  if (status === '到账' || isReturnedForCheck(row)) return 0
  return Math.max(0, daysSinceLatest(row, today) - STAGE_LIMIT_DAYS[status])
}

export function formatAmount(amount: number | null): string {
  if (amount === null) return '未定损'
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function todayLabel(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
