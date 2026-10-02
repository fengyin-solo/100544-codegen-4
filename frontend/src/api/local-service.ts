import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, ClaimRow, ClaimTrail, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// ---------------------------------------------------------------------------
// 灾损保险理赔：业务口径集中在这一段，页面和避险搬迁清单都只读这里的结论。
// ---------------------------------------------------------------------------

export const CLAIM_KEY = 'insurance'
export const RELOCATE_KEY = 'relocate'

// 赔付这条路：状态只能沿该顺序顺推，任何跳转、回退都在动作函数里拒掉。
export const CLAIM_ROUTE = ['报出', '定损', '核赔', '到账'] as const

// 各阶段停留时限（自然日）：超过且没往前一步，就算超期，列表置顶。
export const STAGE_SLA_DAYS: Record<string, number> = {
  报出: 7,
  定损: 10,
  核赔: 5,
}

// 定损金额极值口径：≤1 元或 ≥1000 万元视为录入极值，单独退回核对。
export const ASSESSED_MIN = 1
export const ASSESSED_MAX = 10_000_000

export type ClaimInput = {
  理赔案号: string
  投保标的: string
  所属乡镇: string
  承保公司: string
  报案日期: string
  关联搬迁编号?: string
  operator?: string
}

function claimRows(): ClaimRow[] {
  return listRows(CLAIM_KEY) as ClaimRow[]
}

function saveClaims(rows: ClaimRow[]): void {
  saveRows(CLAIM_KEY, rows as EntryRow[])
}

function stageIndex(status: string): number {
  return CLAIM_ROUTE.indexOf(status as (typeof CLAIM_ROUTE)[number])
}

function nowText(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function dateText(now: Date): string {
  return nowText(now).slice(0, 10)
}

function parseStageDate(value: string): Date | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!matched) {
    return null
  }
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
}

export function parseAmount(value: string): number | null {
  const text = String(value ?? '').trim().replace(/,/g, '')
  if (text === '') {
    return null
  }
  const amount = Number(text)
  return Number.isFinite(amount) ? amount : null
}

/** 极值判定：定损金额落进口径区间外的，单独退回核对。 */
export function isExtremeAmount(amount: number | null): boolean {
  return amount === null || amount < ASSESSED_MIN || amount > ASSESSED_MAX
}

/**
 * 定损金额业务口径：核赔复核办结后才定稿，金额以理赔台账这一份为准；
 * 仍在定损环节、或被退回核对的案件，定损金额一律「未定稿」，不作数。
 */
export function assessedAmount(row: ClaimRow): number | null {
  if (row.amountIssue || stageIndex(String(row.status)) < stageIndex('核赔')) {
    return null
  }
  return parseAmount(String(row.定损金额))
}

/** 赔付进度业务口径：只认 报出→定损→核赔→到账 的阶段位置，不另设口径。 */
export function claimProgress(row: ClaimRow): { label: string; percent: number } {
  const index = stageIndex(String(row.status))
  const safeIndex = index < 0 ? 0 : index
  return {
    label: `${String(row.status)}（${safeIndex}/${CLAIM_ROUTE.length - 1}）`,
    percent: Math.round((safeIndex / (CLAIM_ROUTE.length - 1)) * 100),
  }
}

/** 赔付金额：只有到账才按定稿定损金额生效，此前不形成赔付。 */
export function paidAmount(row: ClaimRow): number | null {
  return String(row.status) === '到账' ? assessedAmount(row) : null
}

export function daysInStage(row: ClaimRow, now: Date = new Date()): number | null {
  const entered = parseStageDate(String(row.进入当前阶段日期))
  if (!entered) {
    return null
  }
  const millis = now.getTime() - entered.getTime() - (now.getTimezoneOffset() - entered.getTimezoneOffset()) * 60_000
  return Math.floor(millis / 86_400_000)
}

/** 超期：没到终态、没被退回核对，且在当前阶段停留超过时限。 */
export function isOverdue(row: ClaimRow, now: Date = new Date()): boolean {
  if (String(row.status) === '到账' || row.amountIssue) {
    return false
  }
  const days = daysInStage(row, now)
  const limit = STAGE_SLA_DAYS[String(row.status)]
  return days !== null && limit !== undefined && days > limit
}

export function overdueDays(row: ClaimRow, now: Date = new Date()): number | null {
  if (!isOverdue(row, now)) {
    return null
  }
  const days = daysInStage(row, now)
  const limit = STAGE_SLA_DAYS[String(row.status)]
  return days === null ? null : days - limit
}

