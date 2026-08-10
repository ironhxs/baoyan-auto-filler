import assert from 'node:assert/strict';
import {
  formatAgentApplicationDisplayName,
  inferAgentApplicationIdentity,
} from '../utils/agent/page-identity';

const identity = inferAgentApplicationIdentity({
  title: '复旦大学研究生报考服务系统',
  visibleTexts: [
    '复旦大学',
    '计算机科学技术学院',
    '2027年全国优秀大学生夏令营',
  ],
  profileInstitution: '合肥工业大学',
});

assert.deepEqual(identity, {
  institutionName: '复旦大学',
  departmentName: '计算机科学技术学院',
  projectName: '2027年全国优秀大学生夏令营',
});
assert.equal(
  formatAgentApplicationDisplayName(identity),
  '复旦大学 · 计算机科学技术学院 · 2027年全国优秀大学生夏令营',
);

assert.equal(formatAgentApplicationDisplayName({
  institutionName: '东南大学',
  departmentName: '',
  projectName: '',
}), '东南大学');

assert.equal(inferAgentApplicationIdentity({
  title: '东南大学',
  visibleTexts: ['东南大学'],
  profileInstitution: '东南大学',
}).institutionName, '东南大学');

assert.equal(inferAgentApplicationIdentity({
  title: '报名信息',
  visibleTexts: ['合肥工业大学'],
  profileInstitution: '合肥工业大学',
}).institutionName, '');

console.log('agent page identity tests passed');
