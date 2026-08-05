# 模型切换表

> 数据来源：[cc-switch](https://github.com/farion1231/cc-switch) `src/config/hermesProviderPresets.ts`
>
> 以下均为 **OpenAI 兼容** 端点（`/v1/chat/completions`），可直接填入保填使用。

## 国内厂商

| 厂商 | Base URL | 推荐模型 | 获取 API Key |
|------|----------|----------|-------------|
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-pro` / `deepseek-v4-flash` | [platform.deepseek.com](https://platform.deepseek.com) |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-5` | [open.bigmodel.cn](https://open.bigmodel.cn) |
| 智谱 GLM 国际 | `https://api.z.ai/api/paas/v4` | `glm-5` | [z.ai](https://z.ai) |
| 阿里百炼 (通义千问) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3-coder-plus` / `qwen3-max` | [bailian.console.aliyun.com](https://bailian.console.aliyun.com) |
| Kimi (月之暗面) | `https://api.moonshot.cn/v1` | `kimi-k2.6` | [platform.moonshot.cn](https://platform.moonshot.cn) |
| StepFun (阶跃星辰) | `https://api.stepfun.ai/v1` | `step-3.5-flash` | [platform.stepfun.ai](https://platform.stepfun.ai) |
| MiniMax | `https://api.minimaxi.com/v1` | `MiniMax-M2.7` | [platform.minimaxi.com](https://platform.minimaxi.com) |
| MiniMax 国际 | `https://api.minimax.io/v1` | `MiniMax-M2.7` | [platform.minimax.io](https://platform.minimax.io) |
| 小米 MiMo | `https://api.xiaomimimo.com/v1` | `mimo-v2.5-pro` | [platform.xiaomimimo.com](https://platform.xiaomimimo.com) |
| 小米 MiMo Token Plan | `https://token-plan-cn.xiaomimimo.com/v1` | `mimo-v2.5-pro` | [platform.xiaomimimo.com](https://platform.xiaomimimo.com) |
| Longcat | `https://api.longcat.chat/openai/v1` | `LongCat-Flash-Chat` | [longcat.chat](https://longcat.chat/platform) |

## 聚合平台

| 厂商 | Base URL | 推荐模型 | 获取 API Key |
|------|----------|----------|-------------|
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Pro/MiniMaxAI/MiniMax-M2.7` | [siliconflow.cn](https://siliconflow.cn) |
| SiliconFlow 国际 | `https://api.siliconflow.com/v1` | `MiniMaxAI/MiniMax-M2.7` | [siliconflow.com](https://siliconflow.com) |
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-opus-4-7` | [openrouter.ai](https://openrouter.ai) |
| TheRouter | `https://api.therouter.ai/v1` | `openai/gpt-5.4` | [therouter.ai](https://therouter.ai) |
| Together AI | `https://api.together.xyz/v1` | `Qwen/Qwen3-Coder-480B-A35B-Instruct` | [together.ai](https://together.ai) |
| Novita AI | `https://api.novita.ai/v3/openai` | `zai-org/glm-5` | [novita.ai](https://novita.ai) |
| AiHubMix | `https://aihubmix.com/v1` | `gpt-5.4` | [aihubmix.com](https://aihubmix.com) |
| DMXAPI | `https://www.dmxapi.cn/v1` | `gpt-5.4` | [dmxapi.cn](https://www.dmxapi.cn) |
| ModelScope (魔搭) | `https://api-inference.modelscope.cn/v1` | `ZhipuAI/GLM-5` | [modelscope.cn](https://modelscope.cn) |
| Compshare (算力共享) | `https://api.modelverse.cn/v1` | `gpt-5.4` | [compshare.cn](https://www.compshare.cn) |
| Compshare Coding Plan | `https://cp.compshare.cn/v1` | `gpt-5.4` | [compshare.cn](https://www.compshare.cn) |
| Shengsuanyun (胜算云) | `https://router.shengsuanyun.com/api/v1` | `openai/gpt-5.4` | [shengsuanyun.com](https://www.shengsuanyun.com) |
| NVIDIA NIM | `https://integrate.api.nvidia.com` | `moonshotai/kimi-k2.5` | [build.nvidia.com](https://build.nvidia.com) |

## 第三方

| 厂商 | Base URL | 推荐模型 |
|------|----------|----------|
| LemonData | `https://api.lemondata.cc/v1` | `gpt-5.4` |
| PatewayAI | `https://api.pateway.ai` | — |

## 研究机构

| 厂商 | Base URL | 推荐模型 |
|------|----------|----------|
| Nous Research | `https://inference-api.nousresearch.com/v1` | `Hermes-4-405B` |

## 本地 / 自部署

| 方案 | Base URL | 说明 |
|------|----------|------|
| Ollama | `http://localhost:11434/v1` | 需先 `ollama pull <model>` |
| vLLM | `http://localhost:8000/v1` | 自部署推理框架 |
| LM Studio | `http://localhost:1234/v1` | 桌面端本地推理 |
