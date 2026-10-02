<template>
  <section class="page" data-module="insurance">
    <header class="page-head">
      <div>
        <h2>灾损保险理赔台账</h2>
        <p class="page-desc">汛期灾损保险理赔按投保标的分类登记，理赔案号、定损金额与赔付进度一本账；赔付沿 报出→定损→核赔→到账 顺推，每次变更留痕，超期未推进置顶，定损金额极值单独退回核对。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openRegister">登记理赔案（报出）</button>
        <button class="btn" type="button" @click="exportRows">导出理赔台账</button>
        <button class="btn ghost" type="button" @click="resetAll">恢复示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">阶段时限：报出 7 天 / 定损 10 天 / 核赔 5 天</span>
      <span class="legend-item">定损极值口径：≤{{ ASSESSED_MIN }} 元或 ≥{{ (ASSESSED_MAX / 10000).toFixed(0) }} 万元退回核对</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :list="field === '投保标的' ? 'object-options' : undefined" :placeholder="`按${field}检索`" />
      </label>
      <datalist id="object-options">
        <option v-for="item in objectKinds" :key="item" :value="item" />
      </datalist>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table claim-table">
      <thead>
        <tr>
          <th>理赔案号</th>
          <th>投保标的</th>
          <th>所属乡镇</th>
          <th>承保公司</th>
          <th>报案日期</th>
          <th>定损金额（业务口径）</th>
          <th>赔付进度</th>
          <th>当前阶段停留</th>
          <th>关联搬迁编号</th>
          <th>可执行动作</th>
          <th>痕迹</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="overdueRows.length" class="section-banner">
          <td :colspan="11">超期未推进（超过阶段时限仍未往前一步，排在最前）</td>
        </tr>
        <template v-for="row in overdueRows" :key="`overdue-${row.id}`">
          <tr :class="{ 'row-overdue': true }">
            <td>{{ row.理赔案号 }}</td>
            <td>{{ row.投保标的 }}</td>
            <td>{{ row.所属乡镇 }}</td>
            <td>{{ row.承保公司 }}</td>
            <td>{{ row.报案日期 }}</td>
            <td>{{ assessedText(row) }}</td>
            <td>
              <div class="progress">
                <div class="progress-bar overdue" :style="{ width: `${progressOf(row).percent}%` }" />
              </div>
              <span class="progress-text">{{ progressOf(row).label }}</span>
            </td>
            <td><span class="tag tag-danger">超期 {{ overdueDays(row) }} 天</span></td>
            <td>{{ row.关联搬迁编号 || '—' }}</td>
            <td class="row-actions">
              <button v-if="row.status === '报出'" class="link" type="button" @click="openAssess(row)">提交定损</button>
              <button v-if="row.status === '定损'" class="link" type="button" @click="doApprove(row)">复核办结</button>
              <button v-if="row.status === '核赔'" class="link" type="button" @click="doArrive(row)">确认到账</button>
              <span v-else-if="row.status === '到账'" class="tag tag-ok">已办结</span>
            </td>
            <td>
              <button class="link" type="button" @click="toggleTrail(row)">{{ expanded.has(Number(row.id)) ? '收起' : `查看 ${row.trail?.length ?? 0} 条` }}</button>
            </td>
          </tr>
          <tr v-if="expanded.has(Number(row.id))" class="trail-row">
            <td colspan="11">
              <ul class="trail-box">
                <li v-for="(item, tIndex) in row.trail" :key="tIndex">
                  <strong>{{ item.time }}</strong> {{ item.operator }} 执行「{{ item.action }}」：{{ item.from }} → {{ item.to }}
                  <span v-if="item.note" class="trail-note">（{{ item.note }}）</span>
                </li>
              </ul>
            </td>
          </tr>
        </template>

        <template v-for="group in groupedRows" :key="group.kind">
          <tr class="section-banner">
            <td :colspan="11">投保标的分类：{{ group.kind }}（{{ group.rows.length }} 条）</td>
          </tr>
          <template v-for="row in group.rows" :key="`group-${row.id}`">
            <tr>
              <td>{{ row.理赔案号 }}</td>
              <td>{{ row.投保标的 }}</td>
              <td>{{ row.所属乡镇 }}</td>
              <td>{{ row.承保公司 }}</td>
              <td>{{ row.报案日期 }}</td>
              <td>{{ assessedText(row) }}</td>
              <td>
                <div class="progress">
                  <div class="progress-bar" :style="{ width: `${progressOf(row).percent}%` }" />
                </div>
                <span class="progress-text">{{ progressOf(row).label }}</span>
              </td>
              <td>停留 {{ daysInStage(row) ?? '—' }} 天</td>
              <td>{{ row.关联搬迁编号 || '—' }}</td>
              <td class="row-actions">
                <button v-if="row.status === '报出'" class="link" type="button" @click="openAssess(row)">提交定损</button>
                <button v-if="row.status === '定损'" class="link" type="button" @click="doApprove(row)">复核办结</button>
                <button v-if="row.status === '核赔'" class="link" type="button" @click="doArrive(row)">确认到账</button>
                <span v-if="row.status === '到账'" class="tag tag-ok">已办结</span>
              </td>
              <td>
                <button class="link" type="button" @click="toggleTrail(row)">{{ expanded.has(Number(row.id)) ? '收起' : `查看 ${row.trail?.length ?? 0} 条` }}</button>
              </td>
            </tr>
            <tr v-if="expanded.has(Number(row.id))" class="trail-row">
              <td colspan="11">
                <ul class="trail-box">
                  <li v-for="(item, tIndex) in row.trail" :key="tIndex">
                    <strong>{{ item.time }}</strong> {{ item.operator }} 执行「{{ item.action }}」：{{ item.from }} → {{ item.to }}
                    <span v-if="item.note" class="trail-note">（{{ item.note }}）</span>
                  </li>
                </ul>
              </td>
            </tr>
          </template>
        </template>

        <tr v-if="returnedRows.length" class="section-banner banner-warn">
          <td :colspan="11">定损金额极值 · 单独退回核对（金额未定稿，不计入定损与赔付统计）</td>
        </tr>
        <template v-for="row in returnedRows" :key="`return-${row.id}`">
          <tr class="row-return">
            <td>{{ row.理赔案号 }}</td>
            <td>{{ row.投保标的 }}</td>
            <td>{{ row.所属乡镇 }}</td>
            <td>{{ row.承保公司 }}</td>
            <td>{{ row.报案日期 }}</td>
            <td>
              <span class="tag tag-warn">待核对：录入 {{ row.定损金额 }} 元</span>
            </td>
            <td>
              <div class="progress">
                <div class="progress-bar halted" style="width: 33%" />
              </div>
              <span class="progress-text">定损（退回核对中）</span>
            </td>
            <td><span class="tag tag-warn">退回核对</span></td>
            <td>{{ row.关联搬迁编号 || '—' }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openAssess(row)">重新定损</button>
            </td>
            <td>
              <button class="link" type="button" @click="toggleTrail(row)">{{ expanded.has(Number(row.id)) ? '收起' : `查看 ${row.trail?.length ?? 0} 条` }}</button>
            </td>
          </tr>
          <tr v-if="expanded.has(Number(row.id))" class="trail-row">
            <td colspan="11">
              <ul class="trail-box">
                <li v-for="(item, tIndex) in row.trail" :key="tIndex">
                  <strong>{{ item.time }}</strong> {{ item.operator }} 执行「{{ item.action }}」：{{ item.from }} → {{ item.to }}
                  <span v-if="item.note" class="trail-note">（{{ item.note }}）</span>
                </li>
              </ul>
            </td>
          </tr>
        </template>

        <tr v-if="!overdueRows.length && !returnedRows.length && !groupedRows.length">
          <td :colspan="11" class="empty-state">暂无理赔记录，点右上角「登记理赔案（报出）」建账</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条理赔记录 · 状态只能沿 报出→定损→核赔→到账 顺推，每次变更均留痕</span>
      <span v-if="message" :class="messageOk ? 'success-text' : 'error-text'">{{ message }}</span>
    </footer>

    <div v-if="dialog !== ''" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3 v-if="dialog === 'register'">登记理赔案（报出）</h3>
        <h3 v-else-if="dialog === 'assess' && assessForm.resubmit">重新定损（退回核对）</h3>
        <h3 v-else>提交定损（报出 → 定损）</h3>

        <div v-if="dialog === 'register'" class="form-grid">
          <label><span>理赔案号 *</span><input v-model="registerForm.理赔案号" placeholder="如 CLM-2026-0109" /></label>
          <label><span>投保标的 *</span><input v-model="registerForm.投保标的" list="object-options" placeholder="农房 / 农作物 / 家庭财产 / 农机具" /></label>
          <label><span>所属乡镇 *</span><input v-model="registerForm.所属乡镇" /></label>
          <label><span>承保公司 *</span><input v-model="registerForm.承保公司" /></label>
          <label><span>报案日期 *</span><input v-model="registerForm.报案日期" type="date" /></label>
          <label><span>关联搬迁编号</span><input v-model="registerForm.关联搬迁编号" placeholder="选填，如 RELO-0003" /></label>
        </div>

        <div v-else class="form-grid">
          <label class="form-full"><span>理赔案号</span><input :value="assessForm.caseNo" disabled /></label>
          <label class="form-full">
            <span>定损金额（元）*</span>
            <input v-model="assessForm.amount" type="number" min="0" step="0.01" placeholder="录入查勘定损金额；≤1 元或 ≥1000 万元将退回核对" />
          </label>
        </div>

        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitDialog">确定</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  ASSESSED_MAX,
  ASSESSED_MIN,
  approveClaim,
  arriveClaim,
  assessedAmount,
  claimProgress,
  claimStats,
  daysInStage,
  exportClaimsCsv,
  listClaims,
  overdueDays,
  registerClaim,
  resetClaims,
  resubmitAssessment,
  submitAssessment,
} from '@/api/local-service'
import type { ClaimRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const CLAIM_ROUTE = ['报出', '定损', '核赔', '到账']
const objectKinds = ['农房', '农作物', '家庭财产', '农机具', '其他']
const filterFields = ['理赔案号', '投保标的', '承保公司']

const rows = ref<ClaimRow[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(false)
const filters = ref<Record<string, string>>({})
const expanded = ref<Set<number>>(new Set())
const stats = ref(claimStats())

const dialog = ref<'' | 'register' | 'assess'>('')
const registerForm = ref({ 理赔案号: '', 投保标的: '', 所属乡镇: '', 承保公司: '', 报案日期: '', 关联搬迁编号: '' })
const assessForm = ref({ id: 0, caseNo: '', amount: '', resubmit: false })

const overdueRows = computed(() => rows.value.filter((row) => overdueDays(row) !== null))
const returnedRows = computed(() => rows.value.filter((row) => row.amountIssue))
const groupedRows = computed(() => {
  const shown = new Set<number>([
    ...overdueRows.value.map((row) => Number(row.id)),
    ...returnedRows.value.map((row) => Number(row.id)),
  ])
  const map = new Map<string, ClaimRow[]>()
  for (const row of rows.value) {
    if (shown.has(Number(row.id))) {
      continue
    }
    const kind = String(row.投保标的 || '未分类')
    const bucket = map.get(kind) ?? []
    bucket.push(row)
    map.set(kind, bucket)
  }
  return [...map.entries()].map(([kind, list]) => ({ kind, rows: list }))
})

const statusSummary = computed(() =>
  CLAIM_ROUTE.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function assessedText(row: ClaimRow): string {
  const amount = assessedAmount(row)
  if (amount !== null) {
    return `${amount.toLocaleString('zh-CN')} 元（已定稿）`
  }
  return '未定稿（核赔复核后生效）'
}

function progressOf(row: ClaimRow) {
  return claimProgress(row)
}

function flash(text: string, ok: boolean) {
  message.value = text
  messageOk.value = ok
}

function toggleTrail(row: ClaimRow) {
  const id = Number(row.id)
  const next = new Set(expanded.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expanded.value = next
}

function openRegister() {
  registerForm.value = { 理赔案号: '', 投保标的: '', 所属乡镇: '', 承保公司: '', 报案日期: new Date().toISOString().slice(0, 10), 关联搬迁编号: '' }
  dialog.value = 'register'
}

function openAssess(row: ClaimRow) {
  assessForm.value = { id: Number(row.id), caseNo: String(row.理赔案号), amount: '', resubmit: Boolean(row.amountIssue) }
  dialog.value = 'assess'
}

function closeDialog() {
  dialog.value = ''
}

function submitDialog() {
  let result: { ok: boolean; message: string } | null = null
  if (dialog.value === 'register') {
    result = registerClaim({ ...registerForm.value, operator: store.operator })
    if (!result.ok) {
      flash(result.message, false)
      return
    }
  } else {
    const fn = assessForm.value.resubmit ? resubmitAssessment : submitAssessment
    result = fn(assessForm.value.id, assessForm.value.amount, store.operator)
    // 金额无效等录入错误：弹窗保留继续改；极值已落退回分区：关窗并在台账上高亮提示。
    if (!result.ok && !result.message.includes('极值')) {
      flash(result.message, false)
      return
    }
  }
  const pending = result
  dialog.value = ''
  reload()
  flash(pending.message, pending.ok)
}

function doApprove(row: ClaimRow) {
  const result = approveClaim(Number(row.id), store.operator)
  flash(result.message, result.ok)
  reload()
}

function doArrive(row: ClaimRow) {
  const result = arriveClaim(Number(row.id), store.operator)
  flash(result.message, result.ok)
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  const { filename, content } = exportClaimsCsv()
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

function resetAll() {
  resetClaims()
  expanded.value = new Set()
  flash('理赔台账与避险搬迁清单已恢复为示例数据', true)
  reload()
}

function reload() {
  message.value = ''
  rows.value = listClaims(filters.value)
  total.value = rows.value.length
  stats.value = claimStats()
}

onMounted(reload)
</script>
