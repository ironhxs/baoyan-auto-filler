import assert from 'node:assert/strict';
import { buildAgentPageSemanticText } from '../utils/agent/page-context';

const applicationTexts = [
  ' 身份证号码  370724********1419 ',
  '联系电话 156****5006',
  '本科院校 合肥工业大学',
  '奖项名称 全国大学生计算机系统能力大赛华东区域赛三等奖',
  '日期格式：2019-11',
  '内容中不得含有 |、#',
  '最多填写 500 字',
  '本科院校 合肥工业大学',
];

const sensitiveTexts = [
  'Cookie: session=secret',
  'Authorization: Bearer secret-token',
  'CSRF token abc123',
  '请输入验证码',
  '支付口令',
  'API Key: sk-secret',
];

const manyRules = Array.from({ length: 35 }, (_, index) => `第 ${index + 1} 项不得超过 ${index + 10} 字`);
const result = buildAgentPageSemanticText([...applicationTexts, ...sensitiveTexts, ...manyRules]);

assert.deepEqual(result.visibleTexts.slice(0, 7), [
  '身份证号码 370724********1419',
  '联系电话 156****5006',
  '本科院校 合肥工业大学',
  '奖项名称 全国大学生计算机系统能力大赛华东区域赛三等奖',
  '日期格式：2019-11',
  '内容中不得含有 |、#',
  '最多填写 500 字',
]);
assert.equal(result.visibleTexts.some((text) => /Cookie|Authorization|CSRF|验证码|支付口令|API Key/i.test(text)), false);
assert.equal(result.instructions.includes('日期格式：2019-11'), true);
assert.equal(result.instructions.includes('内容中不得含有 |、#'), true);
assert.equal(result.instructions.includes('最多填写 500 字'), true);
assert.equal(result.instructions.filter((text) => /^第 \d+ 项不得超过/u.test(text)).length, 35);

console.log('agent page context tests passed');