export function listClaims(filters: Record<string, string> = {}, now: Date = new Date()): ClaimRow[] {
  const matched = filterRows(claimRows(), filters) as ClaimRow[]
  // 超期没往前一步的排最前（超得越久越靠前），其余按进入当前阶段先后排；退回核对的沉底单列。
  return [...matched].sort((a, b) => {
    const ao = isOverdue(a, now)
    const bo = isOverdue(b, now)
    if (ao !== bo) {
      return ao ? -1 : 1
    }
    if (ao && bo) {
      return (daysInStage(b, now) ?? 0) - (daysInStage(a, now) ?? 0)
    }
    if (a.amountIssue !== b.amountIssue) {
      return a.amountIssue ? 1 : -1
    }
    return String(a.进入当前阶段日期).localeCompare(String(b.进入当前阶段日期))
  })
}

export function claimStats(now: Date = new Date()) {
  const rows = claimRows()
  let assessedTotal = 0
  let paidTotal = 0
  for (const row of rows) {
    const assessed = assessedAmount(row)
    if (assessed !== null) {
      assessedTotal += assessed
    }
    const paid = paidAmount(row)
    if (paid !== null) {
      paidTotal += paid
    }
  }
  return [
    { label: '在办理赔案', value: rows.filter((row) => String(row.status) !== '到账' && !row.amountIssue).length },
    { label: '超期未推进', value: rows.filter((row) => isOverdue(row, now)).length },
    { label: '退回核对', value: rows.filter((row) => row.amountIssue).length },
    { label: '已定稿定损金额（元）', value: assessedTotal },
    { label: '已赔付金额（元）', value: paidTotal },
  ]
}

function appendTrail(row: ClaimRow, entry: Omit<ClaimTrail, 'time'>, now: Date): ClaimRow {
  const trail = Array.isArray(row.trail) ? [...row.trail] : []
  trail.push({ time: nowText(now), ...entry })
  return { ...row, trail }
}

