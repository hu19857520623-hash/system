import { useState } from 'react'

import { Save, MapPin, Plus, Trash2 } from 'lucide-react'

import { Link, Navigate } from 'react-router-dom'

import {

  Button, Card, PageHeader, Badge, Table, TableFooter,

} from '../components/ui'

import { FormField, formInput, formSelect } from '../components/ui/form'

import {

  DEFAULT_REGION_DISPATCH_RULES,

  regionDispatchLabel,

  type RegionDispatchRule, type RegionDispatchMethod,

} from '../data/feeTemplates'

import {

  useFeeTemplates, updateRegionDispatchRules,

} from '../data/feeTemplateStore'

import { useDataScope } from '../auth/useDataScope'



const DISPATCH_METHODS: RegionDispatchMethod[] = ['卡派', '快递']



export default function RegionTemplates() {

  const dataScope = useDataScope()

  const { regionDispatchRules } = useFeeTemplates()

  const [draft, setDraft] = useState<RegionDispatchRule[]>(regionDispatchRules)

  const [saved, setSaved] = useState(false)

  const [newCode, setNewCode] = useState('')

  const [newLabel, setNewLabel] = useState('')

  const [newMethod, setNewMethod] = useState<RegionDispatchMethod>('卡派')



  if (!dataScope.isAdmin) {

    return <Navigate to="/" replace />

  }



  const patchRule = (id: string, patch: Partial<RegionDispatchRule>) => {

    setDraft(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))

  }



  const addRegion = () => {

    const code = newCode.trim().toLowerCase()

    const label = newLabel.trim()

    if (!code || !label) {

      window.alert('请填写地区代码和名称')

      return

    }

    if (!/^[a-z0-9_-]+$/.test(code)) {

      window.alert('地区代码仅支持小写字母、数字、下划线、连字符')

      return

    }

    if (draft.some(r => r.code === code)) {

      window.alert('该地区代码已存在')

      return

    }

    setDraft(prev => [...prev, {

      id: `rd-${code}-${Date.now()}`,

      code,

      label,

      shippingMethod: newMethod,

      enabled: true,

      remark: '',

    }])

    setNewCode('')

    setNewLabel('')

    setNewMethod('卡派')

  }



  const removeRegion = (id: string) => {

    const rule = draft.find(r => r.id === id)

    if (!rule) return

    if (!window.confirm(`确定删除地区「${rule.label}」？价格模板中该地区的费率将保留，需手动在价格模板调整。`)) return

    setDraft(prev => prev.filter(r => r.id !== id))

  }



  const save = () => {

    updateRegionDispatchRules(draft)

    setSaved(true)

    setTimeout(() => setSaved(false), 2000)

  }



  const resetDefaults = () => {

    setDraft(DEFAULT_REGION_DISPATCH_RULES.map(r => ({ ...r })))

  }



  return (

    <div className="page-shell">

      <PageHeader

        title="地区模板"

        desc="维护发货目的地区，并为每个地区配置默认配送方式（卡派 / 快递）"

        action={

          <div className="flex gap-2">

            <Link to="/system/price-template">

              <Button variant="secondary" size="sm">价格模板</Button>

            </Link>

            <Button variant="secondary" size="sm" onClick={resetDefaults}>恢复默认</Button>

            <Button size="sm" onClick={save}>

              <Save className="h-3.5 w-3.5" /> {saved ? '已保存' : '保存'}

            </Button>

          </div>

        }

      />



      <div className="mb-4 rounded-xl bg-sky-50 px-4 py-3 ring-1 ring-sky-100">

        <p className="text-xs font-semibold text-sky-900">使用说明</p>

        <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-sky-800">

          <li>· 可<strong>添加自定义地区</strong>（代码 + 名称），并指定默认卡派或快递</li>

          <li>· 保存后自动在「价格模板」中为新地区生成默认物流费与<strong>自提费</strong>，可在价格模板中微调</li>

          <li>· 客户在「预约发货」选择发货地区后，系统自动套用对应配送方式（可手动改为自提）</li>

          <li>· Takealot 入仓仍按目的仓映射到 jhb / cpt / dbn 等地区代码</li>

        </ul>

      </div>



      <Card className="mb-4 p-4">

        <p className="mb-3 text-xs font-semibold text-text-secondary">添加地区</p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">

          <FormField label="地区代码" hint="如 pe、 PTA">

            <input

              className={formInput()}

              value={newCode}

              onChange={e => setNewCode(e.target.value)}

              placeholder="pe"

            />

          </FormField>

          <FormField label="地区名称" hint="展示用">

            <input

              className={formInput()}

              value={newLabel}

              onChange={e => setNewLabel(e.target.value)}

              placeholder="Pretoria 比勒陀利亚"

            />

          </FormField>

          <FormField label="默认配送">

            <select

              className={formSelect()}

              value={newMethod}

              onChange={e => setNewMethod(e.target.value as RegionDispatchMethod)}

            >

              {DISPATCH_METHODS.map(m => <option key={m} value={m}>{m}</option>)}

            </select>

          </FormField>

          <div className="flex items-end lg:col-span-2">

            <Button size="sm" onClick={addRegion}>

              <Plus className="h-3.5 w-3.5" /> 添加地区

            </Button>

          </div>

        </div>

      </Card>



      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">

        {draft.map(rule => (

          <Card key={rule.id} padding className="text-center">

            <MapPin className="mx-auto h-5 w-5 text-primary-500" />

            <p className="mt-2 text-xs font-semibold text-text-primary">{rule.label}</p>

            <p className="text-[10px] text-text-muted">{rule.code}</p>

            <p className="mt-1 text-lg font-bold text-primary-700">{rule.shippingMethod}</p>

            <Badge

              status={rule.enabled ? 'available' : 'discarded'}

              label={rule.enabled ? '已启用' : '已停用'}

            />

          </Card>

        ))}

      </div>



      <Card className="overflow-hidden">

        <Table>

          <thead className="table-head">

            <tr>

              <th>代码</th>

              <th>地区名称</th>

              <th>配送方式</th>

              <th>说明</th>

              <th>状态</th>

              <th>预约发货展示</th>

              <th>操作</th>

            </tr>

          </thead>

          <tbody className="table-body">

            {draft.map(rule => (

              <tr key={rule.id} className="table-row">

                <td className="table-cell">

                  <input

                    className={formInput('w-24 font-mono text-xs')}

                    value={rule.code}

                    onChange={e => patchRule(rule.id, { code: e.target.value.toLowerCase().trim() })}

                  />

                </td>

                <td className="table-cell">

                  <input

                    className={formInput('min-w-[140px]')}

                    value={rule.label}

                    onChange={e => patchRule(rule.id, { label: e.target.value })}

                  />

                </td>

                <td className="table-cell">

                  <select

                    className={formSelect('w-28')}

                    value={rule.shippingMethod}

                    onChange={e => patchRule(rule.id, { shippingMethod: e.target.value as RegionDispatchMethod })}

                  >

                    {DISPATCH_METHODS.map(m => (

                      <option key={m} value={m}>{m}</option>

                    ))}

                  </select>

                </td>

                <td className="table-cell">

                  <input

                    className={formInput('min-w-[160px]')}

                    value={rule.remark ?? ''}

                    placeholder="备注说明"

                    onChange={e => patchRule(rule.id, { remark: e.target.value })}

                  />

                </td>

                <td className="table-cell">

                  <label className="flex cursor-pointer items-center gap-2 text-xs">

                    <input

                      type="checkbox"

                      checked={rule.enabled}

                      onChange={e => patchRule(rule.id, { enabled: e.target.checked })}

                      className="rounded border-border text-primary-600"

                    />

                    {rule.enabled ? '启用' : '停用'}

                  </label>

                </td>

                <td className="table-cell text-xs text-text-secondary">

                  {rule.enabled ? regionDispatchLabel(rule) : '—'}

                </td>

                <td className="table-cell">

                  <button

                    type="button"

                    onClick={() => removeRegion(rule.id)}

                    className="text-red-500 hover:text-red-700"

                    title="删除地区"

                  >

                    <Trash2 className="h-4 w-4" />

                  </button>

                </td>

              </tr>

            ))}

          </tbody>

        </Table>

        <TableFooter total={draft.length} />

      </Card>

    </div>

  )

}


