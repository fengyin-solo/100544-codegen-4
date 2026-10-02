import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  ASSESSMENT_LIMIT,
  INSURED_CATEGORIES,
  INSURANCE_KEY,
  assessmentAmount,
  claimProgress,
  isExtremeAmount,
  isOverdue,
  isReturnedForCheck,
  overdueDays,
  stageIndex,
  todayLabel,
} from '@/data/insurance-policy'
import type { ActionResult, ClaimTrace, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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
  // 理赔台账有专用的顺次流转机（留痕、极值退回、超期口径），不允许走通用动作。
  if (key === INSURANCE_KEY) {
    return { ok: false, message: '理赔台账请使用理赔页上的报出/定损/核赔/到账专用动作' }
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

// ---------------------------------------------------------------------------
// 灾损保险理赔台账
// 状态机只能沿 报出→定损→核赔→到账 推进；通用 runAction 不放行理赔模块，
// 所有理赔动作都走下面的专用函数，每次动作都在 traces 里追加一条痕迹。
// ---------------------------------------------------------------------------

export type ClaimCreateInput = {
  理赔案号: string
  投保标的: string
  被保险人: string
  承保公司: string
  出险乡镇: string
  报案日期: string
  关联搬迁单号?: string
  申报金额?: number
  经办人?: string
}

export type ClaimView = EntryRow & {
  定损金额显示: number | null
  赔付进度: number
  超期: boolean
  超期天数: number
  退回核对: boolean
}

export type RelocateClaimView = {
  理赔案号: string
  定损金额: number | null
  赔付进度: number
  已赔付: boolean
}

function insuranceRows(): EntryRow[] {
  return listRows(INSURANCE_KEY)
}

function saveInsuranceRows(rows: EntryRow[]): void {
  saveRows(INSURANCE_KEY, rows)
}

function appendTrace(row: EntryRow, action: string, note: string, operator: string, when = todayLabel()): void {
  const trace: ClaimTrace = { 阶段: String(row.status), 动作: action, 时间: when, 经办人: operator }
  if (note) {
    trace.说明 = note
  }
  row.traces = [...(row.traces ?? []), trace]
}

// 复核办结（核赔通过）后，给关联的避险搬迁安置单打上保险已赔付标记。
// 定损金额不复制，搬迁清单需要时通过 relocationClaims() 读同一份数据。
function markRelocatePaid(relocateNo: string, claimNo: string, operator: string, when: string): void {
  if (!relocateNo) return
  const rows = listRows('relocate')
  const target = rows.find((row) => String(row.搬迁编号) === relocateNo)
  if (!target || target.保险已赔付 === '是') return
  target.保险已赔付 = '是'
  target.保险理赔案号 = claimNo
  target.保险赔付日期 = when
  target.traces = [
    ...(target.traces ?? []),
    { 阶段: String(target.status), 动作: '理赔复核办结', 时间: when, 经办人: operator, 说明: `理赔案 ${claimNo} 已赔付` },
  ]
  saveRows('relocate', rows)
}

function toClaimView(row: EntryRow, today: string): ClaimView {
  return {
    ...row,
    定损金额显示: assessmentAmount(row),
    赔付进度: claimProgress(String(row.status)),
    超期: isOverdue(row, today),
    超期天数: overdueDays(row, today),
    退回核对: isReturnedForCheck(row),
  }
}

export function listClaims(
  filters: { 投保标的?: string; 关键词?: string } = {},
  today = todayLabel(),
): { active: ClaimView[]; returned: ClaimView[] } {
  let rows = insuranceRows()
  const keyword = filters.关键词?.trim() ?? ''
  if (filters.投保标的) {
    rows = rows.filter((row) => String(row.投保标的) === filters.投保标的)
  }
  if (keyword) {
    rows = rows.filter(
      (row) =>
        String(row.理赔案号).includes(keyword) ||
        String(row.被保险人).includes(keyword) ||
        String(row.出险乡镇).includes(keyword),
    )
  }
  // 超期没往前一步的排在最前：先按超期天数降序，再按最近推进日升序。
  const byOverdue = (a: EntryRow, b: EntryRow) =>
    overdueDays(b, today) - overdueDays(a, today) ||
    String(a.最近推进日).localeCompare(String(b.最近推进日))
  const active = rows.filter((row) => !isReturnedForCheck(row)).sort(byOverdue).map((row) => toClaimView(row, today))
  const returned = rows.filter((row) => isReturnedForCheck(row)).map((row) => toClaimView(row, today))
  return { active, returned }
}

export function createClaim(input: ClaimCreateInput): ActionResult {
  const claimNo = input.理赔案号.trim()
  if (!claimNo) {
    return { ok: false, message: '理赔案号不能为空' }
  }
  if (!INSURED_CATEGORIES.includes(input.投保标的 as (typeof INSURED_CATEGORIES)[number])) {
    return { ok: false, message: `投保标的必须是：${INSURED_CATEGORIES.join('、')}` }
  }
  const rows = insuranceRows()
  if (rows.some((row) => String(row.理赔案号) === claimNo)) {
    // 同一条理赔案号只挂一条，重复报案/复核都不另立案。
    return { ok: false, message: `理赔案号 ${claimNo} 已挂账，不重复登记` }
  }
  const operator = input.经办人?.trim() || '值班管理员'
  const when = input.报案日期 || todayLabel()
  const row: EntryRow = {
    id: rows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1,
    status: '报出',
    pending: true,
    abnormal: false,
    理赔案号: claimNo,
    投保标的: input.投保标的,
    被保险人: input.被保险人.trim() || '—',
    承保公司: input.承保公司.trim() || '—',
    出险乡镇: input.出险乡镇.trim() || '—',
    报案日期: when,
    定损金额: '',
    核赔金额: '',
    到账金额: '',
    关联搬迁单号: input.关联搬迁单号?.trim() || '',
    最近推进日: when,
    traces: [],
  }
  // 报案自报金额只是报案材料，不进「定损金额」字段；保留在报案痕迹里。
  const note =
    input.申报金额 !== undefined && Number.isFinite(input.申报金额)
      ? `报案自报金额 ${input.申报金额} 元（非定损口径）`
      : '电话报案登记'
  appendTrace(row, '报案报出', note, operator, when)
  saveInsuranceRows([...rows, row])
  return { ok: true, message: `理赔案 ${claimNo} 已立案，当前阶段「报出」` }
}

function findClaim(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

// 提交定损：定损金额以本环节录入为准。极值（0、负数、超单案上限）单独退回核对。
export function submitAssessment(
  id: number,
  amount: number,
  operator = '值班管理员',
  when = todayLabel(),
): ActionResult {
  const rows = insuranceRows()
  const row = findClaim(rows, id)
  if (!row) return { ok: false, message: '没有找到这条理赔案' }
  if (String(row.status) !== '报出' && !isReturnedForCheck(row)) {
    return { ok: false, message: `当前阶段「${row.status}」不能提交定损，状态只能顺次推进` }
  }
  if (!Number.isFinite(amount) || isExtremeAmount(amount)) {
    // 极值退回核对：不覆盖定损金额，挂异常并移出正常台账。
    row.abnormal = true
    row.退回核对 = '是'
    row.退回金额 = amount
    row.退回原因 = amount > ASSESSMENT_LIMIT ? `定损金额超过单案上限 ${ASSESSMENT_LIMIT} 元` : '定损金额为 0 或负数'
    appendTrace(row, '退回核对', String(row.退回原因), operator, when)
    saveInsuranceRows(rows)
    return { ok: false, message: `定损金额为极值（${row.退回原因}），已单独退回核对` }
  }
  row.定损金额 = amount
  row.退回核对 = ''
  row.退回金额 = ''
  row.退回原因 = ''
  row.abnormal = false
  row.status = '定损'
  row.最近推进日 = when
  appendTrace(row, '提交定损', `定损金额 ${amount} 元`, operator, when)
  saveInsuranceRows(rows)
  return { ok: true, message: `理赔案 ${row.理赔案号} 定损 ${amount} 元，进入「定损」阶段` }
}

// 修正定损金额：只对已退回核对的案子开放，改完回到定损阶段继续往核赔走。
export function correctAssessment(
  id: number,
  amount: number,
  operator = '值班管理员',
  when = todayLabel(),
): ActionResult {
  const rows = insuranceRows()
  const row = findClaim(rows, id)
  if (!row) return { ok: false, message: '没有找到这条理赔案' }
  if (!isReturnedForCheck(row)) {
    return { ok: false, message: '只有被退回核对的理赔案才能修正定损金额' }
  }
  if (isExtremeAmount(amount)) {
    row.退回金额 = amount
    row.退回原因 = amount > ASSESSMENT_LIMIT ? `定损金额超过单案上限 ${ASSESSMENT_LIMIT} 元` : '定损金额为 0 或负数'
    appendTrace(row, '退回核对', `重新提交仍为极值：${row.退回原因}`, operator, when)
    saveInsuranceRows(rows)
    return { ok: false, message: `修正后仍为极值（${row.退回原因}），继续退回核对` }
  }
  row.定损金额 = amount
  row.退回核对 = ''
  row.退回金额 = ''
  row.退回原因 = ''
  row.abnormal = false
  row.status = '定损'
  row.最近推进日 = when
  appendTrace(row, '修正定损金额', `按核对结论修正为 ${amount} 元`, operator, when)
  saveInsuranceRows(rows)
  return { ok: true, message: `理赔案 ${row.理赔案号} 定损金额已修正为 ${amount} 元，回到「定损」阶段` }
}

// 复核办结：核赔通过，赔付金额以核赔结论为准；办结即给关联搬迁清单挂已赔付标记。
export function concludeReview(
  id: number,
  approvedAmount?: number,
  operator = '值班管理员',
  when = todayLabel(),
): ActionResult {
  const rows = insuranceRows()
  const row = findClaim(rows, id)
  if (!row) return { ok: false, message: '没有找到这条理赔案' }
  if (String(row.status) !== '定损') {
    if (String(row.status) === '核赔') {
      return { ok: false, message: '该理赔案已复核办结，不重复挂账' }
    }
    return { ok: false, message: `当前阶段「${row.status}」不能复核办结，需先完成定损` }
  }
  const assessed = assessmentAmount(row)
  if (assessed === null) {
    return { ok: false, message: '定损金额缺失，不能进入核赔' }
  }
  const amount = approvedAmount === undefined ? assessed : approvedAmount
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: '核赔金额必须为正数' }
  }
  row.核赔金额 = amount
  row.status = '核赔'
  row.最近推进日 = when
  const note =
    amount === assessed
      ? `核赔通过，赔付 ${amount} 元`
      : `核赔通过，定损 ${assessed} 元，核定赔付 ${amount} 元`
  appendTrace(row, '复核办结', note, operator, when)
  saveInsuranceRows(rows)
  markRelocatePaid(String(row.关联搬迁单号 ?? ''), String(row.理赔案号), operator, when)
  return { ok: true, message: `理赔案 ${row.理赔案号} 复核办结，核定赔付 ${amount} 元，搬迁清单已挂已赔付标记` }
}

// 同一条理赔案号的再次复核：不新挂记录，只在原案追加一条痕迹。
export function registerRepeatReview(
  id: number,
  reason: string,
  operator = '值班管理员',
  when = todayLabel(),
): ActionResult {
  const rows = insuranceRows()
  const row = findClaim(rows, id)
  if (!row) return { ok: false, message: '没有找到这条理赔案' }
  const current = stageIndex(String(row.status))
  if (current < stageIndex('定损')) {
    return { ok: false, message: '尚未定损的理赔案不能登记复核' }
  }
  appendTrace(row, '再次复核', reason.trim() || '同一理赔案号重复提交复核，并条留痕', operator, when)
  row.最近推进日 = when
  saveInsuranceRows(rows)
  return { ok: true, message: `理赔案 ${row.理赔案号} 的再次复核已并到原案留痕，未另挂记录` }
}

// 确认到账：赔付流程终点。
export function confirmArrival(
  id: number,
  operator = '值班管理员',
  when = todayLabel(),
): ActionResult {
  const rows = insuranceRows()
  const row = findClaim(rows, id)
  if (!row) return { ok: false, message: '没有找到这条理赔案' }
  if (String(row.status) !== '核赔') {
    return { ok: false, message: `当前阶段「${row.status}」不能确认到账，需先复核办结` }
  }
  const approved = Number(row.核赔金额)
  row.到账金额 = approved
  row.status = '到账'
  row.pending = false
  row.最近推进日 = when
  appendTrace(row, '确认到账', `赔款 ${approved} 元已到账`, operator, when)
  saveInsuranceRows(rows)
  return { ok: true, message: `理赔案 ${row.理赔案号} 赔款 ${approved} 元已确认到账，理赔办结` }
}

export function claimStats(today = todayLabel()) {
  const rows = insuranceRows()
  const active = rows.filter((row) => !isReturnedForCheck(row))
  const paidTotal = rows
    .filter((row) => String(row.status) === '到账')
    .reduce((sum, row) => sum + Number(row.到账金额 || 0), 0)
  return [
    { label: '在办理赔案', value: active.filter((row) => row.status !== '到账').length },
    { label: '超期未推进', value: active.filter((row) => isOverdue(row, today)).length },
    { label: '退回核对', value: rows.filter((row) => isReturnedForCheck(row)).length },
    { label: '已到账金额（元）', value: paidTotal },
  ]
}

// 避险搬迁清单读理赔口径的唯一入口：定损金额、已赔付标记都从这里来，不另存一份。
export function relocationClaims(): Map<string, RelocateClaimView> {
  const map = new Map<string, RelocateClaimView>()
  for (const row of insuranceRows()) {
    const relocateNo = String(row.关联搬迁单号 ?? '').trim()
    if (!relocateNo) continue
    const status = String(row.status)
    map.set(relocateNo, {
      理赔案号: String(row.理赔案号),
      定损金额: assessmentAmount(row),
      赔付进度: claimProgress(status),
      // 已赔付以复核办结动作为准（见 concludeReview 同步写入搬迁单的保险已赔付标记）。
      已赔付: stageIndex(status) >= stageIndex('核赔'),
    })
  }
  return map
}