function findClaim(rows: ClaimRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

/** 登记报出：同一理赔案号只挂一条，重复报案直接拒。 */
export function registerClaim(input: ClaimInput, now: Date = new Date()): ActionResult {
  const fields: (keyof ClaimInput)[] = ['理赔案号', '投保标的', '所属乡镇', '承保公司', '报案日期']
  for (const field of fields) {
    if (!String(input[field] ?? '').trim()) {
      return { ok: false, message: `${field}不能为空` }
    }
  }
  const caseNo = input.理赔案号.trim()
  const rows = claimRows()
  if (rows.some((row) => String(row.理赔案号).trim() === caseNo)) {
    return { ok: false, message: `理赔案号 ${caseNo} 已在台账中，同一条案号只挂一条` }
  }
  const operator = input.operator?.trim() || '值班管理员'
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: ClaimRow = {
    id,
    status: '报出',
    pending: true,
    abnormal: false,
    amountIssue: false,
    理赔案号: caseNo,
    投保标的: input.投保标的.trim(),
    所属乡镇: input.所属乡镇.trim(),
    承保公司: input.承保公司.trim(),
    报案日期: input.报案日期.trim(),
    定损金额: '',
    赔付金额: '',
    关联搬迁编号: (input.关联搬迁编号 ?? '').trim(),
    进入当前阶段日期: dateText(now),
    trail: [{ time: nowText(now), action: '登记报出', from: '—', to: '报出', operator }],
  }
  saveClaims([...rows, row])
  return { ok: true, message: `理赔案 ${caseNo} 已报出登记，当前状态「报出」` }
}

function stampRelocatePaid(caseNo: string, relocateNo: string): ActionResult | null {
  const code = relocateNo.trim()
  if (!code) {
    return null
  }
  const rows = listRows(RELOCATE_KEY)
  const index = rows.findIndex((item) => String(item.搬迁编号).trim() === code)
  if (index < 0) {
    return { ok: false, message: `关联搬迁编号 ${code} 在避险搬迁清单中不存在，先核对再复核办结` }
  }
  if (String(rows[index].保险赔付标记 ?? '') !== '已赔付') {
    const next = [...rows]
    next[index] = { ...next[index], 保险赔付标记: '已赔付' }
    saveRows(RELOCATE_KEY, next)
  }
  return null
}

/** 提交定损：报出 → 定损。金额录成极值的，状态顺推到定损后单独退回核对，不放行复核。 */
export function submitAssessment(id: number, rawAmount: string, operator = '值班管理员', now: Date = new Date()): ActionResult {
  const rows = claimRows()
  const index = findClaim(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的理赔案` }
  }
  const current = rows[index]
  if (String(current.status) !== '报出') {
    return { ok: false, message: `理赔案当前是「${current.status}」，提交定损只能在「报出」阶段办理` }
  }
  const amount = parseAmount(rawAmount)
  if (amount === null || amount < 0) {
    return { ok: false, message: '定损金额无效，请录入非负数字金额后再提交' }
  }
  let updated: ClaimRow = {
    ...appendTrail(current, { action: '提交定损', from: '报出', to: '定损', operator, note: `录入定损金额 ${amount} 元` }, now),
    status: '定损',
    定损金额: String(amount),
    进入当前阶段日期: dateText(now),
  }
  if (isExtremeAmount(amount)) {
    const reason = amount < ASSESSED_MIN ? '低于极值下限' : '超过极值上限'
    updated = {
      ...appendTrail(updated, { action: '退回核对', from: '定损', to: '定损', operator, note: `定损金额${reason}，单独退回核对` }, now),
      amountIssue: true,
      abnormal: true,
    }
  }
  const next = [...rows]
  next[index] = updated
  saveClaims(next)
  if (updated.amountIssue) {
    return { ok: false, message: `理赔案 ${current.理赔案号} 定损金额 ${amount} 元为极值，已单独退回核对，核对后重新提交定损` }
  }
  return { ok: true, message: `理赔案 ${current.理赔案号} 已提交定损，当前状态「定损」` }
}

/** 退回核对后的重新定损：金额仍为极值就继续挂退回，改对了才恢复流转。 */
export function resubmitAssessment(id: number, rawAmount: string, operator = '值班管理员', now: Date = new Date()): ActionResult {
  const rows = claimRows()
  const index = findClaim(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的理赔案` }
  }
  const current = rows[index]
  if (!current.amountIssue) {
    return { ok: false, message: '该理赔案不在退回核对状态，无需重新提交定损' }
  }
  const amount = parseAmount(rawAmount)
  if (amount === null || amount < 0) {
    return { ok: false, message: '定损金额无效，请录入非负数字金额后再提交' }
  }
  let updated: ClaimRow = { ...current, 定损金额: String(amount) }
  if (isExtremeAmount(amount)) {
    updated = appendTrail(
      { ...updated, 进入当前阶段日期: dateText(now) },
      { action: '退回核对', from: '定损', to: '定损', operator, note: `重新录入 ${amount} 元仍为极值，继续退回核对` },
      now,
    )
    const next = [...rows]
    next[index] = updated
    saveClaims(next)
    return { ok: false, message: `定损金额 ${amount} 元仍为极值，继续退回核对` }
  }
  updated = appendTrail(
    { ...updated, amountIssue: false, abnormal: false, 进入当前阶段日期: dateText(now) },
    { action: '重新提交定损', from: '定损', to: '定损', operator, note: `核对后定损金额更正为 ${amount} 元，恢复流转` },
    now,
  )
  const next = [...rows]
  next[index] = updated
  saveClaims(next)
  return { ok: true, message: `理赔案 ${current.理赔案号} 定损金额核对为 ${amount} 元，已恢复流转` }
}

