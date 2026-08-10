import assert from 'node:assert/strict';

import { chooseNearestAncestorQuestionContext } from '../utils/field-context';

assert.equal(
  chooseNearestAncestorQuestionContext([
    [],
    ['何时何地何原因受过何种奖励', '（内容中不得含有|、#）'],
    ['申请须知 基本信息 家庭成员 学习信息'],
  ]),
  '何时何地何原因受过何种奖励 （内容中不得含有|、#）',
  'a nested table should inherit the nearest outer-row question instead of unrelated page navigation',
);

assert.equal(
  chooseNearestAncestorQuestionContext([
    ['  学术成果   （包括荣获奖项、发表论文、学术活动等）  '],
  ]),
  '学术成果 （包括荣获奖项、发表论文、学术活动等）',
);

console.log('field context tests passed');
