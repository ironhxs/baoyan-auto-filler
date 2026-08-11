import assert from 'node:assert/strict';
import {
  formatAgentApplicationDisplayName,
  inferAgentApplicationIdentity,
  inferAgentApplicationIdentityFromPage,
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

assert.deepEqual(inferAgentApplicationIdentity({
  title: '在线报名 - 预推免',
  url: 'https://enroll.sysu.edu.cn/yjszs/plugins/zs/zsxsd/entrance#/tmfwksdExemptionOnlineSignUp',
  visibleTexts: ['670 计算机学院', '预推免'],
  profileInstitution: '合肥工业大学',
}), {
  institutionName: '中山大学',
  departmentName: '计算机学院',
  projectName: '预推免',
});

assert.deepEqual(inferAgentApplicationIdentityFromPage({
  title: '在线报名 - 预推免',
  url: 'https://enroll.sysu.edu.cn/yjszs/plugins/zs/zsxsd/entrance',
  pageLabel: '报名信息',
  fields: [{
    label: '申请院系所',
    groupLabel: '报名信息',
    value: '670 计算机学院',
    context: '*申请院系所',
  }],
  profileInstitution: '合肥工业大学',
}), {
  institutionName: '中山大学',
  departmentName: '计算机学院',
  projectName: '预推免',
});

console.log('agent page identity tests passed');