/** 复核办结：定损 → 核赔。同一理赔案号走两次复核只挂一条；办结即在避险搬迁清单落已赔付标记。 */
export function approveClaim(id: number, operator = '值班管理员', now: Date = new Date()): ActionResult {
  const rows = claimRows()
  const index = findClaim(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的理赔案` }
  }
  const current = rows[index]
  if (stageIndex(String(current.status)) >= stageIndex('核赔')) {
    return { ok: false, message: `理赔案 ${current.理赔案号} 已复核办结，同一条案号只挂一条复核，不再重复办理` }
  }
  if (String(current.status) !== '定损') {
    return { ok: false, message: `理赔案当前是「${current.status}」，复核办结只能从「定损」顺推` }
  }
  if (current.amountIssue) {
    return { ok: false, message: '定损金额仍在退回核对，核对更正后才能复核办结' }
  }
  // 先校验关联搬迁清单，落不到清单就不办结，保证两条路径对得上。
  const stampError = stampRelocatePaid(current.理赔案号, String(current.关联搬迁编号 ?? ''))
  if (stampError) {
    return stampError
  }
  const linked = String(current.关联搬迁编号 ?? '').trim()
  const note = linked
    ? `复核通过，定损金额定稿；避险搬迁清单 ${linked} 落已赔付标记`
    : '复核通过，定损金额定稿'
  const updated = appendTrail(
    { ...current, status: '核赔', 进入当前阶段日期: dateText(now) },
    { action: '复核办结', from: '定损', to: '核赔', operator, note },
    now,
  )
  const next = [...rows]
  next[index] = updated
  saveClaims(next)
  return { ok: true, message: `理赔案 ${current.理赔案号} 复核办结，当前状态「核赔」${linked ? `；${linked} 已标记已赔付` : ''}` }
}

/** 确认到账：核赔 → 到账。赔付金额按定稿定损金额落账，理赔流程到此终态。 */
export function arriveClaim(id: number, operator = '值班管理员', now: Date = new Date()): ActionResult {
  const rows = claimRows()
  const index = findClaim(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的理赔案` }
  }
  const current = rows[index]
  if (String(current.status) === '到账') {
    return { ok: false, message: `理赔案 ${current.理赔案号} 已到账，不用重复确认` }
  }
  if (String(current.status) !== '核赔') {
    return { ok: false, message: `理赔案当前是「${current.status}」，确认到账只能从「核赔」顺推` }
  }
  const amount = assessedAmount(current)
  if (amount === null) {
    return { ok: false, message: '定损金额未定稿，不能确认到账' }
  }
  const updated = appendTrail(
    {
      ...current,
      status: '到账',
      pending: false,
      abnormal: false,
      赔付金额: String(amount),
      进入当前阶段日期: dateText(now),
    },
    { action: '确认到账', from: '核赔', to: '到账', operator, note: `赔款 ${amount} 元已到账` },
    now,
  )
  const next = [...rows]
  next[index] = updated
  saveClaims(next)
  return { ok: true, message: `理赔案 ${current.理赔案号} 赔款 ${amount} 元已到账，流程办结` }
}

/** 避险搬迁清单读取的理赔口径：按搬迁编号回查同一份定损金额与到账结果，两处不允许两样。 */
export function relocateInsuranceView(): Record<string, { 定损金额: string; 赔付金额: string; 理赔案号: string }> {
  const view: Record<string, { 定损金额: string; 赔付金额: string; 理赔案号: string }> = {}
  for (const row of claimRows()) {
    const code = String(row.关联搬迁编号 ?? '').trim()
    if (!code) {
      continue
    }
    const assessed = assessedAmount(row)
    const paid = paidAmount(row)
    view[code] = {
      理赔案号: String(row.理赔案号),
      定损金额: assessed === null ? '未定稿' : String(assessed),
      赔付金额: paid === null ? '未赔付' : String(paid),
    }
  }
  return view
}

export function exportClaimsCsv(now: Date = new Date()): { filename: string; content: string } {
  const header = ['理赔案号', '投保标的', '所属乡镇', '承保公司', '报案日期', '定损金额（定稿）', '赔付进度', '赔付金额', '超期天数', '关联搬迁编号', '状态变更痕迹']
  const lines = [header.join(',')]
  for (const row of listClaims({}, now)) {
    const assessed = assessedAmount(row)
    const progress = claimProgress(row)
    const late = overdueDays(row, now)
    const trail = (row.trail ?? [])
      .map((item) => `${item.time} ${item.operator} ${item.action}：${item.from}→${item.to}${item.note ? `（${item.note}）` : ''}`)
      .join('；')
    lines.push(
      [
        row.理赔案号,
        row.投保标的,
        row.所属乡镇,
        row.承保公司,
        row.报案日期,
        assessed === null ? '未定稿' : assessed,
        progress.label,
        paidAmount(row) ?? '未赔付',
        late === null ? '—' : late,
        row.关联搬迁编号 || '—',
        trail,
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    )
  }
  return { filename: '灾损保险理赔台账.csv', content: `﻿${lines.join('\n')}` }
}

export function resetClaims(): void {
  resetRows(CLAIM_KEY)
  // 理赔与搬迁清单有联动，一并回到示例态，避免标记对不上。
  resetRows(RELOCATE_KEY)
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  if (key === CLAIM_KEY) {
    // 理赔状态只能沿 报出→定损→核赔→到账 顺推，流转必须走专属动作函数，通用入口不开放。
    return { ok: false, message: '理赔案的阶段流转请走理赔台账的专属动作' }
  }
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
