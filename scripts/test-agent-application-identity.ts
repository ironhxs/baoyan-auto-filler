import assert from 'node:assert/strict';
import {
  buildAgentApplicationIdentityPrompt,
  mergeAgentApplicationIdentity,
  needsAgentApplicationIdentity,
  parseAndValidateAgentApplicationIdentity,
} from '../utils/agent/application-identity';

assert.equal(needsAgentApplicationIdentity({ institutionName: '中山大学', departmentName: '', projectName: '' }), true);
assert.equal(needsAgentApplicationIdentity({ institutionName: '中山大学', departmentName: '人工智能学院', projectName: '' }), false);
assert.deepEqual(mergeAgentApplicationIdentity(
  { institutionName: '中山大学', departmentName: '', projectName: '' },
  { institutionName: '中山大学', departmentName: '人工智能学院', projectName: '夏令营' },
), {
  institutionName: '中山大学',
  departmentName: '人工智能学院',
  projectName: '夏令营',
});

const context = {
  title: '中山大学研究生报考服务系统',
  url: 'https://enroll.sysu.edu.cn/form?a=project-1&access_token=TEST_ONLY_IDENTITY_TOKEN#session=TEST_ONLY_SESSION',
  pageEvidenceTexts: [
    '中山大学研究生报考服务系统',
    '申请院系：人工智能学院',
    '2027年优秀大学生夏令营',
  ],
  applicantIdentity: {
    institutionName: '合肥工业大学',
    departmentName: '计算机与信息学院',
    majorName: '计算机科学与技术',
  },
};

const prompt = buildAgentApplicationIdentityPrompt(context);
assert.match(prompt, /页面证据/u);
assert.match(prompt, /申请人来源身份/u);
assert.match(prompt, /证据不足.*空/u);
assert.match(prompt, /人工智能学院/u);
assert.match(prompt, /https:\/\/enroll\.sysu\.edu\.cn\/form/u);
assert.equal(prompt.includes('TEST_ONLY'), false, 'identity prompts must strip query and fragment credentials');

assert.deepEqual(parseAndValidateAgentApplicationIdentity(JSON.stringify({
  institutionName: '中山大学',
  departmentName: '人工智能学院',
  projectName: '2027年优秀大学生夏令营',
  evidenceTexts: ['中山大学研究生报考服务系统', '申请院系：人工智能学院', '2027年优秀大学生夏令营'],
  confidence: 'high',
}), context), {
  institutionName: '中山大学',
  departmentName: '人工智能学院',
  projectName: '2027年优秀大学生夏令营',
});

assert.deepEqual(parseAndValidateAgentApplicationIdentity(JSON.stringify({
  institutionName: '中山大学',
  departmentName: '计算机与信息学院',
  projectName: '',
  evidenceTexts: ['中山大学研究生报考服务系统'],
  confidence: 'high',
}), context), {
  institutionName: '中山大学',
  departmentName: '',
  projectName: '',
}, 'the Agent cannot reuse the applicant source department');

assert.deepEqual(parseAndValidateAgentApplicationIdentity(JSON.stringify({
  institutionName: '中山大学',
  departmentName: '不存在学院',
  projectName: '',
  evidenceTexts: ['申请院系：不存在学院'],
  confidence: 'high',
}), context), {
  institutionName: '',
  departmentName: '',
  projectName: '',
}, 'evidence returned by the Agent must be present in the observed page evidence whitelist');

console.log('agent application identity tests passed');
