import assert from 'node:assert/strict'
import test from 'node:test'
import { attachmentsForReturnDepartment, CATALOG_RETURN_FILE_KINDS, RETURN_DEPARTMENTS, usesCatalogReturnTemplate } from './returnFormTemplate'

test('部门选择分为电商、货盘、其他退货，电商与其他退货使用相同的简化表单', () => {
  assert.deepEqual(RETURN_DEPARTMENTS, ['电商', '货盘', '其他退货'])
  assert.equal(usesCatalogReturnTemplate('货盘'), true)
  for (const department of ['电商', '其他退货', '']) assert.equal(usesCatalogReturnTemplate(department), false)
})

test('历史自填部门保留原模板及资料，编辑时不误丢失原记录', () => {
  assert.equal(usesCatalogReturnTemplate('售后部'), true)
})

test('货盘切换为电商或其他退货，不发送隐藏的三类货盘附件，但保留预约文件和普通附件', () => {
  const kinds = Object.values(CATALOG_RETURN_FILE_KINDS)
  const files = [
    { kind: 'takealot_return_booking', name: '预约单.pdf' },
    { kind: 'return_doc', name: '普通凭据.png' },
    ...kinds.map(kind => ({ kind, name: kind })),
    { kind: 'sourceDocument', fileType: CATALOG_RETURN_FILE_KINDS.sales30d, name: '历史数据表.xlsx' },
  ]
  assert.equal(attachmentsForReturnDepartment(files, '货盘'), files)
  assert.equal(attachmentsForReturnDepartment(files, '售后部'), files)
  for (const department of ['电商', '其他退货']) {
    assert.deepEqual(attachmentsForReturnDepartment(files, department).map(file => file.name), ['预约单.pdf', '普通凭据.png'])
  }
  assert.equal(files.length, 6)
})
