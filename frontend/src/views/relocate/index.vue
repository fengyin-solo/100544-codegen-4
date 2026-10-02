<template>
  <section class="page" data-module="relocate">
    <header class="page-head">
      <div>
        <h2>避险搬迁管理</h2>
        <p class="page-desc">维护搬迁安置单，围绕搬迁编号、所属隐患点、涉及户数、安置方式做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记搬迁安置单</button>
        <button class="btn" type="button" @click="exportRows">导出避险搬迁清单</button>
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
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>关联理赔定损金额</th>
          <th>保险赔付</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ claimInfo(row).定损金额 === null ? '—' : formatAmount(claimInfo(row).定损金额 as number) }}</td>
          <td>
            <span v-if="claimInfo(row).已赔付" class="paid-tag">已赔付</span>
            <span v-else-if="claimInfo(row).理赔案号" class="pending-tag">理赔中 {{ claimInfo(row).赔付进度 }}%</span>
            <span v-else>—</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无避险搬迁数据，可先登记搬迁安置单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条避险搬迁记录；关联理赔定损金额与赔付进度读自灾损保险理赔台账同一份口径，不在此重复维护。</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  relocationClaims,
  runAction as applyAction,
} from '@/api/local-service'
import { formatAmount } from '@/data/insurance-policy'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('relocate')
const columns = ["搬迁编号", "所属隐患点", "涉及户数", "安置方式", "安置地点", "签订日期", "完成日期", "搬迁状态"]
const actions = ["确认签订", "开始搬迁", "确认完成"]
const statuses = ["待签订", "已签订", "搬迁中", "已完成"]
const stats = [{"label": "待签订户数", "value": 0}, {"label": "搬迁中户数", "value": 0}, {"label": "已安置户数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
// 理赔信息（定损金额 / 赔付进度 / 已赔付）统一从理赔台账口径读取，搬迁清单不复制一份。
let claimsMap = relocationClaims()

const noClaim = { 理赔案号: '', 定损金额: null as number | null, 赔付进度: 0, 已赔付: false }
function claimInfo(row: EntryRow) {
  return claimsMap.get(String(row.搬迁编号)) ?? noClaim
}
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '搬迁安置单登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    claimsMap = relocationClaims()
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '避险搬迁列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.paid-tag {
  display: inline-block;
  background: #dcfce7;
  color: #166534;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.pending-tag {
  display: inline-block;
  background: #eef2f7;
  color: #475569;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
  white-space: nowrap;
}
</style>
