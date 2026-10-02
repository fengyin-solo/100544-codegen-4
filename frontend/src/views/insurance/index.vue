<template>
  <section class="page" data-module="insurance">
    <header class="page-head">
      <div>
        <h2>灾损保险理赔台账</h2>
        <p class="page-desc">
          按投保标的分类登记理赔案号、定损金额与赔付进度。赔付状态只能沿「报出 → 定损 → 核赔 → 到账」顺次推进，
          每次变更留痕；超期没往前一步的案子排在最前，定损金额录成极值的单独退回核对。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">新立理赔案</button>
        <button class="btn" type="button" @click="exportRows">导出理赔台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="stage in stages" :key="stage" class="legend-item">
        {{ stage }}（进度 {{ progressOf(stage) }}%）：{{ stageCount(stage) }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>投保标的</span>
        <select v-model="categoryFilter">
          <option value="">全部标的</option>
          <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>关键词</span>
        <input v-model="keyword" placeholder="按理赔案号 / 被保险人 / 出险乡镇检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <section v-if="returnedRows.length" class="return-panel">
      <h3 class="return-title">定损金额极值 · 退回核对（{{ returnedRows.length }}）</h3>
      <p class="return-hint">下列记录不计入正常台账，需按核对结论修正定损金额后才会回到「定损」继续推进。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>理赔案号</th><th>投保标的</th><th>被保险人</th><th>出险乡镇</th>
            <th>退回的极值金额</th><th>退回原因</th><th>最近推进日</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in returnedRows" :key="String(row.id)" class="row-returned">
            <td>{{ row.理赔案号 }}</td>
            <td>{{ row.投保标的 }}</td>
            <td>{{ row.被保险人 }}</td>
            <td>{{ row.出险乡镇 }}</td>
            <td class="amount-bad">{{ formatAmount(Number(row.退回金额)) }}</td>
            <td>{{ row.退回原因 }}</td>
            <td>{{ row.最近推进日 }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openCorrect(row)">按核对结论修正</button>
              <button class="link" type="button" @click="openTraces(row)">流转痕迹</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-for="group in groupedRows" :key="group.category" class="ledger-group">
      <h3 class="group-title">
        {{ group.category }}
        <span class="group-count">{{ group.rows.length }} 件</span>
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>超期</th>
            <th>理赔案号</th>
            <th>被保险人</th>
            <th>承保公司</th>
            <th>出险乡镇</th>
            <th>报案日期</th>
            <th>定损金额</th>
            <th>赔付进度</th>
            <th>当前阶段</th>
            <th>关联搬迁单</th>
            <th>最近推进日</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.rows" :key="String(row.id)" :class="{ 'row-overdue': row.超期 }">
            <td>
              <span v-if="row.超期" class="overdue-tag">超 {{ row.超期天数 }} 天</span>
              <span v-else class="ok-text">正常</span>
            </td>
            <td>{{ row.理赔案号 }}</td>
            <td>{{ row.被保险人 }}</td>
            <td>{{ row.承保公司 }}</td>
            <td>{{ row.出险乡镇 }}</td>
            <td>{{ row.报案日期 }}</td>
            <td :class="{ 'amount-strong': row.定损金额显示 !== null }">
              {{ formatAmount(row.定损金额显示) }}
            </td>
            <td>
              <div class="progress-wrap">
                <div class="progress-bar"><i :style="{ width: `${row.赔付进度}%` }"></i></div>
                <span>{{ row.status }} · {{ row.赔付进度 }}%</span>
              </div>
            </td>
            <td><span :class="['stage-tag', `stage-${row.status}`]">{{ row.status }}</span></td>
            <td>{{ row.关联搬迁单号 || '—' }}</td>
            <td>{{ row.最近推进日 }}</td>
            <td class="row-actions action-cell">
              <button v-if="row.status === '报出'" class="link" type="button" @click="openAssess(row)">提交定损</button>
              <button v-if="row.status === '定损'" class="link" type="button" @click="openConclude(row)">复核办结</button>
              <button v-if="row.status === '定损'" class="link" type="button" @click="openRepeatReview(row)">再次复核（并条）</button>
              <button v-if="row.status === '核赔'" class="link" type="button" @click="arrive(row)">确认到账</button>
              <button class="link" type="button" @click="openTraces(row)">流转痕迹</button>
            </td>
          </tr>
          <tr v-if="!group.rows.length">
            <td colspan="12" class="empty-state">该投保标的下暂无在办理赔案</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>
        共 {{ activeRows.length }} 件在办理赔案{{ returnedRows.length ? `，另有 ${returnedRows.length} 件退回核对` : '' }}；
        定损金额以查勘定损环节录入为唯一口径，赔付进度由当前阶段核定。
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 新立理赔案 -->
    <div v-if="dialog === 'create'" class="modal-mask" @click.self="closeDialog">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>新立理赔案（报案报出）</h3>
        <p class="modal-hint">同一理赔案号只挂一条，重复报案或重复复核都不另立案。</p>
        <label class="form-item"><span>理赔案号 *</span><input v-model="form.理赔案号" required placeholder="如 INSU-2026-0011" /></label>
        <label class="form-item">
          <span>投保标的 *</span>
          <select v-model="form.投保标的" required>
            <option value="" disabled>请选择</option>
            <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
          </select>
        </label>
        <label class="form-item"><span>被保险人</span><input v-model="form.被保险人" /></label>
        <label class="form-item"><span>承保公司</span><input v-model="form.承保公司" /></label>
        <label class="form-item"><span>出险乡镇</span><input v-model="form.出险乡镇" /></label>
        <label class="form-item"><span>报案日期</span><input v-model="form.报案日期" type="date" /></label>
        <label class="form-item"><span>关联搬迁单号</span><input v-model="form.关联搬迁单号" placeholder="如 RELO-0003，可空" /></label>
        <label class="form-item">
          <span>报案自报金额（元）</span>
          <input v-model.number="form.申报金额" type="number" placeholder="仅作报案材料，不算定损金额" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="submit">立案报出</button>
        </div>
      </form>
    </div>

    <!-- 提交定损 -->
    <div v-if="dialog === 'assess'" class="modal-mask" @click.self="closeDialog">
      <form class="modal" @submit.prevent="submitAssess">
        <h3>提交定损 · {{ current?.理赔案号 }}</h3>
        <p class="modal-hint">定损金额以本环节录入为唯一口径；0、负数或超过单案上限 {{ limit.toLocaleString() }} 元将单独退回核对。</p>
        <label class="form-item"><span>定损金额（元）*</span><input v-model.number="amountInput" type="number" required autofocus /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="submit">提交定损</button>
        </div>
      </form>
    </div>

    <!-- 复核办结 -->
    <div v-if="dialog === 'conclude'" class="modal-mask" @click.self="closeDialog">
      <form class="modal" @submit.prevent="submitConclude">
        <h3>复核办结 · {{ current?.理赔案号 }}</h3>
        <p class="modal-hint">
          核赔通过后赔付进度推进到「核赔」，关联搬迁安置单自动挂上已赔付标记。
          核定赔付金额默认取定损金额，核赔调整时以本结论为准。
        </p>
        <label class="form-item"><span>定损金额（元）</span><input :value="formatAmount(current?.定损金额显示 ?? null)" disabled /></label>
        <label class="form-item"><span>核定赔付金额（元）*</span><input v-model.number="amountInput" type="number" required /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="submit">复核办结</button>
        </div>
      </form>
    </div>

    <!-- 极值退回后修正 -->
    <div v-if="dialog === 'correct'" class="modal-mask" @click.self="closeDialog">
      <form class="modal" @submit.prevent="submitCorrect">
        <h3>按核对结论修正定损金额 · {{ current?.理赔案号 }}</h3>
        <p class="modal-hint">退回原因：{{ current?.退回原因 }}。修正后的金额仍为极值的，继续退回核对。</p>
        <label class="form-item"><span>核定后的定损金额（元）*</span><input v-model.number="amountInput" type="number" required autofocus /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="submit">提交修正</button>
        </div>
      </form>
    </div>

    <!-- 再次复核（并条） -->
    <div v-if="dialog === 'repeat'" class="modal-mask" @click.self="closeDialog">
      <form class="modal" @submit.prevent="submitRepeatReview">
        <h3>同一理赔案号再次复核 · {{ current?.理赔案号 }}</h3>
        <p class="modal-hint">不会新挂记录，只在原案的流转痕迹里追加一条。</p>
        <label class="form-item"><span>复核事由</span><input v-model="noteInput" placeholder="如 被保险人补充票据后申请再核" /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="submit">并条留痕</button>
        </div>
      </form>
    </div>

    <!-- 流转痕迹 -->
    <div v-if="dialog === 'traces'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>流转痕迹 · {{ current?.理赔案号 }}</h3>
        <ol class="trace-list">
          <li v-for="(trace, index) in currentTraces" :key="index" class="trace-item">
            <div class="trace-head">
              <span class="trace-stage">{{ trace.阶段 }}</span>
              <strong>{{ trace.动作 }}</strong>
              <span class="trace-time">{{ trace.时间 }} · {{ trace.经办人 }}</span>
            </div>
            <p v-if="trace.说明" class="trace-note">{{ trace.说明 }}</p>
          </li>
        </ol>
        <p v-if="!currentTraces.length" class="empty-state">暂无痕迹</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="closeDialog">知道了</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  claimStats,
  concludeReview,
  confirmArrival,
  correctAssessment,
  createClaim,
  downloadEntries,
  listClaims,
  registerRepeatReview,
  submitAssessment,
} from '@/api/local-service'
import {
  ASSESSMENT_LIMIT,
  CLAIM_STAGES,
  INSURED_CATEGORIES,
  claimProgress,
  formatAmount,
  todayLabel,
} from '@/data/insurance-policy'
import type { ClaimCreateInput, ClaimView } from '@/api/local-service'
import type { ClaimTrace } from '@/data/types'

const stages = [...CLAIM_STAGES]
const categories = [...INSURED_CATEGORIES]
const limit = ASSESSMENT_LIMIT

const activeRows = ref<ClaimView[]>([])
const returnedRows = ref<ClaimView[]>([])
const stats = ref(claimStats())

const categoryFilter = ref('')
const keyword = ref('')
const errorMessage = ref('')

const dialog = ref<'' | 'create' | 'assess' | 'conclude' | 'correct' | 'repeat' | 'traces'>('')
const current = ref<ClaimView | null>(null)
const amountInput = ref<number | null>(null)
const noteInput = ref('')
const emptyForm = (): ClaimCreateInput => ({
  理赔案号: '',
  投保标的: '',
  被保险人: '',
  承保公司: '',
  出险乡镇: '',
  报案日期: todayLabel(),
  关联搬迁单号: '',
  申报金额: undefined,
})
const form = reactive<ClaimCreateInput>(emptyForm())

// 按投保标的分类展示；每类内部仍是超期未推进的排最前。
const groupedRows = computed(() =>
  categories
    .map((category) => ({
      category,
      rows: activeRows.value.filter((row) => String(row.投保标的) === category),
    }))
    .filter((group) => group.rows.length > 0),
)

const currentTraces = computed<ClaimTrace[]>(() => current.value?.traces ?? [])

function stageCount(stage: string): number {
  return activeRows.value.filter((row) => row.status === stage).length
}

function progressOf(stage: string): number {
  return claimProgress(stage)
}

function reload() {
  errorMessage.value = ''
  const payload = listClaims({ 投保标的: categoryFilter.value, 关键词: keyword.value })
  activeRows.value = payload.active
  returnedRows.value = payload.returned
  stats.value = claimStats()
}

function resetFilters() {
  categoryFilter.value = ''
  keyword.value = ''
  reload()
}

function exportRows() {
  downloadEntries('insurance')
}

function closeDialog() {
  dialog.value = ''
  current.value = null
  amountInput.value = null
  noteInput.value = ''
}

function openCreate() {
  Object.assign(form, emptyForm())
  dialog.value = 'create'
}

function openAssess(row: ClaimView) {
  current.value = row
  amountInput.value = null
  dialog.value = 'assess'
}

function openConclude(row: ClaimView) {
  current.value = row
  amountInput.value = row.定损金额显示
  dialog.value = 'conclude'
}

function openCorrect(row: ClaimView) {
  current.value = row
  amountInput.value = null
  dialog.value = 'correct'
}

function openRepeatReview(row: ClaimView) {
  current.value = row
  noteInput.value = ''
  dialog.value = 'repeat'
}

function openTraces(row: ClaimView) {
  current.value = row
  dialog.value = 'traces'
}

function run(result: { ok: boolean; message: string }) {
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = ''
  closeDialog()
  reload()
}

function submitCreate() {
  run(createClaim({ ...form }))
}

function submitAssess() {
  if (!current.value || amountInput.value === null) return
  run(submitAssessment(Number(current.value.id), Number(amountInput.value)))
}

function submitConclude() {
  if (!current.value || amountInput.value === null) return
  run(concludeReview(Number(current.value.id), Number(amountInput.value)))
}

function submitCorrect() {
  if (!current.value || amountInput.value === null) return
  run(correctAssessment(Number(current.value.id), Number(amountInput.value)))
}

function submitRepeatReview() {
  if (!current.value) return
  run(registerRepeatReview(Number(current.value.id), noteInput.value))
}

function arrive(row: ClaimView) {
  run(confirmArrival(Number(row.id)))
}

onMounted(reload)
</script>

<style scoped>
.return-panel {
  background: #fff7ed;
  border: 1px solid #fdba74;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}
.return-title { margin: 0 0 4px; font-size: 15px; color: #9a3412; }
.return-hint { margin: 0 0 8px; font-size: 12px; color: #b45309; }
.row-returned { background: #fffbeb; }
.amount-bad { color: #b42318; font-weight: 600; }
.ledger-group { margin-bottom: 18px; }
.group-title {
  font-size: 14px;
  margin: 0 0 6px;
  padding: 6px 10px;
  background: #e8f0fe;
  border-left: 4px solid var(--brand);
  border-radius: 4px;
}
.group-count { font-size: 12px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.row-overdue { background: #fef2f2; }
.overdue-tag {
  display: inline-block;
  background: #b42318;
  color: #fff;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
  white-space: nowrap;
}
.ok-text { color: #15803d; font-size: 12px; }
.amount-strong { font-variant-numeric: tabular-nums; font-weight: 600; }
.progress-wrap { display: flex; flex-direction: column; gap: 2px; font-size: 12px; min-width: 130px; }
.progress-bar { height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
.progress-bar i { display: block; height: 100%; background: var(--brand); border-radius: 999px; }
.stage-tag { border-radius: 4px; padding: 1px 8px; font-size: 12px; }
.stage-报出 { background: #e5e7eb; color: #374151; }
.stage-定损 { background: #fef3c7; color: #92400e; }
.stage-核赔 { background: #dbeafe; color: #1e40af; }
.stage-到账 { background: #dcfce7; color: #166534; }
.action-cell { white-space: nowrap; }
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 460px;
  max-width: calc(100vw - 32px);
  max-height: 86vh;
  overflow: auto;
}
.modal h3 { margin: 0 0 6px; font-size: 16px; }
.modal-hint { margin: 0 0 12px; font-size: 12px; color: var(--muted); }
.form-item { display: block; margin-bottom: 10px; font-size: 13px; }
.form-item span { display: block; color: var(--muted); margin-bottom: 3px; }
.form-item input,
.form-item select { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.form-item input:disabled { background: #f1f5f9; color: #475569; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.trace-list { list-style: none; margin: 0; padding: 0; }
.trace-item { border-left: 2px solid var(--brand); padding: 0 0 12px 12px; margin-left: 6px; position: relative; }
.trace-item::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand);
}
.trace-head { display: flex; gap: 8px; align-items: baseline; font-size: 13px; flex-wrap: wrap; }
.trace-stage { background: #eef2f7; border-radius: 4px; padding: 0 6px; font-size: 12px; }
.trace-time { color: var(--muted); font-size: 12px; margin-left: auto; }
.trace-note { margin: 2px 0 0; font-size: 12px; color: #475569; }
</style>
